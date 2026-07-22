import {
  encodeCanonicalProtocolDocument,
} from "@verify-internal/protocol";
import type {
  PolicyBundle,
  PolicySignatureVerifier,
  SignedPolicyDistribution,
} from "./types.js";
import { assertSignedPolicyDistribution } from "./validation.js";

function decodeBase64Url(value: string): Uint8Array {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/") + padding);
  const decoded = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (decoded.byteLength !== 64) {
    throw new TypeError("VFY_POLICY_MALFORMED: Ed25519 signature must be 64 bytes");
  }
  return decoded;
}

export function policySigningBytes(value: SignedPolicyDistribution): Uint8Array {
  assertSignedPolicyDistribution(value);
  return encodeCanonicalProtocolDocument(value.bundle);
}

export async function verifySignedPolicyDistribution(
  value: SignedPolicyDistribution,
  expectedTenantId: string,
  now: Date,
  verifySignature: PolicySignatureVerifier,
): Promise<PolicyBundle> {
  assertSignedPolicyDistribution(value);
  if (value.bundle.tenantId !== expectedTenantId) {
    throw new TypeError("VFY_POLICY_TENANT_MISMATCH: policy belongs to another tenant");
  }
  const time = now.getTime();
  if (!Number.isFinite(time)
    || time < Date.parse(value.bundle.issuedAt)
    || time >= Date.parse(value.bundle.expiresAt)) {
    throw new TypeError("VFY_POLICY_EXPIRED: policy is outside its validity interval");
  }
  const valid = await verifySignature(
    value.signature.keyId,
    policySigningBytes(value),
    decodeBase64Url(value.signature.value),
  );
  if (!valid) throw new TypeError("VFY_POLICY_SIGNATURE_INVALID: signature verification failed");
  return structuredClone(value.bundle);
}
