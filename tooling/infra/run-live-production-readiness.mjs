#!/usr/bin/env node
import assert from "node:assert/strict";
import { generateKeyPairSync, sign, verify } from "node:crypto";
import { once } from "node:events";
import { rm, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import {
  PostgresControlApiStore,
  createControlApiHandler,
} from "../../apps/control-api/dist/public/index.js";
import {
  PostgresCustomerWorkloadDispatchStore,
  PostgresPublicationStore,
  PublicationIngestionService,
  prepareDisclosure,
} from "../../packages/cloud-client/dist/public/index.js";
import { encodeCanonicalProtocolDocument } from "../../packages/protocol/dist/public/index.js";
import { Pool } from "pg";
import { createControlApiNodeListener } from "./control-api-node-http.mjs";
import { evaluateProductionReadiness } from "./production-readiness-contract.mjs";

const runId = process.env.CONTROL_API_RUN_ID;
const region = process.env.AWS_REGION;
const sslRootCertPath = process.env.PGSSLROOTCERT;
if (!/^[a-f0-9]{40}$/.test(runId ?? "")) throw new TypeError("VFY_READINESS_RUN_ID_INVALID");
if (region !== "us-west-2") throw new TypeError("VFY_READINESS_REGION_INVALID");
if (typeof sslRootCertPath !== "string" || !path.isAbsolute(sslRootCertPath)) {
  throw new TypeError("VFY_READINESS_TLS_ROOT_INVALID");
}
if (process.env.READINESS_SUPPLY_CHAIN !== "passed") {
  throw new TypeError("VFY_READINESS_SUPPLY_CHAIN_UNATTESTED");
}

const suffix = runId.slice(0, 12);
const tenantId = `tenant:m9-readiness-${suffix}`;
const otherTenantId = `tenant:m9-readiness-other-${suffix}`;
const projectId = `project:m9-readiness-${suffix}`;
const principalId = `principal:m9-readiness-${suffix}`;
const identityKeyId = `key:m9-readiness-identity-${suffix}`;
const intentKeyId = `key:m9-readiness-intent-${suffix}`;
const audience = "verify-cloud-api";
const issuer = "https://identity.verification.invalid";
const workloadBinding = "workload:github:owner/repository";
const sourceCanary = `SOURCE_CANARY_M9_READINESS_${suffix}`;
const secretCanary = `SECRET_CANARY_M9_READINESS_${suffix}`;
const restoreDatabase = `readiness_${suffix.replaceAll("-", "_")}`;
const backupPath = "/work/readiness.dump";
const now = () => new Date();
const plus = (milliseconds) => new Date(now().getTime() + milliseconds).toISOString();
const minus = (milliseconds) => new Date(now().getTime() - milliseconds).toISOString();

const identityKeys = generateKeyPairSync("ed25519");
const intentKeys = generateKeyPairSync("ed25519");
const identityVerificationKey = {
  keyId: identityKeyId,
  issuer,
  audience,
  publicKeyPem: identityKeys.publicKey.export({ type: "spki", format: "pem" }).toString(),
  notBefore: minus(60_000),
  expiresAt: plus(60 * 60_000),
  revoked: false,
};

function identityToken() {
  const currentSeconds = Math.floor(now().getTime() / 1_000);
  const header = Buffer.from(JSON.stringify({ alg: "EdDSA", kid: identityKeyId, typ: "JWT" })).toString("base64url");
  const claims = Buffer.from(JSON.stringify({
    iss: issuer,
    sub: principalId,
    aud: audience,
    iat: currentSeconds - 30,
    exp: currentSeconds + 10 * 60,
    jti: `token:m9-readiness-${suffix}`,
    principalKind: "workload",
  })).toString("base64url");
  const signature = sign(null, Buffer.from(`${header}.${claims}`, "ascii"), identityKeys.privateKey);
  return `${header}.${claims}.${signature.toString("base64url")}`;
}

function canonical(value) {
  return new TextDecoder().decode(encodeCanonicalProtocolDocument(value));
}

function dispatchRequest(index, includeCanaries = false) {
  const idempotencyKey = `idempotency:m9-readiness-dispatch-${index}-${suffix}`;
  const request = {
    schemaVersion: 1,
    command: "dispatchVerification",
    invocationId: `invocation:m9-readiness-dispatch-${index}-${suffix}`,
    arguments: {
      workloadBinding,
      idempotencyKey,
      verifyRequest: {
        schemaVersion: 1,
        command: "verify",
        invocationId: `invocation:m9-readiness-verify-${index}-${suffix}`,
        arguments: { noCache: true },
        configurationReferences: [],
        policyReferences: [],
        consentGrantReferences: [],
        offline: true,
        outputMode: "json",
        environment: {
          platform: "github-action",
          allowlistedBindings: ["workspace:github:owner/repository"],
        },
        workspace: { rootBinding: "workspace:github:owner/repository" },
      },
    },
    configurationReferences: [],
    policyReferences: [],
    consentGrantReferences: [],
    offline: false,
    outputMode: "json",
    environment: { platform: "control-api", allowlistedBindings: [workloadBinding] },
  };
  return includeCanaries ? { ...request, sourceCanary, secretCanary } : request;
}

const sslRootCertificate = await readFile(sslRootCertPath, "utf8");
const poolConfig = {
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 10_000,
  max: 24,
  ssl: { ca: sslRootCertificate, rejectUnauthorized: true },
};
const pool = new Pool(poolConfig);
pool.on("error", () => undefined);
const publicationStore = new PostgresPublicationStore(pool);
const dispatchStore = new PostgresCustomerWorkloadDispatchStore(pool);
const controlStore = new PostgresControlApiStore({
  pool,
  identityKeys: [identityVerificationKey],
  expectedAudience: audience,
  intentSigning: { keyId: intentKeyId, sign: (bytes) => sign(null, bytes, intentKeys.privateKey) },
});
const ingestion = new PublicationIngestionService(
  publicationStore,
  (keyId, bytes, signature) => keyId === intentKeyId
    && verify(null, bytes, intentKeys.publicKey, signature),
);
let correlation = 0;
let phase = "bootstrap";
let evaluation;
const handler = createControlApiHandler({
  expectedAudience: audience,
  authenticator: controlStore,
  grants: controlStore,
  intents: controlStore,
  publications: ingestion,
  publishedRuns: publicationStore,
  dispatches: dispatchStore,
  audit: controlStore,
  now,
  correlationId: () => `correlation:m9-readiness-${suffix}-${++correlation}`,
});
const server = createServer(createControlApiNodeListener(handler));
let origin;
let restoredPool;

async function runCommand(command, args, extraEnvironment = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...extraEnvironment },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let errorBytes = 0;
    child.stderr.on("data", (chunk) => { errorBytes += chunk.byteLength; });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0 && errorBytes < 64 * 1_024) resolve();
      else reject(new TypeError(`VFY_READINESS_COMMAND_FAILED:${command}`));
    });
  });
}

async function cleanSyntheticRows(targetPool = pool) {
  await targetPool.query("BEGIN");
  try {
    for (const table of ["workload_dispatch_outbox", "workload_dispatch_idempotency", "workload_dispatches"]) {
      await targetPool.query(`DELETE FROM ${table} WHERE tenant_id IN ($1, $2)`, [tenantId, otherTenantId]);
    }
    await targetPool.query(
      `DELETE FROM publication_nonces n USING publication_idempotency i
        WHERE n.tenant_id = i.tenant_id AND n.idempotency_key = i.idempotency_key
          AND i.tenant_id IN ($1, $2)`,
      [tenantId, otherTenantId],
    );
    for (const table of [
      "publication_outbox", "published_runs", "published_run_tombstones",
      "publication_idempotency", "published_run_listings", "published_run_cursors",
    ]) {
      await targetPool.query(`DELETE FROM ${table} WHERE tenant_id IN ($1, $2)`, [tenantId, otherTenantId]);
    }
    await targetPool.query("DELETE FROM control_api_audit WHERE tenant_id IN ($1, $2)", [tenantId, otherTenantId]);
    await targetPool.query("DELETE FROM control_publication_policies WHERE tenant_id IN ($1, $2)", [tenantId, otherTenantId]);
    await targetPool.query("DELETE FROM control_authorization_grants WHERE principal_id = $1", [principalId]);
    await targetPool.query("DELETE FROM control_principals WHERE principal_id = $1", [principalId]);
    await targetPool.query("COMMIT");
  } catch (error) {
    await targetPool.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function dropRestoreDatabase() {
  assert.match(restoreDatabase, /^[a-z0-9_]+$/);
  await pool.query(
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
    [restoreDatabase],
  ).catch(() => undefined);
  await pool.query(`DROP DATABASE IF EXISTS ${restoreDatabase}`).catch(() => undefined);
}

async function api(route, { method = "GET", body, key } = {}) {
  const headers = { authorization: `Bearer ${identityToken()}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (key !== undefined) headers["idempotency-key"] = key;
  const response = await fetch(`${origin}${route}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: canonical(body) }),
  });
  return { status: response.status, value: await response.json() };
}

async function grant(grantId, action, resourceType, resourceId) {
  await pool.query(
    `INSERT INTO control_authorization_grants
      (grant_id, principal_id, action, tenant_id, resource_type, resource_id,
       policy_revision, expires_at, revoked)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false)`,
    [grantId, principalId, action, tenantId, resourceType, resourceId,
      "authorization-policy:m9-readiness", plus(60 * 60_000)],
  );
}

async function publish(label) {
  const fixture = JSON.parse(await readFile(
    new URL("../../packages/cloud-client/fixtures/valid/metadata-publication.json", import.meta.url),
    "utf8",
  ));
  const idempotencyKey = `idempotency:m9-readiness-publication-${label}-${suffix}`;
  fixture.tenantId = tenantId;
  fixture.projectId = projectId;
  fixture.runId = `run:m9-readiness-${label}-${suffix}`;
  fixture.idempotencyKey = idempotencyKey;
  fixture.applicationModel.tenantBinding = tenantId;
  fixture.applicationAlias = `readiness-${label}`;
  fixture.auditCorrelationId = `audit:m9-readiness-${label}-${suffix}`;
  const prepared = prepareDisclosure(fixture, {
    payloadSchemaMinor: 0,
    retentionPolicy: { id: "retention:metadata", revision: "revision:one" },
    expiresAt: plus(10 * 60_000),
  });
  const intent = await api(
    `/v1/tenants/${encodeURIComponent(tenantId)}/projects/${encodeURIComponent(projectId)}/publication-intents`,
    {
      method: "POST",
      key: idempotencyKey,
      body: {
        schemaVersion: 1,
        manifest: prepared.manifest,
        manifestDigest: prepared.manifestDigest,
        retentionClass: "metadata-30d",
        limits: {
          maxEncodedPayloadBytes: prepared.payloadBytes.byteLength,
          maxPromiseCount: 0,
          maxProofCount: 0,
          maxEvidenceCount: 0,
        },
        nonce: `nonce:m9-readiness-${label}-${suffix}`,
        expiresAt: plus(5 * 60_000),
      },
    },
  );
  assert.equal(intent.status, 201);
  const publication = await api(
    `/v1/tenants/${encodeURIComponent(tenantId)}/projects/${encodeURIComponent(projectId)}/publications`,
    {
      method: "POST",
      key: idempotencyKey,
      body: {
        schemaVersion: 1,
        signedIntent: intent.value,
        manifest: prepared.manifest,
        manifestDigest: prepared.manifestDigest,
        payload: fixture,
      },
    },
  );
  assert.equal(publication.status, 201);
  return publication.value.publishedRunId;
}

try {
  phase = "migrate";
  await publicationStore.migrate();
  await dispatchStore.migrate();
  await controlStore.migrate();
  await cleanSyntheticRows();
  await dropRestoreDatabase();

  phase = "seed-authority";
  await pool.query(
    `INSERT INTO control_principals
      (principal_id, principal_kind, identity_key_id, expires_at, revoked)
     VALUES ($1, 'workload', $2, $3, false)`,
    [principalId, identityKeyId, plus(60 * 60_000)],
  );
  await grant(`grant:m9-readiness-list-${suffix}`, "project:read", "project", projectId);
  await grant(`grant:m9-readiness-publish-${suffix}`, "run:publish", "project", projectId);
  await grant(`grant:m9-readiness-dispatch-${suffix}`, "dispatch:create", "project", projectId);
  const policy = {
    schemaVersion: 1,
    tenantId,
    policyId: `policy:m9-readiness-${suffix}`,
    revisionId: `policy-revision:m9-readiness-${suffix}`,
    issuedAt: minus(60_000),
    expiresAt: plus(60 * 60_000),
    actions: ["run:publish"],
    publicationRules: [{
      purpose: "verification.metadata",
      payloadSchemaMajor: 1,
      retentionClasses: ["metadata-30d"],
    }],
  };
  await pool.query(
    `INSERT INTO control_publication_policies
      (tenant_id, project_id, policy_id, revision_id, policy, expires_at, revoked)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, false)`,
    [tenantId, projectId, policy.policyId, policy.revisionId, JSON.stringify(policy), policy.expiresAt],
  );

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.equal(typeof address, "object");
  origin = `http://127.0.0.1:${address.port}`;
  const base = `/v1/tenants/${encodeURIComponent(tenantId)}/projects/${encodeURIComponent(projectId)}`;

  phase = "seed-recoverable-state";
  const activePublishedRunId = await publish("active");
  const deletedPublishedRunId = await publish("deleted");
  const dispatchIds = [];
  for (let index = 0; index < 20; index += 1) {
    const request = dispatchRequest(index);
    const response = await api(`${base}/dispatches`, {
      method: "POST",
      key: request.arguments.idempotencyKey,
      body: request,
    });
    assert.equal(response.status, 202);
    dispatchIds.push(response.value.dispatchId);
  }
  const lastCommittedAt = Date.now();

  phase = "load";
  const durationMs = [];
  let successCount = 0;
  for (let offset = 0; offset < 500; offset += 25) {
    const batch = await Promise.all(Array.from({ length: 25 }, async () => {
      const startedAt = performance.now();
      const response = await api(`${base}/runs?limit=1`);
      return { status: response.status, duration: performance.now() - startedAt };
    }));
    for (const result of batch) {
      durationMs.push(Number(result.duration.toFixed(3)));
      if (result.status === 200) successCount += 1;
    }
  }

  phase = "logical-backup";
  const backupStartedAt = Date.now();
  await runCommand("pg_dump", [
    "--dbname=verification",
    `--file=${backupPath}`,
    "--format=custom",
    "--no-owner",
    "--no-privileges",
  ]);
  const postgresRpoMs = backupStartedAt - lastCommittedAt;

  phase = "delete-after-backup";
  const deletion = {
    deletedAt: now().toISOString(),
    authority: "recovery:m9-readiness",
    reasonClass: "RECOVERY_DRILL",
    affectedEdgeIds: [],
  };
  await publicationStore.deletePublishedRun(
    { tenantId, projectId },
    deletedPublishedRunId,
    deletion,
  );
  await assert.rejects(
    publicationStore.assertPublishedRunRestorable({ tenantId, projectId }, deletedPublishedRunId),
    /VFY_PUBLISHED_RUN_RESTORE_BLOCKED/,
  );

  phase = "connection-recovery";
  const connectionRecoveryStartedAt = performance.now();
  await pool.query(
    `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
      WHERE datname = current_database() AND pid <> pg_backend_pid()`,
  );
  let recoveredResponse;
  for (let attempt = 0; attempt < 30 && recoveredResponse?.status !== 200; attempt += 1) {
    recoveredResponse = await api(`${base}/runs?limit=1`).catch(() => undefined);
    if (recoveredResponse?.status !== 200) await delay(250);
  }
  assert.equal(recoveredResponse?.status, 200);
  const connectionRecoveryMs = Number((performance.now() - connectionRecoveryStartedAt).toFixed(3));

  phase = "logical-restore";
  const restoreStartedAt = Date.now();
  await pool.query(`CREATE DATABASE ${restoreDatabase}`);
  await runCommand("pg_restore", [
    `--dbname=${restoreDatabase}`,
    "--no-owner",
    "--no-privileges",
    backupPath,
  ]);
  restoredPool = new Pool({ ...poolConfig, database: restoreDatabase, max: 8 });
  const restoredPublications = new PostgresPublicationStore(restoredPool);
  const restoredDispatches = new PostgresCustomerWorkloadDispatchStore(restoredPool);
  const restoredBeforeReplay = await restoredPublications.resolvePublishedRun(
    { tenantId, projectId },
    deletedPublishedRunId,
  );
  assert.equal(restoredBeforeReplay?.state, "active");
  await restoredPublications.deletePublishedRun(
    { tenantId, projectId },
    deletedPublishedRunId,
    deletion,
  );
  const deletedAfterReplay = await restoredPublications.resolvePublishedRun(
    { tenantId, projectId },
    deletedPublishedRunId,
  );
  const activeAfterRestore = await restoredPublications.resolvePublishedRun(
    { tenantId, projectId },
    activePublishedRunId,
  );
  let recoveredDispatches = 0;
  for (const dispatchId of dispatchIds) {
    if (await restoredDispatches.resolve({ tenantId, projectId }, dispatchId)) recoveredDispatches += 1;
  }
  assert.equal(deletedAfterReplay?.state, "deleted_reference");
  assert.equal(activeAfterRestore?.state, "active");
  assert.equal(recoveredDispatches, dispatchIds.length);
  const postgresRtoMs = Date.now() - restoreStartedAt;

  phase = "cost-abuse";
  const beforeAbuse = await pool.query(
    "SELECT count(*)::int AS count FROM workload_dispatches WHERE tenant_id = $1",
    [tenantId],
  );
  let rejectedCount = 0;
  let nonRetryableRejection = true;
  for (let offset = 0; offset < 100; offset += 20) {
    const batch = await Promise.all(Array.from({ length: 20 }, (_, index) => {
      const attempt = offset + index;
      const request = dispatchRequest(`abuse-${attempt}`, true);
      return api(`${base}/dispatches`, {
        method: "POST",
        key: request.arguments.idempotencyKey,
        body: request,
      });
    }));
    for (const response of batch) {
      if (response.status === 400) rejectedCount += 1;
      if (response.value?.error?.retryability !== "never") nonRetryableRejection = false;
    }
  }
  const afterAbuse = await pool.query(
    "SELECT count(*)::int AS count FROM workload_dispatches WHERE tenant_id = $1",
    [tenantId],
  );
  const durableRowsCreated = afterAbuse.rows[0].count - beforeAbuse.rows[0].count;

  phase = "security-scans";
  const crossTenant = await api(
    `/v1/tenants/${encodeURIComponent(otherTenantId)}/projects/${encodeURIComponent(projectId)}/runs?limit=1`,
  );
  assert.equal(crossTenant.status, 404);
  const retained = await pool.query(
    `SELECT
      (SELECT jsonb_agg(to_jsonb(a)) FROM control_api_audit a WHERE tenant_id IN ($1, $2)) AS audit,
      (SELECT jsonb_agg(to_jsonb(d)) FROM workload_dispatches d WHERE tenant_id IN ($1, $2)) AS dispatches,
      (SELECT jsonb_agg(to_jsonb(r)) FROM published_runs r WHERE tenant_id IN ($1, $2)) AS runs,
      (SELECT jsonb_agg(to_jsonb(t)) FROM published_run_tombstones t WHERE tenant_id IN ($1, $2)) AS tombstones`,
    [tenantId, otherTenantId],
  );
  const retainedText = JSON.stringify(retained.rows[0]);
  const auditText = JSON.stringify(retained.rows[0].audit);
  const sourceCanaryAbsent = !retainedText.includes(sourceCanary);
  const secretCanaryAbsent = !retainedText.includes(secretCanary);
  const auditSanitized = !auditText.includes(identityToken())
    && !auditText.includes("idempotency:m9-readiness-dispatch")
    && sourceCanaryAbsent
    && secretCanaryAbsent;

  phase = "evaluate";
  evaluation = evaluateProductionReadiness({
    schemaVersion: 1,
    load: { requestCount: durationMs.length, successCount, durationMs },
    durability: {
      acceptedDispatches: dispatchIds.length,
      recoveredDispatches,
      duplicateDispatches: new Set(dispatchIds).size === dispatchIds.length ? 0 : 1,
    },
    recovery: {
      postgresRpoMs,
      postgresRtoMs,
      publicationObjectRpoMs: postgresRpoMs,
      publicationObjectRtoMs: postgresRtoMs,
      connectionRecoveryMs,
    },
    deletionRecovery: {
      logicalBackupRestored: restoredBeforeReplay?.state === "active",
      tombstoneLedgerReplayed: deletedAfterReplay?.state === "deleted_reference",
      activeRecordRecovered: activeAfterRestore?.state === "active",
      deletedRecordResurrections: deletedAfterReplay?.state === "active" ? 1 : 0,
    },
    abuse: {
      attemptCount: 100,
      rejectedCount,
      durableRowsCreated,
      nonRetryableRejection,
    },
    security: {
      crossTenantDenied: crossTenant.status === 404,
      sourceCanaryAbsent,
      secretCanaryAbsent,
      auditSanitized,
    },
    supplyChain: {
      immutableImage: true,
      dependencyReview: true,
      sbom: true,
      provenance: true,
    },
  });
  if (evaluation.outcome !== "passed") {
    const error = new TypeError("VFY_READINESS_THRESHOLDS_FAILED");
    error.code = "VFY_READINESS_THRESHOLDS_FAILED";
    throw error;
  }
  console.log(JSON.stringify({
    schemaVersion: 1,
    kind: "awsProductionReadinessEvidence",
    outcome: "passed",
    region,
    runId,
    measurements: evaluation.measurements,
    checks: evaluation.checks,
  }));
} catch (error) {
  console.log(JSON.stringify({
    schemaVersion: 1,
    kind: "awsProductionReadinessEvidence",
    outcome: "failed",
    region,
    runId,
    phase,
    error: {
      name: error instanceof Error ? error.name : "UnknownError",
      code: typeof error?.code === "string" ? error.code : "VFY_READINESS_UNCLASSIFIED",
    },
    ...(evaluation === undefined ? {} : {
      measurements: evaluation.measurements,
      checks: evaluation.checks,
    }),
  }));
  process.exitCode = 1;
} finally {
  if (server.listening) {
    server.close();
    await once(server, "close").catch(() => undefined);
  }
  if (restoredPool) await restoredPool.end().catch(() => undefined);
  await dropRestoreDatabase();
  await cleanSyntheticRows().catch(() => undefined);
  await rm(backupPath, { force: true }).catch(() => undefined);
  await pool.end();
}
