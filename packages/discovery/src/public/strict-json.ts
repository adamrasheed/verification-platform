import {
  CanonicalJsonError,
  parseCanonicalJson,
} from "@verify-internal/contracts";

export class StructuredDataError extends SyntaxError {
  readonly code: "DUPLICATE_KEY" | "INVALID_JSON";

  constructor(
    code: "DUPLICATE_KEY" | "INVALID_JSON",
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "StructuredDataError";
    this.code = code;
  }
}

/**
 * Discovery-owned compatibility wrapper around the contracts trust-boundary
 * parser. No repository JSON passes through JSON.parse before duplicate-key
 * and I-JSON validation.
 */
export function parseJsonData(text: string): unknown {
  try {
    return parseCanonicalJson(text);
  } catch (error) {
    if (error instanceof CanonicalJsonError) {
      throw new StructuredDataError(
        error.code === "DUPLICATE_KEY" ? "DUPLICATE_KEY" : "INVALID_JSON",
        error.message,
      );
    }
    throw error;
  }
}
