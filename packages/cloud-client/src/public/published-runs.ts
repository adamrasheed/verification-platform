import { createHash } from "node:crypto";
import { encodeCanonicalProtocolDocument } from "@verify-internal/protocol";
import type {
  MetadataPublicationPayload,
  PublicationAuthorizationContext,
  PublicationIngestionReceipt,
  PublicationIngestionStore,
  PublicationOutboxClaim,
  PublicationOutboxDelivery,
  PublicationOutboxEvent,
  PublishedRunRecord,
} from "./types.js";
import { assertMetadataPublicationPayload } from "./validation.js";

const MAXIMUM_LEASE_MS = 60_000;
const MAXIMUM_DELIVERY_ATTEMPTS = 5;

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

export type PublicationAdmissionFaultPoint = "before-admission-commit";
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

export class InMemoryPublicationIngestionStore implements PublicationIngestionStore {
  #idempotency = new Map<string, Admission>();
  #nonces = new Map<string, string>();
  #publishedRuns = new Map<string, PublishedRunRecord>();
  #outbox = new Map<string, OutboxState>();
  readonly #fault: PublicationAdmissionFaultInjector | undefined;

  constructor(fault?: PublicationAdmissionFaultInjector) {
    this.#fault = fault;
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
    const nextOutbox = new Map(this.#outbox);
    nextIdempotency.set(idempotencyIdentity, {
      requestDigest,
      receipt: structuredClone(receipt),
    });
    nextNonces.set(nonceIdentity, idempotencyIdentity);
    nextRuns.set(runKey, structuredClone(publishedRun));
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
      .sort((left, right) => left.event.occurredAt.localeCompare(right.event.occurredAt)
        || left.event.eventId.localeCompare(right.event.eventId))[0];
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
