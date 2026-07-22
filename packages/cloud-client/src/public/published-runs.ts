import { createHash, randomBytes } from "node:crypto";
import { encodeCanonicalProtocolDocument } from "@verify-internal/protocol";
import type {
  MetadataPublicationPayload,
  PublicationAuthorizationContext,
  PublicationIngestionReceipt,
  PublicationIngestionStore,
  PublicationOutboxClaim,
  PublicationOutboxDelivery,
  PublicationOutboxEvent,
  PublishedRunDeletionOptions,
  PublishedRunListPage,
  PublishedRunRecord,
  PublishedRunResolution,
  PublishedRunTombstone,
} from "./types.js";
import { assertMetadataPublicationPayload } from "./validation.js";

const MAXIMUM_LEASE_MS = 60_000;
const MAXIMUM_DELIVERY_ATTEMPTS = 5;
const MAXIMUM_LIST_LIMIT = 100;
const MAXIMUM_CURSOR_COUNT = 1_000;
const CURSOR_LIFETIME_MS = 5 * 60_000;

type Admission = {
  readonly requestDigest: `sha256:${string}`;
  readonly receipt: PublicationIngestionReceipt;
};

type OutboxState = {
  readonly event: PublicationOutboxEvent;
  readonly status: "pending" | "leased" | "delivered" | "deadLetter";
  readonly attempt: number;
  readonly fence: number;
  readonly workerId?: string;
  readonly leaseExpiresAt?: string;
  readonly failureCode?: string;
};

type ListingRecord = {
  readonly tenantId: string;
  readonly projectId: string;
  readonly publishedRunId: string;
  readonly publishedAt: string;
};

type CursorState = {
  readonly tenantId: string;
  readonly projectId: string;
  readonly afterPublishedAt: string;
  readonly afterPublishedRunId: string;
  readonly expiresAt: number;
};

export type PublicationAdmissionFaultPoint =
  | "before-admission-commit"
  | "before-deletion-commit";
export type PublicationAdmissionFaultInjector = (
  point: PublicationAdmissionFaultPoint,
) => void;

function sha256(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function bounded(value: unknown, maximum = 512): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maximum
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function utc(value: unknown): value is string {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function runIdentity(tenantId: string, projectId: string, publishedRunId: string): string {
  return `${tenantId}\u0000${projectId}\u0000${publishedRunId}`;
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function structurallyEqual(left: unknown, right: unknown): boolean {
  return sha256(encodeCanonicalProtocolDocument(left))
    === sha256(encodeCanonicalProtocolDocument(right));
}

function assertPublishedRunRecord(record: PublishedRunRecord): void {
  assertMetadataPublicationPayload(record.projection);
  if (record.schemaVersion !== 1
    || !bounded(record.publishedRunId)
    || !bounded(record.sourceIntentId)
    || !bounded(record.tenantId)
    || !bounded(record.projectId)
    || !bounded(record.idempotencyKey)
    || !/^sha256:[a-f0-9]{64}$/.test(record.payloadDigest)
    || !utc(record.publishedAt)
    || record.projection.tenantId !== record.tenantId
    || record.projection.projectId !== record.projectId
    || record.projection.idempotencyKey !== record.idempotencyKey
    || sha256(encodeCanonicalProtocolDocument(record.projection)) !== record.payloadDigest) {
    throw new TypeError("VFY_PUBLISHED_RUN_MALFORMED: projection binding is invalid");
  }
}

function assertOutboxEvent(event: PublicationOutboxEvent, record: PublishedRunRecord): void {
  if (event.schemaVersion !== 1
    || !bounded(event.eventId)
    || event.eventType !== "PublishedRunAccepted"
    || event.tenantId !== record.tenantId
    || event.aggregateType !== "publishedRun"
    || event.aggregateId !== record.publishedRunId
    || event.occurredAt !== record.publishedAt
    || event.payload.publishedRunId !== record.publishedRunId
    || event.payload.payloadDigest !== record.payloadDigest) {
    throw new TypeError("VFY_PUBLICATION_OUTBOX_MALFORMED: event binding is invalid");
  }
}

function assertDeletionOptions(
  publishedRunId: string,
  options: PublishedRunDeletionOptions,
): PublishedRunTombstone {
  if (!bounded(publishedRunId)
    || !utc(options.deletedAt)
    || !bounded(options.authority, 128)
    || !/^[A-Z][A-Z0-9_]{0,63}$/.test(options.reasonClass)
    || !Array.isArray(options.affectedEdgeIds)
    || options.affectedEdgeIds.length > 1_000
    || options.affectedEdgeIds.some((edgeId) => !bounded(edgeId))
    || new Set(options.affectedEdgeIds).size !== options.affectedEdgeIds.length) {
    throw new TypeError("VFY_PUBLISHED_RUN_DELETION_INVALID: malformed deletion request");
  }
  return {
    schemaVersion: 1,
    objectType: "publishedRun",
    opaqueId: publishedRunId,
    deletedAt: options.deletedAt,
    authority: options.authority,
    reasonClass: options.reasonClass,
    affectedEdgeIds: [...options.affectedEdgeIds].sort(),
  };
}

function deletionEvent(
  tenantId: string,
  projectId: string,
  tombstone: PublishedRunTombstone,
): PublicationOutboxEvent {
  const identityBytes = new TextEncoder().encode(
    `published-run-deleted\u0000${tenantId}\u0000${projectId}\u0000${tombstone.opaqueId}`,
  );
  return {
    schemaVersion: 1,
    eventId: `event_v1_${createHash("sha256").update(identityBytes).digest("base64url")}`,
    eventType: "PublishedRunDeleted",
    tenantId,
    aggregateType: "publishedRun",
    aggregateId: tombstone.opaqueId,
    occurredAt: tombstone.deletedAt,
    payload: {
      publishedRunId: tombstone.opaqueId,
      authority: tombstone.authority,
      reasonClass: tombstone.reasonClass,
    },
  };
}

function orderedAfter(record: ListingRecord, cursor: CursorState): boolean {
  return record.publishedAt > cursor.afterPublishedAt
    || (record.publishedAt === cursor.afterPublishedAt
      && record.publishedRunId > cursor.afterPublishedRunId);
}

export class InMemoryPublicationIngestionStore implements PublicationIngestionStore {
  #idempotency = new Map<string, Admission>();
  #nonces = new Map<string, string>();
  #publishedRuns = new Map<string, PublishedRunRecord>();
  #listings = new Map<string, ListingRecord>();
  #tombstones = new Map<string, PublishedRunTombstone>();
  #outbox = new Map<string, OutboxState>();
  #cursors = new Map<string, CursorState>();
  readonly #fault: PublicationAdmissionFaultInjector | undefined;
  readonly #clock: () => Date;

  constructor(
    fault?: PublicationAdmissionFaultInjector,
    clock: () => Date = () => new Date(),
  ) {
    this.#fault = fault;
    this.#clock = clock;
  }

  accept(
    tenantId: string,
    idempotencyKey: string,
    nonce: string,
    requestDigest: `sha256:${string}`,
    receipt: PublicationIngestionReceipt,
    publishedRun: PublishedRunRecord,
    outboxEvent: PublicationOutboxEvent,
  ): PublicationIngestionReceipt {
    assertPublishedRunRecord(publishedRun);
    assertOutboxEvent(outboxEvent, publishedRun);
    if (receipt.publishedRunId !== publishedRun.publishedRunId
      || receipt.intentId !== publishedRun.sourceIntentId
      || receipt.tenantId !== tenantId
      || receipt.tenantId !== publishedRun.tenantId
      || receipt.projectId !== publishedRun.projectId
      || receipt.idempotencyKey !== idempotencyKey
      || receipt.idempotencyKey !== publishedRun.idempotencyKey
      || receipt.payloadDigest !== publishedRun.payloadDigest
      || receipt.acceptedAt !== publishedRun.publishedAt
      || !bounded(nonce)
      || !/^sha256:[a-f0-9]{64}$/.test(requestDigest)) {
      throw new TypeError("VFY_PUBLICATION_ADMISSION_MALFORMED: atomic unit is inconsistent");
    }
    const idempotencyIdentity = `${tenantId}\u0000${idempotencyKey}`;
    const nonceIdentity = `${tenantId}\u0000${nonce}`;
    const existing = this.#idempotency.get(idempotencyIdentity);
    if (existing !== undefined) {
      if (existing.requestDigest !== requestDigest) {
        throw new TypeError("VFY_PUBLICATION_IDEMPOTENCY_CONFLICT: key reused for different bytes");
      }
      return structuredClone(existing.receipt);
    }
    if (this.#nonces.has(nonceIdentity)) {
      throw new TypeError("VFY_PUBLICATION_REPLAY_DETECTED: nonce was already consumed");
    }
    const runKey = runIdentity(tenantId, publishedRun.projectId, publishedRun.publishedRunId);
    const existingRun = this.#publishedRuns.get(runKey);
    const existingEvent = this.#outbox.get(outboxEvent.eventId);
    if ((existingRun !== undefined && !structurallyEqual(existingRun, publishedRun))
      || (existingEvent !== undefined && !structurallyEqual(existingEvent.event, outboxEvent))) {
      throw new TypeError("VFY_PUBLICATION_ADMISSION_CONFLICT: projection or event identity collision");
    }

    const nextIdempotency = new Map(this.#idempotency);
    const nextNonces = new Map(this.#nonces);
    const nextRuns = new Map(this.#publishedRuns);
    const nextListings = new Map(this.#listings);
    const nextOutbox = new Map(this.#outbox);
    nextIdempotency.set(idempotencyIdentity, {
      requestDigest,
      receipt: structuredClone(receipt),
    });
    nextNonces.set(nonceIdentity, idempotencyIdentity);
    nextRuns.set(runKey, structuredClone(publishedRun));
    nextListings.set(runKey, {
      tenantId,
      projectId: publishedRun.projectId,
      publishedRunId: publishedRun.publishedRunId,
      publishedAt: publishedRun.publishedAt,
    });
    nextOutbox.set(outboxEvent.eventId, {
      event: structuredClone(outboxEvent),
      status: "pending",
      attempt: 0,
      fence: 0,
    });
    this.#fault?.("before-admission-commit");
    this.#idempotency = nextIdempotency;
    this.#nonces = nextNonces;
    this.#publishedRuns = nextRuns;
    this.#listings = nextListings;
    this.#outbox = nextOutbox;
    return structuredClone(receipt);
  }

  readPublishedRun(
    authorization: PublicationAuthorizationContext,
    publishedRunId: string,
  ): MetadataPublicationPayload | undefined {
    const record = this.#publishedRuns.get(runIdentity(
      authorization.tenantId,
      authorization.projectId,
      publishedRunId,
    ));
    return record === undefined ? undefined : structuredClone(record.projection);
  }

  resolvePublishedRun(
    authorization: PublicationAuthorizationContext,
    publishedRunId: string,
  ): PublishedRunResolution | undefined {
    const key = runIdentity(
      authorization.tenantId,
      authorization.projectId,
      publishedRunId,
    );
    const listing = this.#listings.get(key);
    if (listing === undefined) return undefined;
    const tombstone = this.#tombstones.get(key);
    if (tombstone !== undefined) {
      return {
        state: "deleted_reference",
        publishedAt: listing.publishedAt,
        publishedRunId,
        tombstone: structuredClone(tombstone),
      };
    }
    const record = this.#publishedRuns.get(key);
    if (record === undefined) {
      throw new TypeError("VFY_PUBLISHED_RUN_STORE_INCONSISTENT: listing has no record");
    }
    return {
      state: "active",
      publishedAt: listing.publishedAt,
      publishedRunId,
      projection: structuredClone(record.projection),
    };
  }

  listPublishedRuns(
    authorization: PublicationAuthorizationContext,
    options: { readonly limit: number; readonly cursor?: string },
  ): PublishedRunListPage {
    if (!bounded(authorization.tenantId)
      || !bounded(authorization.projectId)
      || !Number.isSafeInteger(options.limit)
      || options.limit <= 0
      || options.limit > MAXIMUM_LIST_LIMIT) {
      throw new TypeError("VFY_PUBLISHED_RUN_LIST_INVALID: limit or scope is invalid");
    }
    const now = this.#clock().getTime();
    if (!Number.isFinite(now)) {
      throw new TypeError("VFY_PUBLISHED_RUN_LIST_INVALID: clock is invalid");
    }
    this.#pruneCursors(now);
    let cursorState: CursorState | undefined;
    if (options.cursor !== undefined) {
      if (!/^cursor_v1_[A-Za-z0-9_-]{43}$/.test(options.cursor)) {
        throw new TypeError("VFY_PUBLISHED_RUN_CURSOR_INVALID: cursor is invalid or expired");
      }
      cursorState = this.#cursors.get(options.cursor);
      if (cursorState === undefined
        || cursorState.tenantId !== authorization.tenantId
        || cursorState.projectId !== authorization.projectId
        || cursorState.expiresAt <= now) {
        throw new TypeError("VFY_PUBLISHED_RUN_CURSOR_INVALID: cursor is invalid or expired");
      }
    }
    const ordered = [...this.#listings.values()]
      .filter((record) => record.tenantId === authorization.tenantId
        && record.projectId === authorization.projectId)
      .filter((record) => cursorState === undefined || orderedAfter(record, cursorState))
      .sort((left, right) => compareText(left.publishedAt, right.publishedAt)
        || compareText(left.publishedRunId, right.publishedRunId));
    const selected = ordered.slice(0, options.limit);
    const items = selected.map((record) => {
      const resolution = this.resolvePublishedRun(authorization, record.publishedRunId);
      if (resolution === undefined) {
        throw new TypeError("VFY_PUBLISHED_RUN_STORE_INCONSISTENT: listing resolution failed");
      }
      return resolution;
    });
    if (ordered.length <= selected.length) {
      return { schemaVersion: 1, items };
    }
    const last = selected.at(-1) as ListingRecord;
    const nextCursor = this.#issueCursor({
      tenantId: authorization.tenantId,
      projectId: authorization.projectId,
      afterPublishedAt: last.publishedAt,
      afterPublishedRunId: last.publishedRunId,
      expiresAt: now + CURSOR_LIFETIME_MS,
    });
    return { schemaVersion: 1, items, nextCursor };
  }

  deletePublishedRun(
    authorization: PublicationAuthorizationContext,
    publishedRunId: string,
    options: PublishedRunDeletionOptions,
  ): PublishedRunTombstone | undefined {
    const tombstone = assertDeletionOptions(publishedRunId, options);
    const key = runIdentity(
      authorization.tenantId,
      authorization.projectId,
      publishedRunId,
    );
    const listing = this.#listings.get(key);
    if (listing === undefined) return undefined;
    const existing = this.#tombstones.get(key);
    if (existing !== undefined) {
      if (!structurallyEqual(existing, tombstone)) {
        throw new TypeError("VFY_PUBLISHED_RUN_DELETION_CONFLICT: deletion metadata changed");
      }
      return structuredClone(existing);
    }
    if (!this.#publishedRuns.has(key)) {
      throw new TypeError("VFY_PUBLISHED_RUN_STORE_INCONSISTENT: active record is missing");
    }
    const deletedEvent = deletionEvent(
      authorization.tenantId,
      authorization.projectId,
      tombstone,
    );
    const nextRuns = new Map(this.#publishedRuns);
    const nextTombstones = new Map(this.#tombstones);
    const nextOutbox = new Map(this.#outbox);
    nextRuns.delete(key);
    nextTombstones.set(key, structuredClone(tombstone));
    for (const [eventId, state] of nextOutbox) {
      if (state.event.tenantId === authorization.tenantId
        && state.event.aggregateType === "publishedRun"
        && state.event.aggregateId === publishedRunId) {
        nextOutbox.delete(eventId);
      }
    }
    nextOutbox.set(deletedEvent.eventId, {
      event: deletedEvent,
      status: "pending",
      attempt: 0,
      fence: 0,
    });
    this.#fault?.("before-deletion-commit");
    this.#publishedRuns = nextRuns;
    this.#tombstones = nextTombstones;
    this.#outbox = nextOutbox;
    return structuredClone(tombstone);
  }

  assertPublishedRunRestorable(
    authorization: PublicationAuthorizationContext,
    publishedRunId: string,
  ): void {
    const tombstone = this.#tombstones.get(runIdentity(
      authorization.tenantId,
      authorization.projectId,
      publishedRunId,
    ));
    if (tombstone !== undefined) {
      throw new TypeError("VFY_PUBLISHED_RUN_RESTORE_BLOCKED: object is tombstoned");
    }
  }

  #pruneCursors(now: number): void {
    for (const [token, cursor] of this.#cursors) {
      if (cursor.expiresAt <= now) this.#cursors.delete(token);
    }
    while (this.#cursors.size >= MAXIMUM_CURSOR_COUNT) {
      const oldest = this.#cursors.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.#cursors.delete(oldest);
    }
  }

  #issueCursor(state: CursorState): string {
    let token: string;
    do {
      token = `cursor_v1_${randomBytes(32).toString("base64url")}`;
    } while (this.#cursors.has(token));
    this.#cursors.set(token, state);
    return token;
  }

  claimOutbox(workerId: string, now: Date, leaseMs: number): PublicationOutboxClaim | undefined {
    if (!bounded(workerId)
      || !Number.isFinite(now.getTime())
      || !Number.isSafeInteger(leaseMs)
      || leaseMs <= 0
      || leaseMs > MAXIMUM_LEASE_MS) {
      throw new TypeError("VFY_PUBLICATION_OUTBOX_CLAIM_INVALID: invalid worker or lease");
    }
    const eligible = [...this.#outbox.values()]
      .filter((state) => state.status === "pending"
        || (state.status === "leased"
          && Date.parse(state.leaseExpiresAt ?? "") <= now.getTime()))
      .filter((state) => state.attempt < MAXIMUM_DELIVERY_ATTEMPTS)
      .sort((left, right) => compareText(left.event.occurredAt, right.event.occurredAt)
        || compareText(left.event.eventId, right.event.eventId))[0];
    if (eligible === undefined) return undefined;
    const next: OutboxState = {
      event: eligible.event,
      status: "leased",
      attempt: eligible.attempt + 1,
      fence: eligible.fence + 1,
      workerId,
      leaseExpiresAt: new Date(now.getTime() + leaseMs).toISOString(),
    };
    this.#outbox.set(eligible.event.eventId, next);
    return {
      event: structuredClone(next.event),
      workerId,
      fence: next.fence,
      attempt: next.attempt,
      leaseExpiresAt: next.leaseExpiresAt as string,
    };
  }

  acknowledgeOutbox(claim: PublicationOutboxClaim, now: Date): void {
    const state = this.#outbox.get(claim.event.eventId);
    if (state === undefined
      || state.status !== "leased"
      || state.workerId !== claim.workerId
      || state.fence !== claim.fence
      || state.leaseExpiresAt !== claim.leaseExpiresAt
      || !Number.isFinite(now.getTime())
      || now.getTime() >= Date.parse(state.leaseExpiresAt)) {
      throw new TypeError("VFY_PUBLICATION_OUTBOX_STALE_FENCE: acknowledgement rejected");
    }
    this.#outbox.set(claim.event.eventId, {
      event: state.event,
      status: "delivered",
      attempt: state.attempt,
      fence: state.fence,
    });
  }

  failOutbox(claim: PublicationOutboxClaim, failureCode: string, now: Date): void {
    const state = this.#outbox.get(claim.event.eventId);
    if (state === undefined
      || state.status !== "leased"
      || state.workerId !== claim.workerId
      || state.fence !== claim.fence
      || !/^[A-Z][A-Z0-9_]{0,63}$/.test(failureCode)
      || !Number.isFinite(now.getTime())
      || now.getTime() >= Date.parse(state.leaseExpiresAt ?? "")) {
      throw new TypeError("VFY_PUBLICATION_OUTBOX_STALE_FENCE: failure release rejected");
    }
    this.#outbox.set(claim.event.eventId, {
      event: state.event,
      status: state.attempt >= MAXIMUM_DELIVERY_ATTEMPTS ? "deadLetter" : "pending",
      attempt: state.attempt,
      fence: state.fence,
      failureCode,
    });
  }

  get size(): number {
    return this.#idempotency.size;
  }

  get publishedRunCount(): number {
    return this.#publishedRuns.size;
  }

  get tombstoneCount(): number {
    return this.#tombstones.size;
  }

  get outboxCount(): number {
    return this.#outbox.size;
  }
}

export class PublicationOutboxWorker {
  readonly #store: InMemoryPublicationIngestionStore;
  readonly #deliver: PublicationOutboxDelivery;
  readonly #clock: () => Date;

  constructor(
    store: InMemoryPublicationIngestionStore,
    deliver: PublicationOutboxDelivery,
    clock: () => Date = () => new Date(),
  ) {
    this.#store = store;
    this.#deliver = deliver;
    this.#clock = clock;
  }

  async deliverOne(
    workerId: string,
    leaseMs: number,
  ): Promise<"idle" | "delivered" | "retry"> {
    const claim = this.#store.claimOutbox(workerId, this.#clock(), leaseMs);
    if (claim === undefined) return "idle";
    try {
      await this.#deliver(structuredClone(claim.event));
      this.#store.acknowledgeOutbox(claim, this.#clock());
      return "delivered";
    } catch {
      this.#store.failOutbox(claim, "DELIVERY_FAILED", this.#clock());
      return "retry";
    }
  }
}
