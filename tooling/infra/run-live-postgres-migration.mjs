#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { encodeCanonicalProtocolDocument } from "@verify-internal/protocol";
import { Pool } from "pg";
import { PostgresPublicationStore } from "../../packages/cloud-client/dist/public/index.js";

const migrationId = "0001_publication_store";
const runId = process.env.MIGRATION_RUN_ID;
const expectedPostgresVersion = process.env.EXPECTED_POSTGRES_VERSION;
const sslRootCertPath = process.env.PGSSLROOTCERT;
if (!/^[a-f0-9]{40}$/.test(runId ?? "")) {
  throw new TypeError("VFY_LIVE_MIGRATION_RUN_ID_INVALID");
}
if (!/^\d+\.\d+$/.test(expectedPostgresVersion ?? "")) {
  throw new TypeError("VFY_LIVE_MIGRATION_ENGINE_INVALID");
}
if (typeof sslRootCertPath !== "string" || !sslRootCertPath.startsWith("/app/")) {
  throw new TypeError("VFY_LIVE_MIGRATION_TLS_ROOT_INVALID");
}
const sslRootCertificate = await readFile(sslRootCertPath, "utf8");

const tenantId = `tenant:m9-live-${runId.slice(0, 12)}`;
const projectId = `project:m9-live-${runId.slice(0, 12)}`;
const otherTenantId = `tenant:m9-live-other-${runId.slice(0, 12)}`;
const pool = new Pool({
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 10_000,
  max: 8,
  ssl: {
    ca: sslRootCertificate,
    rejectUnauthorized: true,
  },
});
const store = new PostgresPublicationStore(pool);
let stage = "migration";

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

function admission(sequence, publishedAt) {
  const idempotencyKey = `idempotency:m9-live-${runId.slice(0, 12)}-${sequence}`;
  const publishedRunId = `published-run:m9-live-${runId.slice(0, 12)}-${sequence}`;
  const sourceIntentId = `intent:m9-live-${runId.slice(0, 12)}-${sequence}`;
  const projection = {
    schemaVersion: 1,
    kind: "publishedVerification",
    purpose: "verification.metadata",
    tenantId,
    projectId,
    runId: `run:m9-live-${sequence}`,
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
      evidenceType: "m9.live-postgres-probe",
      byteSize: 1,
      sensitivityClass: "MINIMAL_METADATA",
    }],
    summary: { promiseCount: 1, proofCount: 1, evidenceCount: 1, durationMs: 1 },
    applicationAlias: "M9 live PostgreSQL probe",
    auditCorrelationId: `audit:m9-live-${sequence}`,
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
    eventId: `event:m9-live-${runId.slice(0, 12)}-${sequence}`,
    eventType: "PublishedRunAccepted",
    tenantId,
    aggregateType: "publishedRun",
    aggregateId: publishedRunId,
    occurredAt: publishedAt,
    payload: { publishedRunId, payloadDigest },
  };
  return {
    idempotencyKey,
    nonce: `nonce:m9-live-${runId.slice(0, 12)}-${sequence}`,
    requestDigest: sha256(`request:${sequence}`),
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
    await pool.query("DELETE FROM published_run_cursors WHERE tenant_id IN ($1, $2)", [
      tenantId,
      otherTenantId,
    ]);
    await pool.query("COMMIT");
  } catch (error) {
    await pool.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

try {
  await store.migrate();
  await cleanSyntheticRows();

  stage = "migration-record";
  const migration = await pool.query(
    "SELECT migration_id FROM cloud_schema_migrations WHERE migration_id = $1",
    [migrationId],
  );
  assert.equal(migration.rowCount, 1);

  const preexistingDeliveries = await pool.query(
    "SELECT count(*)::integer AS count FROM publication_outbox WHERE status IN ('pending', 'leased')",
  );
  assert.equal(preexistingDeliveries.rows[0].count, 0);

  stage = "concurrent-idempotency";
  const first = admission(1, "2026-08-06T00:00:00.000Z");
  const second = admission(2, "2026-08-06T00:00:01.000Z");
  const concurrent = await Promise.all(Array.from({ length: 5 }, () => store.accept(
    tenantId,
    first.idempotencyKey,
    first.nonce,
    first.requestDigest,
    first.receipt,
    first.publishedRun,
    first.outboxEvent,
  )));
  assert.equal(new Set(concurrent.map((receipt) => receipt.publishedRunId)).size, 1);
  await store.accept(
    tenantId,
    second.idempotencyKey,
    second.nonce,
    second.requestDigest,
    second.receipt,
    second.publishedRun,
    second.outboxEvent,
  );

  stage = "tenant-isolation";
  assert.deepEqual(
    await store.readPublishedRun({ tenantId, projectId }, first.receipt.publishedRunId),
    first.publishedRun.projection,
  );
  assert.equal(
    await store.readPublishedRun(
      { tenantId: otherTenantId, projectId },
      first.receipt.publishedRunId,
    ),
    undefined,
  );
  assert.equal((await store.listPublishedRuns({ tenantId, projectId }, { limit: 100 })).items.length, 2);
  assert.equal((await store.listPublishedRuns(
    { tenantId: otherTenantId, projectId },
    { limit: 100 },
  )).items.length, 0);

  stage = "fenced-outbox";
  for (let index = 0; index < 2; index += 1) {
    const now = new Date(`2026-08-06T00:01:0${index}.000Z`);
    const claim = await store.claimOutbox(`worker:m9-live-${index}`, now, 10_000);
    assert.equal(claim?.event.tenantId, tenantId);
    await store.acknowledgeOutbox(claim, new Date(now.getTime() + 1_000));
  }

  stage = "atomic-deletion";
  await store.deletePublishedRun(
    { tenantId, projectId },
    first.receipt.publishedRunId,
    {
      deletedAt: "2026-08-06T00:02:00.000Z",
      authority: "migration:m9-live-probe",
      reasonClass: "MIGRATION_PROBE",
      affectedEdgeIds: [],
    },
  );
  await assert.rejects(
    store.assertPublishedRunRestorable({ tenantId, projectId }, first.receipt.publishedRunId),
    /VFY_PUBLISHED_RUN_RESTORE_BLOCKED/,
  );
  const storedTombstone = await pool.query(
    `SELECT to_jsonb(t) AS value
       FROM published_run_tombstones t
      WHERE tenant_id = $1 AND project_id = $2 AND published_run_id = $3`,
    [tenantId, projectId, first.receipt.publishedRunId],
  );
  assert.equal(JSON.stringify(storedTombstone.rows[0].value).includes("sha256:"), false);

  stage = "active-retention";
  await pool.query(
    "UPDATE published_run_listings SET active_expires_at = $1 WHERE tenant_id = $2 AND published_run_id = $3",
    [new Date("2026-08-05T00:00:00.000Z"), tenantId, second.receipt.publishedRunId],
  );
  assert.equal(await store.deleteExpiredPublishedRuns(new Date("2026-08-06T00:03:00.000Z")), 1);

  stage = "deletion-outbox";
  for (let index = 0; index < 2; index += 1) {
    const now = new Date(`2026-08-06T00:04:0${index}.000Z`);
    const claim = await store.claimOutbox(`worker:m9-delete-${index}`, now, 10_000);
    assert.equal(claim?.event.tenantId, tenantId);
    await store.acknowledgeOutbox(claim, new Date(now.getTime() + 1_000));
  }

  stage = "tombstone-retention";
  await pool.query(
    "UPDATE published_run_tombstones SET expires_at = $1 WHERE tenant_id = $2",
    [new Date("2026-08-05T00:00:00.000Z"), tenantId],
  );
  assert.equal(await store.purgeExpiredTombstones(new Date("2026-08-06T00:05:00.000Z")), 2);

  stage = "server-version";
  const version = await pool.query("SHOW server_version");
  const serverVersion = version.rows[0].server_version;
  assert.equal(serverVersion.startsWith(expectedPostgresVersion), true);

  stage = "synthetic-cleanup";
  await cleanSyntheticRows();
  console.log(JSON.stringify({
    schemaVersion: 1,
    kind: "awsPostgresMigrationEvidence",
    outcome: "passed",
    migrationId,
    serverVersion,
    checks: {
      migrationRecorded: "passed",
      concurrentIdempotency: "passed",
      tenantIsolation: "passed",
      fencedOutbox: "passed",
      atomicDeletion: "passed",
      digestFreeTombstone: "passed",
      restoreReplayGate: "passed",
      activeRetention: "passed",
      tombstoneRetention: "passed",
      syntheticDataRemoved: "passed",
    },
  }));
} catch (error) {
  await cleanSyntheticRows().catch(() => undefined);
  console.error(JSON.stringify({
    schemaVersion: 1,
    kind: "awsPostgresMigrationEvidence",
    outcome: "failed",
    failedCheck: stage,
    errorName: error instanceof Error ? error.name : "UnknownError",
    errorCode: typeof error?.code === "string" ? error.code : "UNCLASSIFIED",
    failureCode: error instanceof assert.AssertionError
      ? "LIVE_CONFORMANCE_ASSERTION_FAILED"
      : "LIVE_MIGRATION_FAILED",
  }));
  process.exitCode = 1;
} finally {
  await pool.end();
}
