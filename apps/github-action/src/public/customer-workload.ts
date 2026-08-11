import { join } from "node:path";
import { LocalCanonicalDispatcher } from "@verify-internal/adapter-core";
import {
  assertCustomerWorkloadDispatchRequest,
  assertMetadataPublicationPayload,
} from "@verify-internal/cloud-client";
import type {
  CustomerWorkloadCompletion,
  CustomerWorkloadDispatchRecord,
  CustomerWorkloadOfferClaim,
  DispatchCancellationState,
  MetadataPublicationPayload,
} from "@verify-internal/cloud-client";
import type { AnyCommandEnvelope } from "@verify-internal/protocol";
import type { GitHubActionEnvironment } from "./action.js";

const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;
const DEFAULT_LEASE_MS = 60_000;

export interface CustomerWorkloadProjectionBuilder {
  build(
    envelope: AnyCommandEnvelope,
    claim: CustomerWorkloadOfferClaim,
  ): MetadataPublicationPayload | Promise<MetadataPublicationPayload>;
}

export interface CustomerWorkloadPublicationReceipt {
  readonly publishedRunId: string;
}

export interface CustomerWorkloadPublicationContext {
  readonly schemaVersion: 1;
  readonly dispatchId: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly workloadBinding: string;
  readonly workerId: string;
  readonly fence: number;
  readonly attempt: number;
  readonly verifyInvocationId: string;
  readonly idempotencyKey: string;
}

export interface CustomerWorkloadDispatchTransport {
  acceptOffer(claim: CustomerWorkloadOfferClaim, now: Date): void | Promise<void>;
  heartbeat(
    claim: CustomerWorkloadOfferClaim,
    now: Date,
    leaseMs: number,
  ): CustomerWorkloadOfferClaim | Promise<CustomerWorkloadOfferClaim>;
  observeCancellation(
    claim: CustomerWorkloadOfferClaim,
    now: Date,
  ): DispatchCancellationState | undefined
    | Promise<DispatchCancellationState | undefined>;
  acknowledgeCancellation(
    claim: CustomerWorkloadOfferClaim,
    acknowledgement: "accepted" | "terminal",
    now: Date,
  ): void | Promise<void>;
  publishProjection(
    context: CustomerWorkloadPublicationContext,
    projection: MetadataPublicationPayload,
    signal: AbortSignal,
  ): CustomerWorkloadPublicationReceipt | Promise<CustomerWorkloadPublicationReceipt>;
  finalize(
    claim: CustomerWorkloadOfferClaim,
    completion: CustomerWorkloadCompletion,
    now: Date,
  ): CustomerWorkloadDispatchRecord | Promise<CustomerWorkloadDispatchRecord>;
}

export interface CustomerWorkloadRunnerOptions {
  readonly claim: CustomerWorkloadOfferClaim;
  readonly environment: GitHubActionEnvironment;
  readonly signal: AbortSignal;
  readonly transport: CustomerWorkloadDispatchTransport;
  readonly projectionBuilder: CustomerWorkloadProjectionBuilder;
  readonly dispatcher?: LocalCanonicalDispatcher;
  readonly now?: () => Date;
  readonly leaseMs?: number;
  readonly heartbeatIntervalMs?: number;
}

export type CustomerWorkloadRunnerResult =
  | {
    readonly state: "completed";
    readonly dispatch: CustomerWorkloadDispatchRecord;
    readonly envelope: AnyCommandEnvelope;
    readonly projection: MetadataPublicationPayload;
  }
  | {
    readonly state: "cancelled";
    readonly dispatchId: string;
  };

function bounded(value: unknown, maximum = 512): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maximum
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function repository(value: unknown): string {
  if (typeof value !== "string"
    || !/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(value)) {
    throw new TypeError("VFY_CUSTOMER_WORKLOAD_BINDING_INVALID: repository is invalid");
  }
  return value;
}

function noCache(value: unknown): boolean {
  if (value === undefined) return true;
  if (typeof value !== "boolean") {
    throw new TypeError("VFY_CUSTOMER_WORKLOAD_REQUEST_UNSUPPORTED: noCache must be boolean");
  }
  return value;
}

function validateClaim(
  claim: CustomerWorkloadOfferClaim,
  environment: GitHubActionEnvironment,
): void {
  assertCustomerWorkloadDispatchRequest(claim.request);
  const repositoryName = repository(environment.GITHUB_REPOSITORY);
  const expectedBinding = `workload:github:${repositoryName}`;
  const verifyRequest = claim.request.arguments.verifyRequest;
  const argumentsValue = record(verifyRequest.arguments);
  if (claim.schemaVersion !== 1
    || !bounded(claim.dispatchId)
    || !bounded(claim.tenantId)
    || !bounded(claim.projectId)
    || !bounded(claim.workerId)
    || claim.workloadBinding !== expectedBinding
    || claim.request.arguments.workloadBinding !== expectedBinding
    || verifyRequest.environment.platform !== "github-action"
    || verifyRequest.outputMode !== "json"
    || verifyRequest.workspace.expectedRevision !== undefined
    || verifyRequest.configurationReferences.length !== 0
    || verifyRequest.policyReferences.length !== 0
    || verifyRequest.consentGrantReferences.length !== 0
    || argumentsValue === undefined
    || Object.keys(argumentsValue).some((key) => key !== "noCache")
    || !Number.isSafeInteger(claim.fence)
    || claim.fence <= 0
    || !Number.isSafeInteger(claim.attempt)
    || claim.attempt <= 0
    || !Number.isFinite(Date.parse(claim.leaseExpiresAt))) {
    throw new TypeError(
      "VFY_CUSTOMER_WORKLOAD_REQUEST_UNSUPPORTED: offer is not executable by this runner",
    );
  }
  noCache(argumentsValue?.noCache);
}

function validateTiming(
  claim: CustomerWorkloadOfferClaim,
  now: Date,
  leaseMs: number,
  heartbeatIntervalMs: number,
): void {
  const remaining = Date.parse(claim.leaseExpiresAt) - now.getTime();
  if (!Number.isSafeInteger(leaseMs)
    || leaseMs <= 0
    || leaseMs > 5 * 60 * 1000
    || !Number.isSafeInteger(heartbeatIntervalMs)
    || heartbeatIntervalMs < 100
    || heartbeatIntervalMs >= leaseMs
    || remaining <= 0
    || heartbeatIntervalMs >= remaining) {
    throw new TypeError("VFY_CUSTOMER_WORKLOAD_LEASE_INVALID: lease timing is invalid");
  }
}

function linkAbort(source: AbortSignal, target: AbortController): () => void {
  const abort = () => target.abort(source.reason);
  if (source.aborted) abort();
  else source.addEventListener("abort", abort, { once: true });
  return () => source.removeEventListener("abort", abort);
}

export async function runCustomerWorkloadOffer(
  options: CustomerWorkloadRunnerOptions,
): Promise<CustomerWorkloadRunnerResult> {
  validateClaim(options.claim, options.environment);
  const workspace = options.environment.GITHUB_WORKSPACE;
  if (!bounded(workspace, 4096)) {
    throw new TypeError("VFY_CUSTOMER_WORKLOAD_BINDING_INVALID: checkout is unavailable");
  }
  const now = options.now ?? (() => new Date());
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
  const heartbeatIntervalMs = options.heartbeatIntervalMs
    ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
  validateTiming(options.claim, now(), leaseMs, heartbeatIntervalMs);
  let claim = structuredClone(options.claim);
  const controller = new AbortController();
  const unlinkAbort = linkAbort(options.signal, controller);
  let cancellationObserved = false;
  let pulseFailure: unknown;
  let pulseInFlight: Promise<void> | undefined;
  let interval: ReturnType<typeof setInterval> | undefined;
  const ownedDispatcher = options.dispatcher === undefined;
  const verifyRequest = claim.request.arguments.verifyRequest;
  const verifyArguments = record(verifyRequest.arguments);
  if (verifyArguments === undefined) {
    throw new TypeError("VFY_CUSTOMER_WORKLOAD_REQUEST_UNSUPPORTED: arguments are invalid");
  }
  const dispatcher = options.dispatcher ?? new LocalCanonicalDispatcher({
    workspace: { id: verifyRequest.workspace.rootBinding, root: workspace },
    stateRoot: join(options.environment.RUNNER_TEMP ?? workspace, "verify-state"),
    platform: "github-action",
    createInvocationId: () => verifyRequest.invocationId,
  });
  const publicationContext: CustomerWorkloadPublicationContext = {
    schemaVersion: 1,
    dispatchId: claim.dispatchId,
    tenantId: claim.tenantId,
    projectId: claim.projectId,
    workloadBinding: claim.workloadBinding,
    workerId: claim.workerId,
    fence: claim.fence,
    attempt: claim.attempt,
    verifyInvocationId: verifyRequest.invocationId,
    idempotencyKey: claim.request.arguments.idempotencyKey,
  };

  const observe = async (): Promise<void> => {
    const cancellation = await options.transport.observeCancellation(claim, now());
    if (cancellation === undefined || cancellationObserved) return;
    cancellationObserved = true;
    await options.transport.acknowledgeCancellation(claim, "accepted", now());
    controller.abort("customer-workload-cancellation");
  };

  const pulse = async (): Promise<void> => {
    claim = await options.transport.heartbeat(claim, now(), leaseMs);
    await observe();
  };

  try {
    await observe();
    if (cancellationObserved) {
      await options.transport.acknowledgeCancellation(claim, "terminal", now());
      return { state: "cancelled", dispatchId: claim.dispatchId };
    }
    await options.transport.acceptOffer(claim, now());
    await observe();
    if (cancellationObserved) {
      await options.transport.acknowledgeCancellation(claim, "terminal", now());
      return { state: "cancelled", dispatchId: claim.dispatchId };
    }
    interval = setInterval(() => {
      if (pulseInFlight !== undefined) return;
      pulseInFlight = pulse()
        .catch((error: unknown) => {
          pulseFailure = error;
          controller.abort("customer-workload-lease-failure");
        })
        .finally(() => { pulseInFlight = undefined; });
    }, heartbeatIntervalMs);

    let local;
    try {
      local = await dispatcher.verify({
        workspaceBinding: verifyRequest.workspace.rootBinding,
        offline: true,
        noCache: noCache(verifyArguments.noCache),
        ...(verifyRequest.deadlineMs === undefined ? {} : { deadlineMs: verifyRequest.deadlineMs }),
      }, controller.signal);
    } catch (error: unknown) {
      if (cancellationObserved) {
        await options.transport.acknowledgeCancellation(claim, "terminal", now());
        return { state: "cancelled", dispatchId: claim.dispatchId };
      }
      throw error;
    }
    if (pulseFailure !== undefined) throw pulseFailure;
    if (cancellationObserved) {
      await options.transport.acknowledgeCancellation(claim, "terminal", now());
      return { state: "cancelled", dispatchId: claim.dispatchId };
    }
    if (options.signal.aborted) throw new TypeError("VFY_CUSTOMER_WORKLOAD_CANCELLED");
    if (local.envelope.invocationId !== verifyRequest.invocationId
      || local.request.invocationId !== verifyRequest.invocationId) {
      throw new TypeError("VFY_CUSTOMER_WORKLOAD_RESULT_INVALID: invocation identity drifted");
    }
    const projection = await options.projectionBuilder.build(
      structuredClone(local.envelope),
      structuredClone(claim),
    );
    assertMetadataPublicationPayload(projection);
    if (projection.tenantId !== claim.tenantId
      || projection.projectId !== claim.projectId
      || projection.idempotencyKey !== claim.request.arguments.idempotencyKey
      || projection.runId !== verifyRequest.invocationId) {
      throw new TypeError("VFY_CUSTOMER_WORKLOAD_PROJECTION_INVALID: projection binding drifted");
    }
    const publication = await options.transport.publishProjection(
      publicationContext,
      structuredClone(projection),
      controller.signal,
    );
    if (!bounded(publication.publishedRunId)) {
      throw new TypeError("VFY_CUSTOMER_WORKLOAD_PUBLICATION_INVALID: publication is invalid");
    }
    if (interval !== undefined) clearInterval(interval);
    if (pulseInFlight !== undefined) await pulseInFlight;
    if (pulseFailure !== undefined) throw pulseFailure;
    await pulse();
    if (cancellationObserved) {
      await options.transport.acknowledgeCancellation(claim, "terminal", now());
      return { state: "cancelled", dispatchId: claim.dispatchId };
    }
    const completedAt = now();
    const dispatch = await options.transport.finalize(claim, {
      schemaVersion: 1,
      idempotencyKey: claim.request.arguments.idempotencyKey,
      verifyInvocationId: verifyRequest.invocationId,
      publishedRunId: publication.publishedRunId,
      completedAt: completedAt.toISOString(),
    }, completedAt);
    return {
      state: "completed",
      dispatch,
      envelope: local.envelope,
      projection: structuredClone(projection),
    };
  } finally {
    if (interval !== undefined) clearInterval(interval);
    unlinkAbort();
    if (ownedDispatcher) dispatcher.close();
  }
}
