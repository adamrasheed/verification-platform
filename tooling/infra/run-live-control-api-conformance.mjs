#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  generateKeyPairSync,
  sign,
  verify,
} from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  PostgresControlApiStore,
  createControlApiHandler,
} from "../../apps/control-api/dist/public/index.js";
import {
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
if (!/^[a-f0-9]{40}$/.test(runId ?? "")) throw new TypeError("VFY_LIVE_CONTROL_API_RUN_ID_INVALID");
if (region !== "us-west-2") throw new TypeError("VFY_LIVE_CONTROL_API_REGION_INVALID");
if (typeof sslRootCertPath !== "string" || !path.isAbsolute(sslRootCertPath)) {
  throw new TypeError("VFY_LIVE_CONTROL_API_TLS_ROOT_INVALID");
}

const suffix = runId.slice(0, 12);
const now = new Date();
const plus = (milliseconds) => new Date(now.getTime() + milliseconds).toISOString();
const minus = (milliseconds) => new Date(now.getTime() - milliseconds).toISOString();
const tenantId = `tenant:m9-control-${suffix}`;
const otherTenantId = `tenant:m9-control-other-${suffix}`;
const projectId = `project:m9-control-${suffix}`;
const otherProjectId = `project:m9-control-other-${suffix}`;
const principalId = `principal:m9-control-${suffix}`;
const identityKeyId = `key:m9-control-identity-${suffix}`;
const intentKeyId = `key:m9-control-intent-${suffix}`;
const audience = "verify-cloud-api";
const issuer = "https://identity.verification.invalid";
const idempotencyKey = `idempotency:m9-control-${suffix}`;
const tokenId = `token:m9-control-${suffix}`;
const sensitiveCanary = `never-audit-body-${suffix}`;

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

function identityToken({
  tokenAudience = audience,
  issuedAt = Math.floor(now.getTime() / 1000) - 30,
  expiresAt = Math.floor(now.getTime() / 1000) + 10 * 60,
  jti = tokenId,
} = {}) {
  const header = Buffer.from(JSON.stringify({ alg: "EdDSA", kid: identityKeyId, typ: "JWT" })).toString("base64url");
  const claims = Buffer.from(JSON.stringify({
    iss: issuer,
    sub: principalId,
    aud: tokenAudience,
    iat: issuedAt,
    exp: expiresAt,
    jti,
    principalKind: "workload",
  })).toString("base64url");
  const signature = sign(null, Buffer.from(`${header}.${claims}`, "ascii"), identityKeys.privateKey);
  return `${header}.${claims}.${signature.toString("base64url")}`;
}

function canonical(value) {
  return new TextDecoder().decode(encodeCanonicalProtocolDocument(value));
}

const sslRootCertificate = await readFile(sslRootCertPath, "utf8");
const pool = new Pool({
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 10_000,
  max: 8,
  ssl: { ca: sslRootCertificate, rejectUnauthorized: true },
});
const publicationStore = new PostgresPublicationStore(pool);
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
  audit: controlStore,
  now: () => new Date(now),
  correlationId: () => `correlation:m9-control-${suffix}-${++correlation}`,
});
const server = createServer(createControlApiNodeListener(handler));
let origin;

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
    await pool.query("DELETE FROM control_api_audit WHERE tenant_id IN ($1, $2)", [tenantId, otherTenantId]);
    await pool.query("DELETE FROM control_publication_policies WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM control_principals WHERE principal_id = $1", [principalId]);
    await pool.query("COMMIT");
  } catch (error) {
    await pool.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function api(path, { method = "GET", token = identityToken(), body, key } = {}) {
  const headers = { authorization: `Bearer ${token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (key !== undefined) headers["idempotency-key"] = key;
  const response = await fetch(`${origin}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: canonical(body) }),
  });
  return {
    status: response.status,
    correlationId: response.headers.get("x-correlation-id"),
    value: await response.json(),
  };
}

try {
  phase = "migrate";
  await publicationStore.migrate();
  await controlStore.migrate();
  await cleanSyntheticRows();

  phase = "seed-authority";
  await pool.query(
    `INSERT INTO control_principals
      (principal_id, principal_kind, identity_key_id, expires_at, revoked)
     VALUES ($1, 'workload', $2, $3, false)`,
    [principalId, identityKeyId, plus(60 * 60_000)],
  );
  const grants = [
    [`grant:m9-control-publish-${suffix}`, "run:publish", "project", projectId],
    [`grant:m9-control-list-${suffix}`, "project:read", "project", projectId],
  ];
  for (const [grantId, action, resourceType, resourceId] of grants) {
    await pool.query(
      `INSERT INTO control_authorization_grants
        (grant_id, principal_id, action, tenant_id, resource_type, resource_id,
         policy_revision, expires_at, revoked)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false)`,
      [grantId, principalId, action, tenantId, resourceType, resourceId, "authorization-policy:m9-control", plus(60 * 60_000)],
    );
  }
  const policy = {
    schemaVersion: 1,
    tenantId,
    policyId: `policy:m9-control-${suffix}`,
    revisionId: `policy-revision:m9-control-${suffix}`,
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
    new URL("../../packages/cloud-client/fixtures/valid/metadata-publication.json", import.meta.url),
    "utf8",
  ));
  fixture.tenantId = tenantId;
  fixture.projectId = projectId;
  fixture.runId = `run:m9-control-${suffix}`;
  fixture.idempotencyKey = idempotencyKey;
  fixture.applicationModel.tenantBinding = tenantId;
  fixture.applicationAlias = sensitiveCanary;
  fixture.auditCorrelationId = `audit:m9-control-${suffix}`;
  const prepared = prepareDisclosure(fixture, {
    payloadSchemaMinor: 0,
    retentionPolicy: { id: "retention:metadata", revision: "revision:one" },
    expiresAt: plus(10 * 60_000),
  });
  const intentBody = {
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
    nonce: `nonce:m9-control-${suffix}`,
    expiresAt: plus(5 * 60_000),
  };

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.equal(typeof address, "object");
  origin = `http://127.0.0.1:${address.port}`;

  phase = "publication-intent";
  const base = `/v1/tenants/${encodeURIComponent(tenantId)}/projects/${encodeURIComponent(projectId)}`;
  const firstIntent = await api(`${base}/publication-intents`, {
    method: "POST", key: idempotencyKey, body: intentBody,
  });
  assert.equal(firstIntent.status, 201);
  const replayIntent = await api(`${base}/publication-intents`, {
    method: "POST", key: idempotencyKey, body: intentBody,
  });
  assert.equal(replayIntent.status, 201);
  assert.deepEqual(replayIntent.value, firstIntent.value);
  const conflictingIntent = await api(`${base}/publication-intents`, {
    method: "POST", key: idempotencyKey, body: { ...intentBody, nonce: `nonce:conflict-${suffix}` },
  });
  assert.equal(conflictingIntent.status, 409);

  phase = "publication";
  const publicationBody = {
    schemaVersion: 1,
    signedIntent: firstIntent.value,
    manifest: prepared.manifest,
    manifestDigest: prepared.manifestDigest,
    payload: fixture,
  };
  const firstPublication = await api(`${base}/publications`, {
    method: "POST", key: idempotencyKey, body: publicationBody,
  });
  assert.equal(firstPublication.status, 201);
  const replayPublication = await api(`${base}/publications`, {
    method: "POST", key: idempotencyKey, body: publicationBody,
  });
  assert.equal(replayPublication.status, 201);
  assert.deepEqual(replayPublication.value, firstPublication.value);

  phase = "published-run-read";
  const publishedRunId = firstPublication.value.publishedRunId;
  await pool.query(
    `INSERT INTO control_authorization_grants
      (grant_id, principal_id, action, tenant_id, resource_type, resource_id,
       policy_revision, expires_at, revoked)
     VALUES ($1, $2, 'run:readPublished', $3, 'publishedRun', $4, $5, $6, false)`,
    [
      `grant:m9-control-read-${suffix}`,
      principalId,
      tenantId,
      publishedRunId,
      "authorization-policy:m9-control",
      plus(60 * 60_000),
    ],
  );
  const listed = await api(`${base}/runs?limit=1`);
  assert.equal(listed.status, 200);
  assert.equal(listed.value.items.length, 1);
  assert.equal(listed.value.items[0].publishedRunId, publishedRunId);
  const read = await api(`${base}/runs/${encodeURIComponent(publishedRunId)}`);
  assert.equal(read.status, 200);
  assert.equal(read.value.projection.applicationAlias, sensitiveCanary);

  phase = "tenant-isolation";
  const wrongProject = await api(
    `/v1/tenants/${encodeURIComponent(tenantId)}/projects/${encodeURIComponent(otherProjectId)}/runs/${encodeURIComponent(publishedRunId)}`,
  );
  const crossTenant = await api(
    `/v1/tenants/${encodeURIComponent(otherTenantId)}/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(publishedRunId)}`,
  );
  const missing = await api(`${base}/runs/${encodeURIComponent(`published-run:missing-${suffix}`)}`);
  assert.deepEqual([wrongProject.status, crossTenant.status, missing.status], [404, 404, 404]);
  assert.deepEqual(
    [wrongProject.value.error.code, crossTenant.value.error.code, missing.value.error.code],
    ["VFY_CONTROL_API_NOT_AUTHORIZED", "VFY_CONTROL_API_NOT_AUTHORIZED", "VFY_CONTROL_API_NOT_AUTHORIZED"],
  );

  phase = "identity-rejection";
  const wrongAudience = await api(`${base}/runs`, {
    token: identityToken({ tokenAudience: "wrong-audience" }),
  });
  const expired = await api(`${base}/runs`, {
    token: identityToken({
      issuedAt: Math.floor(now.getTime() / 1000) - 120,
      expiresAt: Math.floor(now.getTime() / 1000) - 60,
      jti: `token:expired-${suffix}`,
    }),
  });
  const revokedTokenId = `token:revoked-${suffix}`;
  await pool.query(
    `INSERT INTO control_identity_token_revocations
      (principal_id, token_id, revoked_at, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [principalId, revokedTokenId, now, plus(10 * 60_000)],
  );
  const revoked = await api(`${base}/runs`, {
    token: identityToken({ jti: revokedTokenId }),
  });
  assert.deepEqual([wrongAudience.status, expired.status, revoked.status], [401, 401, 401]);

  phase = "audit";
  const audit = await pool.query(
    `SELECT occurred_at, correlation_id, principal_id, principal_kind, action,
            tenant_id, resource_type, resource_id, phase, outcome, reason_code,
            grant_id, policy_revision
       FROM control_api_audit
      WHERE tenant_id IN ($1, $2)
      ORDER BY audit_sequence`,
    [tenantId, otherTenantId],
  );
  assert.ok(audit.rowCount >= 20);
  const auditText = JSON.stringify(audit.rows);
  assert.equal(auditText.includes(identityToken()), false);
  assert.equal(auditText.includes(sensitiveCanary), false);
  assert.equal(auditText.includes(idempotencyKey), false);
  const auditColumns = await pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'control_api_audit'
      ORDER BY ordinal_position`,
  );
  assert.equal(
    auditColumns.rows.some(({ column_name: name }) => /token|secret|body|payload|manifest/i.test(name)),
    false,
  );

  phase = "evidence";
  console.log(JSON.stringify({
    schemaVersion: 1,
    kind: "awsControlApiEvidence",
    outcome: "passed",
    region,
    runId,
    checks: {
      privatePostgresTls: "passed",
      realHttpBoundary: "passed",
      signedIdentity: "passed",
      exactAuthorization: "passed",
      tenantIsolation: "passed",
      intentIdempotency: "passed",
      publicationIdempotency: "passed",
      boundedReadAndList: "passed",
      tokenExpiryAndRevocation: "passed",
      sanitizedAudit: "passed",
    },
  }));
} catch (error) {
  console.error(error);
  console.log(JSON.stringify({
    schemaVersion: 1,
    kind: "awsControlApiEvidence",
    outcome: "failed",
    region,
    runId,
    phase,
    error: {
      name: error instanceof Error ? error.name : "UnknownError",
      code: typeof error?.code === "string" ? error.code : "VFY_LIVE_CONTROL_API_UNCLASSIFIED",
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
