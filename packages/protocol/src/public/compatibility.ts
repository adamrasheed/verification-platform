import {
  protocolError,
  type StructuredError,
} from "./errors.js";

export interface CompatibilityPolicy {
  readonly currentMajor: number;
  readonly previousMajor?: number;
}

export type SchemaMajorSupport =
  | "current"
  | "previous"
  | "unsupported"
  | "invalid";

export interface VersionedDocument {
  readonly schemaVersion: number;
}

export type MajorReader<T> = (value: unknown) => T;

export interface CompatibilityReaders<T> {
  readonly policy: CompatibilityPolicy;
  readonly current: MajorReader<T>;
  readonly previous?: MajorReader<T>;
}

export type CompatibilityReadResult<T> =
  | {
      readonly kind: "ok";
      readonly support: "current" | "previous";
      readonly value: T;
    }
  | {
      readonly kind: "unsupported";
      readonly error: StructuredError;
    }
  | {
      readonly kind: "invalid";
      readonly error: StructuredError;
    };

function validMajor(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

export function createCompatibilityPolicy(
  currentMajor: number,
  previousMajor?: number,
): CompatibilityPolicy {
  if (!validMajor(currentMajor)) {
    throw new TypeError("current schema major must be a positive integer");
  }
  if (
    previousMajor !== undefined &&
    (!validMajor(previousMajor) || previousMajor !== currentMajor - 1)
  ) {
    throw new TypeError("previous major must immediately precede current major");
  }
  return previousMajor === undefined
    ? { currentMajor }
    : { currentMajor, previousMajor };
}

export const COMMAND_PROTOCOL_COMPATIBILITY: CompatibilityPolicy =
  createCompatibilityPolicy(1);

export function classifySchemaMajor(
  schemaVersion: unknown,
  policy: CompatibilityPolicy,
): SchemaMajorSupport {
  if (
    typeof schemaVersion !== "number" ||
    !Number.isSafeInteger(schemaVersion) ||
    schemaVersion <= 0
  ) {
    return "invalid";
  }
  if (schemaVersion === policy.currentMajor) return "current";
  if (
    policy.previousMajor !== undefined &&
    schemaVersion === policy.previousMajor
  ) {
    return "previous";
  }
  return "unsupported";
}

function readError(
  code:
    | "VFY_REQUEST_INVALID"
    | "VFY_COMPATIBILITY_UNSUPPORTED_SCHEMA",
  message: string,
): StructuredError {
  return protocolError(code, message, "readCompatible");
}

export function readCompatible<T>(
  value: unknown,
  readers: CompatibilityReaders<T>,
): CompatibilityReadResult<T> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !("schemaVersion" in value)
  ) {
    return {
      kind: "invalid",
      error: readError("VFY_REQUEST_INVALID", "missing schemaVersion"),
    };
  }
  const support = classifySchemaMajor(
    (value as Record<string, unknown>).schemaVersion,
    readers.policy,
  );
  if (support === "invalid") {
    return {
      kind: "invalid",
      error: readError("VFY_REQUEST_INVALID", "invalid schemaVersion"),
    };
  }
  if (support === "unsupported") {
    return {
      kind: "unsupported",
      error: readError(
        "VFY_COMPATIBILITY_UNSUPPORTED_SCHEMA",
        "unsupported schema major",
      ),
    };
  }
  if (support === "previous") {
    if (readers.previous === undefined) {
      return {
        kind: "unsupported",
        error: readError(
          "VFY_COMPATIBILITY_UNSUPPORTED_SCHEMA",
          "previous-major reader is unavailable",
        ),
      };
    }
    return { kind: "ok", support, value: readers.previous(value) };
  }
  return { kind: "ok", support, value: readers.current(value) };
}
