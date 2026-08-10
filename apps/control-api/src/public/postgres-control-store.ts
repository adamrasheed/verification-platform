import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type {
  CloudAuthorizationGrant,
  CloudAuthorizationRequest,
  CloudIdentityTokenRevocationCheck,
  CloudIdentityVerificationKey,
  CloudPrincipal,
} from "@verify-internal/auth";
import { verifyCloudIdentityToken } from "@verify-internal/auth";
import {
  assertPolicyBundle,
  assertSignedPublicationIntent,
  issuePublicationIntent,
} from "@verify-internal/cloud-client";
import type {
  PolicyBundle,
  PublicationIntentSigningOperation,
  SignedPublicationIntent,
} from "@verify-internal/cloud-client";
import { encodeCanonicalProtocolDocument } from "@verify-internal/protocol";
import type {
  Pool,
  PoolClient,
} from "pg";
import type {
  ControlApiAuditEvent,
  ControlApiAuthenticator,
  ControlApiAuditSink,
  ControlApiGrantResolver,
  ControlApiPublicationIntentInput,
  ControlApiPublicationIntentService,
} from "./types.js";

const MIGRATION_ID = "0001_control_api";

interface GrantRow {
  readonly grant_id: string;
  readonly principal_id: string;
  readonly action: CloudAuthorizationGrant["action"];
  readonly tenant_id: string;
  readonly resource_type: CloudAuthorizationGrant["resource"]["resourceType"];
  readonly resource_id: string;
  readonly policy_revision: string;
  readonly expires_at: Date | string;
  readonly revoked: boolean;
}

interface IntentRow {
  readonly request_digest: string;
  readonly signed_intent: unknown;
}

interface PolicyRow {
  readonly policy: unknown;
}

export interface PostgresControlApiStoreOptions {
  readonly pool: Pool;
  readonly identityKeys: readonly CloudIdentityVerificationKey[];
  readonly expectedAudience: string;
  readonly intentSigning: PublicationIntentSigningOperation;
}

function bounded(value: unknown, maximum = 256): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maximum
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function iso(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new TypeError("VFY_CONTROL_STORE_INCONSISTENT: invalid timestamp");
  }
  return parsed.toISOString();
}

function sha256(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(encodeCanonicalProtocolDocument(value)).digest("hex")}`;
}

async function transaction<T>(
  pool: Pool,
  isolation: "SERIALIZABLE" | "READ COMMITTED",
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const maximumAttempts = isolation === "SERIALIZABLE" ? 4 : 1;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET TRANSACTION ISOLATION LEVEL ${isolation}`);
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (isolation !== "SERIALIZABLE"
        || !(typeof error === "object" && error !== null && "code" in error)
        || error.code !== "40001"
        || attempt === maximumAttempts) throw error;
    } finally {
      client.release();
    }
  }
  throw new TypeError("VFY_CONTROL_STORE_INCONSISTENT: transaction retry exhausted");
}

function advisoryIdentity(parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("\u0000")).digest().subarray(0, 8).readBigInt64BE().toString();
}

function validateAudit(event: ControlApiAuditEvent): void {
  if (event.schemaVersion !== 1
    || !Number.isFinite(Date.parse(event.occurredAt))
    || !bounded(event.correlationId)
    || !bounded(event.principalId)
    || !bounded(event.tenantId)
    || !bounded(event.resourceType, 64)
    || !bounded(event.resourceId)
    || !/^[A-Z][A-Z0-9_]{0,63}$/.test(event.reasonCode)) {
    throw new TypeError("VFY_CONTROL_AUDIT_INVALID: audit event is malformed");
  }
}

export class PostgresControlApiStore implements
  ControlApiAuthenticator,
  ControlApiGrantResolver,
  ControlApiPublicationIntentService,
  ControlApiAuditSink {
  readonly #pool: Pool;
  readonly #identityKeys: readonly CloudIdentityVerificationKey[];
  readonly #expectedAudience: string;
  readonly #intentSigning: PublicationIntentSigningOperation;

  constructor(options: PostgresControlApiStoreOptions) {
    this.#pool = options.pool;
    this.#identityKeys = structuredClone(options.identityKeys);
    this.#expectedAudience = options.expectedAudience;
    this.#intentSigning = options.intentSigning;
  }

  async migrate(): Promise<void> {
    const sql = await readFile(
      new URL("../../migrations/0001_control_api.sql", import.meta.url),
      "utf8",
    );
    await transaction(this.#pool, "SERIALIZABLE", async (client) => {
      await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [
        advisoryIdentity(["verification", "control-api-schema"]),
      ]);
      await client.query(sql);
      await client.query(
        "INSERT INTO control_api_schema_migrations (migration_id) VALUES ($1) ON CONFLICT DO NOTHING",
        [MIGRATION_ID],
      );
    });
  }

  readonly isTokenRevoked: CloudIdentityTokenRevocationCheck = async (
    tokenId,
    principalId,
  ) => {
    const result = await this.#pool.query(
      `SELECT 1 FROM control_identity_token_revocations
        WHERE principal_id = $1 AND token_id = $2 AND expires_at > now()`,
      [principalId, tokenId],
    );
    return result.rowCount !== 0;
  };

  async authenticate(token: string, now: Date): Promise<CloudPrincipal | undefined> {
    const decision = await verifyCloudIdentityToken(
      token,
      this.#identityKeys,
      this.#expectedAudience,
      now,
      this.isTokenRevoked,
    );
    if (!decision.authenticated) return undefined;
    const result = await this.#pool.query(
      `SELECT 1 FROM control_principals
        WHERE principal_id = $1 AND principal_kind = $2 AND identity_key_id = $3
          AND revoked = false AND expires_at > $4`,
      [decision.principal.id, decision.principal.kind, decision.keyId, now],
    );
    return result.rowCount === 1 ? decision.principal : undefined;
  }

  async resolve(
    principal: CloudPrincipal,
    request: CloudAuthorizationRequest,
    now: Date,
  ): Promise<readonly CloudAuthorizationGrant[]> {
    const result = await this.#pool.query<GrantRow>(
      `SELECT grant_id, principal_id, action, tenant_id, resource_type,
              resource_id, policy_revision, expires_at, revoked
         FROM control_authorization_grants
        WHERE principal_id = $1 AND action = $2 AND tenant_id = $3
          AND resource_type = $4 AND resource_id = $5
          AND revoked = false AND expires_at > $6
        ORDER BY grant_id
        LIMIT 2`,
      [
        principal.id,
        request.action,
        request.resource.tenantId,
        request.resource.resourceType,
        request.resource.resourceId,
        now,
      ],
    );
    return result.rows.map((row) => ({
      grantId: row.grant_id,
      principalId: row.principal_id,
      action: row.action,
      resource: {
        tenantId: row.tenant_id,
        resourceType: row.resource_type,
        resourceId: row.resource_id,
      },
      policyRevision: row.policy_revision,
      expiresAt: iso(row.expires_at),
      revoked: row.revoked,
    }));
  }

  async issue(input: ControlApiPublicationIntentInput): Promise<SignedPublicationIntent> {
    if (!bounded(input.idempotencyKey, 512)) {
      throw new TypeError("VFY_PUBLICATION_IDEMPOTENCY_CONFLICT: invalid key");
    }
    const requestDigest = sha256({
      principalId: input.principalId,
      authorization: input.authorization,
      authorizationGrantId: input.authorizationGrantId,
      authorizationPolicyRevision: input.authorizationPolicyRevision,
      idempotencyKey: input.idempotencyKey,
      manifest: input.manifest,
      manifestDigest: input.manifestDigest,
      retentionClass: input.retentionClass,
      limits: input.limits,
      nonce: input.nonce,
      expiresAt: input.expiresAt,
    });
    return transaction(this.#pool, "SERIALIZABLE", async (client) => {
      await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [advisoryIdentity([
        "control-intent",
        input.principalId,
        input.authorization.tenantId,
        input.authorization.projectId,
        input.idempotencyKey,
      ])]);
      const existing = await client.query<IntentRow>(
        `SELECT request_digest, signed_intent FROM control_publication_intents
          WHERE principal_id = $1 AND tenant_id = $2 AND project_id = $3
            AND idempotency_key = $4`,
        [
          input.principalId,
          input.authorization.tenantId,
          input.authorization.projectId,
          input.idempotencyKey,
        ],
      );
      if (existing.rowCount === 1) {
        const row = existing.rows[0];
        if (!row || row.request_digest !== requestDigest) {
          throw new TypeError("VFY_PUBLICATION_IDEMPOTENCY_CONFLICT: key reused for different request");
        }
        assertSignedPublicationIntent(row.signed_intent);
        return structuredClone(row.signed_intent);
      }
      const policies = await client.query<PolicyRow>(
        `SELECT policy FROM control_publication_policies
          WHERE tenant_id = $1 AND project_id = $2 AND revoked = false
            AND expires_at >= $3
          ORDER BY policy_id, revision_id
          LIMIT 2`,
        [input.authorization.tenantId, input.authorization.projectId, input.expiresAt],
      );
      if (policies.rowCount !== 1 || !policies.rows[0]) {
        throw new TypeError("VFY_PUBLICATION_POLICY_DENIED: one exact policy is required");
      }
      assertPolicyBundle(policies.rows[0].policy);
      const policy: PolicyBundle = policies.rows[0].policy;
      const intentId = `intent:${requestDigest.slice("sha256:".length, "sha256:".length + 32)}`;
      const signedIntent = await issuePublicationIntent(
        input.manifest,
        input.manifestDigest,
        policy,
        {
          intentId,
          nonce: input.nonce,
          idempotencyKey: input.idempotencyKey,
          retentionClass: input.retentionClass,
          issuedAt: input.now.toISOString(),
          expiresAt: input.expiresAt,
          limits: input.limits,
        },
        this.#intentSigning,
      );
      await client.query(
        `INSERT INTO control_publication_intents
          (principal_id, tenant_id, project_id, idempotency_key,
           request_digest, signed_intent, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::timestamptz)`,
        [
          input.principalId,
          input.authorization.tenantId,
          input.authorization.projectId,
          input.idempotencyKey,
          requestDigest,
          JSON.stringify(signedIntent),
          input.expiresAt,
        ],
      );
      return signedIntent;
    });
  }

  async record(event: ControlApiAuditEvent): Promise<void> {
    validateAudit(event);
    await this.#pool.query(
      `INSERT INTO control_api_audit
        (occurred_at, correlation_id, principal_id, principal_kind, action,
         tenant_id, resource_type, resource_id, phase, outcome, reason_code,
         grant_id, policy_revision)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        event.occurredAt,
        event.correlationId,
        event.principalId,
        event.principalKind,
        event.action,
        event.tenantId,
        event.resourceType,
        event.resourceId,
        event.phase,
        event.outcome,
        event.reasonCode,
        event.grantId ?? null,
        event.policyRevision ?? null,
      ],
    );
  }
}
