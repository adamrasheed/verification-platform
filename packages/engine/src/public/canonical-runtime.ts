import { createHash } from "node:crypto";
import { arch, platform } from "node:os";
import {
  canonicalize,
  type CanonicalValue,
  type Confidence,
  type Evidence,
  type ExecutionManifest,
  type ExecutionPlan,
  type OpaqueId,
  type PermissionRequest,
  type ProducerRef,
  type ProofAttemptRef,
  type RepairSuggestion as ContractRepairSuggestion,
  type RevisionDocument,
  type RevisionRef,
  type Rfc3339Utc,
  type Sha256Digest,
} from "@verify-internal/contracts";
import type {
  SealedWorkspaceModel,
  WorkspaceDiscovery,
} from "@verify-internal/discovery";
import type { NormalizedEvidence } from "@verify-internal/evidence";
import type {
  ProofEvaluation,
  ProofStatus,
} from "@verify-internal/proofs";
import type {
  RepairSuggestion as LegacyRepairSuggestion,
} from "@verify-internal/repair";

export type CanonicalProofResult =
  | {
      readonly status: "passed";
      readonly evidence: readonly RevisionRef[];
    }
  | {
      readonly status: "failed";
      readonly evidence: readonly RevisionRef[];
      readonly reasonCodes: readonly string[];
    }
  | {
      readonly status: "indeterminate";
      readonly evidence: readonly RevisionRef[];
      readonly reasonCodes: readonly string[];
    }
  | {
      readonly status: "error";
      readonly error: {
        readonly code: string;
        readonly message: string;
      };
    }
  | {
      readonly status: "cancelled";
      readonly reason: "caller" | "deadline" | "shutdown";
    };

/**
 * Canonical Proof attempt projection from EDD §10. Attempts are event-sourced
 * records rather than revision documents, so every exact input reference and
 * both stable/complete digests are retained here.
 */
export interface CanonicalProofExecution {
  readonly attemptId: OpaqueId;
  readonly attemptRef: ProofAttemptRef;
  readonly promise: RevisionRef;
  readonly proof: RevisionRef;
  readonly model: RevisionRef;
  readonly executionContext: RevisionRef;
  readonly executionManifest: RevisionRef;
  readonly planKey: Sha256Digest;
  readonly state: ProofStatus;
  readonly effective: boolean;
  readonly startedAt: Rfc3339Utc;
  readonly completedAt: Rfc3339Utc;
  readonly evidence: readonly RevisionRef[];
  readonly result: CanonicalProofResult;
  readonly resultDigest: Sha256Digest;
  readonly attemptRecordDigest: Sha256Digest;
  readonly cachedFromExecution?: OpaqueId;
  readonly validationEventIds: readonly OpaqueId[];
}

export interface CanonicalPromiseResult {
  readonly promise: RevisionRef;
  readonly status: "satisfied" | "violated" | "indeterminate";
  readonly proofAttempts: readonly ProofAttemptRef[];
  readonly evidence: readonly RevisionRef[];
  readonly reasonCodes: readonly string[];
}

export interface CanonicalPromiseEvaluation {
  readonly promises: readonly CanonicalPromiseResult[];
  readonly summary: {
    readonly requiredPromiseCount: number;
    readonly advisoryPromiseCount: number;
    readonly satisfiedCount: number;
    readonly violatedCount: number;
    readonly indeterminateCount: number;
  };
  readonly outcome: "satisfied" | "violated" | "indeterminate";
}

export interface CanonicalRuntimeRecords extends CanonicalPromiseEvaluation {
  readonly proofExecutions: readonly CanonicalProofExecution[];
  readonly evidenceRecords: readonly Evidence[];
  readonly repairRecords: readonly ContractRepairSuggestion[];
  readonly executionManifests: readonly ExecutionManifest[];
  readonly revisionDocuments: readonly RevisionDocument<CanonicalValue>[];
  readonly executionPlan?: ExecutionPlan;
  readonly executionContext?: RevisionRef;
}

export interface CanonicalRuntimeInput {
  readonly invocationId: string;
  readonly occurredAt: Rfc3339Utc;
  readonly graph: SealedWorkspaceModel;
  readonly discovery: WorkspaceDiscovery;
  readonly evidence: NormalizedEvidence;
  readonly evaluations: readonly ProofEvaluation[];
  readonly repairs: readonly LegacyRepairSuggestion[];
  readonly engine: ProducerRef;
  readonly cachedProvenance?: {
    readonly originatingInvocationId: OpaqueId;
    readonly model: RevisionRef;
    readonly proofs: readonly RevisionRef[];
    readonly proofExecutions: readonly CanonicalProofExecution[];
    readonly evidenceRecords: readonly Evidence[];
    readonly validationEventIds: readonly OpaqueId[];
  };
}

function digest(value: CanonicalValue): Sha256Digest {
  return `sha256:${createHash("sha256").update(canonicalize(value)).digest("hex")}`;
}

function canonical(value: unknown): CanonicalValue {
  return JSON.parse(JSON.stringify(value)) as CanonicalValue;
}

function ref(
  kind: RevisionRef["kind"],
  value: {
    readonly id: string;
    readonly revision: Sha256Digest;
    readonly schemaVersion: number;
  },
): RevisionRef {
  return {
    kind,
    id: value.id as OpaqueId,
    revision: value.revision,
    schemaVersion: value.schemaVersion,
  };
}

function document(
  kind: RevisionRef["kind"],
  id: OpaqueId,
  payload: CanonicalValue,
): RevisionDocument<CanonicalValue> {
  return {
    kind,
    id,
    revision: digest({
      domain: "verification-platform/revision",
      id,
      kind,
      payload,
      schemaVersion: 1,
    }),
    schemaVersion: 1,
    payload,
  };
}

function existingDocument(
  kind: RevisionRef["kind"],
  value: {
    readonly id: OpaqueId;
    readonly revision: Sha256Digest;
    readonly schemaVersion: number;
  },
): RevisionDocument<CanonicalValue> {
  const {
    id: _id,
    revision: _revision,
    schemaVersion: _schemaVersion,
    ...payload
  } = value;
  return {
    kind,
    id: value.id,
    revision: value.revision,
    schemaVersion: value.schemaVersion,
    payload: canonical(payload),
  };
}

function graphDocuments(
  graph: SealedWorkspaceModel,
): readonly RevisionDocument<CanonicalValue>[] {
  return [
    ...graph.applications.map((value) => existingDocument("application", value)),
    ...graph.capabilities.map((value) => existingDocument("capability", value)),
    ...graph.promises.map((value) => existingDocument("promise", value)),
    ...graph.proofs.map((value) => existingDocument("proof", value)),
    ...graph.bindings.map((value) =>
      existingDocument("promiseProofBinding", value)
    ),
    existingDocument("applicationModel", graph.model),
  ];
}

function isApplicable(expression: CanonicalValue): boolean {
  return expression === true;
}

function sameRevision(
  left: RevisionRef,
  right: RevisionRef,
): boolean {
  return left.kind === right.kind &&
    left.id === right.id &&
    left.revision === right.revision &&
    left.schemaVersion === right.schemaVersion;
}

function uniqueRefs<T extends RevisionRef | ProofAttemptRef>(
  values: readonly T[],
  key: (value: T) => string,
): readonly T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const identity = key(value);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function derivePromiseResults(
  graph: SealedWorkspaceModel,
  executions: readonly CanonicalProofExecution[],
): readonly CanonicalPromiseResult[] {
  return graph.promises.map((promise) => {
    const promiseRef = ref("promise", promise);
    const applicableBindings = graph.bindings.filter((binding) =>
      sameRevision(binding.promise, promiseRef) &&
      isApplicable(binding.applicability.expression)
    );
    const requiredBindings = applicableBindings.filter(
      (binding) => binding.requirement === "required",
    );
    const applicableExecutions = executions.filter((execution) =>
      execution.effective &&
      sameRevision(execution.promise, promiseRef) &&
      applicableBindings.some((binding) =>
        sameRevision(binding.proof, execution.proof)
      )
    );
    const requiredExecutions = applicableExecutions.filter((execution) =>
      requiredBindings.some((binding) =>
        sameRevision(binding.proof, execution.proof)
      )
    );
    const reasonCodes: string[] = [];
    const addReason = (reason: string): void => {
      if (!reasonCodes.includes(reason)) reasonCodes.push(reason);
    };
    let status: CanonicalPromiseResult["status"];
    if (!isApplicable(promise.applicability.expression)) {
      status = "indeterminate";
      addReason("PROMISE_NOT_APPLICABLE");
    } else if (requiredBindings.length === 0) {
      status = "indeterminate";
      addReason("NO_APPLICABLE_REQUIRED_PROOF");
    } else if (
      requiredExecutions.some((execution) =>
        execution.result.status === "failed"
      )
    ) {
      status = "violated";
    } else if (
      requiredExecutions.length === requiredBindings.length &&
      requiredExecutions.every((execution) =>
        execution.result.status === "passed"
      )
    ) {
      status = "satisfied";
    } else {
      status = "indeterminate";
      if (requiredExecutions.length < requiredBindings.length) {
        addReason("REQUIRED_PROOF_NOT_EXECUTED");
      }
    }
    for (const execution of requiredExecutions) {
      switch (execution.result.status) {
        case "failed":
        case "indeterminate":
          for (const reason of execution.result.reasonCodes) addReason(reason);
          break;
        case "error":
          addReason(execution.result.error.code);
          break;
        case "cancelled":
          addReason(`PROOF_CANCELLED_${execution.result.reason.toUpperCase()}`);
          break;
        case "passed":
          break;
      }
    }
    return {
      promise: promiseRef,
      status,
      proofAttempts: uniqueRefs(
        applicableExecutions.map((execution) => execution.attemptRef),
        (attempt) =>
          `${attempt.attemptId}\u0000${attempt.proof.revision}\u0000${attempt.invocationId}`,
      ),
      evidence: uniqueRefs(
        applicableExecutions.flatMap((execution) => execution.evidence),
        (evidence) =>
          `${evidence.kind}\u0000${evidence.id}\u0000${evidence.revision}\u0000${evidence.schemaVersion}`,
      ),
      reasonCodes,
    };
  });
}

function promiseSummary(
  graph: SealedWorkspaceModel,
  results: readonly CanonicalPromiseResult[],
): CanonicalRuntimeRecords["summary"] {
  return {
    requiredPromiseCount: graph.promises.filter(
      (promise) => promise.criticality === "required",
    ).length,
    advisoryPromiseCount: graph.promises.filter(
      (promise) => promise.criticality === "advisory",
    ).length,
    satisfiedCount: results.filter((result) =>
      result.status === "satisfied"
    ).length,
    violatedCount: results.filter((result) =>
      result.status === "violated"
    ).length,
    indeterminateCount: results.filter((result) =>
      result.status === "indeterminate"
    ).length,
  };
}

function verificationOutcome(
  graph: SealedWorkspaceModel,
  results: readonly CanonicalPromiseResult[],
): CanonicalRuntimeRecords["outcome"] {
  const required = results.filter((result) =>
    graph.promises.some((promise) =>
      promise.criticality === "required" &&
      sameRevision(ref("promise", promise), result.promise)
    )
  );
  if (required.some((result) => result.status === "violated")) {
    return "violated";
  }
  if (
    required.length > 0 &&
    required.every((result) => result.status === "satisfied")
  ) {
    return "satisfied";
  }
  return "indeterminate";
}

export function deriveCanonicalPromiseEvaluation(
  graph: SealedWorkspaceModel,
  executions: readonly CanonicalProofExecution[],
): CanonicalPromiseEvaluation {
  const promises = derivePromiseResults(graph, executions);
  return {
    promises,
    summary: promiseSummary(graph, promises),
    outcome: verificationOutcome(graph, promises),
  };
}

function proofResult(
  status: ProofStatus,
  evidence: readonly RevisionRef[],
  reasonCodes: readonly string[],
): CanonicalProofResult {
  switch (status) {
    case "passed":
      return { status, evidence };
    case "failed":
    case "indeterminate":
      return { status, evidence, reasonCodes };
    case "error":
      return {
        status,
        error: {
          code: reasonCodes[0] ?? "PROOF_EXECUTION_ERROR",
          message: "The Proof evaluator could not complete safely.",
        },
      };
    case "cancelled":
      return { status, reason: "caller" };
  }
}

function repairAction(
  repair: LegacyRepairSuggestion,
  evidence: Evidence,
): ContractRepairSuggestion["action"] {
  if (repair.action.kind === "json_patch") {
    return {
      kind: "jsonPatch",
      target: repair.action.target,
      expectedContentDigest: evidence.contentDigest,
      operations: repair.action.operations.map((operation) => ({
        operation: operation.op,
        pointer: operation.path,
        ...(operation.value === undefined ? {} : { value: operation.value }),
      })),
    };
  }
  return {
    kind: "advisoryInstruction",
    instructionCode: "VERIFY_MANUAL_REPAIR",
    parameters: {
      target: repair.action.target,
      instruction:
        repair.action.instruction ?? "Review the failed Proof and its Evidence.",
    },
  };
}

export function buildCanonicalRuntimeRecords(
  input: CanonicalRuntimeInput,
): CanonicalRuntimeRecords {
  const modelRef = ref("applicationModel", input.graph.model);
  const discoveryOutputDigest = digest(canonical({
    workspaceBinding: input.discovery.workspaceBinding,
    modelRevision: input.discovery.modelRevision,
    manifests: input.discovery.manifests,
    lockfiles: input.discovery.lockfiles,
    packageManagers: input.discovery.packageManagers,
    conflicts: input.discovery.conflicts,
    completion: input.discovery.completion,
  }));
  const contextId =
    `context:${digest(canonical({
      domain: "verification-platform/local-execution-context",
      model: modelRef,
      policy: "passive-offline-v1",
    })).slice("sha256:".length)}` as OpaqueId;
  const contextDocument = document("executionContext", contextId, {
    applicationModel: modelRef as unknown as CanonicalValue,
    authority: "local-os-principal",
    isolationProfile: "passive-offline-v1",
    offline: true,
  });
  const contextRef = ref("executionContext", contextDocument);
  const plannedProofs = input.graph.bindings.map((binding) => ({
    binding: ref("promiseProofBinding", binding),
    promise: binding.promise,
    proof: binding.proof,
    requirement: binding.requirement,
    order: binding.order,
    dependencyProofs:
      input.graph.proofs.find((proof) => proof.id === binding.proof.id)
        ?.dependencies ?? [],
  }));
  const planId =
    `plan:${digest(canonical({
      domain: "verification-platform/execution-plan-id",
      applicationModel: modelRef,
      executionContext: contextRef,
      proofs: plannedProofs,
      discoveryOutputDigest,
    })).slice("sha256:".length)}` as OpaqueId;
  const planFields = {
    applicationModel: modelRef,
    executionContext: contextRef,
    proofs: plannedProofs,
    discoveryOutputDigest,
  };
  const planDocument = document(
    "executionPlan",
    planId,
    canonical(planFields),
  );
  const executionPlan: ExecutionPlan = {
    id: planDocument.id,
    revision: planDocument.revision,
    schemaVersion: 1,
    ...planFields,
  };
  const planRef = ref("executionPlan", planDocument);
  const configurationDigest = digest({
    domain: "verification-platform/configuration",
    profile: "mvp-default",
  });
  const policyDigest = digest({
    domain: "verification-platform/policy",
    profile: "passive-offline-v1",
  });
  const runtimeIdentity = {
    id: "node",
    version: process.version,
    artifactDigest: digest({
      domain: "verification-platform/runtime",
      id: "node",
      version: process.version,
    }),
  };

  const evidenceRecords: Evidence[] = [];
  const executionManifests: ExecutionManifest[] = [];
  const manifestDocuments: RevisionDocument<CanonicalValue>[] = [];
  const evidenceDocuments: RevisionDocument<CanonicalValue>[] = [];
  const proofExecutions: CanonicalProofExecution[] = [];

  for (const [index, evaluation] of input.evaluations.entries()) {
    const binding = input.graph.bindings.find(
      (candidate) => candidate.proof.id === evaluation.proofId,
    ) ?? input.graph.bindings[index];
    if (binding === undefined) continue;
    const proofRef = binding.proof;
    const promiseRef = binding.promise;
    const attemptId =
      `attempt:${digest(canonical({
        domain: "verification-platform/proof-attempt",
        invocationId: input.invocationId,
        proof: proofRef,
        ordinal: index,
      })).slice("sha256:".length)}` as OpaqueId;
    const attemptRef: ProofAttemptRef = {
      attemptId,
      proof: proofRef,
      invocationId: input.invocationId as OpaqueId,
    };
    const reusedEvidence = input.cachedProvenance?.evidenceRecords.find(
      (candidate) =>
        candidate.attempt.proof.id === proofRef.id &&
        candidate.attempt.proof.revision === proofRef.revision,
    );
    let evidenceRecord: Evidence;
    let evidenceDocument: RevisionDocument<CanonicalValue>;
    if (reusedEvidence !== undefined) {
      evidenceRecord = reusedEvidence;
      evidenceDocument = existingDocument("evidence", reusedEvidence);
    } else {
      const evidenceId =
        `evidence:${digest(canonical({
          domain: "verification-platform/attempt-evidence-id",
          attempt: attemptRef,
          contentDigest: input.evidence.contentDigest,
        })).slice("sha256:".length)}` as OpaqueId;
      const evidenceFields = {
        evidenceType: input.evidence.evidenceType,
        mediaType: input.evidence.mediaType,
        producer: input.engine,
        captureMethod: "engine-native-passive-workspace-observation",
        capturedAt: input.occurredAt,
        attempt: attemptRef,
        subjects: input.graph.model.applications,
        inputRefs: [modelRef],
        contentDigest: input.evidence.contentDigest,
        byteSize: input.evidence.byteSize as Evidence["byteSize"],
        classification: input.evidence.classification,
        chainOfCustody: [
          {
            sequence: 0,
            action: "captured" as const,
            actor: input.engine,
            outputDigest: input.evidence.contentDigest,
            occurredAt: input.occurredAt,
          },
          {
            sequence: 1,
            action: "normalized" as const,
            actor: input.engine,
            inputDigest: input.evidence.contentDigest,
            outputDigest: input.evidence.contentDigest,
            occurredAt: input.occurredAt,
          },
          {
            sequence: 2,
            action: "classified" as const,
            actor: input.engine,
            inputDigest: input.evidence.contentDigest,
            outputDigest: input.evidence.contentDigest,
            occurredAt: input.occurredAt,
          },
          {
            sequence: 3,
            action: "redacted" as const,
            actor: input.engine,
            inputDigest: input.evidence.contentDigest,
            outputDigest: input.evidence.contentDigest,
            occurredAt: input.occurredAt,
          },
          {
            sequence: 4,
            action: "persisted" as const,
            actor: input.engine,
            inputDigest: input.evidence.contentDigest,
            outputDigest: input.evidence.contentDigest,
            occurredAt: input.occurredAt,
          },
        ],
        supersedes: [],
      };
      evidenceDocument = document(
        "evidence",
        evidenceId,
        canonical(evidenceFields),
      );
      evidenceRecord = {
        id: evidenceDocument.id,
        revision: evidenceDocument.revision,
        schemaVersion: 1,
        ...evidenceFields,
      };
    }
    const evidenceRef = ref("evidence", evidenceDocument);
    evidenceRecords.push(evidenceRecord);
    evidenceDocuments.push(evidenceDocument);

    const planKey = digest(canonical({
      domain: "verification-platform/proof-plan-key",
      executionPlan: planRef,
      proof: proofRef,
      model: modelRef,
      evidenceContentDigest: input.evidence.contentDigest,
    }));
    const manifestId = `manifest:${attemptId.slice("attempt:".length)}` as OpaqueId;
    const manifestFields = {
      engine: input.engine,
      applicationModel: modelRef,
      promises: [promiseRef],
      proof: proofRef,
      pluginsAndTools: [],
      source: {
        inputDigest: input.evidence.contentDigest,
        repositoryState: "unknown" as const,
      },
      configurationDigest,
      policyDigest,
      platform: {
        operatingSystem: platform(),
        architecture: arch(),
        runtimeVersions: [runtimeIdentity],
        toolchainVersions: [],
      },
      authenticationBindingIds: [],
      isolation: {
        filesystem: { mode: "read-only", boundary: input.discovery.workspaceBinding },
        network: { mode: "denied" },
        clock: { mode: "observed", capturedAt: input.occurredAt },
        randomness: { mode: "engine-owned-identifiers" },
        enforcementTier: "engine-native-passive",
      },
      discoveryOutputDigest,
      executionPlan: planRef,
      executionPlanDigest: planDocument.revision,
    };
    const manifestDocument = document(
      "executionManifest",
      manifestId,
      canonical(manifestFields),
    );
    const executionManifest: ExecutionManifest = {
      id: manifestDocument.id,
      revision: manifestDocument.revision,
      schemaVersion: 1,
      ...manifestFields,
    };
    executionManifests.push(executionManifest);
    manifestDocuments.push(manifestDocument);

    const result = proofResult(
      evaluation.status,
      [evidenceRef],
      evaluation.reasonCodes,
    );
    const resultDigest = digest(canonical({
      domain: "verification-platform/proof-result",
      proof: proofRef,
      promise: promiseRef,
      model: modelRef,
      result,
    }));
    const cachedFromExecution = reusedEvidence?.attempt.attemptId ??
      input.cachedProvenance?.proofExecutions.find(
        (candidate) =>
          candidate.proof.id === proofRef.id &&
          candidate.proof.revision === proofRef.revision,
      )?.attemptId;
    const recordWithoutDigest = {
      attemptId,
      attemptRef,
      promise: promiseRef,
      proof: proofRef,
      model: modelRef,
      executionContext: contextRef,
      executionManifest: ref("executionManifest", manifestDocument),
      planKey,
      state: evaluation.status,
      effective: true,
      startedAt: input.occurredAt,
      completedAt: input.occurredAt,
      evidence: [evidenceRef],
      result,
      resultDigest,
      ...(cachedFromExecution === undefined
        ? {}
        : { cachedFromExecution }),
      validationEventIds:
        input.cachedProvenance?.validationEventIds[index] === undefined
          ? []
          : [input.cachedProvenance.validationEventIds[index]],
    };
    proofExecutions.push({
      ...recordWithoutDigest,
      attemptRecordDigest: digest(canonical({
        domain: "verification-platform/proof-attempt-record",
        ...recordWithoutDigest,
      })),
    });
  }

  const repairRecords: ContractRepairSuggestion[] = [];
  const repairDocuments: RevisionDocument<CanonicalValue>[] = [];
  const verificationPlanDocuments: RevisionDocument<CanonicalValue>[] = [];
  for (const legacyRepair of input.repairs) {
    const execution = proofExecutions.find(
      (candidate) => candidate.proof.id === legacyRepair.motivatingProof,
    );
    if (execution === undefined) continue;
    const motivatingEvidence = evidenceRecords.find(
      (candidate) => candidate.attempt.attemptId === execution.attemptId,
    );
    if (motivatingEvidence === undefined) continue;
    const motivatingEvidenceRef = ref("evidence", motivatingEvidence);
    const verificationPlanId =
      `plan:repair:${legacyRepair.id.slice("repair:".length)}` as OpaqueId;
    const verificationPlanFields = {
      applicationModel: modelRef,
      executionContext: contextRef,
      proofs: plannedProofs.filter(
        (planned) => planned.proof.id === execution.proof.id,
      ),
      discoveryOutputDigest,
    };
    const verificationPlanDocument = document(
      "executionPlan",
      verificationPlanId,
      canonical(verificationPlanFields),
    );
    verificationPlanDocuments.push(verificationPlanDocument);
    const permissions: PermissionRequest = {
      filesystem: [{
        mode: "write",
        root: legacyRepair.action.target,
      }],
      network: [],
      subprocess: false,
      secrets: [],
    };
    const confidence: Confidence = {
      value: 1 as Confidence["value"],
      basis: "deterministic_rule",
      ruleId: `repair:${legacyRepair.action.kind}:v1`,
      signalRefs: [],
    };
    const repairFields = {
      motivatingPromise: execution.promise,
      motivatingExecution: execution.attemptRef,
      evidence: [motivatingEvidenceRef],
      generator: input.engine,
      action: repairAction(legacyRepair, motivatingEvidence),
      assumptions: legacyRepair.assumptions,
      requiredPermissions: permissions,
      expectedEffect: legacyRepair.expectedEffect,
      confidence,
      verificationPlan: ref("executionPlan", verificationPlanDocument),
    };
    const repairDocument = document(
      "repair",
      legacyRepair.id as OpaqueId,
      canonical(repairFields),
    );
    repairDocuments.push(repairDocument);
    repairRecords.push({
      id: repairDocument.id,
      revision: repairDocument.revision,
      schemaVersion: 1,
      ...repairFields,
    });
  }

  const promiseEvaluation = deriveCanonicalPromiseEvaluation(
    input.graph,
    proofExecutions,
  );
  return {
    ...promiseEvaluation,
    proofExecutions,
    evidenceRecords,
    repairRecords,
    executionManifests,
    revisionDocuments: [
      ...graphDocuments(input.graph),
      contextDocument,
      planDocument,
      ...verificationPlanDocuments,
      ...manifestDocuments,
      ...evidenceDocuments,
      ...repairDocuments,
    ],
    executionPlan,
    executionContext: contextRef,
  };
}
