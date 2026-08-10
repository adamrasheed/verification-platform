import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  Pool,
  type PoolClient,
  type PoolConfig,
  type QueryResultRow,
} from "pg";
import { encodeCanonicalProtocolDocument } from "@verify-internal/protocol";
import type {
  DispatchVerificationRequest,
  DispatchVerificationResult,
} from "@verify-internal/protocol";
import type {
  CustomerWorkloadCompletion,
  CustomerWorkloadDispatchAdmission,
  CustomerWorkloadDispatchReceipt,
  CustomerWorkloadDispatchRecord,
  CustomerWorkloadDispatchStore,
  CustomerWorkloadOfferClaim,
  DispatchAuthorizationContext,
  DispatchCancellationState,
} from "./types.js";
import {
  MAXIMUM_WORKLOAD_DISPATCH_ATTEMPTS,
  MAXIMUM_WORKLOAD_DISPATCH_LEASE_MS,
  assertCustomerWorkloadDispatchAdmission,
  assertCustomerWorkloadDispatchRequest,
} from "./workload-dispatch.js";

const MIGRATION_ID = "0002_customer_workload_dispatch";

interface DispatchRow extends QueryResultRow {
  tenant_id: string;
  project_id: string;
  dispatch_id: string;
  workload_binding: string;
  idempotency_key: string;
  request_digest: `sha256:${string}`;
  request: unknown;
  state: CustomerWorkloadDispatchRecord["state"];
  admitted_at: Date | string;
  updated_at: Date | string;
  verify_invocation_id: string | null;
  published_run_id: string | null;
  cancellation: unknown | null;
  reason_codes: unknown;
  worker_id: string | null;
  fence: string | number;
  attempt: number;
  lease_expires_at: Date | string | null;
  completion_digest: `sha256:${string}` | null;
}

interface IdempotencyRow extends QueryResultRow {
  project_id: string;
  request_digest: string;
  receipt: unknown;
}

function bounded(value: unknown, maximum = 512): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maximum
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function iso(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new TypeError("VFY_DISPATCH_STORE_INCONSISTENT: timestamp is invalid");
  }
  return parsed.toISOString();
}

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256")
    .update(encodeCanonicalProtocolDocument(value))
    .digest("hex")}`;
}

function databaseErrorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error
    ? (error as { code?: unknown }).code
    : undefined;
}

async function transaction<T>(
  pool: Pool,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      const code = databaseErrorCode(error);
      if (attempt === 5 || (code !== "40001" && code !== "40P01")) throw error;
    } finally {
      client.release();
    }
  }
  throw new TypeError("VFY_DISPATCH_STORE_UNAVAILABLE: transaction retry exhausted");
}

async function lock(client: PoolClient, identity: readonly string[]): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    JSON.stringify(identity),
  ]);
}

function validateScope(authorization: DispatchAuthorizationContext): void {
  if (!bounded(authorization.tenantId) || !bounded(authorization.projectId)) {
    throw new TypeError("VFY_DISPATCH_SCOPE_INVALID: tenant or project is invalid");
  }
}

function cancellation(value: unknown): DispatchCancellationState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("VFY_DISPATCH_STORE_INCONSISTENT: cancellation is malformed");
  }
  const result = value as Partial<DispatchCancellationState>;
  if (!bounded(result.cancellationId)
    || typeof result.requestedAt !== "string"
    || !Number.isFinite(Date.parse(result.requestedAt))
    || (result.gatewayAcknowledgement !== "accepted"
      && result.gatewayAcknowledgement !== "forwarded")
    || !["pending", "accepted", "terminal"].includes(result.workloadAcknowledgement ?? "")) {
    throw new TypeError("VFY_DISPATCH_STORE_INCONSISTENT: cancellation is malformed");
  }
  return structuredClone(result as DispatchCancellationState);
}

function record(row: DispatchRow): CustomerWorkloadDispatchRecord {
  if (!Array.isArray(row.reason_codes)
    || !row.reason_codes.every((value) => bounded(value, 128))) {
    throw new TypeError("VFY_DISPATCH_STORE_INCONSISTENT: reason codes are malformed");
  }
  return {
    schemaVersion: 1,
    dispatchId: row.dispatch_id,
    tenantId: row.tenant_id,
    projectId: row.project_id,
    workloadBinding: row.workload_binding,
    state: row.state,
    admittedAt: iso(row.admitted_at),
    updatedAt: iso(row.updated_at),
    ...(row.verify_invocation_id === null ? {} : { verifyInvocationId: row.verify_invocation_id }),
    ...(row.published_run_id === null ? {} : { publishedRunId: row.published_run_id }),
    ...(row.cancellation === null ? {} : { cancellation: cancellation(row.cancellation) }),
    reasonCodes: [...row.reason_codes] as string[],
  };
}

function resultFor(value: CustomerWorkloadDispatchRecord): DispatchVerificationResult {
  return {
    kind: "dispatchVerification",
    dispatchId: value.dispatchId as DispatchVerificationResult["dispatchId"],
    state: value.state === "cancelled"
      ? "cancelled"
      : value.state === "expired"
        ? "expired"
        : value.state === "failed" ? "transport_error" : "accepted",
    workloadBinding: value.workloadBinding as DispatchVerificationResult["workloadBinding"],
    ...(value.verifyInvocationId === undefined ? {} : {
      verifyInvocationId: value.verifyInvocationId as NonNullable<
        DispatchVerificationResult["verifyInvocationId"]
      >,
    }),
    ...(value.publishedRunId === undefined ? {} : {
      publishedRunId: value.publishedRunId as NonNullable<
        DispatchVerificationResult["publishedRunId"]
      >,
    }),
    reasonCodes: [...value.reasonCodes],
  };
}

function receipt(value: unknown): CustomerWorkloadDispatchReceipt {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("VFY_DISPATCH_STORE_INCONSISTENT: receipt is malformed");
  }
  const stored = value as Partial<CustomerWorkloadDispatchReceipt>;
  if (stored.schemaVersion !== 1
    || typeof stored.result !== "object"
    || stored.result === null
    || typeof stored.admittedAt !== "string"
    || !Number.isFinite(Date.parse(stored.admittedAt))) {
    throw new TypeError("VFY_DISPATCH_STORE_INCONSISTENT: receipt is malformed");
  }
  return structuredClone(stored as CustomerWorkloadDispatchReceipt);
}

function validateLease(workerId: string, leaseMs: number): void {
  if (!bounded(workerId)
    || !Number.isSafeInteger(leaseMs)
    || leaseMs <= 0
    || leaseMs > MAXIMUM_WORKLOAD_DISPATCH_LEASE_MS) {
    throw new TypeError("VFY_DISPATCH_LEASE_INVALID: worker or lease is invalid");
  }
}

export class PostgresCustomerWorkloadDispatchStore
implements CustomerWorkloadDispatchStore {
  readonly #pool: Pool;
  readonly #ownsPool: boolean;

  constructor(pool: Pool, ownsPool = false) {
    this.#pool = pool;
    this.#ownsPool = ownsPool;
  }

  static connect(config: PoolConfig): PostgresCustomerWorkloadDispatchStore {
    return new PostgresCustomerWorkloadDispatchStore(new Pool(config), true);
  }

  async close(): Promise<void> {
    if (this.#ownsPool) await this.#pool.end();
  }

  async migrate(): Promise<void> {
    const sql = await readFile(
      new URL("../../migrations/0002_customer_workload_dispatch.sql", import.meta.url),
      "utf8",
    );
    await transaction(this.#pool, async (client) => {
      await lock(client, ["verification", "cloud-schema-migrations"]);
      await client.query(sql);
      await client.query(
        "INSERT INTO cloud_schema_migrations (migration_id) VALUES ($1) ON CONFLICT DO NOTHING",
        [MIGRATION_ID],
      );
    });
  }

  async admit(
    admission: CustomerWorkloadDispatchAdmission,
  ): Promise<CustomerWorkloadDispatchReceipt> {
    assertCustomerWorkloadDispatchAdmission(admission);
    return transaction(this.#pool, async (client) => {
      const { tenantId, projectId } = admission.authorization;
      const idempotencyKey = admission.request.arguments.idempotencyKey;
      await lock(client, ["dispatch-idempotency", tenantId, idempotencyKey]);
      const existing = await client.query<IdempotencyRow>(
        `SELECT project_id, request_digest, receipt FROM workload_dispatch_idempotency
          WHERE tenant_id = $1 AND idempotency_key = $2 FOR UPDATE`,
        [tenantId, idempotencyKey],
      );
      if (existing.rowCount === 1) {
        const row = existing.rows[0] as IdempotencyRow;
        if (row.project_id !== projectId) {
          throw new TypeError(
            "VFY_DISPATCH_IDEMPOTENCY_CONFLICT: key is bound to another project",
          );
        }
        if (row.request_digest !== admission.requestDigest) {
          throw new TypeError("VFY_DISPATCH_IDEMPOTENCY_CONFLICT: key reused for different bytes");
        }
        return receipt(row.receipt);
      }
      const dispatchId = `dispatch_v1_${randomUUID()}`;
      const value: CustomerWorkloadDispatchRecord = {
        schemaVersion: 1,
        dispatchId,
        tenantId,
        projectId,
        workloadBinding: admission.request.arguments.workloadBinding,
        state: "queued",
        admittedAt: admission.admittedAt,
        updatedAt: admission.admittedAt,
        reasonCodes: [],
      };
      const accepted: CustomerWorkloadDispatchReceipt = {
        schemaVersion: 1,
        result: resultFor(value),
        admittedAt: admission.admittedAt,
      };
      await client.query(
        `INSERT INTO workload_dispatches
          (tenant_id, project_id, dispatch_id, workload_binding, idempotency_key,
           request_digest, request, state, admitted_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 'queued', $8, $8)`,
        [tenantId, projectId, dispatchId, value.workloadBinding, idempotencyKey,
          admission.requestDigest, JSON.stringify(admission.request), admission.admittedAt],
      );
      await client.query(
        `INSERT INTO workload_dispatch_idempotency
          (tenant_id, project_id, idempotency_key, request_digest, dispatch_id, receipt)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
        [tenantId, projectId, idempotencyKey, admission.requestDigest,
          dispatchId, JSON.stringify(accepted)],
      );
      await client.query(
        `INSERT INTO workload_dispatch_outbox
          (tenant_id, project_id, dispatch_id, event_id, occurred_at, event, status)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'pending')`,
        [tenantId, projectId, dispatchId, `dispatch-event_v1_${randomUUID()}`,
          admission.admittedAt, JSON.stringify({
            schemaVersion: 1,
            kind: "customerWorkloadDispatchReference",
            tenantId,
            projectId,
            dispatchId,
            workloadBinding: value.workloadBinding,
          })],
      );
      return accepted;
    });
  }

  async resolve(
    authorization: DispatchAuthorizationContext,
    dispatchId: string,
  ): Promise<CustomerWorkloadDispatchRecord | undefined> {
    validateScope(authorization);
    if (!bounded(dispatchId)) throw new TypeError("VFY_DISPATCH_SCOPE_INVALID: dispatch ID is invalid");
    const result = await this.#pool.query<DispatchRow>(
      `SELECT * FROM workload_dispatches
        WHERE tenant_id = $1 AND project_id = $2 AND dispatch_id = $3`,
      [authorization.tenantId, authorization.projectId, dispatchId],
    );
    return result.rowCount === 0 ? undefined : record(result.rows[0] as DispatchRow);
  }

  async claimOffer(
    workloadBinding: string,
    workerId: string,
    now: Date,
    leaseMs: number,
  ): Promise<CustomerWorkloadOfferClaim | undefined> {
    validateLease(workerId, leaseMs);
    if (!bounded(workloadBinding)) {
      throw new TypeError("VFY_DISPATCH_WORKLOAD_INVALID: workload binding is invalid");
    }
    return transaction(this.#pool, async (client) => {
      await client.query(
        `WITH exhausted AS (
           UPDATE workload_dispatches
              SET state = 'failed', updated_at = $2,
                  reason_codes = '["DISPATCH_ATTEMPTS_EXHAUSTED"]'::jsonb,
                  lease_expires_at = NULL
            WHERE workload_binding = $1
              AND state IN ('queued', 'offered', 'running', 'cancellation_requested')
              AND attempt >= $3
              AND (lease_expires_at IS NULL OR lease_expires_at <= $2)
          RETURNING tenant_id, project_id, dispatch_id
         )
         UPDATE workload_dispatch_outbox AS outbox
            SET status = 'delivered', lease_expires_at = NULL
           FROM exhausted
          WHERE outbox.tenant_id = exhausted.tenant_id
            AND outbox.project_id = exhausted.project_id
            AND outbox.dispatch_id = exhausted.dispatch_id`,
        [workloadBinding, now, MAXIMUM_WORKLOAD_DISPATCH_ATTEMPTS],
      );
      const selected = await client.query<DispatchRow>(
        `SELECT * FROM workload_dispatches
          WHERE workload_binding = $1
            AND state IN ('queued', 'offered', 'running', 'cancellation_requested')
            AND (lease_expires_at IS NULL OR lease_expires_at <= $2)
            AND attempt < $3
          ORDER BY admitted_at, dispatch_id
          FOR UPDATE SKIP LOCKED LIMIT 1`,
        [workloadBinding, now, MAXIMUM_WORKLOAD_DISPATCH_ATTEMPTS],
      );
      if (selected.rowCount === 0) return undefined;
      const prior = selected.rows[0] as DispatchRow;
      const leaseExpiresAt = new Date(now.getTime() + leaseMs).toISOString();
      const updated = await client.query<DispatchRow>(
        `UPDATE workload_dispatches
            SET state = CASE WHEN cancellation IS NULL THEN 'offered'
                             ELSE 'cancellation_requested' END,
                worker_id = $1, fence = fence + 1, attempt = attempt + 1,
                lease_expires_at = $2, updated_at = $3
          WHERE tenant_id = $4 AND project_id = $5 AND dispatch_id = $6
          RETURNING *`,
        [workerId, leaseExpiresAt, now, prior.tenant_id, prior.project_id, prior.dispatch_id],
      );
      const row = updated.rows[0] as DispatchRow;
      await client.query(
        `UPDATE workload_dispatch_outbox
            SET status = 'leased', worker_id = $1, fence = $2,
                attempt = $3, lease_expires_at = $4
          WHERE tenant_id = $5 AND project_id = $6 AND dispatch_id = $7`,
        [workerId, row.fence, row.attempt, leaseExpiresAt,
          row.tenant_id, row.project_id, row.dispatch_id],
      );
      assertCustomerWorkloadDispatchRequest(row.request);
      return {
        schemaVersion: 1,
        dispatchId: row.dispatch_id,
        tenantId: row.tenant_id,
        projectId: row.project_id,
        workloadBinding: row.workload_binding,
        workerId,
        fence: Number(row.fence),
        attempt: row.attempt,
        leaseExpiresAt,
        request: structuredClone(row.request as DispatchVerificationRequest),
      };
    });
  }

  async acceptOffer(claim: CustomerWorkloadOfferClaim, now: Date): Promise<void> {
    await this.#mutateClaim(claim, now, "state = 'running', updated_at = $8", "offered");
  }

  async heartbeat(
    claim: CustomerWorkloadOfferClaim,
    now: Date,
    leaseMs: number,
  ): Promise<CustomerWorkloadOfferClaim> {
    validateLease(claim.workerId, leaseMs);
    const leaseExpiresAt = new Date(now.getTime() + leaseMs).toISOString();
    await this.#mutateClaim(
      claim,
      now,
      "lease_expires_at = $8, updated_at = $9",
      ["running", "cancellation_requested"],
      [leaseExpiresAt, now],
    );
    return { ...structuredClone(claim), leaseExpiresAt };
  }

  async requestCancellation(
    authorization: DispatchAuthorizationContext,
    dispatchId: string,
    cancellationId: string,
    now: Date,
  ): Promise<CustomerWorkloadDispatchRecord | undefined> {
    validateScope(authorization);
    if (!bounded(dispatchId) || !bounded(cancellationId)) {
      throw new TypeError("VFY_DISPATCH_CANCELLATION_INVALID: identity is invalid");
    }
    return transaction(this.#pool, async (client) => {
      const result = await client.query<DispatchRow>(
        `SELECT * FROM workload_dispatches
          WHERE tenant_id = $1 AND project_id = $2 AND dispatch_id = $3 FOR UPDATE`,
        [authorization.tenantId, authorization.projectId, dispatchId],
      );
      if (result.rowCount === 0) return undefined;
      const row = result.rows[0] as DispatchRow;
      if (["completed", "expired", "failed"].includes(row.state)) {
        throw new TypeError("VFY_DISPATCH_STATE_CONFLICT: terminal dispatch cannot be cancelled");
      }
      const existing = row.cancellation === null ? undefined : cancellation(row.cancellation);
      if (existing !== undefined && existing.cancellationId !== cancellationId) {
        throw new TypeError("VFY_DISPATCH_CANCELLATION_CONFLICT: cancellation identity changed");
      }
      if (existing !== undefined) return record(row);
      const value: DispatchCancellationState = {
        cancellationId,
        requestedAt: now.toISOString(),
        gatewayAcknowledgement: "accepted",
        workloadAcknowledgement: row.state === "cancelled" ? "terminal" : "pending",
      };
      const updated = await client.query<DispatchRow>(
        `UPDATE workload_dispatches
            SET state = CASE WHEN state = 'cancelled' THEN state ELSE 'cancellation_requested' END,
                cancellation = $1::jsonb, updated_at = $2
          WHERE tenant_id = $3 AND project_id = $4 AND dispatch_id = $5 RETURNING *`,
        [JSON.stringify(value), now, authorization.tenantId, authorization.projectId, dispatchId],
      );
      return record(updated.rows[0] as DispatchRow);
    });
  }

  async observeCancellation(
    claim: CustomerWorkloadOfferClaim,
    now: Date,
  ): Promise<DispatchCancellationState | undefined> {
    return transaction(this.#pool, async (client) => {
      const row = await this.#lockedClaim(client, claim, now);
      const existing = row.cancellation === null ? undefined : cancellation(row.cancellation);
      if (existing === undefined) return undefined;
      const value: DispatchCancellationState = {
        ...existing,
        gatewayAcknowledgement: "forwarded",
      };
      await client.query(
        `UPDATE workload_dispatches SET cancellation = $1::jsonb, updated_at = $2
          WHERE tenant_id = $3 AND project_id = $4 AND dispatch_id = $5`,
        [JSON.stringify(value), now, row.tenant_id, row.project_id, row.dispatch_id],
      );
      return value;
    });
  }

  async acknowledgeCancellation(
    claim: CustomerWorkloadOfferClaim,
    acknowledgement: "accepted" | "terminal",
    now: Date,
  ): Promise<void> {
    await transaction(this.#pool, async (client) => {
      const row = await this.#lockedClaim(client, claim, now);
      const existing = row.cancellation === null ? undefined : cancellation(row.cancellation);
      if (existing === undefined || existing.gatewayAcknowledgement !== "forwarded") {
        throw new TypeError("VFY_DISPATCH_STATE_CONFLICT: cancellation was not forwarded");
      }
      if (existing.workloadAcknowledgement === "terminal" && acknowledgement !== "terminal") {
        throw new TypeError("VFY_DISPATCH_STATE_CONFLICT: terminal cancellation cannot regress");
      }
      await client.query(
        `UPDATE workload_dispatches
            SET state = $1, cancellation = $2::jsonb, updated_at = $3,
                reason_codes = CASE WHEN $1 = 'cancelled'
                  THEN '["WORKLOAD_CANCELLED"]'::jsonb ELSE reason_codes END
          WHERE tenant_id = $4 AND project_id = $5 AND dispatch_id = $6`,
        [acknowledgement === "terminal" ? "cancelled" : "cancellation_requested",
          JSON.stringify({ ...existing, workloadAcknowledgement: acknowledgement }), now,
          row.tenant_id, row.project_id, row.dispatch_id],
      );
      if (acknowledgement === "terminal") await this.#deliverOutbox(client, row);
    });
  }

  async finalize(
    claim: CustomerWorkloadOfferClaim,
    completion: CustomerWorkloadCompletion,
    now: Date,
  ): Promise<CustomerWorkloadDispatchRecord> {
    const completionDigest = digest(completion);
    return transaction(this.#pool, async (client) => {
      const existing = await client.query<DispatchRow>(
        `SELECT * FROM workload_dispatches
          WHERE tenant_id = $1 AND project_id = $2 AND dispatch_id = $3 FOR UPDATE`,
        [claim.tenantId, claim.projectId, claim.dispatchId],
      );
      if (existing.rowCount === 0) {
        throw new TypeError("VFY_DISPATCH_STALE_FENCE: dispatch is missing");
      }
      const row = existing.rows[0] as DispatchRow;
      if (row.state === "completed") {
        if (row.completion_digest !== completionDigest) {
          throw new TypeError("VFY_DISPATCH_COMPLETION_CONFLICT: completion bytes changed");
        }
        return record(row);
      }
      this.#assertClaimRow(row, claim, now);
      assertCustomerWorkloadDispatchRequest(row.request);
      if (row.state !== "running"
        || completion.schemaVersion !== 1
        || !bounded(completion.idempotencyKey)
        || completion.idempotencyKey !== row.idempotency_key
        || !bounded(completion.verifyInvocationId)
        || completion.verifyInvocationId
          !== (row.request as DispatchVerificationRequest).arguments.verifyRequest.invocationId
        || !bounded(completion.publishedRunId)
        || !Number.isFinite(Date.parse(completion.completedAt))
        || Date.parse(completion.completedAt) > now.getTime()) {
        throw new TypeError("VFY_DISPATCH_COMPLETION_INVALID: completion is invalid or unauthorized");
      }
      const updated = await client.query<DispatchRow>(
        `UPDATE workload_dispatches
            SET state = 'completed', updated_at = $1, verify_invocation_id = $2,
                published_run_id = $3, completion_digest = $4, reason_codes = '[]'::jsonb
          WHERE tenant_id = $5 AND project_id = $6 AND dispatch_id = $7 RETURNING *`,
        [completion.completedAt, completion.verifyInvocationId, completion.publishedRunId,
          completionDigest, row.tenant_id, row.project_id, row.dispatch_id],
      );
      await this.#deliverOutbox(client, row);
      return record(updated.rows[0] as DispatchRow);
    });
  }

  async #lockedClaim(
    client: PoolClient,
    claim: CustomerWorkloadOfferClaim,
    now: Date,
  ): Promise<DispatchRow> {
    const result = await client.query<DispatchRow>(
      `SELECT * FROM workload_dispatches
        WHERE tenant_id = $1 AND project_id = $2 AND dispatch_id = $3 FOR UPDATE`,
      [claim.tenantId, claim.projectId, claim.dispatchId],
    );
    if (result.rowCount === 0) {
      throw new TypeError("VFY_DISPATCH_STALE_FENCE: dispatch is missing");
    }
    const row = result.rows[0] as DispatchRow;
    this.#assertClaimRow(row, claim, now);
    return row;
  }

  #assertClaimRow(row: DispatchRow, claim: CustomerWorkloadOfferClaim, now: Date): void {
    if (row.workload_binding !== claim.workloadBinding
      || row.worker_id !== claim.workerId
      || Number(row.fence) !== claim.fence
      || row.attempt !== claim.attempt
      || row.lease_expires_at === null
      || iso(row.lease_expires_at) !== claim.leaseExpiresAt
      || Date.parse(claim.leaseExpiresAt) <= now.getTime()) {
      throw new TypeError("VFY_DISPATCH_STALE_FENCE: workload lease is stale or mismatched");
    }
  }

  async #mutateClaim(
    claim: CustomerWorkloadOfferClaim,
    now: Date,
    mutation: string,
    expectedState: CustomerWorkloadDispatchRecord["state"] | readonly CustomerWorkloadDispatchRecord["state"][],
    mutationValues: readonly unknown[] = [now],
  ): Promise<void> {
    await transaction(this.#pool, async (client) => {
      const row = await this.#lockedClaim(client, claim, now);
      const states = Array.isArray(expectedState) ? expectedState : [expectedState];
      if (!states.includes(row.state)) {
        throw new TypeError("VFY_DISPATCH_STATE_CONFLICT: dispatch state is invalid");
      }
      const base = [claim.tenantId, claim.projectId, claim.dispatchId,
        claim.workerId, claim.fence, claim.attempt, claim.leaseExpiresAt];
      await client.query(
        `UPDATE workload_dispatches SET ${mutation}
          WHERE tenant_id = $1 AND project_id = $2 AND dispatch_id = $3
            AND worker_id = $4 AND fence = $5 AND attempt = $6
            AND lease_expires_at = $7`,
        [...base, ...mutationValues],
      );
    });
  }

  async #deliverOutbox(client: PoolClient, row: DispatchRow): Promise<void> {
    await client.query(
      `UPDATE workload_dispatch_outbox
          SET status = 'delivered', lease_expires_at = NULL
        WHERE tenant_id = $1 AND project_id = $2 AND dispatch_id = $3`,
      [row.tenant_id, row.project_id, row.dispatch_id],
    );
  }
}
