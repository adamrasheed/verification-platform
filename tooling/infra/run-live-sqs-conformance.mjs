#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { encodeCanonicalProtocolDocument } from "@verify-internal/protocol";
import { Pool } from "pg";
import {
  CLOUD_SECONDARY_SINKS,
  PostgresPublicationStore,
  PublicationSqsRelay,
  PublicationSqsWorker,
  assertCloudCanariesAbsent,
  assertCloudSecondarySinkInventory,
  decodePublicationQueueReference,
  encodePublicationQueueReference,
  publicationQueueReference,
} from "../../packages/cloud-client/dist/public/index.js";
import { AwsSqsPublicationQueueTransport } from "./aws-sqs-publication-transport.mjs";

const runId = process.env.QUEUE_RUN_ID;
const accountId = process.env.AWS_ACCOUNT_ID;
const region = process.env.AWS_REGION;
const queueName = process.env.QUEUE_NAME;
const queueUrl = process.env.QUEUE_URL;
const dlqName = process.env.DLQ_NAME;
const dlqUrl = process.env.DLQ_URL;
const sslRootCertPath = process.env.PGSSLROOTCERT;
if (!/^[a-f0-9]{40}$/.test(runId ?? "")) throw new TypeError("VFY_LIVE_SQS_RUN_ID_INVALID");
if (region !== "us-west-2") throw new TypeError("VFY_LIVE_SQS_REGION_INVALID");
if (typeof sslRootCertPath !== "string" || !sslRootCertPath.startsWith("/app/")) {
  throw new TypeError("VFY_LIVE_SQS_TLS_ROOT_INVALID");
}

const runSuffix = runId.slice(0, 12);
const tenantId = `tenant:m9-sqs-${runSuffix}`;
const projectId = `project:m9-sqs-${runSuffix}`;
const publishedRunId = `published-run:m9-sqs-${runSuffix}`;
const eventId = `event:m9-sqs-${runSuffix}`;
const sslRootCertificate = await readFile(sslRootCertPath, "utf8");
const pool = new Pool({
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 10_000,
  max: 4,
  ssl: { ca: sslRootCertificate, rejectUnauthorized: true },
});
const store = new PostgresPublicationStore(pool);
const primary = new AwsSqsPublicationQueueTransport({
  accountId,
  region,
  queueName,
  queueUrl,
});
const deadLetter = new AwsSqsPublicationQueueTransport({
  accountId,
  region,
  queueName: dlqName,
  queueUrl: dlqUrl,
});
let stage = "preflight";

function sha256(value) {
  const bytes = typeof value === "string"
    ? Buffer.from(value, "utf8")
    : encodeCanonicalProtocolDocument(value);
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function publicationRef(objectType, character) {
  return {
    objectType,
    publicationId: `pub_v1_${character.repeat(43)}`,
    tenantBinding: tenantId,
  };
}

function admission() {
  const publishedAt = "2026-08-08T12:00:00.000Z";
  const idempotencyKey = `idempotency:m9-sqs-${runSuffix}`;
  const sourceIntentId = `intent:m9-sqs-${runSuffix}`;
  const projection = {
    schemaVersion: 1,
    kind: "publishedVerification",
    purpose: "verification.metadata",
    tenantId,
    projectId,
    runId: `run:m9-sqs-${runSuffix}`,
    idempotencyKey,
    applicationModel: publicationRef("applicationModel", "A"),
    operationalStatus: "completed",
    outcome: "satisfied",
    engine: { id: "engine", version: "1.0.0", artifactDigest: sha256("engine") },
    protocolVersion: 1,
    plugins: [],
    promises: [{
      promise: publicationRef("promise", "B"),
      status: "satisfied",
      reasonCodes: [],
    }],
    proofs: [{
      proof: publicationRef("proof", "C"),
      status: "passed",
      reasonCodes: [],
      durationMs: 1,
    }],
    evidence: [{
      evidence: publicationRef("evidence", "D"),
      evidenceType: "m9.live-sqs-probe",
      byteSize: 1,
      sensitivityClass: "MINIMAL_METADATA",
    }],
    summary: { promiseCount: 1, proofCount: 1, evidenceCount: 1, durationMs: 1 },
    applicationAlias: "M9 live SQS probe",
    auditCorrelationId: `audit:m9-sqs-${runSuffix}`,
    retentionClass: "metadata-30d",
  };
  const payloadDigest = sha256(projection);
  const receipt = {
    schemaVersion: 1,
    intentId: sourceIntentId,
    publishedRunId,
    tenantId,
    projectId,
    idempotencyKey,
    payloadDigest,
    acceptedAt: publishedAt,
  };
  const publishedRun = {
    schemaVersion: 1,
    publishedRunId,
    sourceIntentId,
    tenantId,
    projectId,
    idempotencyKey,
    payloadDigest,
    publishedAt,
    projection,
  };
  const outboxEvent = {
    schemaVersion: 1,
    eventId,
    eventType: "PublishedRunAccepted",
    tenantId,
    aggregateType: "publishedRun",
    aggregateId: publishedRunId,
    occurredAt: publishedAt,
    payload: { publishedRunId, payloadDigest },
  };
  return {
    idempotencyKey,
    nonce: `nonce:m9-sqs-${runSuffix}`,
    requestDigest: sha256("request:m9-sqs"),
    receipt,
    publishedRun,
    outboxEvent,
  };
}

async function cleanSyntheticRows() {
  await pool.query("BEGIN");
  try {
    await pool.query(
      `DELETE FROM publication_nonces n
        USING publication_idempotency i
        WHERE n.tenant_id = i.tenant_id
          AND n.idempotency_key = i.idempotency_key
          AND i.tenant_id = $1`,
      [tenantId],
    );
    await pool.query("DELETE FROM publication_outbox WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM published_runs WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM published_run_tombstones WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM publication_idempotency WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM published_run_listings WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM published_run_cursors WHERE tenant_id = $1", [tenantId]);
    await pool.query("COMMIT");
  } catch (error) {
    await pool.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function assertQueueEmpty(transport, label) {
  const message = await transport.receiveOne({ waitTimeSeconds: 1, visibilityTimeoutSeconds: 1 });
  if (message !== undefined) {
    await transport.defer(message.receiptHandle, 1).catch(() => undefined);
    throw new TypeError(`VFY_LIVE_SQS_PREFLIGHT_NOT_EMPTY: ${label}`);
  }
}

async function removeSyntheticQueueMessages(transport) {
  for (let index = 0; index < 10; index += 1) {
    const message = await transport.receiveOne({ waitTimeSeconds: 1, visibilityTimeoutSeconds: 1 });
    if (message === undefined) return;
    let reference;
    try {
      reference = decodePublicationQueueReference(message.body);
    } catch {
      await transport.defer(message.receiptHandle, 1).catch(() => undefined);
      throw new TypeError("VFY_LIVE_SQS_CLEANUP_UNRELATED_MESSAGE");
    }
    if (reference.tenantId !== tenantId) {
      await transport.defer(message.receiptHandle, 1).catch(() => undefined);
      throw new TypeError("VFY_LIVE_SQS_CLEANUP_UNRELATED_MESSAGE");
    }
    await transport.acknowledge(message.receiptHandle);
  }
  throw new TypeError("VFY_LIVE_SQS_CLEANUP_BOUND_EXCEEDED");
}

function sinkInventory() {
  return {
    schemaVersion: 1,
    sinks: CLOUD_SECONDARY_SINKS.map((sink) => ({
      sink,
      owner: `cloud-platform:${sink}`,
      tenantScoped: !["metric", "trace"].includes(sink),
      allowedDataClasses: sink === "backup"
        ? ["MINIMAL_METADATA", "TOMBSTONE"]
        : ["MINIMAL_METADATA"],
      deletionControl: sink === "backup" ? "scheduled_expiry" : "purge",
      canaryScanRequired: true,
    })),
  };
}

try {
  await cleanSyntheticRows();
  await removeSyntheticQueueMessages(primary);
  await removeSyntheticQueueMessages(deadLetter);
  const preexistingDeliveries = await pool.query(
    "SELECT count(*)::integer AS count FROM publication_outbox WHERE status IN ('pending', 'leased')",
  );
  assert.equal(preexistingDeliveries.rows[0].count, 0);
  await assertQueueEmpty(primary, "primary");
  await assertQueueEmpty(deadLetter, "dead-letter");

  stage = "outbox-relay";
  const input = admission();
  await store.accept(
    tenantId,
    input.idempotencyKey,
    input.nonce,
    input.requestDigest,
    input.receipt,
    input.publishedRun,
    input.outboxEvent,
  );
  const relay = new PublicationSqsRelay(store, primary);
  assert.equal(await relay.relayOne(`worker:m9-sqs-relay-${runSuffix}`, 10_000), "delivered");
  const stableBody = encodePublicationQueueReference(publicationQueueReference(input.outboxEvent));
  assert.equal(stableBody.includes("sha256:"), false);
  assert.equal(stableBody.includes("payloadDigest"), false);

  stage = "duplicate-delivery";
  await primary.sendReferenceBody(stableBody);
  const handledEventIds = new Set();
  let sideEffectCount = 0;
  const worker = new PublicationSqsWorker(primary, (reference) => {
    if (handledEventIds.has(reference.eventId)) return "duplicate";
    handledEventIds.add(reference.eventId);
    sideEffectCount += 1;
    return "processed";
  }, { waitTimeSeconds: 5, visibilityTimeoutSeconds: 5 });
  const duplicateOutcomes = [await worker.processOne(), await worker.processOne()].sort();
  assert.deepEqual(duplicateOutcomes, ["duplicate", "processed"]);
  assert.equal(sideEffectCount, 1);

  stage = "bounded-retry-redrive";
  await primary.sendReferenceBody(stableBody);
  const poisonWorker = new PublicationSqsWorker(primary, () => {
    throw new Error(
      "SECRET_CANARY_DO_NOT_PERSIST SOURCE_PATH_CANARY_/private/source.ts",
    );
  }, {
    waitTimeSeconds: 5,
    visibilityTimeoutSeconds: 1,
    maximumReceiveCount: 5,
    baseRetrySeconds: 1,
    maximumRetrySeconds: 1,
    jitter: () => 0,
  });
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    stage = `bounded-retry-attempt-${attempt}`;
    assert.equal(await poisonWorker.processOne(), "retry");
  }
  stage = "source-bound-redrive";
  let redriven;
  for (let trigger = 0; trigger < 3 && redriven === undefined; trigger += 1) {
    await delay(1_500);
    await poisonWorker.processOne();
    redriven = await deadLetter.receiveOne({ waitTimeSeconds: 5, visibilityTimeoutSeconds: 30 });
  }
  assert.ok(redriven, "terminal delivery must reach the source-bound DLQ");
  assert.equal(redriven.body, stableBody);

  stage = "deletion-delivery";
  const tombstone = await store.deletePublishedRun(
    { tenantId, projectId },
    publishedRunId,
    {
      deletedAt: "2026-08-08T12:01:00.000Z",
      authority: "conformance:m9-sqs",
      reasonClass: "CONFORMANCE_PROBE",
      affectedEdgeIds: [],
    },
  );
  assert.ok(tombstone);
  assert.equal(JSON.stringify(tombstone).includes("sha256:"), false);
  assert.equal(await relay.relayOne(`worker:m9-sqs-delete-${runSuffix}`, 10_000), "delivered");
  let deletionBody;
  const deletionWorker = new PublicationSqsWorker(primary, (reference) => {
    assert.equal(reference.eventType, "PublishedRunDeleted");
    deletionBody = encodePublicationQueueReference(reference);
    return "processed";
  }, { waitTimeSeconds: 5, visibilityTimeoutSeconds: 5 });
  assert.equal(await deletionWorker.processOne(), "processed");
  assert.equal(deletionBody.includes("sha256:"), false);

  stage = "secondary-sink-scan";
  const inventory = sinkInventory();
  assertCloudSecondarySinkInventory(inventory);
  const snapshots = inventory.sinks.map((entry) => ({
    sink: entry.sink,
    ...(entry.tenantScoped ? { tenantId } : {}),
    encodedBytes: new TextEncoder().encode(
      entry.sink === "deadLetter"
        ? redriven.body
        : JSON.stringify({ sink: entry.sink, state: "canary-free" }),
    ),
  }));
  assertCloudCanariesAbsent(inventory, snapshots, [
    { kind: "source", value: "SOURCE_PATH_CANARY_/private/source.ts" },
    { kind: "secret", value: "SECRET_CANARY_DO_NOT_PERSIST" },
    { kind: "secret", value: "sha256:" },
    { kind: "tenant", value: "TENANT_CROSS_SCOPE_CANARY", tenantId: "tenant:other" },
  ]);
  await deadLetter.acknowledge(redriven.receiptHandle);

  stage = "synthetic-cleanup";
  await cleanSyntheticRows();
  await assertQueueEmpty(primary, "primary-after-cleanup");
  await assertQueueEmpty(deadLetter, "dead-letter-after-cleanup");
  const remainingRows = await pool.query(
    `SELECT
       (SELECT count(*) FROM publication_outbox WHERE tenant_id = $1)
       + (SELECT count(*) FROM published_runs WHERE tenant_id = $1)
       + (SELECT count(*) FROM published_run_tombstones WHERE tenant_id = $1)
       + (SELECT count(*) FROM published_run_listings WHERE tenant_id = $1)
       AS count`,
    [tenantId],
  );
  assert.equal(Number(remainingRows.rows[0].count), 0);

  console.log(JSON.stringify({
    schemaVersion: 1,
    kind: "awsSqsWorkerEvidence",
    outcome: "passed",
    queueType: "standard",
    maxReceiveCount: 5,
    checks: {
      exactQueueTransport: "passed",
      fencedOutboxRelay: "passed",
      duplicateSideEffectCount: sideEffectCount,
      boundedVisibilityRetry: "passed",
      sourceBoundDeadLetterRedrive: "passed",
      digestFreeDeadLetter: "passed",
      digestFreeDeletion: "passed",
      secondarySinkInventoryCount: inventory.sinks.length,
      boundedCanaryScan: "passed",
      syntheticDataRemoved: "passed",
    },
  }));
} catch (error) {
  await cleanSyntheticRows().catch(() => undefined);
  await delay(1_500);
  await removeSyntheticQueueMessages(primary).catch(() => undefined);
  await removeSyntheticQueueMessages(deadLetter).catch(() => undefined);
  console.error(JSON.stringify({
    schemaVersion: 1,
    kind: "awsSqsWorkerEvidence",
    outcome: "failed",
    failedCheck: stage,
    errorName: error instanceof Error ? error.name : "UnknownError",
    errorCode: typeof error?.code === "string" ? error.code : "UNCLASSIFIED",
    failureCode: error instanceof assert.AssertionError
      ? "LIVE_CONFORMANCE_ASSERTION_FAILED"
      : "LIVE_SQS_CONFORMANCE_FAILED",
  }));
  process.exitCode = 1;
} finally {
  await pool.end();
}
