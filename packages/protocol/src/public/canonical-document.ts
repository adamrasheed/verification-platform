import {
  encodeCanonical,
  parseCanonicalJson,
} from "@verify-internal/contracts";
import type { CanonicalValue } from "@verify-internal/contracts";

/**
 * Canonical protocol encoding shared by adapters and boundary clients. The
 * domain package remains the authority for the encoding rules.
 */
export function encodeCanonicalProtocolDocument(value: unknown): Uint8Array {
  return encodeCanonical(value as CanonicalValue);
}

/**
 * Parses I-JSON without losing duplicate-key information at the trust
 * boundary. Callers must still validate the returned document's schema.
 */
export function parseCanonicalProtocolDocument(text: string): unknown {
  return parseCanonicalJson(text);
}
