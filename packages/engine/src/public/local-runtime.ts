import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { canonicalize } from "@verify-internal/contracts";
import type {
  CanonicalValue,
  OpaqueId,
  RepairSuggestion,
  RevisionDocument,
  RevisionRef,
  Rfc3339Utc,
  Sha256Digest,
} from "@verify-internal/contracts";
import {
  authorize,
  repairApplyCliPolicy,
  type LocalPrincipal,
} from "@verify-internal/auth";
import {
  RepairApplyConflict,
  applyRepairPatch,
  previewRepairPatch,
} from "@verify-internal/repair";
import type {
  EngineUnitOfWorkCommit,
  EventEnvelope,
  ReferenceEdge,
} from "@verify-internal/events";
import { EngineUnitOfWorkConflict } from "@verify-internal/events";
import {
  EvidenceBlobStore,
  LocalCacheStore,
  LocalProjectionRepository,
  SqliteEngineUnitOfWork,
} from "@verify-internal/execution";
import type {
  CacheEntryPayload,
  SqliteCommitFaultInjector,
} from "@verify-internal/execution";
import {
  VerificationEngine,
  type CachedEvaluation,
  type EngineCache,
  type EngineHistory,
  type EngineHistoryCheckpoint,
  type VerifyRequest,
  type VerifyResult,
} from "./index.js";

export interface LocalRuntimeOptions {
  readonly now?: () => Date;
  readonly commitFault?: SqliteCommitFaultInjector;
  readonly projectionFault?: ProjectionFaultInjector;
  readonly checkpointFault?: CheckpointFaultInjector;
  readonly ownerLeaseMs?: number;
  readonly ownerHeartbeatIntervalMs?: number;
}

export interface RepairApplicationRecord {
  readonly applicationInvocationId: OpaqueId;
  readonly sourceInvocationId: OpaqueId;
  readonly repair: RevisionRef;
  readonly target: string;
  readonly beforeDigest: Sha256Digest;
  readonly afterDigest: Sha256Digest;
  readonly principalId: string;
}

export interface RepairVerificationRecord {
  readonly applicationInvocationId: OpaqueId;
  readonly repair: RevisionRef;
  readonly verifyingInvocationId: OpaqueId;
  readonly verifyingProof: RevisionRef;
  readonly verifyingAttemptId?: OpaqueId;
  readonly resultDigest?: Sha256Digest;
  readonly passed: boolean;
}

export interface LocalRepairCommandResult {
  readonly document: CanonicalValue;
  readonly passed?: boolean;
}

export type ProjectionFaultPoint =
  | "after-canonical-commit"
  | "before-legacy-evidence-projection"
  | "before-canonical-evidence-projection"
  | "before-run-projection";

export type ProjectionFaultInjector = (point: ProjectionFaultPoint) => void;
export type CheckpointFaultInjector = (
  unit: import("./index.js").EngineHistoryUnit,
) => void;

const DEFAULT_LOCAL_RUNTIME_OWNER_LEASE_MS = 5 * 60 * 1_000;
const DEFAULT_LOCAL_RUNTIME_HEARTBEAT_INTERVAL_MS = 60 * 1_000;
const knownLocalOwnerTokens = new Set<string>();
const activeLocalOwnerTokens = new Set<string>();

interface DurableAdmissionOwner {
  readonly ownerToken: string;
  readonly ownerPid: number;
  readonly leaseUntil: string;
}

interface DurableOwnerHeartbeat extends DurableAdmissionOwner {
  readonly schemaVersion: 1;
  readonly refreshedAt: string;
}

function processIsLive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "EPERM"
    );
  }
}

function canonical(value: unknown): CanonicalValue {
  return JSON.parse(JSON.stringify(value)) as CanonicalValue;
}

function refKey(ref: RevisionRef): string {
  return `${ref.kind}\0${ref.id}\0${ref.revision}\0${ref.schemaVersion}`;
}

function terminalHistoryEvents(
  result: VerifyResult,
  occurredAt: Rfc3339Utc,
  normalizedEvidence:
    | import("@verify-internal/evidence").NormalizedEvidence
    | undefined,
  sequence: number,
): readonly EventEnvelope<string, CanonicalValue>[] {
  return [{
    schemaVersion: 1,
    eventId:
      `${result.invocationId}:unit:11-invocation-terminal:1` as OpaqueId,
    eventType: "VerificationInvocationCompleted",
    occurredAt,
    invocationId: result.invocationId as OpaqueId,
    correlationId: result.invocationId as OpaqueId,
    sequence,
    producer: {
      id: "@verify-internal/engine" as OpaqueId,
      version: result.engineVersion,
      artifactDigest: `sha256:${createHash("sha256")
        .update(`@verify-internal/engine@${result.engineVersion}`)
        .digest("hex")}`,
    },
    dataClassification: "LOCAL_SOURCE",
    payload: canonical({
      result,
      projectionEvidence: normalizedEvidence === undefined
        ? null
        : {
            evidenceId: normalizedEvidence.id,
            metadata: {
              schemaVersion: normalizedEvidence.schemaVersion,
              id: normalizedEvidence.id,
              revision: normalizedEvidence.revision,
              evidenceType: normalizedEvidence.evidenceType,
              mediaType: normalizedEvidence.mediaType,
              contentDigest: normalizedEvidence.contentDigest,
              byteSize: normalizedEvidence.byteSize,
              classification: normalizedEvidence.classification,
              redactions: normalizedEvidence.redactions,
            },
            body: normalizedEvidence.body,
          },
    }),
  }];
}

/**
 * Durable local composition root. Adapters call this service; they do not
 * interpret results, inspect the database, or implement cache semantics.
 */
export class LocalVerificationRuntime implements EngineCache, EngineHistory {
  readonly #cache: LocalCacheStore;
  readonly #projections: LocalProjectionRepository;
  readonly #unitOfWork: SqliteEngineUnitOfWork;
  readonly #engine: VerificationEngine;
  readonly #now: () => Date;
  readonly #projectionFault: ProjectionFaultInjector | undefined;
  readonly #checkpointFault: CheckpointFaultInjector | undefined;
  readonly #recovery: Promise<void>;
  readonly #ownerToken: string;
  readonly #ownerDirectory: string;
  readonly #ownerLeaseMs: number;
  readonly #ownerHeartbeat: ReturnType<typeof setInterval>;
  #closed = false;

  constructor(stateRoot: string, options: LocalRuntimeOptions = {}) {
    this.#ownerToken = randomUUID();
    knownLocalOwnerTokens.add(this.#ownerToken);
    activeLocalOwnerTokens.add(this.#ownerToken);
    mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
    this.#ownerDirectory = path.join(stateRoot, ".runtime-owners");
    mkdirSync(this.#ownerDirectory, { recursive: true, mode: 0o700 });
    chmodSync(this.#ownerDirectory, 0o700);
    this.#ownerLeaseMs = options.ownerLeaseMs ??
      DEFAULT_LOCAL_RUNTIME_OWNER_LEASE_MS;
    const heartbeatInterval = options.ownerHeartbeatIntervalMs ??
      DEFAULT_LOCAL_RUNTIME_HEARTBEAT_INTERVAL_MS;
    if (
      !Number.isSafeInteger(this.#ownerLeaseMs) ||
      this.#ownerLeaseMs <= 0 ||
      !Number.isSafeInteger(heartbeatInterval) ||
      heartbeatInterval <= 0 ||
      heartbeatInterval >= this.#ownerLeaseMs
    ) {
      throw new TypeError(
        "owner heartbeat interval must be positive and shorter than the owner lease",
      );
    }
    const evidenceBlobs = new EvidenceBlobStore(path.join(stateRoot, "evidence"));
    this.#cache = new LocalCacheStore(path.join(stateRoot, "cache"));
    const historyPath = path.join(stateRoot, "history.sqlite");
    this.#projections = new LocalProjectionRepository(
      historyPath,
      evidenceBlobs,
    );
    this.#unitOfWork = new SqliteEngineUnitOfWork(
      historyPath,
      options.commitFault,
    );
    this.#now = options.now ?? (() => new Date());
    this.#writeOwnerHeartbeat();
    this.#ownerHeartbeat = setInterval(() => {
      try {
        this.#writeOwnerHeartbeat();
      } catch {
        // A failed refresh becomes a stale heartbeat and recovery fails closed.
      }
    }, heartbeatInterval);
    this.#ownerHeartbeat.unref();
    this.#projectionFault = options.projectionFault;
    this.#checkpointFault = options.checkpointFault;
    this.#reconcileRunProjections();
    this.#recovery = this.#recoverAbandonedInvocations();
    this.#engine = new VerificationEngine({
      cache: this,
      history: this,
      now: this.#now,
    });
  }

  async verify(request: VerifyRequest, disableCache = false): Promise<VerifyResult> {
    await this.#recovery;
    if (!disableCache) return this.#engine.verify(request);
    return new VerificationEngine({
      history: this,
      now: this.#now,
    }).verify(request);
  }

  #retainedRepair(
    sourceInvocationId: string,
    repairId: string,
  ): RepairSuggestion {
    const retained = this.readRun(sourceInvocationId) as {
      readonly repairRecords?: readonly RepairSuggestion[];
    } | undefined;
    if (retained === undefined) {
      throw new RepairApplyConflict(
        "INVALID_REPAIR_ACTION",
        `source run not found: ${sourceInvocationId}`,
      );
    }
    const matches = (retained.repairRecords ?? []).filter(
      (repair) => repair.id === repairId,
    );
    if (matches.length !== 1) {
      throw new RepairApplyConflict(
        "INVALID_REPAIR_ACTION",
        `exact retained Repair not found: ${repairId}`,
      );
    }
    return matches[0]!;
  }

  previewRepair(
    sourceInvocationId: string,
    repairId: string,
    workspace: string,
  ): LocalRepairCommandResult {
    const preview = previewRepairPatch(
      this.#retainedRepair(sourceInvocationId, repairId),
      workspace,
    );
    return {
      document: canonical({
        schemaVersion: 1,
        kind: "repairPreview",
        sourceInvocationId,
        writeAuthorized: false,
        writePerformed: false,
        preview,
      }),
    };
  }

  async applyRepair(
    applicationInvocationId: string,
    sourceInvocationId: string,
    repairId: string,
    workspace: string,
    writeGranted: boolean,
    signal: AbortSignal,
  ): Promise<LocalRepairCommandResult> {
    if (!writeGranted) {
      throw new RepairApplyConflict(
        "INVALID_REPAIR_ACTION",
        "an explicit workspace write grant is required",
      );
    }
    const principal: LocalPrincipal = {
      kind: "local-user",
      id: `local-user:${process.getuid?.() ?? "unknown"}`,
      authenticated: true,
    };
    const decision = authorize(
      principal,
      {
        operation: "applyRepair",
        workspaceRoot: workspace,
        permissions: ["workspace.write"],
      },
      repairApplyCliPolicy(principal, workspace),
    );
    if (!decision.allowed) {
      throw new RepairApplyConflict(
        "INVALID_REPAIR_ACTION",
        `workspace write was denied: ${decision.reasonCode}`,
      );
    }
    const repair = this.#retainedRepair(sourceInvocationId, repairId);
    const preview = applyRepairPatch(repair, workspace);
    const repairRef: RevisionRef = {
      kind: "repair",
      id: repair.id,
      revision: repair.revision,
      schemaVersion: repair.schemaVersion,
    };
    await this.recordRepairApplied({
      applicationInvocationId: applicationInvocationId as OpaqueId,
      sourceInvocationId: sourceInvocationId as OpaqueId,
      repair: repairRef,
      target: preview.target,
      beforeDigest: preview.currentContentDigest,
      afterDigest: preview.patchedContentDigest,
      principalId: principal.id,
    });
    const verifyingInvocationId =
      `${applicationInvocationId}:verification` as OpaqueId;
    const verification = await this.verify({
      schemaVersion: 1,
      workspaceRoot: workspace,
      invocationId: verifyingInvocationId,
      signal,
    }, true);
    const exact = verification.proofExecutions.find((execution) =>
      refKey(execution.proof) === refKey(repair.motivatingExecution.proof)
    );
    const passed = exact?.result?.status === "passed";
    await this.recordRepairVerification({
      applicationInvocationId: applicationInvocationId as OpaqueId,
      repair: repairRef,
      verifyingInvocationId,
      verifyingProof: repair.motivatingExecution.proof,
      ...(exact === undefined
        ? {}
        : {
            verifyingAttemptId: exact.attemptId,
            ...(exact.resultDigest === undefined
              ? {}
              : { resultDigest: exact.resultDigest }),
          }),
      passed,
    });
    return {
      passed,
      document: canonical({
        schemaVersion: 1,
        kind: "repairApply",
        applicationInvocationId,
        sourceInvocationId,
        repair: repairRef,
        writeAuthorized: true,
        writePerformed: true,
        preview,
        lifecycle: [
          "accepted",
          "applied",
          passed ? "verified" : "verification_failed",
        ],
        verification: {
          invocationId: verification.invocationId,
          outcome: verification.outcome,
          proof: repair.motivatingExecution.proof,
          status: exact?.result?.status ?? "not_evaluated",
          ...(exact?.resultDigest === undefined
            ? {}
            : { resultDigest: exact.resultDigest }),
        },
      }),
    };
  }

  async recordRepairApplied(record: RepairApplicationRecord): Promise<void> {
    await this.#recovery;
    const occurredAt = this.#now().toISOString() as Rfc3339Utc;
    const producer = {
      id: "@verify-internal/engine" as OpaqueId,
      version: "0.2.0",
      artifactDigest: `sha256:${createHash("sha256")
        .update("@verify-internal/engine@0.2.0")
        .digest("hex")}` as Sha256Digest,
    };
    await this.#unitOfWork.commit({
      idempotencyKey:
        `repair-application:${record.applicationInvocationId}:applied` as OpaqueId,
      invocationId: record.applicationInvocationId,
      expectedNextSequence: 1,
      revisions: [],
      events: [
        {
          schemaVersion: 1,
          eventId: `${record.applicationInvocationId}:repair:accepted` as OpaqueId,
          eventType: "RepairAccepted",
          occurredAt,
          invocationId: record.applicationInvocationId,
          subject: record.repair,
          correlationId: record.sourceInvocationId,
          sequence: 1,
          producer,
          dataClassification: "MINIMAL_METADATA",
          payload: canonical({
            repair: record.repair,
            from: "proposed",
            to: "accepted",
            actorRef: record.principalId,
            reasonCode: "EXPLICIT_CLI_WRITE_GRANT",
          }),
        },
        {
          schemaVersion: 1,
          eventId: `${record.applicationInvocationId}:repair:applied` as OpaqueId,
          eventType: "RepairApplied",
          occurredAt,
          invocationId: record.applicationInvocationId,
          subject: record.repair,
          correlationId: record.sourceInvocationId,
          sequence: 2,
          producer,
          dataClassification: "LOCAL_SOURCE",
          payload: canonical({
            repair: record.repair,
            from: "accepted",
            to: "applied",
            actorRef: record.principalId,
            authorizationDecisionRef:
              `${record.applicationInvocationId}:workspace-write`,
            reasonCode: "ATOMIC_PATCH_APPLIED",
            target: record.target,
            beforeDigest: record.beforeDigest,
            afterDigest: record.afterDigest,
          }),
        },
      ],
      referenceEdges: [],
      currentRevisionMutations: [],
    });
  }

  async recordRepairVerification(
    record: RepairVerificationRecord,
  ): Promise<void> {
    await this.#recovery;
    const occurredAt = this.#now().toISOString() as Rfc3339Utc;
    await this.#unitOfWork.commit({
      idempotencyKey:
        `repair-application:${record.applicationInvocationId}:verification` as OpaqueId,
      invocationId: record.applicationInvocationId,
      expectedNextSequence: 3,
      revisions: [],
      events: [{
        schemaVersion: 1,
        eventId:
          `${record.applicationInvocationId}:repair:verification` as OpaqueId,
        eventType: record.passed ? "RepairVerified" : "RepairVerificationFailed",
        occurredAt,
        invocationId: record.applicationInvocationId,
        subject: record.repair,
        correlationId: record.verifyingInvocationId,
        sequence: 3,
        producer: {
          id: "@verify-internal/engine" as OpaqueId,
          version: "0.2.0",
          artifactDigest: `sha256:${createHash("sha256")
            .update("@verify-internal/engine@0.2.0")
            .digest("hex")}`,
        },
        dataClassification: "MINIMAL_METADATA",
        payload: canonical({
          repair: record.repair,
          from: "applied",
          to: record.passed ? "verified" : "verification_failed",
          actorRef: "@verify-internal/engine",
          reasonCode: record.passed
            ? "LATER_EXACT_PROOF_PASSED"
            : "LATER_EXACT_PROOF_DID_NOT_PASS",
          verifyingInvocationId: record.verifyingInvocationId,
          verifyingProof: record.verifyingProof,
          ...(record.verifyingAttemptId === undefined
            ? {}
            : { verifyingAttemptId: record.verifyingAttemptId }),
          ...(record.resultDigest === undefined
            ? {}
            : { resultDigest: record.resultDigest }),
        }),
      }],
      referenceEdges: [{
        source: record.repair,
        relation: record.passed ? "verified-by-proof" : "verification-attempted-by-proof",
        target: record.verifyingProof,
      }],
      currentRevisionMutations: [],
    });
  }

  async admit(invocationId: string, workspaceRoot: string): Promise<void> {
    await this.#recovery;
    const occurredAt = this.#now().toISOString() as Rfc3339Utc;
    const id = invocationId as OpaqueId;
    const idempotencyKey =
      `history:${invocationId}:admission` as OpaqueId;
    const workspaceBinding = `sha256:${createHash("sha256")
      .update(path.resolve(workspaceRoot))
      .digest("hex")}`;
    const owner = this.#ownerIdentity();
    const retainedHistory = this.#unitOfWork.readInvocation(id);
    const retainedTerminal = retainedHistory.find((event) =>
      event.eventType === "VerificationInvocationCompleted" ||
      event.eventType === "VerificationInvocationAbandoned"
    );
    if (retainedTerminal !== undefined) {
      throw new EngineUnitOfWorkConflict(
        "IDEMPOTENCY_CONFLICT",
        `invocation ${invocationId} is already terminal as ${retainedTerminal.eventType}`,
      );
    }
    const acceptedAdmission =
      this.#unitOfWork.readAcceptedCommit(idempotencyKey);
    if (acceptedAdmission !== undefined) {
      const retainedBinding = (
        acceptedAdmission.events[0]?.payload as {
          readonly workspaceBinding?: string;
          readonly owner?: DurableAdmissionOwner;
        } | undefined
      )?.workspaceBinding;
      const retainedOwner = (
        acceptedAdmission.events[0]?.payload as {
          readonly owner?: DurableAdmissionOwner;
        } | undefined
      )?.owner;
      if (
        retainedBinding !== workspaceBinding ||
        retainedOwner?.ownerToken !== this.#ownerToken
      ) {
        throw new EngineUnitOfWorkConflict(
          "IDEMPOTENCY_CONFLICT",
          `invocation ${invocationId} was admitted for another workspace or owner`,
        );
      }
      return;
    }
    await this.#unitOfWork.commit({
      idempotencyKey,
      invocationId: id,
      expectedNextSequence: 1,
      revisions: [],
      events: [{
        schemaVersion: 1,
        eventId: `${invocationId}:history:1` as OpaqueId,
        eventType: "VerificationInvocationAdmitted",
        occurredAt,
        invocationId: id,
        correlationId: id,
        sequence: 1,
        producer: {
          id: "@verify-internal/engine" as OpaqueId,
          version: "0.2.0",
          artifactDigest: `sha256:${createHash("sha256")
            .update("@verify-internal/engine@0.2.0")
            .digest("hex")}`,
        },
        dataClassification: "LOCAL_SOURCE",
        payload: canonical({
          workspaceBinding,
          owner,
          state: "admitted",
        }),
      }],
      referenceEdges: [],
      currentRevisionMutations: [],
    });
  }

  async checkpoint(checkpoint: EngineHistoryCheckpoint): Promise<void> {
    await this.#recovery;
    const idempotencyKey =
      `history:${checkpoint.invocationId}:unit:${checkpoint.unit}` as OpaqueId;
    const accepted = this.#unitOfWork.readAcceptedCommit(idempotencyKey);
    if (accepted !== undefined) {
      const retainedEvents = accepted.events.map((event) => ({
        eventType: event.eventType,
        ...(event.subject === undefined ? {} : { subject: event.subject }),
        dataClassification: event.dataClassification,
        payload: event.payload,
      }));
      const requestedCurrent = checkpoint.currentRevision?.next;
      const retainedMutation = accepted.currentRevisionMutations[0];
      const retainedCurrent = retainedMutation?.nextCurrent;
      const retainedEdges = accepted.referenceEdges.filter((edge) =>
        !(
          edge.relation === "superseded-by" &&
          retainedMutation?.expectedCurrent !== null &&
          retainedMutation?.expectedCurrent !== undefined &&
          refKey(edge.source) ===
            refKey(retainedMutation.expectedCurrent) &&
          refKey(edge.target) === refKey(retainedMutation.nextCurrent)
        )
      );
      if (
        canonicalize(accepted.revisions as unknown as CanonicalValue) !==
          canonicalize(checkpoint.revisions as unknown as CanonicalValue) ||
        canonicalize(
          retainedEdges as unknown as CanonicalValue,
        ) !==
          canonicalize(checkpoint.referenceEdges as unknown as CanonicalValue) ||
        canonicalize(retainedEvents as unknown as CanonicalValue) !==
          canonicalize(checkpoint.events as unknown as CanonicalValue) ||
        (
          requestedCurrent === undefined
            ? retainedCurrent !== undefined
            : retainedCurrent === undefined ||
              refKey(requestedCurrent) !== refKey(retainedCurrent)
        )
      ) {
        throw new EngineUnitOfWorkConflict(
          "IDEMPOTENCY_CONFLICT",
          `checkpoint ${checkpoint.unit} was already committed differently`,
        );
      }
      return;
    }
    const prior = this.#unitOfWork.readInvocation(checkpoint.invocationId);
    const retainedTerminal = prior.find((event) =>
      event.eventType === "VerificationInvocationCompleted" ||
      event.eventType === "VerificationInvocationAbandoned"
    );
    if (retainedTerminal !== undefined) {
      throw new EngineUnitOfWorkConflict(
        "IDEMPOTENCY_CONFLICT",
        `invocation ${checkpoint.invocationId} is already terminal as ${retainedTerminal.eventType}`,
      );
    }
    const firstSequence = prior.length + 1;
    const events = checkpoint.events.map((event, index) => ({
      schemaVersion: 1,
      eventId:
        `${checkpoint.invocationId}:unit:${checkpoint.unit}:${index + 1}` as OpaqueId,
      eventType: event.eventType,
      occurredAt: checkpoint.occurredAt,
      invocationId: checkpoint.invocationId,
      ...(event.subject === undefined ? {} : { subject: event.subject }),
      correlationId: checkpoint.invocationId,
      sequence: firstSequence + index,
      producer: {
        id: "@verify-internal/engine" as OpaqueId,
        version: "0.2.0",
        artifactDigest: `sha256:${createHash("sha256")
          .update("@verify-internal/engine@0.2.0")
          .digest("hex")}` as Sha256Digest,
      },
      dataClassification: event.dataClassification,
      payload: event.payload,
    }));
    const priorCurrent = checkpoint.currentRevision === undefined
      ? null
      : this.#unitOfWork.readCurrentRevision(
          checkpoint.currentRevision.slot,
        );
    const currentRevisionMutations = checkpoint.currentRevision === undefined
        ? []
        : [{
            slot: checkpoint.currentRevision.slot,
            expectedCurrent: priorCurrent,
            nextCurrent: checkpoint.currentRevision.next,
          }];
    const referenceEdges = [
      ...checkpoint.referenceEdges,
      ...(
        checkpoint.currentRevision !== undefined &&
          priorCurrent !== null &&
          refKey(priorCurrent) !== refKey(checkpoint.currentRevision.next)
          ? [{
              source: priorCurrent,
              relation: "superseded-by",
              target: checkpoint.currentRevision.next,
            }]
          : []
      ),
    ];
    await this.#unitOfWork.commit({
      idempotencyKey,
      invocationId: checkpoint.invocationId,
      expectedNextSequence: firstSequence,
      revisions: checkpoint.revisions,
      events,
      referenceEdges,
      currentRevisionMutations,
    });
    this.#checkpointFault?.(checkpoint.unit);
  }

  async #recoverAbandonedInvocations(): Promise<void> {
    for (const invocationId of this.#unitOfWork.listInvocationIds()) {
      const events = this.#unitOfWork.readInvocation(invocationId);
      const admission = events.find((event) =>
        event.eventType === "VerificationInvocationAdmitted"
      );
      if (
        admission === undefined ||
        events.some((event) =>
          event.eventType === "VerificationInvocationCompleted" ||
          event.eventType === "VerificationInvocationAbandoned"
        )
      ) {
        continue;
      }
      const owner = (
        admission.payload as {
          readonly owner?: DurableAdmissionOwner;
        }
      ).owner;
      if (this.#admissionOwnerIsLive(owner)) continue;
      const sequence = events.length + 1;
      const occurredAt = this.#now().toISOString() as Rfc3339Utc;
      await this.#unitOfWork.commit({
        idempotencyKey:
          `history:${invocationId}:abandoned` as OpaqueId,
        invocationId,
        expectedNextSequence: sequence,
        revisions: [],
        events: [{
          schemaVersion: 1,
          eventId:
            `${invocationId}:history:${sequence}` as OpaqueId,
          eventType: "VerificationInvocationAbandoned",
          occurredAt,
          invocationId,
          correlationId: invocationId,
          sequence,
          producer: {
            id: "@verify-internal/engine" as OpaqueId,
            version: "0.2.0",
            artifactDigest: `sha256:${createHash("sha256")
              .update("@verify-internal/engine@0.2.0")
              .digest("hex")}`,
          },
          dataClassification: "MINIMAL_METADATA",
          payload: canonical({
            state: "abandoned",
            reasonCode: "PROCESS_INTERRUPTED",
            semanticOutcome: null,
          }),
        }],
        referenceEdges: [],
        currentRevisionMutations: [],
      });
    }
  }

  #admissionOwnerIsLive(owner: DurableAdmissionOwner | undefined): boolean {
    if (
      owner === undefined ||
      typeof owner.ownerToken !== "string" ||
      typeof owner.leaseUntil !== "string"
    ) {
      return false;
    }
    if (knownLocalOwnerTokens.has(owner.ownerToken)) {
      return activeLocalOwnerTokens.has(owner.ownerToken);
    }
    if (!processIsLive(owner.ownerPid)) return false;
    const heartbeat = this.#readOwnerHeartbeat(owner.ownerToken);
    if (
      heartbeat === undefined ||
      heartbeat.ownerToken !== owner.ownerToken ||
      heartbeat.ownerPid !== owner.ownerPid
    ) {
      return false;
    }
    const leaseExpiry = Date.parse(heartbeat.leaseUntil);
    return Number.isFinite(leaseExpiry) &&
      leaseExpiry > Date.now();
  }

  #ownerIdentity(): DurableAdmissionOwner {
    return {
      ownerToken: this.#ownerToken,
      ownerPid: process.pid,
      leaseUntil: new Date(
        Date.now() + this.#ownerLeaseMs,
      ).toISOString(),
    };
  }

  #ownerHeartbeatPath(ownerToken: string): string {
    const filename = createHash("sha256")
      .update(ownerToken)
      .digest("hex");
    return path.join(this.#ownerDirectory, `${filename}.json`);
  }

  #writeOwnerHeartbeat(): void {
    const refreshedAt = new Date().toISOString();
    const heartbeat: DurableOwnerHeartbeat = {
      schemaVersion: 1,
      ...this.#ownerIdentity(),
      refreshedAt,
    };
    const target = this.#ownerHeartbeatPath(this.#ownerToken);
    const temporary = path.join(
      this.#ownerDirectory,
      `.${path.basename(target)}.${randomUUID()}.tmp`,
    );
    try {
      writeFileSync(temporary, JSON.stringify(heartbeat), {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      renameSync(temporary, target);
      chmodSync(target, 0o600);
    } finally {
      rmSync(temporary, { force: true });
    }
  }

  #readOwnerHeartbeat(
    ownerToken: string,
  ): DurableOwnerHeartbeat | undefined {
    try {
      const value = JSON.parse(
        readFileSync(this.#ownerHeartbeatPath(ownerToken), "utf8"),
      ) as Partial<DurableOwnerHeartbeat>;
      if (
        value.schemaVersion !== 1 ||
        typeof value.ownerToken !== "string" ||
        !Number.isSafeInteger(value.ownerPid) ||
        typeof value.leaseUntil !== "string" ||
        typeof value.refreshedAt !== "string"
      ) {
        return undefined;
      }
      return value as DurableOwnerHeartbeat;
    } catch {
      return undefined;
    }
  }

  async get(key: string): Promise<CachedEvaluation | undefined> {
    await this.#recovery;
    const lookup = await this.#cache.lookup(
      key as Sha256Digest,
      (entry) => this.#cacheReferencesValid(entry),
    );
    if (lookup.disposition !== "hit") return undefined;
    return lookup.entry.value as unknown as CachedEvaluation;
  }

  #cacheReferencesValid(
    entry: import("@verify-internal/execution").StoredCacheEntry,
  ): boolean {
    const value = entry.value as unknown as CachedEvaluation;
    const provenance = value.provenance;
    if (
      provenance === undefined ||
      refKey(entry.model) !== refKey(provenance.model) ||
      provenance.proofExecutions.length === 0 ||
      entry.originatingExecutionId !==
        provenance.proofExecutions[0]?.attemptId ||
      provenance.proofs.length === 0 ||
      provenance.proofs.length !== provenance.proofExecutions.length ||
      provenance.proofExecutions.some((execution) =>
        !provenance.proofs.some((proof) =>
          refKey(proof) === refKey(execution.proof)
        )
      ) ||
      !provenance.proofs.some((proof) =>
        refKey(proof) === refKey(entry.proof)
      )
    ) {
      return false;
    }
    const evidenceRefs = provenance.evidenceRecords.map((evidence) => ({
      kind: "evidence" as const,
      id: evidence.id,
      revision: evidence.revision,
      schemaVersion: evidence.schemaVersion,
    }));
    if (
      evidenceRefs.length === 0 ||
      provenance.proofExecutions.some((execution) =>
        execution.evidence.some((reference) =>
          !evidenceRefs.some((candidate) =>
            refKey(candidate) === refKey(reference)
          )
        )
      ) ||
      entry.evidenceRefs.length !== evidenceRefs.length ||
      entry.validationEventIds.length !==
        provenance.validationEventIds.length ||
      entry.evidenceRefs.some((reference) =>
        !evidenceRefs.some((candidate) =>
          refKey(candidate) === refKey(reference)
        )
      ) ||
      entry.validationEventIds.some((eventId) =>
        !provenance.validationEventIds.includes(eventId)
      )
    ) {
      return false;
    }
    const revisionRefs = [
      provenance.model,
      ...provenance.proofs,
      ...evidenceRefs,
    ];
    if (
      revisionRefs.some((reference) =>
        this.#unitOfWork.readRevision(reference) === undefined
      )
    ) {
      return false;
    }
    const evidenceKeys = new Set(evidenceRefs.map(refKey));
    for (const eventId of provenance.validationEventIds) {
      const event = this.#unitOfWork.readEvent(eventId);
      if (
        event?.eventType !== "EvidenceValidated" ||
        event.subject === undefined ||
        !evidenceKeys.has(refKey(event.subject))
      ) {
        return false;
      }
    }
    const originatingEvents = this.#unitOfWork.readInvocation(
      provenance.originatingInvocationId,
    );
    if (
      !originatingEvents.some((event) =>
        event.eventType === "VerificationInvocationCompleted"
      )
    ) {
      return false;
    }
    for (const execution of provenance.proofExecutions) {
      const retained = originatingEvents.find((event) =>
        event.eventType === "ProofExecutionCompleted" &&
        (event.payload as { readonly attemptId?: string }).attemptId ===
          execution.attemptId
      );
      if (
        retained === undefined ||
        canonicalize(retained.payload) !==
          canonicalize(execution as unknown as CanonicalValue)
      ) {
        return false;
      }
    }
    return true;
  }

  async publish(
    key: string,
    value: CachedEvaluation,
  ): Promise<"published" | "existing"> {
    const provenance = value.provenance;
    if (
      provenance === undefined ||
      provenance.proofs.length === 0 ||
      provenance.proofExecutions.length === 0
    ) {
      throw new TypeError(
        "cache publication requires exact canonical provenance",
      );
    }
    const events = this.#unitOfWork.readInvocation(
      provenance.originatingInvocationId,
    );
    const evidenceRefs = provenance.evidenceRecords.map((evidence) => ({
      kind: "evidence" as const,
      id: evidence.id,
      revision: evidence.revision,
      schemaVersion: evidence.schemaVersion,
    }));
    const evidenceKeys = new Set(evidenceRefs.map(refKey));
    const validationEventIds = events
      .filter((event) =>
        event.eventType === "EvidenceValidated" &&
        event.subject !== undefined &&
        evidenceKeys.has(refKey(event.subject))
      )
      .map((event) => event.eventId);
    if (
      evidenceRefs.length === 0 ||
      validationEventIds.length !== evidenceRefs.length
    ) {
      throw new TypeError(
        "cache publication requires validated canonical Evidence",
      );
    }
    const enrichedValue: CachedEvaluation = {
      ...value,
      provenance: {
        ...provenance,
        validationEventIds,
      },
    };
    const entry: CacheEntryPayload = {
      schemaVersion: 1,
      planKey: key as Sha256Digest,
      proof: provenance.proofs[0] as RevisionRef,
      model: provenance.model,
      originatingExecutionId:
        (provenance.proofExecutions[0] as
          import("./canonical-runtime.js").CanonicalProofExecution).attemptId,
      originatingResultDigest: value.proofSuite.resultDigest,
      evidenceRefs,
      validationEventIds,
      reproducibility: "replayable",
      value: enrichedValue as unknown as CanonicalValue,
    };
    const published = await this.#cache.publish(entry, randomUUID());
    const createdAt = this.#now().toISOString() as Rfc3339Utc;
    this.#projections.putCacheMetadata({
      planKey: key as Sha256Digest,
      originatingExecutionId: entry.originatingExecutionId,
      byteSize: Buffer.byteLength(canonicalize(entry.value)),
      createdAt,
    });
    return published.wonPublication ? "published" : "existing";
  }

  async append(
    result: VerifyResult,
    evidence: import("@verify-internal/evidence").NormalizedEvidence | undefined,
  ): Promise<void> {
    await this.#recovery;
    const retainedHistory = this.#unitOfWork.readInvocation(
      result.invocationId as OpaqueId,
    );
    if (
      retainedHistory.some((event) =>
        event.eventType === "VerificationInvocationAbandoned"
      )
    ) {
      throw new EngineUnitOfWorkConflict(
        "IDEMPOTENCY_CONFLICT",
        `abandoned invocation ${result.invocationId} cannot be completed`,
      );
    }
    const occurredAt = this.#now().toISOString() as Rfc3339Utc;
    const terminalKey =
      `history:${result.invocationId}:terminal` as OpaqueId;
    const acceptedTerminal =
      this.#unitOfWork.readAcceptedCommit(terminalKey);
    if (
      acceptedTerminal === undefined &&
      retainedHistory.some((event) =>
        event.eventType === "VerificationInvocationCompleted"
      )
    ) {
      throw new EngineUnitOfWorkConflict(
        "IDEMPOTENCY_CONFLICT",
        `invocation ${result.invocationId} already has an unrecognized terminal event`,
      );
    }
    const firstSequence = acceptedTerminal?.expectedNextSequence ??
      (retainedHistory.length + 1);
    const events = terminalHistoryEvents(
      result,
      occurredAt,
      evidence,
      firstSequence,
    );
    const unit: EngineUnitOfWorkCommit = {
      idempotencyKey: terminalKey,
      invocationId: result.invocationId as OpaqueId,
      expectedNextSequence: firstSequence,
      revisions: [],
      events,
      referenceEdges: [],
      currentRevisionMutations: [],
    };
    if (acceptedTerminal === undefined) {
      await this.#unitOfWork.commit(unit);
      this.#projectionFault?.("after-canonical-commit");
    } else {
      const retainedTerminal = acceptedTerminal.events[0];
      if (
        retainedTerminal === undefined ||
        canonicalize(retainedTerminal.payload) !==
          canonicalize(events[0]?.payload as CanonicalValue)
      ) {
        throw new EngineUnitOfWorkConflict(
          "IDEMPOTENCY_CONFLICT",
          `terminal result ${result.invocationId} changed`,
        );
      }
    }
    if (evidence !== undefined) {
      this.#projectionFault?.("before-legacy-evidence-projection");
      await this.#projections.appendEvidence({
        evidenceId: evidence.id as OpaqueId,
        metadata: {
          schemaVersion: evidence.schemaVersion,
          id: evidence.id,
          revision: evidence.revision,
          evidenceType: evidence.evidenceType,
          mediaType: evidence.mediaType,
          contentDigest: evidence.contentDigest,
          byteSize: evidence.byteSize,
          classification: evidence.classification,
          redactions: evidence.redactions,
        },
        body: evidence.body,
      }, `evidence-${randomUUID()}`);
      for (const record of result.evidenceRecords) {
        this.#projectionFault?.("before-canonical-evidence-projection");
        await this.#projections.appendEvidence({
          evidenceId: record.id,
          metadata: canonical(record),
          body: evidence.body,
        }, `canonical-evidence-${randomUUID()}`);
      }
    }
    this.#projectionFault?.("before-run-projection");
    this.#projections.appendRun({
      invocationId: result.invocationId as OpaqueId,
      result: result as unknown as CanonicalValue,
    });
  }

  readRun(invocationId: string): CanonicalValue | undefined {
    const id = invocationId as OpaqueId;
    const projected = this.#projections.readRun(id)?.result;
    if (projected !== undefined) return projected;
    this.#reconcileRunProjection(id);
    return this.#projections.readRun(id)?.result;
  }

  #terminalEvent(
    invocationId: OpaqueId,
  ): EventEnvelope<string, CanonicalValue> | undefined {
    return this.#unitOfWork.readInvocation(invocationId).find(
      (event) => event.eventType === "VerificationInvocationCompleted",
    ) as EventEnvelope<string, CanonicalValue> | undefined;
  }

  #reconcileRunProjection(invocationId: OpaqueId): void {
    const terminal = this.#terminalEvent(invocationId);
    if (terminal === undefined) return;
    const payload = terminal.payload as {
      readonly result?: CanonicalValue;
    };
    if (payload.result === undefined) return;
    this.#projections.appendRun({
      invocationId,
      result: payload.result,
    });
  }

  #reconcileRunProjections(): void {
    for (const invocationId of this.#unitOfWork.listInvocationIds()) {
      if (this.#projections.readRun(invocationId) === undefined) {
        this.#reconcileRunProjection(invocationId);
      }
    }
  }

  readHistoryEvents(
    invocationId: string,
  ): readonly EventEnvelope<string, CanonicalValue>[] {
    return this.#unitOfWork.readInvocation(invocationId as OpaqueId);
  }

  readCanonicalRevision(
    reference: RevisionRef,
  ): RevisionDocument | undefined {
    return this.#unitOfWork.readRevision(reference);
  }

  readHistoryEdges(): readonly ReferenceEdge[] {
    return this.#unitOfWork.readReferenceEdges();
  }

  readCurrentRevision(slot: string): RevisionRef | null {
    return this.#unitOfWork.readCurrentRevision(slot);
  }

  async readEvidence(evidenceId: string): Promise<CanonicalValue | undefined> {
    await this.#recovery;
    const id = evidenceId as OpaqueId;
    let projection = await this.#projections.readEvidence(id);
    if (projection === undefined) {
      await this.#reconcileEvidenceProjection(id);
      projection = await this.#projections.readEvidence(id);
    }
    return projection as unknown as CanonicalValue | undefined;
  }

  async #reconcileEvidenceProjection(evidenceId: OpaqueId): Promise<void> {
    for (const invocationId of this.#unitOfWork.listInvocationIds()) {
      for (const event of this.#unitOfWork.readInvocation(invocationId)) {
        if (event.eventType === "EvidenceCaptured") {
          const payload = event.payload as {
            readonly record?: { readonly id?: string };
            readonly body?: CanonicalValue;
          };
          if (
            payload.record?.id === evidenceId &&
            payload.body !== undefined &&
            payload.body !== null
          ) {
            await this.#projections.appendEvidence({
              evidenceId,
              metadata: canonical(payload.record),
              body: payload.body,
            }, `reconcile-canonical-${randomUUID()}`);
            return;
          }
        }
        if (event.eventType === "VerificationInvocationCompleted") {
          const payload = event.payload as {
            readonly projectionEvidence?: {
              readonly evidenceId?: string;
              readonly metadata?: CanonicalValue;
              readonly body?: CanonicalValue;
            } | null;
          };
          const retained = payload.projectionEvidence;
          if (
            retained?.evidenceId === evidenceId &&
            retained.metadata !== undefined &&
            retained.body !== undefined
          ) {
            await this.#projections.appendEvidence({
              evidenceId,
              metadata: retained.metadata,
              body: retained.body,
            }, `reconcile-legacy-${randomUUID()}`);
            return;
          }
        }
      }
    }
  }

  inspectCache(): CanonicalValue {
    return {
      schemaVersion: 1,
      entries: this.#projections.listCacheMetadata() as unknown as CanonicalValue,
    };
  }

  async clearCache(): Promise<CanonicalValue> {
    const before = this.#projections.listCacheMetadata().length;
    await this.#cache.clear();
    this.#projections.clearCacheMetadata();
    return {
      schemaVersion: 1,
      clearedEntries: before,
      historyPreserved: true,
    };
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    clearInterval(this.#ownerHeartbeat);
    activeLocalOwnerTokens.delete(this.#ownerToken);
    rmSync(this.#ownerHeartbeatPath(this.#ownerToken), { force: true });
    this.#unitOfWork.close();
    this.#projections.close();
  }
}
