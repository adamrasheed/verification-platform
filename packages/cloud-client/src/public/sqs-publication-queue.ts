import {
  encodeCanonicalProtocolDocument,
  parseCanonicalProtocolDocument,
} from "@verify-internal/protocol";
import { PublicationOutboxWorker } from "./published-runs.js";
import type {
  PublicationOutboxEvent,
  PublicationOutboxStore,
} from "./types.js";

const MAXIMUM_REFERENCE_BYTES = 2_048;
const MAXIMUM_VISIBILITY_SECONDS = 43_200;

export interface PublicationQueueReference {
  readonly schemaVersion: 1;
  readonly kind: "publicationOutboxReference";
  readonly tenantId: string;
  readonly eventId: string;
  readonly eventType: "PublishedRunAccepted" | "PublishedRunDeleted";
  readonly aggregateType: "publishedRun";
  readonly aggregateId: string;
}

export interface PublicationQueueMessage {
  readonly messageId: string;
  readonly receiptHandle: string;
  readonly body: string;
  readonly receiveCount: number;
}

export interface PublicationQueueTransport {
  sendReferenceBody(body: string): Promise<void>;
  receiveOne(options: {
    readonly waitTimeSeconds: number;
    readonly visibilityTimeoutSeconds: number;
  }): Promise<PublicationQueueMessage | undefined>;
  acknowledge(receiptHandle: string): Promise<void>;
  defer(receiptHandle: string, visibilityTimeoutSeconds: number): Promise<void>;
}

export type PublicationQueueHandlerResult = "processed" | "duplicate";

export type PublicationQueueHandler = (
  reference: PublicationQueueReference,
) => PublicationQueueHandlerResult | Promise<PublicationQueueHandlerResult>;

export interface PublicationQueueWorkerOptions {
  readonly waitTimeSeconds?: number;
  readonly visibilityTimeoutSeconds?: number;
  readonly maximumReceiveCount?: number;
  readonly baseRetrySeconds?: number;
  readonly maximumRetrySeconds?: number;
  readonly jitter?: () => number;
}

function bounded(value: unknown, maximum = 256): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maximum
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).sort().join(",") === [...expected].sort().join(",");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

export function assertPublicationQueueReference(
  value: unknown,
): asserts value is PublicationQueueReference {
  const record = asRecord(value);
  if (record === undefined
    || !exactKeys(record, [
      "schemaVersion",
      "kind",
      "tenantId",
      "eventId",
      "eventType",
      "aggregateType",
      "aggregateId",
    ])
    || record.schemaVersion !== 1
    || record.kind !== "publicationOutboxReference"
    || !bounded(record.tenantId)
    || !bounded(record.eventId)
    || (record.eventType !== "PublishedRunAccepted"
      && record.eventType !== "PublishedRunDeleted")
    || record.aggregateType !== "publishedRun"
    || !bounded(record.aggregateId)) {
    throw new TypeError("VFY_PUBLICATION_QUEUE_REFERENCE_INVALID: reference is malformed");
  }
}

export function publicationQueueReference(
  event: PublicationOutboxEvent,
): PublicationQueueReference {
  return {
    schemaVersion: 1,
    kind: "publicationOutboxReference",
    tenantId: event.tenantId,
    eventId: event.eventId,
    eventType: event.eventType,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
  };
}

export function encodePublicationQueueReference(
  value: PublicationQueueReference,
): string {
  assertPublicationQueueReference(value);
  const bytes = encodeCanonicalProtocolDocument(value);
  if (bytes.byteLength > MAXIMUM_REFERENCE_BYTES) {
    throw new TypeError("VFY_PUBLICATION_QUEUE_REFERENCE_INVALID: reference is oversized");
  }
  return new TextDecoder().decode(bytes);
}

export function decodePublicationQueueReference(body: string): PublicationQueueReference {
  const encoded = new TextEncoder().encode(body);
  if (encoded.byteLength === 0 || encoded.byteLength > MAXIMUM_REFERENCE_BYTES) {
    throw new TypeError("VFY_PUBLICATION_QUEUE_REFERENCE_INVALID: reference is oversized");
  }
  const value = parseCanonicalProtocolDocument(body);
  assertPublicationQueueReference(value);
  if (new TextDecoder().decode(encodeCanonicalProtocolDocument(value)) !== body) {
    throw new TypeError("VFY_PUBLICATION_QUEUE_REFERENCE_INVALID: reference is not canonical");
  }
  return value;
}

export class PublicationSqsRelay {
  readonly #worker: PublicationOutboxWorker;

  constructor(
    store: PublicationOutboxStore,
    transport: PublicationQueueTransport,
    clock: () => Date = () => new Date(),
  ) {
    this.#worker = new PublicationOutboxWorker(
      store,
      async (event) => transport.sendReferenceBody(
        encodePublicationQueueReference(publicationQueueReference(event)),
      ),
      clock,
    );
  }

  async relayOne(workerId: string, leaseMs: number): Promise<"idle" | "delivered" | "retry"> {
    return this.#worker.deliverOne(workerId, leaseMs);
  }
}

export class PublicationSqsWorker {
  readonly #transport: PublicationQueueTransport;
  readonly #handle: PublicationQueueHandler;
  readonly #waitTimeSeconds: number;
  readonly #visibilityTimeoutSeconds: number;
  readonly #maximumReceiveCount: number;
  readonly #baseRetrySeconds: number;
  readonly #maximumRetrySeconds: number;
  readonly #jitter: () => number;

  constructor(
    transport: PublicationQueueTransport,
    handle: PublicationQueueHandler,
    options: PublicationQueueWorkerOptions = {},
  ) {
    this.#transport = transport;
    this.#handle = handle;
    this.#waitTimeSeconds = options.waitTimeSeconds ?? 20;
    this.#visibilityTimeoutSeconds = options.visibilityTimeoutSeconds ?? 60;
    this.#maximumReceiveCount = options.maximumReceiveCount ?? 5;
    this.#baseRetrySeconds = options.baseRetrySeconds ?? 2;
    this.#maximumRetrySeconds = options.maximumRetrySeconds ?? 30;
    this.#jitter = options.jitter ?? Math.random;
    if (!Number.isSafeInteger(this.#waitTimeSeconds)
      || this.#waitTimeSeconds < 0
      || this.#waitTimeSeconds > 20
      || !Number.isSafeInteger(this.#visibilityTimeoutSeconds)
      || this.#visibilityTimeoutSeconds < 1
      || this.#visibilityTimeoutSeconds > MAXIMUM_VISIBILITY_SECONDS
      || !Number.isSafeInteger(this.#maximumReceiveCount)
      || this.#maximumReceiveCount < 1
      || this.#maximumReceiveCount > 10
      || !Number.isSafeInteger(this.#baseRetrySeconds)
      || this.#baseRetrySeconds < 1
      || !Number.isSafeInteger(this.#maximumRetrySeconds)
      || this.#maximumRetrySeconds < this.#baseRetrySeconds
      || this.#maximumRetrySeconds > MAXIMUM_VISIBILITY_SECONDS) {
      throw new TypeError("VFY_PUBLICATION_QUEUE_WORKER_INVALID: worker bounds are invalid");
    }
  }

  async processOne(): Promise<"idle" | PublicationQueueHandlerResult | "retry"> {
    const message = await this.#transport.receiveOne({
      waitTimeSeconds: this.#waitTimeSeconds,
      visibilityTimeoutSeconds: this.#visibilityTimeoutSeconds,
    });
    if (message === undefined) return "idle";
    try {
      const reference = decodePublicationQueueReference(message.body);
      const outcome = await this.#handle(structuredClone(reference));
      if (outcome !== "processed" && outcome !== "duplicate") {
        throw new TypeError("VFY_PUBLICATION_QUEUE_HANDLER_INVALID: handler outcome is invalid");
      }
      await this.#transport.acknowledge(message.receiptHandle);
      return outcome;
    } catch {
      if (message.receiveCount < this.#maximumReceiveCount) {
        await this.#transport.defer(
          message.receiptHandle,
          this.#retrySeconds(message.receiveCount),
        );
      }
      return "retry";
    }
  }

  #retrySeconds(receiveCount: number): number {
    const exponent = Math.min(Math.max(receiveCount - 1, 0), 20);
    const ceiling = Math.min(
      this.#maximumRetrySeconds,
      this.#baseRetrySeconds * (2 ** exponent),
    );
    const jitter = this.#jitter();
    if (!Number.isFinite(jitter) || jitter < 0 || jitter > 1) {
      throw new TypeError("VFY_PUBLICATION_QUEUE_WORKER_INVALID: jitter is invalid");
    }
    return Math.max(1, Math.floor((ceiling / 2) + ((ceiling / 2) * jitter)));
  }
}
