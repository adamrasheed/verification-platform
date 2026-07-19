import type {
  CanonicalValue,
  Sha256Digest,
} from "./primitives.js";

export type CanonicalJsonErrorCode =
  | "CYCLE"
  | "DUPLICATE_KEY"
  | "INVALID_JSON"
  | "INVALID_NUMBER"
  | "INVALID_OBJECT"
  | "INVALID_STRING"
  | "INVALID_TYPE"
  | "SPARSE_ARRAY";

export class CanonicalJsonError extends TypeError {
  readonly code: CanonicalJsonErrorCode;
  readonly path: string;

  constructor(code: CanonicalJsonErrorCode, path: string, message: string) {
    super(`${code} at ${path}: ${message}`);
    this.name = "CanonicalJsonError";
    this.code = code;
    this.path = path;
  }
}

export type Sha256Function = (
  bytes: Uint8Array,
) => Sha256Digest | Promise<Sha256Digest>;

function assertUnicodeScalarString(value: string, path: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new CanonicalJsonError(
          "INVALID_STRING",
          path,
          "unpaired high surrogate",
        );
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new CanonicalJsonError(
        "INVALID_STRING",
        path,
        "unpaired low surrogate",
      );
    }
  }
}

function propertyPath(parent: string, key: string): string {
  return `${parent}[${JSON.stringify(key)}]`;
}

function serialize(
  value: unknown,
  path: string,
  ancestors: Set<object>,
): string {
  if (value === null) return "null";

  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "string":
      assertUnicodeScalarString(value, path);
      return JSON.stringify(value);
    case "number": {
      if (!Number.isFinite(value)) {
        throw new CanonicalJsonError(
          "INVALID_NUMBER",
          path,
          "number must be finite",
        );
      }
      return Object.is(value, -0) ? "0" : JSON.stringify(value);
    }
    case "object": {
      const object = value as object;
      if (ancestors.has(object)) {
        throw new CanonicalJsonError("CYCLE", path, "cyclic value");
      }
      ancestors.add(object);
      try {
        if (Array.isArray(value)) {
          const items: string[] = [];
          for (let index = 0; index < value.length; index += 1) {
            if (!Object.hasOwn(value, index)) {
              throw new CanonicalJsonError(
                "SPARSE_ARRAY",
                `${path}[${index}]`,
                "array entries must be present",
              );
            }
            items.push(serialize(value[index], `${path}[${index}]`, ancestors));
          }
          return `[${items.join(",")}]`;
        }

        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
          throw new CanonicalJsonError(
            "INVALID_OBJECT",
            path,
            "only ordinary or null-prototype objects are allowed",
          );
        }

        const record = value as Record<string, unknown>;
        const keys = Object.keys(record).sort();
        const members: string[] = [];
        for (const key of keys) {
          assertUnicodeScalarString(key, propertyPath(path, key));
          const childPath = propertyPath(path, key);
          members.push(
            `${JSON.stringify(key)}:${serialize(record[key], childPath, ancestors)}`,
          );
        }
        return `{${members.join(",")}}`;
      } finally {
        ancestors.delete(object);
      }
    }
    default:
      throw new CanonicalJsonError(
        "INVALID_TYPE",
        path,
        `unsupported type ${typeof value}`,
      );
  }
}

export function canonicalize(value: CanonicalValue): string {
  return serialize(value, "$", new Set<object>());
}

export function encodeCanonical(value: CanonicalValue): Uint8Array {
  return new TextEncoder().encode(canonicalize(value));
}

export async function canonicalSha256(
  value: CanonicalValue,
  sha256: Sha256Function,
): Promise<Sha256Digest> {
  const digest = await sha256(encodeCanonical(value));
  if (!/^sha256:[a-f0-9]{64}$/.test(digest)) {
    throw new TypeError("sha256 function returned an invalid digest");
  }
  return digest;
}

/**
 * Parses an I-JSON document without losing duplicate-key information at the
 * JSON.parse trust boundary.
 */
export function parseCanonicalJson(text: string): CanonicalValue {
  let offset = 0;
  const whitespace = (): void => {
    while (offset < text.length && /[\t\n\r ]/.test(text[offset] ?? "")) offset += 1;
  };
  const invalid = (message: string): never => {
    throw new CanonicalJsonError("INVALID_JSON", `$@${offset}`, message);
  };
  const stringValue = (): string => {
    if (text[offset] !== "\"") return invalid("expected string");
    const start = offset;
    offset += 1;
    while (offset < text.length) {
      const character = text[offset];
      if (character === "\"") {
        offset += 1;
        try {
          const value = JSON.parse(text.slice(start, offset)) as unknown;
          if (typeof value !== "string") return invalid("invalid string");
          assertUnicodeScalarString(value, `$@${start}`);
          return value;
        } catch (error) {
          if (error instanceof CanonicalJsonError) throw error;
          return invalid("invalid string escape");
        }
      }
      if (character === "\\") {
        offset += 2;
      } else {
        if ((character?.charCodeAt(0) ?? 0) < 0x20) return invalid("unescaped control character");
        offset += 1;
      }
    }
    return invalid("unterminated string");
  };
  const value = (): CanonicalValue => {
    whitespace();
    const character = text[offset];
    if (character === "\"") return stringValue();
    if (character === "[") {
      offset += 1;
      whitespace();
      const output: CanonicalValue[] = [];
      if (text[offset] === "]") {
        offset += 1;
        return output;
      }
      while (true) {
        output.push(value());
        whitespace();
        if (text[offset] === "]") {
          offset += 1;
          return output;
        }
        if (text[offset] !== ",") return invalid("expected comma or closing bracket");
        offset += 1;
      }
    }
    if (character === "{") {
      offset += 1;
      whitespace();
      const output: Record<string, CanonicalValue> = {};
      const keys = new Set<string>();
      if (text[offset] === "}") {
        offset += 1;
        return output;
      }
      while (true) {
        whitespace();
        const keyOffset = offset;
        const key = stringValue();
        if (keys.has(key)) {
          throw new CanonicalJsonError("DUPLICATE_KEY", `$@${keyOffset}`, `duplicate object key ${JSON.stringify(key)}`);
        }
        keys.add(key);
        whitespace();
        if (text[offset] !== ":") return invalid("expected colon");
        offset += 1;
        output[key] = value();
        whitespace();
        if (text[offset] === "}") {
          offset += 1;
          return output;
        }
        if (text[offset] !== ",") return invalid("expected comma or closing brace");
        offset += 1;
      }
    }
    for (const [token, parsed] of [
      ["true", true],
      ["false", false],
      ["null", null],
    ] as const) {
      if (text.startsWith(token, offset)) {
        offset += token.length;
        return parsed;
      }
    }
    const number = text.slice(offset).match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/);
    if (number) {
      offset += number[0].length;
      const parsed = Number(number[0]);
      if (!Number.isFinite(parsed)) {
        throw new CanonicalJsonError("INVALID_NUMBER", `$@${offset}`, "number must be finite");
      }
      return parsed;
    }
    return invalid("expected JSON value");
  };
  const parsed = value();
  whitespace();
  if (offset !== text.length) invalid("trailing content");
  canonicalize(parsed);
  return parsed;
}
