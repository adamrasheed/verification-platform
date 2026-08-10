import assert from "node:assert/strict";
import {
  generateKeyPairSync,
  sign,
} from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { prepareDisclosure } from "@verify-internal/cloud-client";
import { Pool } from "pg";
import { PostgresControlApiStore } from "../dist/public/index.js";

const connectionString = process.env.VERIFY_POSTGRES_URL;
const now = new Date();
const offset = (milliseconds) => new Date(now.getTime() + milliseconds).toISOString();
const tenantId = "tenant:control-api-postgres";
const projectId = "project:control-api-postgres";
const principalId = "principal:control-api-postgres";
const keyId = "key:control-api-postgres";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const verificationKey = {
  keyId,
  issuer: "https://identity.verification.invalid",
  audience: "verify-cloud-api",
  publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  notBefore: offset(-60 * 60_000),
  expiresAt: offset(24 * 60 * 60_000),
  revoked: false,
};

function token(overrides = {}) {
  const header = Buffer.from(JSON.stringify({ alg: "EdDSA", kid: keyId, typ: "JWT" })).toString("base64url");
  const claims = Buffer.from(JSON.stringify({
    iss: verificationKey.issuer,
    sub: principalId,
    aud: verificationKey.audience,
    iat: Math.floor(now.getTime() / 1000) - 60,
    exp: Math.floor(now.getTime() / 1000) + 10 * 60,
    jti: "token:control-api-postgres",
    principalKind: "workload",
    ...overrides,
  })).toString("base64url");
  const signature = sign(
    null,
    Buffer.from(`${header}.${claims}`, "ascii"),
    privateKey,
  ).toString("base64url");
  return `${header}.${claims}.${signature}`;
}

test("PostgreSQL binds identity, exact grants, idempotent intents, revocation, and sanitized audit", {
  skip: connectionString ? false : "VERIFY_POSTGRES_URL is not configured",
}, async () => {
  const pool = new Pool({ connectionString, max: 6 });
  const store = new PostgresControlApiStore({
    pool,
    identityKeys: [verificationKey],
    expectedAudience: "verify-cloud-api",
    intentSigning: {
      keyId: "key:intent:postgres",
      sign: (bytes) => sign(null, bytes, privateKey),
    },
  });
  const cleanup = async () => {
    await pool.query("DELETE FROM control_api_audit WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM control_publication_policies WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM control_principals WHERE principal_id = $1", [principalId]);
  };
  try {
    await store.migrate();
    await cleanup();
    await pool.query(
      `INSERT INTO control_principals
        (principal_id, principal_kind, identity_key_id, expires_at, revoked)
       VALUES ($1, 'workload', $2, $3, false)`,
      [principalId, keyId, offset(60 * 60_000)],
    );
    const grant = {
      grantId: "grant:control-api-postgres",
      principalId,
      action: "run:publish",
      resource: { tenantId, resourceType: "project", resourceId: projectId },
      policyRevision: "authorization-policy:one",
      expiresAt: offset(60 * 60_000),
      revoked: false,
    };
    await pool.query(
      `INSERT INTO control_authorization_grants
        (grant_id, principal_id, action, tenant_id, resource_type, resource_id,
         policy_revision, expires_at, revoked)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false)`,
      [
        grant.grantId,
        principalId,
        grant.action,
        tenantId,
        grant.resource.resourceType,
        projectId,
        grant.policyRevision,
        grant.expiresAt,
      ],
    );
    const policy = {
      schemaVersion: 1,
      tenantId,
      policyId: "policy:control-api-postgres",
      revisionId: "policy-revision:control-api-postgres",
      issuedAt: offset(-60 * 60_000),
      expiresAt: offset(60 * 60_000),
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

    const authenticated = await store.authenticate(token(), now);
    assert.equal(authenticated?.id, principalId);
    const request = { action: "run:publish", resource: grant.resource };
    assert.deepEqual(await store.resolve(authenticated, request, now), [grant]);
    assert.deepEqual(await store.resolve(authenticated, {
      ...request,
      resource: { ...request.resource, tenantId: "tenant:other" },
    }, now), []);

    const payload = JSON.parse(await readFile(
      new URL("../../../packages/cloud-client/fixtures/valid/metadata-publication.json", import.meta.url),
      "utf8",
    ));
    payload.tenantId = tenantId;
    payload.projectId = projectId;
    payload.idempotencyKey = "idempotency:control-api-postgres";
    payload.applicationModel.tenantBinding = tenantId;
    const prepared = prepareDisclosure(payload, {
      payloadSchemaMinor: 0,
      retentionPolicy: { id: "retention:metadata", revision: "revision:one" },
      expiresAt: offset(5 * 60_000),
    });
    const input = {
      principalId,
      authorization: { tenantId, projectId },
      authorizationGrantId: grant.grantId,
      authorizationPolicyRevision: grant.policyRevision,
      idempotencyKey: payload.idempotencyKey,
      manifest: prepared.manifest,
      manifestDigest: prepared.manifestDigest,
      retentionClass: "metadata-30d",
      limits: {
        maxEncodedPayloadBytes: prepared.payloadBytes.byteLength,
        maxPromiseCount: 0,
        maxProofCount: 0,
        maxEvidenceCount: 0,
      },
      nonce: "nonce:control-api-postgres",
      expiresAt: offset(4 * 60_000),
      now,
    };
    const [first, replay] = await Promise.all([store.issue(input), store.issue(input)]);
    assert.deepEqual(replay, first);
    await assert.rejects(
      store.issue({ ...input, nonce: "nonce:changed" }),
      /VFY_PUBLICATION_IDEMPOTENCY_CONFLICT/,
    );

    await store.record({
      schemaVersion: 1,
      occurredAt: now.toISOString(),
      correlationId: "correlation:control-api-postgres",
      principalId,
      principalKind: "workload",
      action: "run:publish",
      tenantId,
      resourceType: "project",
      resourceId: projectId,
      phase: "operation",
      outcome: "succeeded",
      reasonCode: "SUCCEEDED",
      grantId: grant.grantId,
      policyRevision: grant.policyRevision,
    });
    const audit = await pool.query(
      `SELECT correlation_id, principal_id, action, tenant_id, resource_type,
              resource_id, phase, outcome, reason_code
         FROM control_api_audit WHERE tenant_id = $1`,
      [tenantId],
    );
    assert.equal(audit.rowCount, 1);
    assert.equal(JSON.stringify(audit.rows).includes("metadata-publication"), false);
    assert.equal(JSON.stringify(audit.rows).includes("token:control-api-postgres"), false);

    await pool.query(
      `INSERT INTO control_identity_token_revocations
        (principal_id, token_id, revoked_at, expires_at)
       VALUES ($1, 'token:control-api-postgres', $2, $3)`,
      [principalId, now, offset(10 * 60_000)],
    );
    assert.equal(await store.authenticate(token(), now), undefined);
    await assert.rejects(
      pool.query(
        `INSERT INTO control_authorization_grants
          (grant_id, principal_id, action, tenant_id, resource_type, resource_id,
           policy_revision, expires_at, revoked)
         VALUES ('grant:invalid', $1, 'run:publish', $2, 'tenant', $2, 'revision:one', $3, false)`,
        [principalId, tenantId, grant.expiresAt],
      ),
      /control_authorization_grants_check/,
    );
  } finally {
    await cleanup().catch(() => undefined);
    await pool.end();
  }
});
