import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  Pool,
  type PoolClient,
  type PoolConfig,
  type QueryResultRow,
} from "pg";
import type {
  MetadataPublicationPayload,
  PublicationAuthorizationContext,
  PublicationIngestionReceipt,
  PublicationOutboxClaim,
  PublicationOutboxEvent,
  PublicationOutboxStore,
  PublishedRunDeletionOptions,
  PublishedRunListPage,
  PublishedRunRecord,
  PublishedRunResolution,
  PublishedRunStore,
  PublishedRunTombstone,
} from "./types.js";
import {
  MAXIMUM_PUBLICATION_DELIVERY_ATTEMPTS,
  MAXIMUM_PUBLICATION_LEASE_MS,
  MAXIMUM_PUBLISHED_RUN_CURSOR_COUNT,
  MAXIMUM_PUBLISHED_RUN_LIST_LIMIT,
  PUBLISHED_RUN_CURSOR_LIFETIME_MS,
  assertDeletionOptions,
  assertPublicationAdmissionUnit,
  bounded,
  deletionEvent,
  structurallyEqual,
} from "./published-runs.js";
import { assertMetadataPublicationPayload } from "./validation.js";

const MIGRATION_ID = "0001_publication_store";
const ACTIVE_RETENTION_DAYS = 30;
const TOMBSTONE_RETENTION_DAYS = 365;

interface IdempotencyRow extends QueryResultRow {
  request_digest: string;
  receipt: unknown;
}

interface ResolutionRow extends QueryResultRow {
  published_at: Date | string;
  projection: unknown | null;
  deleted_at: Date | string | null;
  authority: string | null;
  reason_class: string | null;
  affected_edge_ids: unknown | null;
}

interface CursorRow extends QueryResultRow {
  after_published_at: Date | string;
  after_published_run_id: string;
}

interface ListingRow extends ResolutionRow {
  published_run_id: string;
}

interface OutboxRow extends QueryResultRow {
  event: unknown;
  worker_id: string;
  fence: string | number;
  attempt: number;
  lease_expires_at: Date | string;
}

interface RetentionRow extends QueryResultRow {
  tenant_id: string;
  project_id: string;
  published_run_id: string;
}

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function iso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError("VFY_PUBLISHED_RUN_STORE_INCONSISTENT: invalid stored timestamp");
  }
  return date.toISOString();
}

function requiredRow<T>(rows: readonly T[], message: string): T {
  const row = rows[0];
  if (row === undefined) throw new TypeError(message);
  return row;
}

function databaseErrorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error
    ? (error as { code?: unknown }).code
    : undefined;
}

function assertScope(authorization: PublicationAuthorizationContext): void {
  if (!bounded(authorization.tenantId) || !bounded(authorization.projectId)) {
    throw new TypeError("VFY_PUBLISHED_RUN_SCOPE_INVALID: tenant or project is invalid");
  }
}

function receiptFrom(value: unknown): PublicationIngestionReceipt {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("VFY_PUBLISHED_RUN_STORE_INCONSISTENT: malformed stored receipt");
  }
  const receipt = value as Partial<PublicationIngestionReceipt>;
  if (receipt.schemaVersion !== 1
    || !bounded(receipt.intentId)
    || !bounded(receipt.publishedRunId)
    || !bounded(receipt.tenantId)
    || !bounded(receipt.projectId)
    || !bounded(receipt.idempotencyKey)
    || typeof receipt.payloadDigest !== "string"
    || !/^sha256:[a-f0-9]{64}$/.test(receipt.payloadDigest)
    || typeof receipt.acceptedAt !== "string"
    || !Number.isFinite(Date.parse(receipt.acceptedAt))) {
    throw new TypeError("VFY_PUBLISHED_RUN_STORE_INCONSISTENT: malformed stored receipt");
  }
  return structuredClone(receipt as PublicationIngestionReceipt);
}

function eventFrom(value: unknown): PublicationOutboxEvent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("VFY_PUBLICATION_OUTBOX_STORE_INCONSISTENT: malformed event");
  }
  const event = value as Partial<PublicationOutboxEvent>;
  const payload = event.payload;
  if (event.schemaVersion !== 1
    || !bounded(event.eventId)
    || !["PublishedRunAccepted", "PublishedRunDeleted"].includes(event.eventType ?? "")
    || !bounded(event.tenantId)
    || event.aggregateType !== "publishedRun"
    || !bounded(event.aggregateId)
    || typeof event.occurredAt !== "string"
    || !Number.isFinite(Date.parse(event.occurredAt))
    || typeof payload !== "object"
    || payload === null
    || Array.isArray(payload)
    || !bounded(payload.publishedRunId)
    || payload.publishedRunId !== event.aggregateId) {
    throw new TypeError("VFY_PUBLICATION_OUTBOX_STORE_INCONSISTENT: malformed event");
  }
  if (event.eventType === "PublishedRunAccepted"
    && (typeof (payload as { payloadDigest?: unknown }).payloadDigest !== "string"
      || !/^sha256:[a-f0-9]{64}$/.test((payload as { payloadDigest: string }).payloadDigest))) {
    throw new TypeError("VFY_PUBLICATION_OUTBOX_STORE_INCONSISTENT: malformed accepted event");
  }
  if (event.eventType === "PublishedRunDeleted"
    && (!bounded((payload as { authority?: unknown }).authority, 128)
      || typeof (payload as { reasonClass?: unknown }).reasonClass !== "string"
      || !/^[A-Z][A-Z0-9_]{0,63}$/.test((payload as { reasonClass: string }).reasonClass))) {
    throw new TypeError("VFY_PUBLICATION_OUTBOX_STORE_INCONSISTENT: malformed deletion event");
  }
  return structuredClone(event as PublicationOutboxEvent);
}

function tombstoneFrom(
  publishedRunId: string,
  row: ResolutionRow,
): PublishedRunTombstone {
  if (row.deleted_at === null
    || !bounded(row.authority, 128)
    || typeof row.reason_class !== "string"
    || !Array.isArray(row.affected_edge_ids)) {
    throw new TypeError("VFY_PUBLISHED_RUN_STORE_INCONSISTENT: malformed tombstone row");
  }
  return assertDeletionOptions(publishedRunId, {
    deletedAt: iso(row.deleted_at),
    authority: row.authority,
    reasonClass: row.reason_class,
    affectedEdgeIds: row.affected_edge_ids as string[],
  });
}

function resolutionFrom(row: ListingRow): PublishedRunResolution {
  const publishedAt = iso(row.published_at);
  if (row.deleted_at !== null) {
    if (row.projection !== null) {
      throw new TypeError("VFY_PUBLISHED_RUN_STORE_INCONSISTENT: active and deleted rows overlap");
    }
    return {
      state: "deleted_reference",
      publishedAt,
      publishedRunId: row.published_run_id,
      tombstone: tombstoneFrom(row.published_run_id, row),
    };
  }
  if (row.projection === null) {
    throw new TypeError("VFY_PUBLISHED_RUN_STORE_INCONSISTENT: listing has no active or deleted row");
  }
  assertMetadataPublicationPayload(row.projection);
  return {
    state: "active",
    publishedAt,
    publishedRunId: row.published_run_id,
    projection: structuredClone(row.projection),
  };
}

async function transaction<T>(
  pool: Pool,
  isolation: "READ COMMITTED" | "REPEATABLE READ" | "SERIALIZABLE",
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const client = await pool.connect();
    try {
      await client.query(`BEGIN ISOLATION LEVEL ${isolation}`);
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
  throw new TypeError("VFY_PUBLISHED_RUN_STORE_UNAVAILABLE: transaction retry exhausted");
}

async function lockIdentity(client: PoolClient, identity: string): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [identity]);
}

function lockKey(...parts: readonly string[]): string {
  return JSON.stringify(parts);
}

export class PostgresPublicationStore implements PublishedRunStore, PublicationOutboxStore {
  readonly #pool: Pool;
  readonly #ownsPool: boolean;

  constructor(pool: Pool, ownsPool = false) {
    this.#pool = pool;
    this.#ownsPool = ownsPool;
  }

  static connect(config: PoolConfig): PostgresPublicationStore {
    return new PostgresPublicationStore(new Pool(config), true);
  }

  async close(): Promise<void> {
    if (this.#ownsPool) await this.#pool.end();
  }

  async migrate(): Promise<void> {
    const sql = await readFile(
      new URL("../../migrations/0001_publication_store.sql", import.meta.url),
      "utf8",
    );
    await transaction(this.#pool, "SERIALIZABLE", async (client) => {
      await lockIdentity(client, "verification:cloud-schema-migrations");
      await client.query(sql);
      await client.query(
        "INSERT INTO cloud_schema_migrations (migration_id) VALUES ($1) ON CONFLICT DO NOTHING",
        [MIGRATION_ID],
      );
    });
  }

  async accept(
    tenantId: string,
    idempotencyKey: string,
    nonce: string,
    requestDigest: `sha256:${string}`,
    receipt: PublicationIngestionReceipt,
    publishedRun: PublishedRunRecord,
    outboxEvent: PublicationOutboxEvent,
  ): Promise<PublicationIngestionReceipt> {
    assertPublicationAdmissionUnit(
      tenantId,
      idempotencyKey,
      nonce,
      requestDigest,
      receipt,
      publishedRun,
      outboxEvent,
    );
    try {
      return await transaction(this.#pool, "SERIALIZABLE", async (client) => {
        await lockIdentity(client, lockKey("idempotency", tenantId, idempotencyKey));
        await lockIdentity(client, lockKey("nonce", tenantId, nonce));
        const existing = await client.query<IdempotencyRow>(
          `SELECT request_digest, receipt
             FROM publication_idempotency
            WHERE tenant_id = $1 AND idempotency_key = $2
            FOR UPDATE`,
          [tenantId, idempotencyKey],
        );
        if (existing.rowCount === 1) {
          const row = requiredRow(
            existing.rows,
            "VFY_PUBLISHED_RUN_STORE_INCONSISTENT: idempotency row is missing",
          );
          if (row.request_digest !== requestDigest) {
            throw new TypeError("VFY_PUBLICATION_IDEMPOTENCY_CONFLICT: key reused for different bytes");
          }
          return receiptFrom(row.receipt);
        }
        const consumedNonce = await client.query(
          "SELECT 1 FROM publication_nonces WHERE tenant_id = $1 AND nonce = $2 FOR UPDATE",
          [tenantId, nonce],
        );
        if (consumedNonce.rowCount !== 0) {
          throw new TypeError("VFY_PUBLICATION_REPLAY_DETECTED: nonce was already consumed");
        }
        await lockIdentity(
          client,
          lockKey("published-run", tenantId, publishedRun.projectId, publishedRun.publishedRunId),
        );
        const tombstone = await client.query(
          `SELECT 1 FROM published_run_tombstones
            WHERE tenant_id = $1 AND project_id = $2 AND published_run_id = $3
            FOR UPDATE`,
          [tenantId, publishedRun.projectId, publishedRun.publishedRunId],
        );
        if (tombstone.rowCount !== 0) {
          throw new TypeError("VFY_PUBLISHED_RUN_RESTORE_BLOCKED: object is tombstoned");
        }
        await client.query(
          `INSERT INTO publication_idempotency
            (tenant_id, project_id, published_run_id, idempotency_key, request_digest, receipt)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
          [
            tenantId,
            publishedRun.projectId,
            publishedRun.publishedRunId,
            idempotencyKey,
            requestDigest,
            JSON.stringify(receipt),
          ],
        );
        await client.query(
          `INSERT INTO publication_nonces (tenant_id, nonce, idempotency_key)
           VALUES ($1, $2, $3)`,
          [tenantId, nonce, idempotencyKey],
        );
        await client.query(
          `INSERT INTO published_run_listings
            (tenant_id, project_id, published_run_id, published_at, active_expires_at)
           VALUES ($1, $2, $3, $4::timestamptz, $4::timestamptz + make_interval(days => $5))`,
          [
            tenantId,
            publishedRun.projectId,
            publishedRun.publishedRunId,
            publishedRun.publishedAt,
            ACTIVE_RETENTION_DAYS,
          ],
        );
        await client.query(
          `INSERT INTO published_runs
            (tenant_id, project_id, published_run_id, source_intent_id, idempotency_key,
             payload_digest, published_at, projection)
           VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8::jsonb)`,
          [
            tenantId,
            publishedRun.projectId,
            publishedRun.publishedRunId,
            publishedRun.sourceIntentId,
            idempotencyKey,
            publishedRun.payloadDigest,
            publishedRun.publishedAt,
            JSON.stringify(publishedRun.projection),
          ],
        );
        await client.query(
          `INSERT INTO publication_outbox
            (tenant_id, project_id, event_id, aggregate_type, aggregate_id,
             occurred_at, event, status)
           VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::jsonb, 'pending')`,
          [
            tenantId,
            publishedRun.projectId,
            outboxEvent.eventId,
            outboxEvent.aggregateType,
            outboxEvent.aggregateId,
            outboxEvent.occurredAt,
            JSON.stringify(outboxEvent),
          ],
        );
        return structuredClone(receipt);
      });
    } catch (error) {
      if (databaseErrorCode(error) === "23505") {
        throw new TypeError(
          "VFY_PUBLICATION_ADMISSION_CONFLICT: projection or event identity collision",
          { cause: error },
        );
      }
      throw error;
    }
  }

  async readPublishedRun(
    authorization: PublicationAuthorizationContext,
    publishedRunId: string,
  ): Promise<MetadataPublicationPayload | undefined> {
    const resolution = await this.resolvePublishedRun(authorization, publishedRunId);
    return resolution?.state === "active" ? resolution.projection : undefined;
  }

  async resolvePublishedRun(
    authorization: PublicationAuthorizationContext,
    publishedRunId: string,
  ): Promise<PublishedRunResolution | undefined> {
    assertScope(authorization);
    if (!bounded(publishedRunId)) {
      throw new TypeError("VFY_PUBLISHED_RUN_SCOPE_INVALID: published run ID is invalid");
    }
    const result = await this.#pool.query<ListingRow>(
      `SELECT l.published_run_id, l.published_at, r.projection,
              t.deleted_at, t.authority, t.reason_class, t.affected_edge_ids
         FROM published_run_listings l
         LEFT JOIN published_runs r
           ON r.tenant_id = l.tenant_id
          AND r.project_id = l.project_id
          AND r.published_run_id = l.published_run_id
         LEFT JOIN published_run_tombstones t
           ON t.tenant_id = l.tenant_id
          AND t.project_id = l.project_id
          AND t.published_run_id = l.published_run_id
        WHERE l.tenant_id = $1 AND l.project_id = $2 AND l.published_run_id = $3`,
      [authorization.tenantId, authorization.projectId, publishedRunId],
    );
    return result.rowCount === 0
      ? undefined
      : resolutionFrom(requiredRow(
        result.rows,
        "VFY_PUBLISHED_RUN_STORE_INCONSISTENT: listing row is missing",
      ));
  }

  async listPublishedRuns(
    authorization: PublicationAuthorizationContext,
    options: { readonly limit: number; readonly cursor?: string },
  ): Promise<PublishedRunListPage> {
    assertScope(authorization);
    if (!Number.isSafeInteger(options.limit)
      || options.limit <= 0
      || options.limit > MAXIMUM_PUBLISHED_RUN_LIST_LIMIT) {
      throw new TypeError("VFY_PUBLISHED_RUN_LIST_INVALID: limit or scope is invalid");
    }
    const now = new Date();
    return transaction(this.#pool, "REPEATABLE READ", async (client) => {
      await client.query("DELETE FROM published_run_cursors WHERE expires_at <= $1", [now]);
      let afterPublishedAt: string | undefined;
      let afterPublishedRunId: string | undefined;
      if (options.cursor !== undefined) {
        if (!/^cursor_v1_[A-Za-z0-9_-]{43}$/.test(options.cursor)) {
          throw new TypeError("VFY_PUBLISHED_RUN_CURSOR_INVALID: cursor is invalid or expired");
        }
        const cursor = await client.query<CursorRow>(
          `SELECT after_published_at, after_published_run_id
             FROM published_run_cursors
            WHERE token_digest = $1 AND tenant_id = $2 AND project_id = $3 AND expires_at > $4`,
          [digest(options.cursor), authorization.tenantId, authorization.projectId, now],
        );
        if (cursor.rowCount !== 1) {
          throw new TypeError("VFY_PUBLISHED_RUN_CURSOR_INVALID: cursor is invalid or expired");
        }
        const row = requiredRow(
          cursor.rows,
          "VFY_PUBLISHED_RUN_CURSOR_INVALID: cursor is invalid or expired",
        );
        afterPublishedAt = iso(row.after_published_at);
        afterPublishedRunId = row.after_published_run_id;
      }
      const rows = await client.query<ListingRow>(
        `SELECT l.published_run_id, l.published_at, r.projection,
                t.deleted_at, t.authority, t.reason_class, t.affected_edge_ids
           FROM published_run_listings l
           LEFT JOIN published_runs r
             ON r.tenant_id = l.tenant_id
            AND r.project_id = l.project_id
            AND r.published_run_id = l.published_run_id
           LEFT JOIN published_run_tombstones t
             ON t.tenant_id = l.tenant_id
            AND t.project_id = l.project_id
            AND t.published_run_id = l.published_run_id
          WHERE l.tenant_id = $1
            AND l.project_id = $2
            AND ($3::timestamptz IS NULL OR (l.published_at, l.published_run_id) > ($3::timestamptz, $4))
          ORDER BY l.published_at, l.published_run_id
          LIMIT $5`,
        [
          authorization.tenantId,
          authorization.projectId,
          afterPublishedAt ?? null,
          afterPublishedRunId ?? "",
          options.limit + 1,
        ],
      );
      const selected = rows.rows.slice(0, options.limit);
      const items = selected.map(resolutionFrom);
      if (rows.rows.length <= options.limit) return { schemaVersion: 1, items };
      const last = selected.at(-1) as ListingRow;
      const nextCursor = `cursor_v1_${randomBytes(32).toString("base64url")}`;
      await lockIdentity(client, "verification:published-run-cursors");
      await client.query(
        `INSERT INTO published_run_cursors
          (token_digest, tenant_id, project_id, after_published_at, after_published_run_id, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          digest(nextCursor),
          authorization.tenantId,
          authorization.projectId,
          last.published_at,
          last.published_run_id,
          new Date(now.getTime() + PUBLISHED_RUN_CURSOR_LIFETIME_MS),
        ],
      );
      await client.query(
        `DELETE FROM published_run_cursors
          WHERE cursor_sequence IN (
            SELECT cursor_sequence
              FROM published_run_cursors
             ORDER BY cursor_sequence DESC
             OFFSET $1
          )`,
        [MAXIMUM_PUBLISHED_RUN_CURSOR_COUNT],
      );
      return { schemaVersion: 1, items, nextCursor };
    });
  }

  async deletePublishedRun(
    authorization: PublicationAuthorizationContext,
    publishedRunId: string,
    options: PublishedRunDeletionOptions,
  ): Promise<PublishedRunTombstone | undefined> {
    assertScope(authorization);
    const tombstone = assertDeletionOptions(publishedRunId, options);
    return transaction(this.#pool, "SERIALIZABLE", async (client) => {
      await lockIdentity(
        client,
        lockKey(
          "published-run",
          authorization.tenantId,
          authorization.projectId,
          publishedRunId,
        ),
      );
      const listing = await client.query(
        `SELECT 1 FROM published_run_listings
          WHERE tenant_id = $1 AND project_id = $2 AND published_run_id = $3
          FOR UPDATE`,
        [authorization.tenantId, authorization.projectId, publishedRunId],
      );
      if (listing.rowCount === 0) return undefined;
      const existing = await client.query<ResolutionRow>(
        `SELECT l.published_at, NULL::jsonb AS projection,
                t.deleted_at, t.authority, t.reason_class, t.affected_edge_ids
           FROM published_run_listings l
           JOIN published_run_tombstones t
             ON t.tenant_id = l.tenant_id
            AND t.project_id = l.project_id
            AND t.published_run_id = l.published_run_id
          WHERE l.tenant_id = $1 AND l.project_id = $2 AND l.published_run_id = $3
          FOR UPDATE OF t`,
        [authorization.tenantId, authorization.projectId, publishedRunId],
      );
      if (existing.rowCount === 1) {
        const stored = tombstoneFrom(publishedRunId, requiredRow(
          existing.rows,
          "VFY_PUBLISHED_RUN_STORE_INCONSISTENT: tombstone row is missing",
        ));
        if (!structurallyEqual(stored, tombstone)) {
          throw new TypeError("VFY_PUBLISHED_RUN_DELETION_CONFLICT: deletion metadata changed");
        }
        return stored;
      }
      const active = await client.query(
        `SELECT 1 FROM published_runs
          WHERE tenant_id = $1 AND project_id = $2 AND published_run_id = $3
          FOR UPDATE`,
        [authorization.tenantId, authorization.projectId, publishedRunId],
      );
      if (active.rowCount !== 1) {
        throw new TypeError("VFY_PUBLISHED_RUN_STORE_INCONSISTENT: active record is missing");
      }
      const event = deletionEvent(authorization.tenantId, authorization.projectId, tombstone);
      await client.query(
        `DELETE FROM published_runs
          WHERE tenant_id = $1 AND project_id = $2 AND published_run_id = $3`,
        [authorization.tenantId, authorization.projectId, publishedRunId],
      );
      await client.query(
        `DELETE FROM publication_nonces n
          USING publication_idempotency i
          WHERE n.tenant_id = i.tenant_id
            AND n.idempotency_key = i.idempotency_key
            AND i.tenant_id = $1 AND i.project_id = $2 AND i.published_run_id = $3`,
        [authorization.tenantId, authorization.projectId, publishedRunId],
      );
      await client.query(
        `DELETE FROM publication_idempotency
          WHERE tenant_id = $1 AND project_id = $2 AND published_run_id = $3`,
        [authorization.tenantId, authorization.projectId, publishedRunId],
      );
      await client.query(
        `DELETE FROM publication_outbox
          WHERE tenant_id = $1 AND project_id = $2
            AND aggregate_type = 'publishedRun' AND aggregate_id = $3`,
        [authorization.tenantId, authorization.projectId, publishedRunId],
      );
      await client.query(
        `INSERT INTO published_run_tombstones
          (tenant_id, project_id, published_run_id, deleted_at, authority,
           reason_class, affected_edge_ids, expires_at)
         VALUES ($1, $2, $3, $4::timestamptz, $5, $6, $7::jsonb,
                 $4::timestamptz + make_interval(days => $8))`,
        [
          authorization.tenantId,
          authorization.projectId,
          publishedRunId,
          tombstone.deletedAt,
          tombstone.authority,
          tombstone.reasonClass,
          JSON.stringify(tombstone.affectedEdgeIds),
          TOMBSTONE_RETENTION_DAYS,
        ],
      );
      await client.query(
        `INSERT INTO publication_outbox
          (tenant_id, project_id, event_id, aggregate_type, aggregate_id,
           occurred_at, event, status)
         VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::jsonb, 'pending')`,
        [
          authorization.tenantId,
          authorization.projectId,
          event.eventId,
          event.aggregateType,
          event.aggregateId,
          event.occurredAt,
          JSON.stringify(event),
        ],
      );
      return structuredClone(tombstone);
    });
  }

  async assertPublishedRunRestorable(
    authorization: PublicationAuthorizationContext,
    publishedRunId: string,
  ): Promise<void> {
    assertScope(authorization);
    if (!bounded(publishedRunId)) {
      throw new TypeError("VFY_PUBLISHED_RUN_SCOPE_INVALID: published run ID is invalid");
    }
    const result = await this.#pool.query(
      `SELECT 1 FROM published_run_tombstones
        WHERE tenant_id = $1 AND project_id = $2 AND published_run_id = $3`,
      [authorization.tenantId, authorization.projectId, publishedRunId],
    );
    if (result.rowCount !== 0) {
      throw new TypeError("VFY_PUBLISHED_RUN_RESTORE_BLOCKED: object is tombstoned");
    }
  }

  async claimOutbox(
    workerId: string,
    now: Date,
    leaseMs: number,
  ): Promise<PublicationOutboxClaim | undefined> {
    if (!bounded(workerId)
      || !Number.isFinite(now.getTime())
      || !Number.isSafeInteger(leaseMs)
      || leaseMs <= 0
      || leaseMs > MAXIMUM_PUBLICATION_LEASE_MS) {
      throw new TypeError("VFY_PUBLICATION_OUTBOX_CLAIM_INVALID: invalid worker or lease");
    }
    return transaction(this.#pool, "READ COMMITTED", async (client) => {
      const result = await client.query<OutboxRow>(
        `WITH candidate AS (
           SELECT tenant_id, event_id
             FROM publication_outbox
            WHERE (status = 'pending' OR (status = 'leased' AND lease_expires_at <= $1))
              AND attempt < $2
            ORDER BY occurred_at, event_id
            FOR UPDATE SKIP LOCKED
            LIMIT 1
         )
         UPDATE publication_outbox o
            SET status = 'leased',
                attempt = o.attempt + 1,
                fence = o.fence + 1,
                worker_id = $3,
                lease_expires_at = $1::timestamptz + make_interval(secs => $4::double precision / 1000),
                failure_code = NULL
           FROM candidate c
          WHERE o.tenant_id = c.tenant_id AND o.event_id = c.event_id
         RETURNING o.event, o.worker_id, o.fence, o.attempt, o.lease_expires_at`,
        [now, MAXIMUM_PUBLICATION_DELIVERY_ATTEMPTS, workerId, leaseMs],
      );
      if (result.rowCount === 0) return undefined;
      const row = requiredRow(
        result.rows,
        "VFY_PUBLICATION_OUTBOX_STORE_INCONSISTENT: claimed row is missing",
      );
      const fence = Number(row.fence);
      if (!Number.isSafeInteger(fence) || fence <= 0) {
        throw new TypeError("VFY_PUBLICATION_OUTBOX_STORE_INCONSISTENT: invalid fence");
      }
      return {
        event: eventFrom(row.event),
        workerId: row.worker_id,
        fence,
        attempt: row.attempt,
        leaseExpiresAt: iso(row.lease_expires_at),
      };
    });
  }

  async acknowledgeOutbox(claim: PublicationOutboxClaim, now: Date): Promise<void> {
    if (!Number.isFinite(now.getTime())) {
      throw new TypeError("VFY_PUBLICATION_OUTBOX_STALE_FENCE: acknowledgement rejected");
    }
    const result = await this.#pool.query(
      `UPDATE publication_outbox
          SET status = 'delivered', worker_id = NULL, lease_expires_at = NULL, failure_code = NULL
        WHERE tenant_id = $1 AND event_id = $2 AND status = 'leased'
          AND worker_id = $3 AND fence = $4 AND lease_expires_at = $5::timestamptz
          AND lease_expires_at > $6::timestamptz`,
      [
        claim.event.tenantId,
        claim.event.eventId,
        claim.workerId,
        claim.fence,
        claim.leaseExpiresAt,
        now,
      ],
    );
    if (result.rowCount !== 1) {
      throw new TypeError("VFY_PUBLICATION_OUTBOX_STALE_FENCE: acknowledgement rejected");
    }
  }

  async failOutbox(
    claim: PublicationOutboxClaim,
    failureCode: string,
    now: Date,
  ): Promise<void> {
    if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(failureCode) || !Number.isFinite(now.getTime())) {
      throw new TypeError("VFY_PUBLICATION_OUTBOX_STALE_FENCE: failure release rejected");
    }
    const result = await this.#pool.query(
      `UPDATE publication_outbox
          SET status = CASE WHEN attempt >= $1 THEN 'deadLetter' ELSE 'pending' END,
              event = CASE WHEN attempt >= $1 THEN jsonb_build_object(
                'schemaVersion', 1,
                'eventId', event->>'eventId',
                'eventType', event->>'eventType',
                'tenantId', event->>'tenantId',
                'aggregateType', event->>'aggregateType',
                'aggregateId', event->>'aggregateId',
                'occurredAt', event->>'occurredAt',
                'payload', jsonb_build_object('publishedRunId', event#>>'{payload,publishedRunId}')
              ) ELSE event END,
              worker_id = NULL,
              lease_expires_at = NULL,
              failure_code = $2
        WHERE tenant_id = $3 AND event_id = $4 AND status = 'leased'
          AND worker_id = $5 AND fence = $6 AND lease_expires_at = $7::timestamptz
          AND lease_expires_at > $8::timestamptz`,
      [
        MAXIMUM_PUBLICATION_DELIVERY_ATTEMPTS,
        failureCode,
        claim.event.tenantId,
        claim.event.eventId,
        claim.workerId,
        claim.fence,
        claim.leaseExpiresAt,
        now,
      ],
    );
    if (result.rowCount !== 1) {
      throw new TypeError("VFY_PUBLICATION_OUTBOX_STALE_FENCE: failure release rejected");
    }
  }

  async deleteExpiredPublishedRuns(now: Date, limit = 100): Promise<number> {
    if (!Number.isFinite(now.getTime())
      || !Number.isSafeInteger(limit)
      || limit <= 0
      || limit > MAXIMUM_PUBLISHED_RUN_LIST_LIMIT) {
      throw new TypeError("VFY_PUBLISHED_RUN_RETENTION_INVALID: invalid clock or limit");
    }
    const due = await this.#pool.query<RetentionRow>(
      `SELECT l.tenant_id, l.project_id, l.published_run_id
         FROM published_run_listings l
         JOIN published_runs r
           ON r.tenant_id = l.tenant_id
          AND r.project_id = l.project_id
          AND r.published_run_id = l.published_run_id
        WHERE l.active_expires_at <= $1
        ORDER BY l.active_expires_at, l.tenant_id, l.project_id, l.published_run_id
        LIMIT $2`,
      [now, limit],
    );
    let deleted = 0;
    for (const row of due.rows) {
      const result = await this.deletePublishedRun(
        { tenantId: row.tenant_id, projectId: row.project_id },
        row.published_run_id,
        {
          deletedAt: now.toISOString(),
          authority: "retention:metadata-30d",
          reasonClass: "RETENTION_EXPIRED",
          affectedEdgeIds: [],
        },
      );
      if (result !== undefined) deleted += 1;
    }
    return deleted;
  }

  async purgeExpiredTombstones(now: Date, limit = 100): Promise<number> {
    if (!Number.isFinite(now.getTime())
      || !Number.isSafeInteger(limit)
      || limit <= 0
      || limit > MAXIMUM_PUBLISHED_RUN_LIST_LIMIT) {
      throw new TypeError("VFY_PUBLISHED_RUN_RETENTION_INVALID: invalid clock or limit");
    }
    return transaction(this.#pool, "SERIALIZABLE", async (client) => {
      const eligible = await client.query<RetentionRow>(
        `SELECT t.tenant_id, t.project_id, t.published_run_id
           FROM published_run_tombstones t
          WHERE t.expires_at <= $1
            AND NOT EXISTS (
              SELECT 1 FROM publication_outbox o
               WHERE o.tenant_id = t.tenant_id
                 AND o.project_id = t.project_id
                 AND o.aggregate_type = 'publishedRun'
                 AND o.aggregate_id = t.published_run_id
                 AND o.status IN ('pending', 'leased')
            )
          ORDER BY t.expires_at, t.tenant_id, t.project_id, t.published_run_id
          FOR UPDATE SKIP LOCKED
          LIMIT $2`,
        [now, limit],
      );
      for (const row of eligible.rows) {
        await client.query(
          `DELETE FROM publication_outbox
            WHERE tenant_id = $1 AND project_id = $2
              AND aggregate_type = 'publishedRun' AND aggregate_id = $3`,
          [row.tenant_id, row.project_id, row.published_run_id],
        );
        await client.query(
          `DELETE FROM published_run_tombstones
            WHERE tenant_id = $1 AND project_id = $2 AND published_run_id = $3`,
          [row.tenant_id, row.project_id, row.published_run_id],
        );
        await client.query(
          `DELETE FROM published_run_listings
            WHERE tenant_id = $1 AND project_id = $2 AND published_run_id = $3`,
          [row.tenant_id, row.project_id, row.published_run_id],
        );
      }
      return eligible.rows.length;
    });
  }
}
