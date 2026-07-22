import assert from "node:assert/strict";
import {
  createHmac,
  generateKeyPairSync,
  sign,
  verify,
} from "node:crypto";
import test from "node:test";
import {
  InMemoryPublicationMappingStore,
  PublicationIdentifierService,
  assertMetadataPublicationPayload,
  policySigningBytes,
  prepareDisclosure,
  verifyDisclosureBytes,
  verifySignedPolicyDistribution,
} from "../dist/public/index.js";

const digest = (character) => `sha256:${character.repeat(64)}`;
const ref = (objectType, id, tenantBinding = "tenant:one") => ({
  objectType,
  publicationId: `pub:${id}`,
  tenantBinding,
});

function payload() {
  return {
    schemaVersion: 1,
    kind: "publishedVerification",
    purpose: "verification.metadata",
    tenantId: "tenant:one",
    projectId: "project:one",
    runId: "run:local-opaque",
    idempotencyKey: "idempotency:one",
    applicationModel: ref("applicationModel", "model"),
    operationalStatus: "completed",
    outcome: "violated",
    engine: { id: "engine", version: "1.0.0", artifactDigest: digest("a") },
    protocolVersion: 1,
    plugins: [{ id: "plugin", version: "1.0.0", artifactDigest: digest("b") }],
    promises: [{
      promise: ref("promise", "promise"),
      status: "violated",
      reasonCodes: ["DECLARATION_MISSING"],
    }],
    proofs: [{
      proof: ref("proof", "proof"),
      status: "failed",
      reasonCodes: ["DECLARATION_MISSING"],
      durationMs: 12,
    }],
    evidence: [{
      evidence: ref("evidence", "evidence"),
      evidenceType: "workspace.declaration",
      byteSize: 42,
      sensitivityClass: "SENSITIVE_EVIDENCE",
    }],
    summary: { promiseCount: 1, proofCount: 1, evidenceCount: 1, durationMs: 24 },
    applicationAlias: "Example service",
    auditCorrelationId: "audit:one",
    retentionClass: "metadata-30d",
  };
}

test("metadata publication is a closed allowlist with tenant-bound references", () => {
  assert.doesNotThrow(() => assertMetadataPublicationPayload(payload()));
  assert.throws(
    () => assertMetadataPublicationPayload({ ...payload(), source: "private" }),
    /VFY_CLOUD_PAYLOAD_MALFORMED/,
  );
  const mismatched = payload();
  mismatched.promises[0].promise.tenantBinding = "tenant:other";
  assert.throws(() => assertMetadataPublicationPayload(mismatched), /VFY_CLOUD_PAYLOAD_MALFORMED/);
  const inconsistent = payload();
  inconsistent.summary.promiseCount = 2;
  assert.throws(() => assertMetadataPublicationPayload(inconsistent), /VFY_CLOUD_PAYLOAD_MALFORMED/);
});

test("disclosure preview binds exact canonical bytes, fields, destination, and retention", () => {
  const prepared = prepareDisclosure(payload(), {
    payloadSchemaMinor: 0,
    retentionPolicy: { id: "retention:metadata", revision: "revision:1" },
    expiresAt: "2026-07-22T23:00:00Z",
  });
  const verified = verifyDisclosureBytes(
    prepared.payloadBytes,
    prepared.manifest,
    prepared.manifestDigest,
    new Date("2026-07-22T22:00:00Z"),
  );
  assert.deepEqual(verified, payload());
  assert.equal(prepared.manifest.destination.tenantId, "tenant:one");
  assert.equal(prepared.manifest.fields.every((field) => field.classification === "MINIMAL_METADATA"), true);
  assert.equal(prepared.manifest.fields.some((field) => field.path === "/applicationAlias"), true);

  const whitespaceDrift = new TextEncoder().encode(
    `${new TextDecoder().decode(prepared.payloadBytes)}\n`,
  );
  assert.throws(
    () => verifyDisclosureBytes(
      whitespaceDrift,
      prepared.manifest,
      prepared.manifestDigest,
      new Date("2026-07-22T22:00:00Z"),
    ),
    /VFY_DISCLOSURE_DRIFT/,
  );
  const changedManifest = structuredClone(prepared.manifest);
  changedManifest.destination.projectId = "project:other";
  assert.throws(
    () => verifyDisclosureBytes(
      prepared.payloadBytes,
      changedManifest,
      prepared.manifestDigest,
      new Date("2026-07-22T22:00:00Z"),
    ),
    /VFY_DISCLOSURE_DRIFT/,
  );
  assert.throws(
    () => verifyDisclosureBytes(
      prepared.payloadBytes,
      prepared.manifest,
      prepared.manifestDigest,
      new Date("2026-07-22T23:00:00Z"),
    ),
    /VFY_DISCLOSURE_EXPIRED/,
  );
});

test("disclosure parsing rejects duplicate keys and payload fields added after preview", () => {
  const prepared = prepareDisclosure(payload(), {
    payloadSchemaMinor: 0,
    retentionPolicy: { id: "retention:metadata", revision: "revision:1" },
    expiresAt: "2026-07-22T23:00:00Z",
  });
  const duplicate = new TextEncoder().encode(
    new TextDecoder().decode(prepared.payloadBytes).replace(
      '"schemaVersion":1',
      '"schemaVersion":1,"schemaVersion":1',
    ),
  );
  assert.throws(
    () => verifyDisclosureBytes(
      duplicate,
      prepared.manifest,
      prepared.manifestDigest,
      new Date("2026-07-22T22:00:00Z"),
    ),
    /duplicate object key/,
  );
});

function keyOperation(keyId, secret) {
  return {
    keyId,
    createdAt: "2026-07-22T20:00:00Z",
    mac(bytes) {
      return new Uint8Array(createHmac("sha256", secret).update(bytes).digest());
    },
  };
}

test("publication IDs are keyed, tenant/object separated, and stable across rotation", async () => {
  let active = keyOperation("local-key:1", Buffer.alloc(32, 1));
  const mappings = new InMemoryPublicationMappingStore();
  const service = new PublicationIdentifierService({ activeKey: () => active }, mappings);
  const subject = {
    kind: "promise",
    id: "promise:local",
    revision: digest("c"),
    schemaVersion: 1,
  };
  const first = await service.derive("tenant:one", "promise", subject, "2026-07-22T21:00:00Z");
  const otherTenant = await service.derive("tenant:two", "promise", subject, "2026-07-22T21:00:00Z");
  const otherDomain = await service.derive(
    "tenant:one",
    "proof",
    { ...subject, kind: "proof" },
    "2026-07-22T21:00:00Z",
  );
  assert.notEqual(first.publishedObject.publicationId, otherTenant.publishedObject.publicationId);
  assert.notEqual(first.publishedObject.publicationId, otherDomain.publishedObject.publicationId);
  assert.equal(JSON.stringify(first.publishedObject).includes(subject.revision), false);
  assert.equal(Object.hasOwn(first.publishedObject, "keyId"), false);

  active = keyOperation("local-key:2", Buffer.alloc(32, 2));
  const retained = await service.derive("tenant:one", "promise", subject, "2026-07-22T22:00:00Z");
  assert.deepEqual(retained, first, "an existing mapping survives active-key rotation");
  const fresh = await service.derive(
    "tenant:one",
    "promise",
    { ...subject, revision: digest("d") },
    "2026-07-22T22:00:00Z",
  );
  assert.equal(fresh.localKeyId, "local-key:2");
  assert.notEqual(fresh.publishedObject.publicationId, first.publishedObject.publicationId);
  await assert.rejects(
    service.derive(
      "tenant:one",
      "proof",
      subject,
      "2026-07-22T22:00:00Z",
    ),
    /subject kind does not match object type/,
  );
});

test("publication identifier derivation fails closed on invalid MAC output", async () => {
  const service = new PublicationIdentifierService({
    activeKey: () => ({
      keyId: "local-key:invalid",
      createdAt: "2026-07-22T20:00:00Z",
      mac: () => new Uint8Array(16),
    }),
  }, new InMemoryPublicationMappingStore());
  await assert.rejects(
    service.derive("tenant:one", "promise", {
      kind: "promise",
      id: "promise:local",
      revision: digest("e"),
      schemaVersion: 1,
    }, "2026-07-22T22:00:00Z"),
    /VFY_PUBLICATION_KEY_INVALID/,
  );
});

test("publication identifier collisions fail closed", async () => {
  const service = new PublicationIdentifierService({
    activeKey: () => ({
      keyId: "local-key:constant-test-double",
      createdAt: "2026-07-22T20:00:00Z",
      mac: () => new Uint8Array(32),
    }),
  }, new InMemoryPublicationMappingStore());
  const base = {
    kind: "promise",
    id: "promise:local",
    revision: digest("f"),
    schemaVersion: 1,
  };
  await service.derive("tenant:one", "promise", base, "2026-07-22T22:00:00Z");
  await assert.rejects(
    service.derive(
      "tenant:one",
      "promise",
      { ...base, revision: digest("0") },
      "2026-07-22T22:00:00Z",
    ),
    /VFY_PUBLICATION_ID_COLLISION/,
  );
});

test("signed policies are exact-byte, tenant-bound, and validity-bound", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const unsigned = {
    bundle: {
      schemaVersion: 1,
      tenantId: "tenant:one",
      policyId: "policy:publication",
      revisionId: "revision:1",
      issuedAt: "2026-07-22T20:00:00Z",
      expiresAt: "2026-07-23T20:00:00Z",
      actions: ["publication.create"],
      publicationRules: [{
        purpose: "verification.metadata",
        payloadSchemaMajor: 1,
        retentionClasses: ["metadata-30d"],
      }],
    },
    signature: { algorithm: "Ed25519", keyId: "policy-key:1", value: "A".repeat(86) },
  };
  const signature = sign(null, policySigningBytes(unsigned), privateKey).toString("base64url");
  const distribution = { ...unsigned, signature: { ...unsigned.signature, value: signature } };
  const bundle = await verifySignedPolicyDistribution(
    distribution,
    "tenant:one",
    new Date("2026-07-22T21:00:00Z"),
    (_keyId, bytes, signatureBytes) => verify(null, bytes, publicKey, signatureBytes),
  );
  assert.equal(bundle.policyId, "policy:publication");
  await assert.rejects(
    verifySignedPolicyDistribution(
      distribution,
      "tenant:other",
      new Date("2026-07-22T21:00:00Z"),
      () => true,
    ),
    /VFY_POLICY_TENANT_MISMATCH/,
  );
  await assert.rejects(
    verifySignedPolicyDistribution(
      distribution,
      "tenant:one",
      new Date("2026-07-24T21:00:00Z"),
      () => true,
    ),
    /VFY_POLICY_EXPIRED/,
  );
});
