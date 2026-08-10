import assert from "node:assert/strict";
import {
  generateKeyPairSync,
  sign,
} from "node:crypto";
import test from "node:test";
import { verifyCloudIdentityToken } from "../dist/public/index.js";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const now = new Date("2026-08-10T20:00:00Z");
const issuedAt = Math.floor(now.getTime() / 1000) - 60;
const expiresAt = issuedAt + 15 * 60;

const key = {
  keyId: "key:workload:one",
  issuer: "https://identity.verification.invalid",
  audience: "verify-cloud-api",
  publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  notBefore: "2026-08-10T19:00:00Z",
  expiresAt: "2026-08-11T19:00:00Z",
  revoked: false,
};

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function token(claimOverrides = {}, headerOverrides = {}) {
  const header = encode({
    alg: "EdDSA",
    kid: key.keyId,
    typ: "JWT",
    ...headerOverrides,
  });
  const claims = encode({
    iss: key.issuer,
    sub: "principal:workload:one",
    aud: key.audience,
    iat: issuedAt,
    exp: expiresAt,
    jti: "token:one",
    principalKind: "workload",
    ...claimOverrides,
  });
  const signature = sign(
    null,
    Buffer.from(`${header}.${claims}`, "ascii"),
    privateKey,
  ).toString("base64url");
  return `${header}.${claims}.${signature}`;
}

test("short-lived workload identity verifies without carrying tenant authority", async () => {
  const decision = await verifyCloudIdentityToken(
    token(),
    [key],
    "verify-cloud-api",
    now,
  );
  assert.equal(decision.authenticated, true);
  assert.deepEqual(decision.principal, {
    kind: "workload",
    id: "principal:workload:one",
    authenticated: true,
    audience: "verify-cloud-api",
    issuedAt: new Date(issuedAt * 1000).toISOString(),
    expiresAt: new Date(expiresAt * 1000).toISOString(),
    revoked: false,
  });
  assert.equal(decision.tokenId, "token:one");
  assert.equal("tenantId" in decision.principal, false);
  assert.equal("actions" in decision.principal, false);
});

test("audience, issuer, expiry, key, signature, and token revocation fail closed", async () => {
  const [tamperedHeader, tamperedClaims, tamperedSignature] = token().split(".");
  const tamperedSignatureBytes = Buffer.from(tamperedSignature, "base64url");
  tamperedSignatureBytes[0] ^= 0xff;
  const invalidSignature = `${tamperedHeader}.${tamperedClaims}.${tamperedSignatureBytes.toString("base64url")}`;
  const cases = [
    [token({ aud: "another-api" }), [key], "verify-cloud-api", now, () => false, "INVALID_AUDIENCE"],
    [token({ iss: "https://attacker.invalid" }), [key], "verify-cloud-api", now, () => false, "INVALID_ISSUER"],
    [token({ exp: issuedAt + 16 * 60 }), [key], "verify-cloud-api", now, () => false, "TOKEN_EXPIRED"],
    [token(), [{ ...key, revoked: true }], "verify-cloud-api", now, () => false, "UNKNOWN_KEY"],
    [invalidSignature, [key], "verify-cloud-api", now, () => false, "INVALID_SIGNATURE"],
    [token(), [key], "verify-cloud-api", now, () => true, "TOKEN_REVOKED"],
  ];
  for (const [value, keys, audience, current, revoked, reasonCode] of cases) {
    assert.deepEqual(
      await verifyCloudIdentityToken(value, keys, audience, current, revoked),
      { authenticated: false, reasonCode },
    );
  }
});

test("the token profile rejects duplicate, additive, and algorithm-confused fields", async () => {
  const valid = token();
  const [, encodedClaims, encodedSignature] = valid.split(".");
  const duplicateHeader = Buffer.from(
    `{"alg":"EdDSA","alg":"none","kid":"${key.keyId}","typ":"JWT"}`,
  ).toString("base64url");
  const malformed = `${duplicateHeader}.${encodedClaims}.${encodedSignature}`;
  assert.equal(
    (await verifyCloudIdentityToken(malformed, [key], key.audience, now)).reasonCode,
    "MALFORMED_TOKEN",
  );
  assert.equal(
    (await verifyCloudIdentityToken(token({}, { crit: [] }), [key], key.audience, now)).reasonCode,
    "MALFORMED_TOKEN",
  );
  assert.equal(
    (await verifyCloudIdentityToken(token({}, { alg: "HS256" }), [key], key.audience, now)).reasonCode,
    "MALFORMED_TOKEN",
  );
});
