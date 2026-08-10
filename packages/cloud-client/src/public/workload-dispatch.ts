import { createHash, randomUUID } from "node:crypto";
import {
  decodeCommandRequest,
  encodeCanonicalProtocolDocument,
} from "@verify-internal/protocol";
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

export const MAXIMUM_WORKLOAD_DISPATCH_LEASE_MS: number = 5 * 60 * 1000;
export const MAXIMUM_WORKLOAD_DISPATCH_ATTEMPTS: number = 5;

interface StoredDispatch {
  readonly request: DispatchVerificationRequest;
  readonly requestDigest: `sha256:${string}`;
  readonly idempotencyKey: string;
  record: CustomerWorkloadDispatchRecord;
  fence: number;
  attempt: number;
  workerId?: string;
  leaseExpiresAt?: string;
  completionDigest?: `sha256:${string}`;
}

function bounded(value: unknown, maximum = 512): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maximum
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function iso(value: Date | string, code: string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new TypeError(code);
  return parsed.toISOString();
}

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256")
    .update(encodeCanonicalProtocolDocument(value))
    .digest("hex")}`;
}

function exactDigest(value: unknown): value is `sha256:${string}` {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
}

function sameScope(
  record: CustomerWorkloadDispatchRecord,
  authorization: DispatchAuthorizationContext,
): boolean {
  return record.tenantId === authorization.tenantId
    && record.projectId === authorization.projectId;
}

function validateScope(authorization: DispatchAuthorizationContext): void {
  if (!bounded(authorization.tenantId) || !bounded(authorization.projectId)) {
    throw new TypeError("VFY_DISPATCH_SCOPE_INVALID: tenant or project is invalid");
  }
}

export function customerWorkloadDispatchDigest(
  request: DispatchVerificationRequest,
): `sha256:${string}` {
  assertCustomerWorkloadDispatchRequest(request);
  return digest(request);
}

export function assertCustomerWorkloadDispatchRequest(
  request: unknown,
): asserts request is DispatchVerificationRequest {
  const decoded = decodeCommandRequest(request);
  if (decoded.kind !== "ok" || decoded.value.command !== "dispatchVerification") {
    throw new TypeError("VFY_DISPATCH_REQUEST_INVALID: dispatch request is malformed");
  }
  const value = decoded.value as DispatchVerificationRequest;
  const nested = value.arguments.verifyRequest;
  if (!bounded(value.arguments.workloadBinding)
    || !bounded(value.arguments.idempotencyKey)
    || nested.command !== "verify"
    || nested.offline !== true
    || !bounded(nested.workspace.rootBinding)
    || !nested.environment.allowlistedBindings.includes(nested.workspace.rootBinding)
    || !value.environment.allowlistedBindings.includes(value.arguments.workloadBinding)) {
    throw new TypeError(
      "VFY_DISPATCH_REQUEST_INVALID: workload and offline workspace bindings are required",
    );
  }
}

export function dispatchAdmission(
  authorization: DispatchAuthorizationContext,
  request: DispatchVerificationRequest,
  admittedAt: Date,
): CustomerWorkloadDispatchAdmission {
  validateScope(authorization);
  assertCustomerWorkloadDispatchRequest(request);
  return {
    authorization: structuredClone(authorization),
    request: structuredClone(request),
    requestDigest: customerWorkloadDispatchDigest(request),
    admittedAt: iso(admittedAt, "VFY_DISPATCH_ADMISSION_INVALID: timestamp is invalid"),
  };
}

function resultFor(record: CustomerWorkloadDispatchRecord): DispatchVerificationResult {
  const state = record.state === "cancelled"
    ? "cancelled"
    : record.state === "expired"
      ? "expired"
      : record.state === "failed"
        ? "transport_error"
        : "accepted";
  return {
    kind: "dispatchVerification",
    dispatchId: record.dispatchId as DispatchVerificationResult["dispatchId"],
    state,
    workloadBinding: record.workloadBinding as DispatchVerificationResult["workloadBinding"],
    ...(record.verifyInvocationId === undefined
      ? {} : {
          verifyInvocationId: record.verifyInvocationId as NonNullable<
            DispatchVerificationResult["verifyInvocationId"]
          >,
        }),
    ...(record.publishedRunId === undefined ? {} : {
      publishedRunId: record.publishedRunId as NonNullable<
        DispatchVerificationResult["publishedRunId"]
      >,
    }),
    reasonCodes: [...record.reasonCodes],
  };
}

export function assertCustomerWorkloadDispatchAdmission(
  admission: CustomerWorkloadDispatchAdmission,
): void {
  validateScope(admission.authorization);
  assertCustomerWorkloadDispatchRequest(admission.request);
  if (!exactDigest(admission.requestDigest)
    || admission.requestDigest !== customerWorkloadDispatchDigest(admission.request)
    || !Number.isFinite(Date.parse(admission.admittedAt))) {
    throw new TypeError("VFY_DISPATCH_ADMISSION_INVALID: digest or timestamp is invalid");
  }
}

function validateLease(workerId: string, leaseMs: number): void {
  if (!bounded(workerId)
    || !Number.isSafeInteger(leaseMs)
    || leaseMs <= 0
    || leaseMs > MAXIMUM_WORKLOAD_DISPATCH_LEASE_MS) {
    throw new TypeError("VFY_DISPATCH_LEASE_INVALID: worker or lease is invalid");
  }
}

function activeClaim(
  stored: StoredDispatch,
  claim: CustomerWorkloadOfferClaim,
  now: Date,
): void {
  if (stored.record.dispatchId !== claim.dispatchId
    || stored.record.tenantId !== claim.tenantId
    || stored.record.projectId !== claim.projectId
    || stored.record.workloadBinding !== claim.workloadBinding
    || stored.workerId !== claim.workerId
    || stored.fence !== claim.fence
    || stored.attempt !== claim.attempt
    || stored.leaseExpiresAt !== claim.leaseExpiresAt
    || Date.parse(claim.leaseExpiresAt) <= now.getTime()) {
    throw new TypeError("VFY_DISPATCH_STALE_FENCE: workload lease is stale or mismatched");
  }
}

function cancellationCopy(
  cancellation: DispatchCancellationState | undefined,
): DispatchCancellationState | undefined {
  return cancellation === undefined ? undefined : structuredClone(cancellation);
}

export class InMemoryCustomerWorkloadDispatchStore
implements CustomerWorkloadDispatchStore {
  readonly #dispatches = new Map<string, StoredDispatch>();
  readonly #idempotency = new Map<string, string>();
  readonly #idFactory: () => string;

  constructor(idFactory: () => string = randomUUID) {
    this.#idFactory = idFactory;
  }

  get size(): number {
    return this.#dispatches.size;
  }

  admit(admission: CustomerWorkloadDispatchAdmission): CustomerWorkloadDispatchReceipt {
    assertCustomerWorkloadDispatchAdmission(admission);
    const idempotencyIdentity = JSON.stringify([
      admission.authorization.tenantId,
      admission.request.arguments.idempotencyKey,
    ]);
    const existingId = this.#idempotency.get(idempotencyIdentity);
    if (existingId !== undefined) {
      const existing = this.#dispatches.get(existingId);
      if (existing === undefined) {
        throw new TypeError("VFY_DISPATCH_STORE_INCONSISTENT: idempotency target is missing");
      }
      if (existing.requestDigest !== admission.requestDigest) {
        throw new TypeError("VFY_DISPATCH_IDEMPOTENCY_CONFLICT: key reused for different bytes");
      }
      return {
        schemaVersion: 1,
        result: resultFor(existing.record),
        admittedAt: existing.record.admittedAt,
      };
    }
    const dispatchId = `dispatch_v1_${this.#idFactory()}`;
    if (!bounded(dispatchId) || this.#dispatches.has(dispatchId)) {
      throw new TypeError("VFY_DISPATCH_IDENTITY_CONFLICT: dispatch identity collision");
    }
    const record: CustomerWorkloadDispatchRecord = {
      schemaVersion: 1,
      dispatchId,
      tenantId: admission.authorization.tenantId,
      projectId: admission.authorization.projectId,
      workloadBinding: admission.request.arguments.workloadBinding,
      state: "queued",
      admittedAt: admission.admittedAt,
      updatedAt: admission.admittedAt,
      reasonCodes: [],
    };
    this.#dispatches.set(dispatchId, {
      request: structuredClone(admission.request),
      requestDigest: admission.requestDigest,
      idempotencyKey: admission.request.arguments.idempotencyKey,
      record,
      fence: 0,
      attempt: 0,
    });
    this.#idempotency.set(idempotencyIdentity, dispatchId);
    return { schemaVersion: 1, result: resultFor(record), admittedAt: record.admittedAt };
  }

  resolve(
    authorization: DispatchAuthorizationContext,
    dispatchId: string,
  ): CustomerWorkloadDispatchRecord | undefined {
    validateScope(authorization);
    if (!bounded(dispatchId)) throw new TypeError("VFY_DISPATCH_SCOPE_INVALID: dispatch ID is invalid");
    const stored = this.#dispatches.get(dispatchId);
    return stored !== undefined && sameScope(stored.record, authorization)
      ? structuredClone(stored.record)
      : undefined;
  }

  claimOffer(
    workloadBinding: string,
    workerId: string,
    now: Date,
    leaseMs: number,
  ): CustomerWorkloadOfferClaim | undefined {
    validateLease(workerId, leaseMs);
    if (!bounded(workloadBinding)) {
      throw new TypeError("VFY_DISPATCH_WORKLOAD_INVALID: workload binding is invalid");
    }
    const timestamp = iso(now, "VFY_DISPATCH_LEASE_INVALID: timestamp is invalid");
    for (const stored of this.#dispatches.values()) {
      if (stored.record.workloadBinding !== workloadBinding
        || ["completed", "cancelled", "expired", "failed"].includes(stored.record.state)
        || (stored.leaseExpiresAt !== undefined
          && Date.parse(stored.leaseExpiresAt) > now.getTime())) continue;
      if (stored.attempt >= MAXIMUM_WORKLOAD_DISPATCH_ATTEMPTS) {
        stored.record = {
          ...stored.record,
          state: "failed",
          updatedAt: timestamp,
          reasonCodes: ["DISPATCH_ATTEMPTS_EXHAUSTED"],
        };
        continue;
      }
      stored.fence += 1;
      stored.attempt += 1;
      stored.workerId = workerId;
      stored.leaseExpiresAt = new Date(now.getTime() + leaseMs).toISOString();
      stored.record = {
        ...stored.record,
        state: stored.record.cancellation === undefined
          ? "offered" : "cancellation_requested",
        updatedAt: timestamp,
      };
      return {
        schemaVersion: 1,
        dispatchId: stored.record.dispatchId,
        tenantId: stored.record.tenantId,
        projectId: stored.record.projectId,
        workloadBinding,
        workerId,
        fence: stored.fence,
        attempt: stored.attempt,
        leaseExpiresAt: stored.leaseExpiresAt,
        request: structuredClone(stored.request),
      };
    }
    return undefined;
  }

  acceptOffer(claim: CustomerWorkloadOfferClaim, now: Date): void {
    const stored = this.#requiredClaim(claim, now);
    if (stored.record.state !== "offered") {
      throw new TypeError("VFY_DISPATCH_STATE_CONFLICT: offer cannot be accepted");
    }
    stored.record = { ...stored.record, state: "running", updatedAt: now.toISOString() };
  }

  heartbeat(
    claim: CustomerWorkloadOfferClaim,
    now: Date,
    leaseMs: number,
  ): CustomerWorkloadOfferClaim {
    validateLease(claim.workerId, leaseMs);
    const stored = this.#requiredClaim(claim, now);
    if (stored.record.state !== "running" && stored.record.state !== "cancellation_requested") {
      throw new TypeError("VFY_DISPATCH_STATE_CONFLICT: dispatch cannot heartbeat");
    }
    stored.leaseExpiresAt = new Date(now.getTime() + leaseMs).toISOString();
    stored.record = { ...stored.record, updatedAt: now.toISOString() };
    return { ...structuredClone(claim), leaseExpiresAt: stored.leaseExpiresAt };
  }

  requestCancellation(
    authorization: DispatchAuthorizationContext,
    dispatchId: string,
    cancellationId: string,
    now: Date,
  ): CustomerWorkloadDispatchRecord | undefined {
    validateScope(authorization);
    if (!bounded(dispatchId) || !bounded(cancellationId)) {
      throw new TypeError("VFY_DISPATCH_CANCELLATION_INVALID: identity is invalid");
    }
    const stored = this.#dispatches.get(dispatchId);
    if (stored === undefined || !sameScope(stored.record, authorization)) return undefined;
    if (["completed", "expired", "failed"].includes(stored.record.state)) {
      throw new TypeError("VFY_DISPATCH_STATE_CONFLICT: terminal dispatch cannot be cancelled");
    }
    if (stored.record.cancellation !== undefined) {
      if (stored.record.cancellation.cancellationId !== cancellationId) {
        throw new TypeError("VFY_DISPATCH_CANCELLATION_CONFLICT: cancellation identity changed");
      }
      return structuredClone(stored.record);
    }
    const requestedAt = iso(now, "VFY_DISPATCH_CANCELLATION_INVALID: timestamp is invalid");
    stored.record = {
      ...stored.record,
      state: stored.record.state === "cancelled" ? "cancelled" : "cancellation_requested",
      updatedAt: requestedAt,
      cancellation: {
        cancellationId,
        requestedAt,
        gatewayAcknowledgement: "accepted",
        workloadAcknowledgement: stored.record.state === "cancelled" ? "terminal" : "pending",
      },
    };
    return structuredClone(stored.record);
  }

  observeCancellation(
    claim: CustomerWorkloadOfferClaim,
    now: Date,
  ): DispatchCancellationState | undefined {
    const stored = this.#requiredClaim(claim, now);
    if (stored.record.cancellation === undefined) return undefined;
    stored.record = {
      ...stored.record,
      updatedAt: now.toISOString(),
      cancellation: {
        ...stored.record.cancellation,
        gatewayAcknowledgement: "forwarded",
      },
    };
    return cancellationCopy(stored.record.cancellation);
  }

  acknowledgeCancellation(
    claim: CustomerWorkloadOfferClaim,
    acknowledgement: "accepted" | "terminal",
    now: Date,
  ): void {
    const stored = this.#requiredClaim(claim, now);
    const cancellation = stored.record.cancellation;
    if (cancellation === undefined || cancellation.gatewayAcknowledgement !== "forwarded") {
      throw new TypeError("VFY_DISPATCH_STATE_CONFLICT: cancellation was not forwarded");
    }
    if (cancellation.workloadAcknowledgement === "terminal" && acknowledgement !== "terminal") {
      throw new TypeError("VFY_DISPATCH_STATE_CONFLICT: terminal cancellation cannot regress");
    }
    stored.record = {
      ...stored.record,
      state: acknowledgement === "terminal" ? "cancelled" : "cancellation_requested",
      updatedAt: now.toISOString(),
      cancellation: { ...cancellation, workloadAcknowledgement: acknowledgement },
      ...(acknowledgement === "terminal" ? { reasonCodes: ["WORKLOAD_CANCELLED"] } : {}),
    };
  }

  finalize(
    claim: CustomerWorkloadOfferClaim,
    completion: CustomerWorkloadCompletion,
    now: Date,
  ): CustomerWorkloadDispatchRecord {
    const stored = this.#dispatches.get(claim.dispatchId);
    if (stored === undefined) throw new TypeError("VFY_DISPATCH_STALE_FENCE: dispatch is missing");
    const completionDigest = digest(completion);
    if (stored.record.state === "completed") {
      if (stored.completionDigest !== completionDigest) {
        throw new TypeError("VFY_DISPATCH_COMPLETION_CONFLICT: completion bytes changed");
      }
      return structuredClone(stored.record);
    }
    activeClaim(stored, claim, now);
    if (stored.record.state !== "running"
      || completion.schemaVersion !== 1
      || !bounded(completion.idempotencyKey)
      || completion.idempotencyKey !== stored.idempotencyKey
      || !bounded(completion.verifyInvocationId)
      || completion.verifyInvocationId !== stored.request.arguments.verifyRequest.invocationId
      || !bounded(completion.publishedRunId)
      || !Number.isFinite(Date.parse(completion.completedAt))
      || Date.parse(completion.completedAt) > now.getTime()) {
      throw new TypeError("VFY_DISPATCH_COMPLETION_INVALID: completion is invalid or unauthorized");
    }
    stored.completionDigest = completionDigest;
    stored.record = {
      ...stored.record,
      state: "completed",
      updatedAt: iso(completion.completedAt, "VFY_DISPATCH_COMPLETION_INVALID: timestamp is invalid"),
      verifyInvocationId: completion.verifyInvocationId,
      publishedRunId: completion.publishedRunId,
      reasonCodes: [],
    };
    return structuredClone(stored.record);
  }

  #requiredClaim(claim: CustomerWorkloadOfferClaim, now: Date): StoredDispatch {
    const stored = this.#dispatches.get(claim.dispatchId);
    if (stored === undefined) throw new TypeError("VFY_DISPATCH_STALE_FENCE: dispatch is missing");
    activeClaim(stored, claim, now);
    return stored;
  }
}
