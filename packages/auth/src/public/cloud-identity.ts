import {
  createPublicKey,
  verify as verifySignature,
} from "node:crypto";
import { parseCanonicalJson } from "@verify-internal/contracts";
import type { CloudPrincipal } from "./cloud-authorization.js";

const MAXIMUM_TOKEN_BYTES = 16_384;
const MAXIMUM_TOKEN_LIFETIME_SECONDS = 15 * 60;

type RecordValue = Record<string, unknown>;

export interface CloudIdentityVerificationKey {
  readonly keyId: string;
  readonly issuer: string;
  readonly audience: string;
  readonly publicKeyPem: string;
  readonly notBefore: string;
  readonly expiresAt: string;
  readonly revoked: boolean;
}

export type CloudIdentityTokenRevocationCheck = (
  tokenId: string,
  principalId: string,
) => boolean | Promise<boolean>;

export type CloudIdentityTokenDecision =
  | {
      readonly authenticated: true;
      readonly principal: CloudPrincipal;
      readonly tokenId: string;
      readonly keyId: string;
    }
  | {
      readonly authenticated: false;
      readonly reasonCode:
        | "MALFORMED_TOKEN"
        | "UNKNOWN_KEY"
        | "INVALID_SIGNATURE"
        | "INVALID_ISSUER"
        | "INVALID_AUDIENCE"
        | "TOKEN_EXPIRED"
        | "TOKEN_REVOKED";
    };

function record(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: RecordValue, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}

function bounded(value: unknown, maximum = 256): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maximum
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function instant(value: unknown): number | undefined {
  if (typeof value !== "string" || !value.endsWith("Z")) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function base64UrlBytes(value: string, maximum: number): Buffer | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return undefined;
  const bytes = Buffer.from(value, "base64url");
  if (bytes.byteLength === 0
    || bytes.byteLength > maximum
    || bytes.toString("base64url") !== value) return undefined;
  return bytes;
}

function jsonSegment(value: string): unknown {
  const bytes = base64UrlBytes(value, MAXIMUM_TOKEN_BYTES);
  if (!bytes) throw new TypeError("invalid token segment");
  return parseCanonicalJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

function principalKind(
  value: unknown,
): value is CloudPrincipal["kind"] {
  return value === "user"
    || value === "workload"
    || value === "integration"
    || value === "operator";
}

function malformed(): CloudIdentityTokenDecision {
  return { authenticated: false, reasonCode: "MALFORMED_TOKEN" };
}

/**
 * Verifies the closed compact-JWT profile used at the cloud API boundary.
 * Tokens deliberately carry no tenant, role, action, or resource authority;
 * those grants are resolved independently on the server.
 */
export async function verifyCloudIdentityToken(
  token: string,
  keys: readonly CloudIdentityVerificationKey[],
  expectedAudience: string,
  now: Date,
  isRevoked: CloudIdentityTokenRevocationCheck = () => false,
): Promise<CloudIdentityTokenDecision> {
  if (!bounded(token, MAXIMUM_TOKEN_BYTES)
    || !bounded(expectedAudience)
    || !Number.isFinite(now.getTime())) return malformed();
  const segments = token.split(".");
  if (segments.length !== 3) return malformed();
  const [encodedHeader, encodedClaims, encodedSignature] = segments;
  if (!encodedHeader || !encodedClaims || !encodedSignature) return malformed();

  let header: unknown;
  let claims: unknown;
  try {
    header = jsonSegment(encodedHeader);
    claims = jsonSegment(encodedClaims);
  } catch {
    return malformed();
  }
  if (!record(header)
    || !exactKeys(header, ["alg", "kid", "typ"])
    || header.alg !== "EdDSA"
    || header.typ !== "JWT"
    || !bounded(header.kid)
    || !record(claims)
    || !exactKeys(claims, [
      "iss", "sub", "aud", "iat", "exp", "jti", "principalKind",
    ])
    || !bounded(claims.iss)
    || !bounded(claims.sub)
    || !bounded(claims.aud)
    || !bounded(claims.jti)
    || !principalKind(claims.principalKind)
    || !Number.isSafeInteger(claims.iat)
    || !Number.isSafeInteger(claims.exp)) return malformed();

  const matchingKeys = keys.filter((candidate) => candidate.keyId === header.kid);
  const key = matchingKeys[0];
  if (matchingKeys.length !== 1
    || !key
    || key.revoked
    || !bounded(key.issuer)
    || !bounded(key.audience)
    || typeof key.publicKeyPem !== "string"
    || key.publicKeyPem.length === 0
    || key.publicKeyPem.length > 2_048
    || key.publicKeyPem.includes("\u0000")) {
    return { authenticated: false, reasonCode: "UNKNOWN_KEY" };
  }
  if (claims.iss !== key.issuer) {
    return { authenticated: false, reasonCode: "INVALID_ISSUER" };
  }
  if (claims.aud !== expectedAudience || key.audience !== expectedAudience) {
    return { authenticated: false, reasonCode: "INVALID_AUDIENCE" };
  }
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const issuedAt = claims.iat as number;
  const expiresAt = claims.exp as number;
  const keyNotBefore = instant(key.notBefore);
  const keyExpiresAt = instant(key.expiresAt);
  if (keyNotBefore === undefined
    || keyExpiresAt === undefined
    || keyExpiresAt <= keyNotBefore
    || now.getTime() < keyNotBefore
    || now.getTime() >= keyExpiresAt
    || expiresAt <= issuedAt
    || expiresAt - issuedAt > MAXIMUM_TOKEN_LIFETIME_SECONDS
    || nowSeconds < issuedAt
    || nowSeconds >= expiresAt) {
    return { authenticated: false, reasonCode: "TOKEN_EXPIRED" };
  }

  const signature = base64UrlBytes(encodedSignature, 128);
  if (!signature || signature.byteLength !== 64) return malformed();
  let verified = false;
  try {
    const publicKey = createPublicKey(key.publicKeyPem);
    verified = publicKey.asymmetricKeyType === "ed25519"
      && verifySignature(
        null,
        Buffer.from(`${encodedHeader}.${encodedClaims}`, "ascii"),
        publicKey,
        signature,
      );
  } catch {
    verified = false;
  }
  if (!verified) {
    return { authenticated: false, reasonCode: "INVALID_SIGNATURE" };
  }
  if (await isRevoked(claims.jti, claims.sub)) {
    return { authenticated: false, reasonCode: "TOKEN_REVOKED" };
  }
  return {
    authenticated: true,
    principal: {
      kind: claims.principalKind,
      id: claims.sub,
      authenticated: true,
      audience: claims.aud,
      issuedAt: new Date(issuedAt * 1000).toISOString(),
      expiresAt: new Date(expiresAt * 1000).toISOString(),
      revoked: false,
    },
    tokenId: claims.jti,
    keyId: key.keyId,
  };
}
