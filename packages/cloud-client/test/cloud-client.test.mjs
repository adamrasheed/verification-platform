import assert from "node:assert/strict";
import {
  createHash,
  createHmac,
  generateKeyPairSync,
  sign,
  verify,
} from "node:crypto";
import test from "node:test";
import { encodeCanonicalProtocolDocument } from "@verify-internal/protocol";
import {
  InMemoryPublicationIngestionStore,
  InMemoryPublicationMappingStore,
  PublicationIngestionService,
  PublicationIdentifierService,
  PublicationOutboxWorker,
  assertMetadataPublicationPayload,
  issuePublicationIntent,
  policySigningBytes,
  prepareDisclosure,
  verifyDisclosureBytes,
  verifySignedPolicyDistribution,
} from "../dist/public/index.js";

const digest = (character) => `sha256:${character.repeat(64)}`;
const publicationCharacters = {
  model: "A",
  promise: "B",
  proof: "C",
  evidence: "D",
};
const ref = (objectType, id, tenantBinding = "tenant:one") => ({
  objectType,
  publicationId: `pub_v1_${(publicationCharacters[id] ?? "Z").repeat(43)}`,
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
  const localRevisionLeak = payload();
  localRevisionLeak.applicationModel.publicationId = digest("f");
  assert.throws(
    () => assertMetadataPublicationPayload(localRevisionLeak),
    /VFY_CLOUD_PAYLOAD_MALFORMED/,
  );
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

function publicationPolicy() {
  return {
    schemaVersion: 1,
    tenantId: "tenant:one",
    policyId: "policy:publication",
    revisionId: "revision:1",
    issuedAt: "2026-07-22T20:00:00Z",
    expiresAt: "2026-07-23T20:00:00Z",
    actions: ["run:publish"],
    publicationRules: [{
      purpose: "verification.metadata",
      payloadSchemaMajor: 1,
      retentionClasses: ["metadata-30d"],
    }],
  };
}

const publicationLimits = {
  maxEncodedPayloadBytes: 1_048_576,
  maxPromiseCount: 10_000,
  maxProofCount: 50_000,
  maxEvidenceCount: 50_000,
};

async function publicationRequest({
  document = payload(),
  nonce = "nonce:one",
  intentId = "intent:one",
  issuedAt = "2026-07-22T21:00:00Z",
  expiresAt = "2026-07-22T21:05:00Z",
  limits = publicationLimits,
  keyPair = generateKeyPairSync("ed25519"),
  manifestMutation,
} = {}) {
  const prepared = prepareDisclosure(document, {
    payloadSchemaMinor: 0,
    retentionPolicy: { id: "retention:metadata", revision: "revision:1" },
    expiresAt: "2026-07-22T22:00:00Z",
  });
  if (manifestMutation) manifestMutation(prepared);
  const signedIntent = await issuePublicationIntent(
    prepared.manifest,
    prepared.manifestDigest,
    publicationPolicy(),
    {
      intentId,
      nonce,
      idempotencyKey: document.idempotencyKey,
      retentionClass: document.retentionClass,
      issuedAt,
      expiresAt,
      limits,
    },
    {
      keyId: "publication-key:one",
      sign: (bytes) => new Uint8Array(sign(null, bytes, keyPair.privateKey)),
    },
  );
  return {
    prepared,
    keyPair,
    request: {
      signedIntent,
      manifest: prepared.manifest,
      manifestDigest: prepared.manifestDigest,
      payloadBytes: prepared.payloadBytes,
      idempotencyKey: document.idempotencyKey,
      contentType: "application/json",
      contentEncoding: "identity",
    },
  };
}

function publicationVerifier(publicKey) {
  return (_keyId, bytes, signature) => verify(null, bytes, publicKey, signature);
}

test("a short-lived publication intent binds the exact authorized upload", async () => {
  const fixture = await publicationRequest();
  const store = new InMemoryPublicationIngestionStore();
  const service = new PublicationIngestionService(
    store,
    publicationVerifier(fixture.keyPair.publicKey),
  );
  const authorization = { tenantId: "tenant:one", projectId: "project:one" };
  const now = new Date("2026-07-22T21:01:00Z");
  const first = await service.ingest(fixture.request, authorization, now);
  const retry = await service.ingest(structuredClone(fixture.request), authorization, now);
  assert.deepEqual(retry, first);
  assert.equal(first.intentId, "intent:one");
  assert.equal(store.size, 1, "an exact retry does not create another publication");
  assert.equal(store.publishedRunCount, 1);
  assert.equal(store.outboxCount, 1);
  const retained = store.readPublishedRun(authorization, first.publishedRunId);
  assert.deepEqual(retained, payload());
  retained.outcome = "satisfied";
  assert.equal(
    store.readPublishedRun(authorization, first.publishedRunId).outcome,
    "violated",
    "reads cannot mutate or recalculate the retained projection",
  );
  assert.equal(
    store.readPublishedRun(
      { tenantId: "tenant:other", projectId: "project:one" },
      first.publishedRunId,
    ),
    undefined,
  );
  assert.equal(
    store.readPublishedRun(
      { tenantId: "tenant:one", projectId: "project:other" },
      first.publishedRunId,
    ),
    undefined,
  );

  const countLimited = await publicationRequest({
    keyPair: fixture.keyPair,
    nonce: "nonce:limited",
    intentId: "intent:limited",
    limits: { ...publicationLimits, maxPromiseCount: 0 },
  });
  await assert.rejects(
    service.ingest(countLimited.request, authorization, now),
    /VFY_PUBLICATION_LIMIT_EXCEEDED/,
  );

  await assert.rejects(
    service.ingest(fixture.request, { ...authorization, tenantId: "tenant:other" }, now),
    /VFY_PUBLICATION_NOT_AUTHORIZED/,
  );
  await assert.rejects(
    service.ingest(fixture.request, authorization, new Date("2026-07-22T21:05:00Z")),
    /VFY_PUBLICATION_INTENT_EXPIRED/,
  );
});

test("intent issuance rejects digest, policy, and lifetime drift", async () => {
  const prepared = prepareDisclosure(payload(), {
    payloadSchemaMinor: 0,
    retentionPolicy: { id: "retention:metadata", revision: "revision:1" },
    expiresAt: "2026-07-22T22:00:00Z",
  });
  const signing = {
    keyId: "publication-key:one",
    sign: () => new Uint8Array(64),
  };
  const options = {
    intentId: "intent:one",
    nonce: "nonce:one",
    idempotencyKey: "idempotency:one",
    retentionClass: "metadata-30d",
    issuedAt: "2026-07-22T21:00:00Z",
    expiresAt: "2026-07-22T21:05:00Z",
    limits: publicationLimits,
  };
  await assert.rejects(
    issuePublicationIntent(
      prepared.manifest,
      digest("0"),
      publicationPolicy(),
      options,
      signing,
    ),
    /VFY_PUBLICATION_INTENT_MISMATCH/,
  );
  await assert.rejects(
    issuePublicationIntent(
      prepared.manifest,
      prepared.manifestDigest,
      { ...publicationPolicy(), actions: [] },
      options,
      signing,
    ),
    /VFY_PUBLICATION_POLICY_DENIED/,
  );
  await assert.rejects(
    issuePublicationIntent(
      prepared.manifest,
      prepared.manifestDigest,
      publicationPolicy(),
      { ...options, expiresAt: "2026-07-22T21:05:00.001Z" },
      signing,
    ),
    /VFY_PUBLICATION_INTENT_MALFORMED/,
  );
});

test("idempotency and nonce replay conflicts are atomic", async () => {
  const keyPair = generateKeyPairSync("ed25519");
  const first = await publicationRequest({ keyPair });
  const changedDocument = payload();
  changedDocument.applicationAlias = "Changed but still allowlisted";
  const changed = await publicationRequest({
    document: changedDocument,
    keyPair,
    nonce: "nonce:two",
    intentId: "intent:two",
  });
  const replayDocument = payload();
  replayDocument.idempotencyKey = "idempotency:two";
  const replay = await publicationRequest({
    document: replayDocument,
    keyPair,
    nonce: "nonce:one",
    intentId: "intent:three",
  });
  const store = new InMemoryPublicationIngestionStore();
  const service = new PublicationIngestionService(store, publicationVerifier(keyPair.publicKey));
  const authorization = { tenantId: "tenant:one", projectId: "project:one" };
  const now = new Date("2026-07-22T21:01:00Z");
  await service.ingest(first.request, authorization, now);
  await assert.rejects(
    service.ingest(changed.request, authorization, now),
    /VFY_PUBLICATION_IDEMPOTENCY_CONFLICT/,
  );
  await assert.rejects(
    service.ingest(replay.request, authorization, now),
    /VFY_PUBLICATION_REPLAY_DETECTED/,
  );
  assert.equal(store.size, 1, "conflicts reveal no partial admission");
});

test("ingestion rejects hostile transport, deep JSON, and signature drift before admission", async () => {
  const fixture = await publicationRequest();
  const store = new InMemoryPublicationIngestionStore();
  const service = new PublicationIngestionService(
    store,
    publicationVerifier(fixture.keyPair.publicKey),
  );
  const authorization = { tenantId: "tenant:one", projectId: "project:one" };
  const now = new Date("2026-07-22T21:01:00Z");
  await assert.rejects(
    service.ingest({ ...fixture.request, contentEncoding: "gzip" }, authorization, now),
    /VFY_PUBLICATION_CONTENT_TYPE_DENIED/,
  );
  const tampered = structuredClone(fixture.request);
  tampered.signedIntent.signature.value = `A${tampered.signedIntent.signature.value.slice(1)}`;
  await assert.rejects(
    service.ingest(tampered, authorization, now),
    /VFY_PUBLICATION_INTENT_SIGNATURE_INVALID/,
  );
  const unknown = structuredClone(fixture.request);
  unknown.signedIntent.intent.source = "must-never-enter-cloud";
  await assert.rejects(
    service.ingest(unknown, authorization, now),
    /VFY_PUBLICATION_INTENT_MALFORMED/,
  );

  const deepBytes = new TextEncoder().encode(`${"[".repeat(33)}0${"]".repeat(33)}`);
  const deep = await publicationRequest({
    keyPair: fixture.keyPair,
    nonce: "nonce:deep",
    intentId: "intent:deep",
    manifestMutation(prepared) {
      prepared.payloadBytes = deepBytes;
      prepared.manifest.payloadDigest = `sha256:${createHash("sha256").update(deepBytes).digest("hex")}`;
      prepared.manifest.encodedPayloadBytes = deepBytes.byteLength;
      prepared.manifestDigest = `sha256:${createHash("sha256").update(
        encodeCanonicalProtocolDocument(prepared.manifest),
      ).digest("hex")}`;
    },
  });
  await assert.rejects(
    service.ingest(deep.request, authorization, now),
    /VFY_CLOUD_PAYLOAD_TOO_DEEP/,
  );
  assert.equal(store.size, 0);
});

test("projection, idempotency, nonce, and outbox admission is one atomic unit", async () => {
  const fixture = await publicationRequest();
  const store = new InMemoryPublicationIngestionStore((point) => {
    if (point === "before-admission-commit") throw new Error("fault:admission");
  });
  const service = new PublicationIngestionService(
    store,
    publicationVerifier(fixture.keyPair.publicKey),
  );
  await assert.rejects(
    service.ingest(
      fixture.request,
      { tenantId: "tenant:one", projectId: "project:one" },
      new Date("2026-07-22T21:01:00Z"),
    ),
    /fault:admission/,
  );
  assert.equal(store.size, 0);
  assert.equal(store.publishedRunCount, 0);
  assert.equal(store.outboxCount, 0);
});

test("outbox retries retain one event identity and reject stale fences", async () => {
  const fixture = await publicationRequest();
  const store = new InMemoryPublicationIngestionStore();
  const service = new PublicationIngestionService(
    store,
    publicationVerifier(fixture.keyPair.publicKey),
  );
  await service.ingest(
    fixture.request,
    { tenantId: "tenant:one", projectId: "project:one" },
    new Date("2026-07-22T21:01:00Z"),
  );
  const firstClaim = store.claimOutbox(
    "worker:stale",
    new Date("2026-07-22T21:01:00Z"),
    1_000,
  );
  const replacement = store.claimOutbox(
    "worker:replacement",
    new Date("2026-07-22T21:01:02Z"),
    1_000,
  );
  assert.ok(firstClaim);
  assert.ok(replacement);
  assert.equal(replacement.fence, firstClaim.fence + 1);
  await assert.rejects(
    async () => store.acknowledgeOutbox(firstClaim, new Date("2026-07-22T21:01:02Z")),
    /VFY_PUBLICATION_OUTBOX_STALE_FENCE/,
  );
  store.failOutbox(replacement, "DELIVERY_FAILED", new Date("2026-07-22T21:01:02.500Z"));

  let current = new Date("2026-07-22T21:01:03Z");
  const deliveredEventIds = [];
  let deliveries = 0;
  const worker = new PublicationOutboxWorker(
    store,
    (event) => {
      deliveries += 1;
      deliveredEventIds.push(event.eventId);
      if (deliveries === 1) throw new Error("synthetic delivery failure");
    },
    () => current,
  );
  assert.equal(await worker.deliverOne("worker:one", 1_000), "retry");
  current = new Date("2026-07-22T21:01:03.500Z");
  assert.equal(await worker.deliverOne("worker:one", 1_000), "delivered");
  assert.equal(await worker.deliverOne("worker:one", 1_000), "idle");
  assert.equal(new Set(deliveredEventIds).size, 1, "retry delivers one stable event identity");
});
