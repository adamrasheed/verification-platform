#!/usr/bin/env node
import assert from "node:assert/strict";
import { generateKeyPairSync, sign, verify } from "node:crypto";
import { once } from "node:events";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import {
  PostgresControlApiStore,
  createControlApiHandler,
} from "../../apps/control-api/dist/public/index.js";
import { runCustomerWorkloadOffer } from "../../apps/github-action/lib/public/index.js";
import {
  PostgresCustomerWorkloadDispatchStore,
  PostgresPublicationStore,
  PublicationIngestionService,
  prepareDisclosure,
} from "../../packages/cloud-client/dist/public/index.js";
import { encodeCanonicalProtocolDocument } from "../../packages/protocol/dist/public/index.js";
import { Pool } from "pg";
import { createControlApiNodeListener } from "./control-api-node-http.mjs";

const runId = process.env.CONTROL_API_RUN_ID;
const region = process.env.AWS_REGION;
const sslRootCertPath = process.env.PGSSLROOTCERT;
if (!/^[a-f0-9]{40}$/.test(runId ?? "")) {
  throw new TypeError("VFY_LIVE_CUSTOMER_WORKLOAD_RUN_ID_INVALID");
}
if (region !== "us-west-2") throw new TypeError("VFY_LIVE_CUSTOMER_WORKLOAD_REGION_INVALID");
if (typeof sslRootCertPath !== "string" || !path.isAbsolute(sslRootCertPath)) {
  throw new TypeError("VFY_LIVE_CUSTOMER_WORKLOAD_TLS_ROOT_INVALID");
}

const suffix = runId.slice(0, 12);
const tenantId = `tenant:m9-workload-${suffix}`;
const otherTenantId = `tenant:m9-workload-other-${suffix}`;
const projectId = `project:m9-workload-${suffix}`;
const principalId = `principal:m9-workload-${suffix}`;
const identityKeyId = `key:m9-workload-identity-${suffix}`;
const intentKeyId = `key:m9-workload-intent-${suffix}`;
const workloadBinding = "workload:github:owner/repository";
const workerId = `runner:m9-workload-${suffix}`;
const audience = "verify-cloud-api";
const issuer = "https://identity.verification.invalid";
const sourceCanary = `SOURCE_CANARY_M9_WORKLOAD_${suffix}`;
const checkout = "/work/checkout";
const stateRoot = "/work/state";
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
  const currentSeconds = Math.floor(now().getTime() / 1000);
  const header = Buffer.from(JSON.stringify({
    alg: "EdDSA",
    kid: identityKeyId,
    typ: "JWT",
  })).toString("base64url");
  const claims = Buffer.from(JSON.stringify({
    iss: issuer,
    sub: principalId,
    aud: audience,
    iat: currentSeconds - 30,
    exp: currentSeconds + 10 * 60,
    jti: `token:m9-workload-${suffix}`,
    principalKind: "workload",
  })).toString("base64url");
  const signature = sign(null, Buffer.from(`${header}.${claims}`, "ascii"), identityKeys.privateKey);
  return `${header}.${claims}.${signature.toString("base64url")}`;
}

function canonical(value) {
  return new TextDecoder().decode(encodeCanonicalProtocolDocument(value));
}

function dispatchRequest(label) {
  const idempotencyKey = `idempotency:m9-workload-${label}-${suffix}`;
  return {
    schemaVersion: 1,
    command: "dispatchVerification",
    invocationId: `invocation:m9-dispatch-${label}-${suffix}`,
    arguments: {
      workloadBinding,
      idempotencyKey,
      verifyRequest: {
        schemaVersion: 1,
        command: "verify",
        invocationId: `invocation:m9-verify-${label}-${suffix}`,
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
    environment: {
      platform: "control-api",
      allowlistedBindings: [workloadBinding],
    },
  };
}

const sslRootCertificate = await readFile(sslRootCertPath, "utf8");
const pool = new Pool({
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 10_000,
  max: 8,
  ssl: { ca: sslRootCertificate, rejectUnauthorized: true },
});
const publicationStore = new PostgresPublicationStore(pool);
const dispatchStore = new PostgresCustomerWorkloadDispatchStore(pool);
const controlStore = new PostgresControlApiStore({
  pool,
  identityKeys: [identityVerificationKey],
  expectedAudience: audience,
  intentSigning: {
    keyId: intentKeyId,
    sign: (bytes) => sign(null, bytes, intentKeys.privateKey),
  },
});
const ingestion = new PublicationIngestionService(
  publicationStore,
  (keyId, bytes, signature) => keyId === intentKeyId
    && verify(null, bytes, intentKeys.publicKey, signature),
);
let correlation = 0;
let phase = "bootstrap";
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
  correlationId: () => `correlation:m9-workload-${suffix}-${++correlation}`,
});
const server = createServer(createControlApiNodeListener(handler));
let origin;

async function cleanSyntheticRows() {
  await pool.query("BEGIN");
  try {
    await pool.query("DELETE FROM workload_dispatch_outbox WHERE tenant_id IN ($1, $2)", [
      tenantId,
      otherTenantId,
    ]);
    await pool.query("DELETE FROM workload_dispatch_idempotency WHERE tenant_id IN ($1, $2)", [
      tenantId,
      otherTenantId,
    ]);
    await pool.query("DELETE FROM workload_dispatches WHERE tenant_id IN ($1, $2)", [
      tenantId,
      otherTenantId,
    ]);
    await pool.query(
      `DELETE FROM publication_nonces n
        USING publication_idempotency i
        WHERE n.tenant_id = i.tenant_id
          AND n.idempotency_key = i.idempotency_key
          AND i.tenant_id IN ($1, $2)`,
      [tenantId, otherTenantId],
    );
    for (const table of [
      "publication_outbox",
      "published_runs",
      "published_run_tombstones",
      "publication_idempotency",
      "published_run_listings",
      "published_run_cursors",
    ]) {
      await pool.query(`DELETE FROM ${table} WHERE tenant_id IN ($1, $2)`, [tenantId, otherTenantId]);
    }
    await pool.query("DELETE FROM control_api_audit WHERE tenant_id IN ($1, $2)", [
      tenantId,
      otherTenantId,
    ]);
    await pool.query("DELETE FROM control_publication_policies WHERE tenant_id IN ($1, $2)", [
      tenantId,
      otherTenantId,
    ]);
    await pool.query("DELETE FROM control_principals WHERE principal_id = $1", [principalId]);
    await pool.query("COMMIT");
  } catch (error) {
    await pool.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function api(route, { method = "GET", body, key, signal } = {}) {
  const headers = { authorization: `Bearer ${identityToken()}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (key !== undefined) headers["idempotency-key"] = key;
  const response = await fetch(`${origin}${route}`, {
    method,
    headers,
    signal,
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
    [
      grantId,
      principalId,
      action,
      tenantId,
      resourceType,
      resourceId,
      "authorization-policy:m9-workload",
      plus(60 * 60_000),
    ],
  );
}

function projectionBuilder(fixture) {
  return {
    async build(envelope, claim) {
      assert.equal(await readFile(path.join(checkout, "source-canary.txt"), "utf8"), sourceCanary);
      await delay(600);
      const payload = structuredClone(fixture);
      payload.tenantId = claim.tenantId;
      payload.projectId = claim.projectId;
      payload.runId = envelope.invocationId;
      payload.idempotencyKey = claim.request.arguments.idempotencyKey;
      payload.applicationModel.tenantBinding = claim.tenantId;
      payload.operationalStatus = envelope.operationalStatus;
      payload.outcome = envelope.result.outcome;
      payload.auditCorrelationId = `audit:m9-workload-${suffix}`;
      return payload;
    },
  };
}

function customerTransport() {
  let heartbeatCount = 0;
  let publicationBoundaryText = "";
  return {
    get heartbeatCount() { return heartbeatCount; },
    get publicationBoundaryText() { return publicationBoundaryText; },
    acceptOffer: (claim, at) => dispatchStore.acceptOffer(claim, at),
    heartbeat: async (claim, at, leaseMs) => {
      heartbeatCount += 1;
      return dispatchStore.heartbeat(claim, at, leaseMs);
    },
    observeCancellation: (claim, at) => dispatchStore.observeCancellation(claim, at),
    acknowledgeCancellation: (claim, acknowledgement, at) => (
      dispatchStore.acknowledgeCancellation(claim, acknowledgement, at)
    ),
    async publishProjection(context, projection, signal) {
      assert.deepEqual(Object.keys(context).sort(), [
        "attempt", "dispatchId", "fence", "idempotencyKey", "projectId",
        "schemaVersion", "tenantId", "verifyInvocationId", "workerId",
        "workloadBinding",
      ]);
      publicationBoundaryText = JSON.stringify({ context, projection });
      assert.equal(publicationBoundaryText.includes(sourceCanary), false);
      assert.equal(publicationBoundaryText.includes(checkout), false);
      assert.equal(Object.hasOwn(context, "request"), false);
      assert.equal(Object.hasOwn(context, "leaseExpiresAt"), false);
      const prepared = prepareDisclosure(projection, {
        payloadSchemaMinor: 0,
        retentionPolicy: { id: "retention:metadata", revision: "revision:one" },
        expiresAt: plus(10 * 60_000),
      });
      const intent = await api(
        `/v1/tenants/${encodeURIComponent(context.tenantId)}/projects/${encodeURIComponent(context.projectId)}/publication-intents`,
        {
          method: "POST",
          key: context.idempotencyKey,
          signal,
          body: {
            schemaVersion: 1,
            manifest: prepared.manifest,
            manifestDigest: prepared.manifestDigest,
            retentionClass: projection.retentionClass,
            limits: {
              maxEncodedPayloadBytes: prepared.payloadBytes.byteLength,
              maxPromiseCount: projection.promises.length,
              maxProofCount: projection.proofs.length,
              maxEvidenceCount: projection.evidence.length,
            },
            nonce: `nonce:${context.dispatchId}`,
            expiresAt: plus(5 * 60_000),
          },
        },
      );
      assert.equal(intent.status, 201);
      const published = await api(
        `/v1/tenants/${encodeURIComponent(context.tenantId)}/projects/${encodeURIComponent(context.projectId)}/publications`,
        {
          method: "POST",
          key: context.idempotencyKey,
          signal,
          body: {
            schemaVersion: 1,
            signedIntent: intent.value,
            manifest: prepared.manifest,
            manifestDigest: prepared.manifestDigest,
            payload: projection,
          },
        },
      );
      assert.equal(published.status, 201);
      return { publishedRunId: published.value.publishedRunId };
    },
    finalize: (claim, completion, at) => dispatchStore.finalize(claim, completion, at),
  };
}

try {
  phase = "migrate";
  await publicationStore.migrate();
  await dispatchStore.migrate();
  await controlStore.migrate();
  await cleanSyntheticRows();

  phase = "prepare-customer-checkout";
  await mkdir("/work", { recursive: true });
  await cp("/app/tooling/corpus/npm-valid", checkout, { recursive: true });
  await writeFile(path.join(checkout, "source-canary.txt"), sourceCanary, "utf8");

  phase = "seed-authority";
  await pool.query(
    `INSERT INTO control_principals
      (principal_id, principal_kind, identity_key_id, expires_at, revoked)
     VALUES ($1, 'workload', $2, $3, false)`,
    [principalId, identityKeyId, plus(60 * 60_000)],
  );
  await grant(`grant:m9-workload-create-${suffix}`, "dispatch:create", "project", projectId);
  await grant(`grant:m9-workload-project-read-${suffix}`, "project:read", "project", projectId);
  await grant(`grant:m9-workload-publish-${suffix}`, "run:publish", "project", projectId);
  const policy = {
    schemaVersion: 1,
    tenantId,
    policyId: `policy:m9-workload-${suffix}`,
    revisionId: `policy-revision:m9-workload-${suffix}`,
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
  const fixture = JSON.parse(await readFile(
    "/app/packages/cloud-client/fixtures/valid/metadata-publication.json",
    "utf8",
  ));

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.equal(typeof address, "object");
  origin = `http://127.0.0.1:${address.port}`;
  const base = `/v1/tenants/${encodeURIComponent(tenantId)}/projects/${encodeURIComponent(projectId)}`;

  phase = "admit-and-bind";
  const successRequest = dispatchRequest("success");
  const admitted = await api(`${base}/dispatches`, {
    method: "POST",
    key: successRequest.arguments.idempotencyKey,
    body: successRequest,
  });
  assert.equal(admitted.status, 202);
  const claim = await dispatchStore.claimOffer(workloadBinding, workerId, now(), 5_000);
  assert.ok(claim);
  assert.equal(claim.dispatchId, admitted.value.dispatchId);
  await assert.rejects(runCustomerWorkloadOffer({
    claim,
    environment: {
      GITHUB_WORKSPACE: checkout,
      GITHUB_REPOSITORY: "other/repository",
      RUNNER_TEMP: stateRoot,
    },
    signal: new AbortController().signal,
    transport: customerTransport(),
    projectionBuilder: projectionBuilder(fixture),
    heartbeatIntervalMs: 250,
    leaseMs: 5_000,
  }), /VFY_CUSTOMER_WORKLOAD_REQUEST_UNSUPPORTED/);

  phase = "execute-publish-finalize";
  const transport = customerTransport();
  const completed = await runCustomerWorkloadOffer({
    claim,
    environment: {
      GITHUB_WORKSPACE: checkout,
      GITHUB_REPOSITORY: "owner/repository",
      RUNNER_TEMP: stateRoot,
    },
    signal: new AbortController().signal,
    transport,
    projectionBuilder: projectionBuilder(fixture),
    heartbeatIntervalMs: 250,
    leaseMs: 5_000,
  });
  assert.equal(completed.state, "completed");
  assert.ok(transport.heartbeatCount >= 2);
  assert.equal(transport.publicationBoundaryText.includes(sourceCanary), false);
  const resolved = await api(`${base}/dispatches/${encodeURIComponent(claim.dispatchId)}`);
  assert.equal(resolved.status, 200);
  assert.equal(resolved.value.state, "completed");
  assert.equal(resolved.value.verifyInvocationId, successRequest.arguments.verifyRequest.invocationId);
  assert.equal(Object.hasOwn(resolved.value, "verifyResult"), false);
  await grant(
    `grant:m9-workload-run-read-${suffix}`,
    "run:readPublished",
    "publishedRun",
    resolved.value.publishedRunId,
  );
  const published = await api(
    `${base}/runs/${encodeURIComponent(resolved.value.publishedRunId)}`,
  );
  assert.equal(published.status, 200);
  assert.equal(JSON.stringify(published.value).includes(sourceCanary), false);

  phase = "durable-cancellation";
  const cancelledRequest = dispatchRequest("cancelled");
  const cancelledAdmission = await api(`${base}/dispatches`, {
    method: "POST",
    key: cancelledRequest.arguments.idempotencyKey,
    body: cancelledRequest,
  });
  assert.equal(cancelledAdmission.status, 202);
  await grant(
    `grant:m9-workload-cancel-${suffix}`,
    "dispatch:cancel",
    "dispatch",
    cancelledAdmission.value.dispatchId,
  );
  const cancellation = await api(
    `${base}/dispatches/${encodeURIComponent(cancelledAdmission.value.dispatchId)}/cancellations`,
    { method: "POST", key: `cancellation:m9-workload-${suffix}`, body: { schemaVersion: 1 } },
  );
  assert.equal(cancellation.status, 202);
  assert.equal(cancellation.value.cancellation.gatewayAcknowledgement, "accepted");
  const cancelledClaim = await dispatchStore.claimOffer(workloadBinding, `${workerId}:cancel`, now(), 5_000);
  assert.ok(cancelledClaim);
  let cancellationPublished = false;
  const cancelledTransport = customerTransport();
  const cancellationResult = await runCustomerWorkloadOffer({
    claim: cancelledClaim,
    environment: {
      GITHUB_WORKSPACE: checkout,
      GITHUB_REPOSITORY: "owner/repository",
      RUNNER_TEMP: stateRoot,
    },
    signal: new AbortController().signal,
    transport: {
      ...cancelledTransport,
      publishProjection: async () => {
        cancellationPublished = true;
        return { publishedRunId: "published-run:forbidden" };
      },
    },
    projectionBuilder: projectionBuilder(fixture),
    heartbeatIntervalMs: 250,
    leaseMs: 5_000,
  });
  assert.equal(cancellationResult.state, "cancelled");
  assert.equal(cancellationPublished, false);
  const cancellationResolved = await api(
    `${base}/dispatches/${encodeURIComponent(cancelledAdmission.value.dispatchId)}`,
  );
  assert.equal(cancellationResolved.status, 200);
  assert.equal(cancellationResolved.value.state, "cancelled");
  assert.equal(cancellationResolved.value.cancellation.gatewayAcknowledgement, "forwarded");
  assert.equal(cancellationResolved.value.cancellation.workloadAcknowledgement, "terminal");

  phase = "tenant-and-source-isolation";
  const crossTenant = await api(
    `/v1/tenants/${encodeURIComponent(otherTenantId)}/projects/${encodeURIComponent(projectId)}/dispatches/${encodeURIComponent(claim.dispatchId)}`,
  );
  assert.equal(crossTenant.status, 404);
  const rows = await pool.query(
    `SELECT
      (SELECT jsonb_agg(to_jsonb(d)) FROM workload_dispatches d WHERE tenant_id = $1) AS dispatches,
      (SELECT jsonb_agg(to_jsonb(o)) FROM workload_dispatch_outbox o WHERE tenant_id = $1) AS dispatch_outbox,
      (SELECT jsonb_agg(to_jsonb(r)) FROM published_runs r WHERE tenant_id = $1) AS runs,
      (SELECT jsonb_agg(to_jsonb(a)) FROM control_api_audit a WHERE tenant_id = $1) AS audit`,
    [tenantId],
  );
  assert.equal(JSON.stringify(rows.rows).includes(sourceCanary), false);

  phase = "evidence";
  console.log(JSON.stringify({
    schemaVersion: 1,
    kind: "awsCustomerWorkloadEvidence",
    outcome: "passed",
    region,
    runId,
    checks: {
      privatePostgresTls: "passed",
      exactRepositoryBinding: "passed",
      canonicalOfflineEngine: "passed",
      durableFencedHeartbeat: "passed",
      allowlistedPublication: "passed",
      publicationReferenceOnlyCompletion: "passed",
      forwardedTerminalCancellation: "passed",
      tenantIsolation: "passed",
      sourceEgressCanaryAbsent: "passed",
    },
  }));
} catch (error) {
  console.log(JSON.stringify({
    schemaVersion: 1,
    kind: "awsCustomerWorkloadEvidence",
    outcome: "failed",
    region,
    runId,
    phase,
    error: {
      name: error instanceof Error ? error.name : "UnknownError",
      code: typeof error?.code === "string"
        ? error.code
        : "VFY_LIVE_CUSTOMER_WORKLOAD_UNCLASSIFIED",
    },
  }));
  process.exitCode = 1;
} finally {
  if (server.listening) {
    server.close();
    await once(server, "close").catch(() => undefined);
  }
  await cleanSyntheticRows().catch(() => undefined);
  await pool.end();
}
