import { createHash, randomUUID } from "node:crypto";
import { authorize, passiveCliPolicy } from "@verify-internal/auth";
import type { AuthorityPolicy, LocalPrincipal } from "@verify-internal/auth";
import { canonicalize } from "@verify-internal/contracts";
import type {
  CanonicalValue,
  Evidence,
  ExecutionManifest,
  ExecutionPlan,
  OpaqueId,
  ProducerRef,
  RepairSuggestion as ContractRepairSuggestion,
  RevisionDocument,
  RevisionRef,
  Rfc3339Utc,
} from "@verify-internal/contracts";
import {
  discoverWorkspace,
  resolveAndSealWorkspaceModel,
} from "@verify-internal/discovery";
import type { DiscoveryLimits, WorkspaceDiscovery } from "@verify-internal/discovery";
import {
  normalizeWorkspaceEvidence,
  validateEvidence,
} from "@verify-internal/evidence";
import type { NormalizedEvidence } from "@verify-internal/evidence";
import {
  evaluateWorkspaceProofs,
  MVP_PROOF_REGISTRY,
} from "@verify-internal/proofs";
import type { ProofEvaluation, ProofSuiteResult } from "@verify-internal/proofs";
import { suggestRepairs } from "@verify-internal/repair";
import type { RepairSuggestion } from "@verify-internal/repair";
import type { ReferenceEdge } from "@verify-internal/events";
import {
  buildCanonicalRuntimeRecords,
  type CanonicalPromiseResult,
  type CanonicalProofExecution,
  type CanonicalRuntimeRecords,
} from "./canonical-runtime.js";
export { deriveCanonicalPromiseEvaluation } from "./canonical-runtime.js";
export {
  createEnginePluginRuntime,
  createEngineProviderEgressBroker,
} from "./plugin-services.js";

export const ENGINE_VERSION = "0.2.0";
export const ENGINE_ARTIFACT_DIGEST: `sha256:${string}` = `sha256:${createHash("sha256")
  .update(`@verify-internal/engine@${ENGINE_VERSION}`)
  .digest("hex")}`;
const ENGINE_PRODUCER: ProducerRef = {
  id: "@verify-internal/engine" as OpaqueId,
  version: ENGINE_VERSION,
  artifactDigest: ENGINE_ARTIFACT_DIGEST,
};

export type OperationalStatus =
  | "completed"
  | "blocked"
  | "cancelled"
  | "invalid"
  | "internal_error";

export type VerificationOutcome =
  | "satisfied"
  | "violated"
  | "indeterminate"
  | "not_evaluated";

export interface VerifyRequest {
  readonly schemaVersion: 1;
  readonly workspaceRoot: string;
  readonly invocationId?: string;
  readonly deadlineMs?: number;
  readonly discoveryLimits?: Partial<DiscoveryLimits>;
  readonly signal?: AbortSignal;
  readonly principal?: LocalPrincipal;
  readonly authorityPolicy?: AuthorityPolicy;
}

export interface EngineLifecycleEvent {
  readonly sequence: number;
  readonly type: string;
  readonly stage:
    | "preflight"
    | "discovery_plan"
    | "discover"
    | "resolve"
    | "seal"
    | "plan"
    | "authorize"
    | "execute"
    | "capture"
    | "evaluate"
    | "repair"
    | "report";
  readonly status: "started" | "completed" | "skipped" | "failed";
  readonly reasonCode?: string;
}

export interface VerifyResult {
  readonly kind: "verify";
  readonly schemaVersion: 1;
  readonly engineVersion: string;
  readonly invocationId: string;
  readonly operationalStatus: OperationalStatus;
  readonly outcome: VerificationOutcome;
  readonly workspace: {
    readonly binding?: string;
    readonly packageManager?: string;
    readonly modelRevision?: string;
  };
  readonly applicationModel?: {
    readonly kind: "applicationModel";
    readonly id: string;
    readonly revision: `sha256:${string}`;
    readonly schemaVersion: 1;
  };
  readonly summary: {
    readonly requiredPromiseCount: number;
    readonly advisoryPromiseCount: number;
    readonly satisfiedCount: number;
    readonly violatedCount: number;
    readonly indeterminateCount: number;
  };
  readonly promises: readonly CanonicalPromiseResult[];
  readonly proofExecutions: readonly CanonicalProofExecution[];
  readonly proofs: readonly ProofEvaluation[];
  readonly evidenceRecords: readonly Evidence[];
  readonly evidence: readonly {
    readonly id: string;
    readonly revision: string;
    readonly evidenceType: string;
    readonly classification: string;
    readonly byteSize: number;
    readonly validation: "valid" | "rejected";
  }[];
  readonly repairRecords: readonly ContractRepairSuggestion[];
  readonly repairs: readonly RepairSuggestion[];
  readonly executionManifests: readonly ExecutionManifest[];
  readonly revisionDocuments: readonly RevisionDocument<CanonicalValue>[];
  readonly executionPlan?: ExecutionPlan;
  readonly executionContext?: RevisionRef;
  readonly reasonCodes: readonly string[];
  readonly diagnostics: readonly {
    readonly code: string;
    readonly message: string;
    readonly path?: string;
  }[];
  readonly cache: {
    readonly key?: string;
    readonly status: "hit" | "miss" | "bypass";
  };
  readonly events: readonly EngineLifecycleEvent[];
  readonly resultDigest: `sha256:${string}`;
}

export interface CachedEvaluation {
  readonly proofSuite: ProofSuiteResult;
  readonly evidenceRevision: string;
  readonly provenance?: CachedEvaluationProvenance;
}

export interface CachedEvaluationProvenance {
  readonly originatingInvocationId: OpaqueId;
  readonly model: RevisionRef;
  readonly proofs: readonly RevisionRef[];
  readonly proofExecutions: readonly CanonicalProofExecution[];
  readonly evidenceRecords: readonly Evidence[];
  readonly validationEventIds: readonly OpaqueId[];
}

export interface EngineCache {
  get(key: string): Promise<CachedEvaluation | undefined>;
  publish(key: string, value: CachedEvaluation): Promise<"published" | "existing">;
}

export interface EngineHistory {
  admit?(invocationId: string, workspaceRoot: string): Promise<void>;
  checkpoint?(checkpoint: EngineHistoryCheckpoint): Promise<void>;
  append(result: VerifyResult, evidence: NormalizedEvidence | undefined): Promise<void>;
}

export type EngineHistoryUnit =
  | "01-discovery-plan"
  | "02-discovery"
  | "03-model-seal"
  | "04-execution-plan"
  | "05-attempt-start"
  | "06-evidence-capture"
  | "07-evidence-validation"
  | "08-proof-terminal"
  | "09-promise-aggregation"
  | "10-repair-proposal";

export interface EngineHistoryCheckpointEvent {
  readonly eventType: string;
  readonly subject?: RevisionRef;
  readonly dataClassification: "MINIMAL_METADATA" | "LOCAL_SOURCE";
  readonly payload: CanonicalValue;
}

export interface EngineHistoryCheckpoint {
  readonly unit: EngineHistoryUnit;
  readonly invocationId: OpaqueId;
  readonly occurredAt: Rfc3339Utc;
  readonly revisions: readonly RevisionDocument<CanonicalValue>[];
  readonly events: readonly EngineHistoryCheckpointEvent[];
  readonly referenceEdges: readonly ReferenceEdge[];
  readonly currentRevision?: {
    readonly slot: string;
    readonly next: RevisionRef;
  };
}

export interface EnginePorts {
  readonly cache?: EngineCache;
  readonly history?: EngineHistory;
  readonly createInvocationId?: () => string;
  readonly now?: () => Date;
}

class Lifecycle {
  readonly events: EngineLifecycleEvent[] = [];

  add(
    stage: EngineLifecycleEvent["stage"],
    status: EngineLifecycleEvent["status"],
    reasonCode?: string,
  ): void {
    this.events.push({
      sequence: this.events.length + 1,
      type: `engine.${stage}.${status}`,
      stage,
      status,
      ...(reasonCode === undefined ? {} : { reasonCode }),
    });
  }
}

function digest(value: CanonicalValue): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonicalize(value)).digest("hex")}`;
}

function stableResultDigest(input: {
  operationalStatus: OperationalStatus;
  outcome: VerificationOutcome;
  workspace: VerifyResult["workspace"];
  applicationModel?: VerifyResult["applicationModel"];
  proofs: readonly ProofEvaluation[];
  promises: readonly CanonicalPromiseResult[];
  repairs: readonly RepairSuggestion[];
  reasonCodes: readonly string[];
  diagnostics: VerifyResult["diagnostics"];
}): `sha256:${string}` {
  const value = JSON.parse(JSON.stringify({
    schemaVersion: 1,
    engineVersion: ENGINE_VERSION,
    operationalStatus: input.operationalStatus,
    outcome: input.outcome,
    workspace: input.workspace,
    ...(input.applicationModel === undefined ? {} : { applicationModel: input.applicationModel }),
    proofs: input.proofs.map((proof) => ({
      proofId: proof.proofId,
      promiseId: proof.promiseId,
      status: proof.status,
      reasonCodes: proof.reasonCodes,
      details: proof.details,
      resultDigest: proof.resultDigest,
    })),
    promises: input.promises.map((promise) => ({
      promise: promise.promise,
      status: promise.status,
      reasonCodes: promise.reasonCodes,
    })),
    repairs: input.repairs.map((repair) => ({
      revision: repair.revision,
      motivatingPromise: repair.motivatingPromise,
      motivatingProof: repair.motivatingProof,
      action: repair.action,
      expectedEffect: repair.expectedEffect,
      verificationPlan: repair.verificationPlan,
    })),
    reasonCodes: [...input.reasonCodes].sort(),
    diagnostics: input.diagnostics,
  })) as CanonicalValue;
  return digest(value);
}

function cacheKey(
  discovery: WorkspaceDiscovery,
  modelRevision: `sha256:${string}`,
  evidence: NormalizedEvidence,
): string {
  return digest({
    domain: "verification-platform/evaluation-cache",
    schemaVersion: 1,
    engineVersion: ENGINE_VERSION,
    modelRevision,
    evidenceContentDigest: evidence.contentDigest,
    proofRevisions: MVP_PROOF_REGISTRY.map((proof) => proof.revision),
    executionPolicy: "passive-offline-v1",
  });
}

function terminalResult(
  invocationId: string,
  lifecycle: Lifecycle,
  input: {
    operationalStatus: OperationalStatus;
    outcome: VerificationOutcome;
    workspace?: VerifyResult["workspace"];
    applicationModel?: VerifyResult["applicationModel"];
    proofs?: readonly ProofEvaluation[];
    promises?: readonly CanonicalPromiseResult[];
    summary?: VerifyResult["summary"];
    evidence?: VerifyResult["evidence"];
    repairs?: readonly RepairSuggestion[];
    reasonCodes?: readonly string[];
    diagnostics?: VerifyResult["diagnostics"];
    cache?: VerifyResult["cache"];
  },
): VerifyResult {
  const workspace = input.workspace ?? {};
  const proofs = input.proofs ?? [];
  const repairs = input.repairs ?? [];
  const promises = input.promises ?? [];
  const reasonCodes = [...(input.reasonCodes ?? [])].sort();
  const diagnostics = input.diagnostics ?? [];
  const summary = input.summary ?? {
    requiredPromiseCount: proofs.length,
    advisoryPromiseCount: 0,
    satisfiedCount: proofs.filter((proof) => proof.status === "passed").length,
    violatedCount: proofs.filter((proof) => proof.status === "failed").length,
    indeterminateCount: proofs.filter((proof) =>
      proof.status !== "passed" && proof.status !== "failed").length,
  };
  return {
    kind: "verify",
    schemaVersion: 1,
    engineVersion: ENGINE_VERSION,
    invocationId,
    operationalStatus: input.operationalStatus,
    outcome: input.outcome,
    workspace,
    ...(input.applicationModel === undefined ? {} : { applicationModel: input.applicationModel }),
    summary,
    promises,
    proofExecutions: [],
    proofs,
    evidenceRecords: [],
    evidence: input.evidence ?? [],
    repairRecords: [],
    repairs,
    executionManifests: [],
    revisionDocuments: [],
    reasonCodes,
    diagnostics,
    cache: input.cache ?? { status: "bypass" },
    events: lifecycle.events,
    resultDigest: stableResultDigest({
      operationalStatus: input.operationalStatus,
      outcome: input.outcome,
      workspace,
      ...(input.applicationModel === undefined ? {} : { applicationModel: input.applicationModel }),
      proofs,
      promises,
      repairs,
      reasonCodes,
      diagnostics,
    }),
  };
}

function evidenceProjection(evidence: NormalizedEvidence, validation: "valid" | "rejected"): VerifyResult["evidence"] {
  return [{
    id: evidence.id,
    revision: evidence.revision,
    evidenceType: evidence.evidenceType,
    classification: evidence.classification,
    byteSize: evidence.byteSize,
    validation,
  }];
}

function revisionRef(document: RevisionDocument): RevisionRef {
  return {
    kind: document.kind,
    id: document.id,
    revision: document.revision,
    schemaVersion: document.schemaVersion,
  };
}

function revisionDocument(
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

function discoveryDocuments(
  discovery: WorkspaceDiscovery,
): readonly RevisionDocument<CanonicalValue>[] {
  return [
    ...discovery.signals.map((signal) =>
      revisionDocument(
        "discoverySignal",
        `signal:${signal.id.slice("sha256:".length)}` as OpaqueId,
        JSON.parse(JSON.stringify({
          readerId: signal.readerId,
          inputPath: signal.inputPath,
          pointer: signal.pointer,
          kind: signal.kind,
          value: signal.value,
        })) as CanonicalValue,
      )
    ),
    ...discovery.facts.map((fact) =>
      revisionDocument(
        "discoveryFact",
        `fact:${fact.id.slice("sha256:".length)}` as OpaqueId,
        JSON.parse(JSON.stringify({
          readerId: fact.readerId,
          inputPath: fact.inputPath,
          pointer: fact.pointer,
          kind: fact.kind,
          value: fact.value,
        })) as CanonicalValue,
      )
    ),
  ];
}

function scaffoldEvaluations(): readonly ProofEvaluation[] {
  return MVP_PROOF_REGISTRY.map((proof) => ({
    proofId: proof.proofId,
    promiseId: proof.promiseId,
    status: "indeterminate",
    reasonCodes: ["EXECUTION_PENDING"],
    evidence: [],
    details: [],
    resultDigest: digest({
      domain: "verification-platform/pending-proof-scaffold",
      proofId: proof.proofId,
      revision: proof.revision,
    }),
  }));
}

function edgesForDocuments(
  documents: readonly RevisionDocument<CanonicalValue>[],
  availableDocuments: readonly RevisionDocument<CanonicalValue>[] = documents,
): readonly ReferenceEdge[] {
  const available = new Set(availableDocuments.map((document) =>
    `${document.kind}\0${document.id}\0${document.revision}\0${document.schemaVersion}`
  ));
  const edges: ReferenceEdge[] = [];
  const add = (
    source: RevisionRef,
    relation: string,
    target: RevisionRef,
  ): void => {
    const targetKey =
      `${target.kind}\0${target.id}\0${target.revision}\0${target.schemaVersion}`;
    if (available.has(targetKey)) edges.push({ source, relation, target });
  };
  for (const document of documents) {
    const source = revisionRef(document);
    const payload = document.payload as Record<string, unknown>;
    for (const [field, value] of Object.entries(payload)) {
      if (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value) &&
        "kind" in value &&
        "id" in value &&
        "revision" in value &&
        "schemaVersion" in value
      ) {
        add(source, field, value as RevisionRef);
      } else if (Array.isArray(value)) {
        for (const candidate of value) {
          if (
            typeof candidate === "object" &&
            candidate !== null &&
            "kind" in candidate &&
            "id" in candidate &&
            "revision" in candidate &&
            "schemaVersion" in candidate
          ) {
            add(source, field, candidate as RevisionRef);
          }
        }
      }
    }
  }
  return edges;
}

function selectedDocuments(
  records: CanonicalRuntimeRecords,
  predicate: (document: RevisionDocument<CanonicalValue>) => boolean,
): readonly RevisionDocument<CanonicalValue>[] {
  return records.revisionDocuments.filter(predicate);
}

function event(
  eventType: string,
  payload: unknown,
  subject?: RevisionRef,
  dataClassification:
    | "MINIMAL_METADATA"
    | "LOCAL_SOURCE" = "MINIMAL_METADATA",
): EngineHistoryCheckpointEvent {
  return {
    eventType,
    ...(subject === undefined ? {} : { subject }),
    dataClassification,
    payload: JSON.parse(JSON.stringify(payload)) as CanonicalValue,
  };
}

export class VerificationEngine {
  readonly #ports: EnginePorts;

  constructor(ports: EnginePorts = {}) {
    this.#ports = ports;
  }

  async verify(request: VerifyRequest): Promise<VerifyResult> {
    const invocationId = request.invocationId
      ?? this.#ports.createInvocationId?.()
      ?? `invocation:${randomUUID()}`;
    const lifecycle = new Lifecycle();
    const occurredAt = (
      this.#ports.now?.() ?? new Date()
    ).toISOString() as Rfc3339Utc;
    await this.#ports.history?.admit?.(invocationId, request.workspaceRoot);
    const principal = request.principal ?? {
      kind: "local-user",
      id: `local:${typeof process.getuid === "function" ? process.getuid() : "user"}`,
      authenticated: true,
    };
    const policy = request.authorityPolicy ?? passiveCliPolicy(principal, request.workspaceRoot);
    lifecycle.add("preflight", "started");
    const decision = authorize(principal, {
      operation: "verify",
      workspaceRoot: request.workspaceRoot,
      permissions: ["workspace.read"],
    }, policy);
    if (!decision.allowed) {
      lifecycle.add("preflight", "failed", decision.reasonCode);
      await this.#ports.history?.checkpoint?.({
        unit: "01-discovery-plan",
        invocationId: invocationId as OpaqueId,
        occurredAt,
        revisions: [],
        events: [event("DiscoveryPlanAuthorizationDenied", {
          operation: "verify",
          permission: "workspace.read",
          reasonCode: decision.reasonCode,
        })],
        referenceEdges: [],
      });
      lifecycle.add("report", "completed");
      const result = terminalResult(invocationId, lifecycle, {
        operationalStatus: "blocked",
        outcome: "indeterminate",
        reasonCodes: [decision.reasonCode],
        diagnostics: [{ code: decision.reasonCode, message: "Verification was not authorized for this workspace." }],
      });
      await this.#ports.history?.append(result, undefined);
      return result;
    }
    lifecycle.add("preflight", "completed");
    lifecycle.add("discovery_plan", "started");
    const controller = new AbortController();
    const abortFromCaller = (): void => controller.abort(request.signal?.reason);
    if (request.signal?.aborted) abortFromCaller();
    else request.signal?.addEventListener("abort", abortFromCaller, { once: true });
    const deadlineMs = request.deadlineMs ?? 30_000;
    const deadline = setTimeout(() => controller.abort(), Math.max(1, deadlineMs));
    deadline.unref();
    const clearCancellation = (): void => {
      clearTimeout(deadline);
      request.signal?.removeEventListener("abort", abortFromCaller);
    };
    lifecycle.add("discovery_plan", "completed");
    await this.#ports.history?.checkpoint?.({
      unit: "01-discovery-plan",
      invocationId: invocationId as OpaqueId,
      occurredAt,
      revisions: [],
      events: [event("DiscoveryPlanAuthorized", {
        operation: "verify",
        permissions: {
          filesystem: "read-only-workspace",
          network: false,
          process: false,
          write: false,
        },
        deadlineMs,
      })],
      referenceEdges: [],
    });

    let discovery: WorkspaceDiscovery;
    try {
      lifecycle.add("discover", "started");
      discovery = await discoverWorkspace(request.workspaceRoot, {
        ...(request.discoveryLimits === undefined ? {} : { limits: request.discoveryLimits }),
        signal: controller.signal,
      });
      lifecycle.add("discover", "completed");
    } catch (error) {
      clearCancellation();
      lifecycle.add("discover", "failed", "DISCOVERY_ERROR");
      await this.#ports.history?.checkpoint?.({
        unit: "02-discovery",
        invocationId: invocationId as OpaqueId,
        occurredAt,
        revisions: [],
        events: [event("DiscoveryFailed", {
          reasonCode: "DISCOVERY_ERROR",
        })],
        referenceEdges: [],
      });
      lifecycle.add("report", "completed");
      const message = error instanceof Error ? error.message : "Unknown discovery error";
      const result = terminalResult(invocationId, lifecycle, {
        operationalStatus: error instanceof TypeError ? "invalid" : "internal_error",
        outcome: "indeterminate",
        reasonCodes: ["DISCOVERY_ERROR"],
        diagnostics: [{ code: "DISCOVERY_ERROR", message }],
      });
      await this.#ports.history?.append(result, undefined);
      return result;
    }
    const discoveredDocuments = discoveryDocuments(discovery);
    await this.#ports.history?.checkpoint?.({
      unit: "02-discovery",
      invocationId: invocationId as OpaqueId,
      occurredAt,
      revisions: discoveredDocuments,
      events: [event("DiscoveryCompleted", {
        completion: discovery.completion,
        inspectedFiles: discovery.inspectedFiles,
        inspectedBytes: discovery.inspectedBytes,
        signals: discoveredDocuments
          .filter((document) => document.kind === "discoverySignal")
          .map(revisionRef),
        facts: discoveredDocuments
          .filter((document) => document.kind === "discoveryFact")
          .map(revisionRef),
      }, undefined, "LOCAL_SOURCE")],
      referenceEdges: [],
    });

    lifecycle.add("resolve", "started");
    const supported = discovery.packageManagers.length > 0;
    const modelResolution = await resolveAndSealWorkspaceModel(
      discovery,
      MVP_PROOF_REGISTRY,
    );
    lifecycle.add("resolve", "completed");
    const sealedModel = modelResolution.status === "sealed"
      ? modelResolution.graph.model
      : undefined;
    const effectiveModelRevision = sealedModel?.revision ?? discovery.modelRevision;
    const workspace = {
      binding: discovery.workspaceBinding,
      ...(discovery.selectedPackageManager ? { packageManager: discovery.selectedPackageManager } : {}),
      modelRevision: effectiveModelRevision,
    };
    const applicationModel = {
      kind: "applicationModel" as const,
      id: sealedModel?.id ?? `model:${discovery.workspaceBinding.slice("sha256:".length)}`,
      revision: effectiveModelRevision,
      schemaVersion: 1 as const,
    };
    const sealedGraph = modelResolution.status === "sealed"
      ? modelResolution.graph
      : undefined;
    const modelDocuments = sealedGraph === undefined
      ? []
      : [
          ...sealedGraph.applications.map((value) =>
            revisionDocument(
              "application",
              value.id,
              JSON.parse(JSON.stringify(
                Object.fromEntries(
                  Object.entries(value).filter(([key]) =>
                    !["id", "revision", "schemaVersion"].includes(key)
                  ),
                ),
              )) as CanonicalValue,
            )
          ),
          ...sealedGraph.capabilities.map((value) =>
            revisionDocument(
              "capability",
              value.id,
              JSON.parse(JSON.stringify(
                Object.fromEntries(
                  Object.entries(value).filter(([key]) =>
                    !["id", "revision", "schemaVersion"].includes(key)
                  ),
                ),
              )) as CanonicalValue,
            )
          ),
          ...sealedGraph.promises.map((value) =>
            revisionDocument(
              "promise",
              value.id,
              JSON.parse(JSON.stringify(
                Object.fromEntries(
                  Object.entries(value).filter(([key]) =>
                    !["id", "revision", "schemaVersion"].includes(key)
                  ),
                ),
              )) as CanonicalValue,
            )
          ),
          ...sealedGraph.proofs.map((value) =>
            revisionDocument(
              "proof",
              value.id,
              JSON.parse(JSON.stringify(
                Object.fromEntries(
                  Object.entries(value).filter(([key]) =>
                    !["id", "revision", "schemaVersion"].includes(key)
                  ),
                ),
              )) as CanonicalValue,
            )
          ),
          ...sealedGraph.bindings.map((value) =>
            revisionDocument(
              "promiseProofBinding",
              value.id,
              JSON.parse(JSON.stringify(
                Object.fromEntries(
                  Object.entries(value).filter(([key]) =>
                    !["id", "revision", "schemaVersion"].includes(key)
                  ),
                ),
              )) as CanonicalValue,
            )
          ),
          revisionDocument(
            "applicationModel",
            sealedGraph.model.id,
            JSON.parse(JSON.stringify(
              Object.fromEntries(
                Object.entries(sealedGraph.model).filter(([key]) =>
                  !["id", "revision", "schemaVersion"].includes(key)
                ),
              ),
            )) as CanonicalValue,
          ),
        ];
    if (
      sealedGraph !== undefined &&
      modelDocuments.some((document, index) =>
        document.revision !== [
          ...sealedGraph.applications,
          ...sealedGraph.capabilities,
          ...sealedGraph.promises,
          ...sealedGraph.proofs,
          ...sealedGraph.bindings,
          sealedGraph.model,
        ][index]?.revision
      )
    ) {
      throw new TypeError("canonical model checkpoint revision drift");
    }
    const modelRef: RevisionRef | undefined = sealedGraph === undefined
      ? undefined
      : {
          kind: "applicationModel",
          id: sealedGraph.model.id,
          revision: sealedGraph.model.revision,
          schemaVersion: sealedGraph.model.schemaVersion,
        };
    await this.#ports.history?.checkpoint?.({
      unit: "03-model-seal",
      invocationId: invocationId as OpaqueId,
      occurredAt,
      revisions: modelDocuments,
      events: [event(
        sealedGraph === undefined
          ? "ApplicationModelNotSealed"
          : "ApplicationModelSealed",
        sealedGraph === undefined
          ? { status: modelResolution.status, diagnostics: modelResolution.diagnostics }
          : { applicationModel: modelRef },
        modelRef,
      )],
      referenceEdges: edgesForDocuments(modelDocuments),
      ...(modelRef === undefined
        ? {}
        : {
            currentRevision: {
              slot: `current-model:${discovery.workspaceBinding}`,
              next: modelRef,
            },
          }),
    });
    if (discovery.completion === "cancelled") {
      clearCancellation();
      lifecycle.add("seal", "skipped", "CANCELLED");
      lifecycle.add("plan", "skipped", "CANCELLED");
      lifecycle.add("authorize", "skipped", "CANCELLED");
      lifecycle.add("execute", "skipped", "CANCELLED");
      lifecycle.add("capture", "skipped", "CANCELLED");
      lifecycle.add("evaluate", "skipped", "CANCELLED");
      lifecycle.add("repair", "skipped", "CANCELLED");
      lifecycle.add("report", "completed");
      const result = terminalResult(invocationId, lifecycle, {
        operationalStatus: "cancelled",
        outcome: "indeterminate",
        workspace,
        applicationModel,
        reasonCodes: ["CANCELLED"],
      });
      await this.#ports.history?.append(result, undefined);
      return result;
    }

    lifecycle.add("seal", "started");
    lifecycle.add("seal", "completed");
    const evidence = normalizeWorkspaceEvidence({
      workspaceBinding: discovery.workspaceBinding,
      evidenceType: "workspace.manifest-observations",
      mediaType: "application/vnd.verify.workspace-observations+json",
      observations: discovery.manifests,
      lockfiles: discovery.lockfiles,
      packageManagers: discovery.packageManagers,
      completion: discovery.completion,
      diagnostics: discovery.diagnostics,
    });
    const validation = validateEvidence(evidence);
    const key = cacheKey(discovery, effectiveModelRevision, evidence);
    const cached = validation.state === "valid" &&
        discovery.completion === "complete" &&
        sealedGraph !== undefined
      ? await this.#ports.cache?.get(key)
      : undefined;
    const cacheStatus: "hit" | "miss" | "bypass" =
      cached !== undefined && cached.evidenceRevision === evidence.revision
        ? "hit"
        : this.#ports.cache === undefined
          ? "bypass"
          : "miss";
    const scaffold = sealedGraph === undefined
      ? undefined
      : buildCanonicalRuntimeRecords({
          invocationId,
          occurredAt,
          graph: sealedGraph,
          discovery,
          evidence,
          evaluations: scaffoldEvaluations(),
          repairs: [],
          engine: ENGINE_PRODUCER,
          ...(cacheStatus === "hit" && cached?.provenance !== undefined
            ? { cachedProvenance: cached.provenance }
            : {}),
        });
    const executionScaffold =
      validation.state === "valid" &&
        discovery.completion === "complete"
        ? scaffold
        : undefined;
    lifecycle.add("plan", "started");
    lifecycle.add("plan", "completed");
    lifecycle.add("authorize", "started");
    lifecycle.add("authorize", "completed");
    const planDocuments = scaffold === undefined
      ? []
      : selectedDocuments(
          scaffold,
          (document) =>
            document.kind === "executionContext" ||
            (
              document.kind === "executionPlan" &&
              document.id === scaffold.executionPlan?.id
            ),
        );
    const planRef = planDocuments.find(
      (document) => document.kind === "executionPlan",
    );
    await this.#ports.history?.checkpoint?.({
      unit: "04-execution-plan",
      invocationId: invocationId as OpaqueId,
      occurredAt,
      revisions: planDocuments,
      events: [event(
        planRef === undefined
          ? "ExecutionPlanNotCreated"
          : "ExecutionPlanAuthorized",
        planRef === undefined
          ? { reasonCode: "MODEL_NOT_SEALED" }
          : {
              executionPlan: revisionRef(planRef),
              permissions: "passive-offline-v1",
            },
        planRef === undefined ? undefined : revisionRef(planRef),
      )],
      referenceEdges: edgesForDocuments(
        planDocuments,
        [...modelDocuments, ...planDocuments],
      ),
    });
    const manifestDocuments = executionScaffold === undefined
      ? []
      : selectedDocuments(
          executionScaffold,
          (document) => document.kind === "executionManifest",
        );
    await this.#ports.history?.checkpoint?.({
      unit: "05-attempt-start",
      invocationId: invocationId as OpaqueId,
      occurredAt,
      revisions: manifestDocuments,
      events: executionScaffold === undefined
        ? [event("ProofAttemptsNotStarted", {
            reasonCode: "EXECUTION_PLAN_UNAVAILABLE",
          })]
        : executionScaffold.proofExecutions.map((execution) =>
            event(
              "ProofExecutionStarted",
              {
                attempt: execution.attemptRef,
                planKey: execution.planKey,
                executionManifest: execution.executionManifest,
              },
              execution.executionManifest,
            )
          ),
      referenceEdges: edgesForDocuments(
        manifestDocuments,
        [...modelDocuments, ...planDocuments, ...manifestDocuments],
      ),
    });
    lifecycle.add("execute", "started");
    lifecycle.add("execute", "completed");
    lifecycle.add("capture", "started");
    lifecycle.add("capture", validation.state === "valid" ? "completed" : "failed",
      validation.state === "valid" ? undefined : "EVIDENCE_REJECTED");
    const evidenceDocuments = executionScaffold === undefined
      ? []
      : selectedDocuments(
          executionScaffold,
          (document) =>
            document.kind === "evidence" &&
            executionScaffold.evidenceRecords.some(
              (record) =>
                record.id === document.id &&
                record.attempt.invocationId === invocationId,
            ),
        );
    const captureEdges: ReferenceEdge[] = [];
    if (executionScaffold !== undefined) {
      for (const execution of executionScaffold.proofExecutions) {
        for (const evidenceRef of execution.evidence) {
          captureEdges.push({
            source: execution.executionManifest,
            relation: `attempt:${execution.attemptId}:evidence`,
            target: evidenceRef,
          });
          captureEdges.push({
            source: evidenceRef,
            relation: `captured-for:${execution.attemptId}`,
            target: execution.proof,
          });
        }
      }
    }
    await this.#ports.history?.checkpoint?.({
      unit: "06-evidence-capture",
      invocationId: invocationId as OpaqueId,
      occurredAt,
      revisions: evidenceDocuments,
      events: executionScaffold === undefined
        ? [event("EvidenceCaptureUnavailable", {
            reasonCode: "NO_PROOF_ATTEMPTS",
          })]
        : executionScaffold.evidenceRecords.map((record) =>
            record.attempt.invocationId === invocationId
              ? event(
                  "EvidenceCaptured",
                  { record, body: evidence.body },
                  {
                    kind: "evidence",
                    id: record.id,
                    revision: record.revision,
                    schemaVersion: record.schemaVersion,
                  },
                  "LOCAL_SOURCE",
                )
              : event(
                  "EvidenceReused",
                  {
                    evidence: {
                      kind: "evidence",
                      id: record.id,
                      revision: record.revision,
                      schemaVersion: record.schemaVersion,
                    },
                    originatingAttempt: record.attempt,
                  },
                  {
                    kind: "evidence",
                    id: record.id,
                    revision: record.revision,
                    schemaVersion: record.schemaVersion,
                  },
                )
          ),
      referenceEdges: captureEdges,
    });
    await this.#ports.history?.checkpoint?.({
      unit: "07-evidence-validation",
      invocationId: invocationId as OpaqueId,
      occurredAt,
      revisions: [],
      events: executionScaffold === undefined
        ? [event(
            validation.state === "valid"
              ? "EvidenceValidationUnavailable"
              : "EvidenceRejected",
            {
              state: validation.state,
              reasonCodes: validation.reasonCodes,
            },
          )]
        : executionScaffold.evidenceRecords.map((record, index) =>
            record.attempt.invocationId === invocationId
              ? event(
                  validation.state === "valid"
                    ? "EvidenceValidated"
                    : "EvidenceRejected",
                  {
                    state: validation.state,
                    reasonCodes: validation.reasonCodes,
                    evidenceRevision: record.revision,
                  },
                  {
                    kind: "evidence",
                    id: record.id,
                    revision: record.revision,
                    schemaVersion: record.schemaVersion,
                  },
                )
              : event(
                  "EvidenceValidationReused",
                  {
                    evidenceRevision: record.revision,
                    validationEventId:
                      cached?.provenance?.validationEventIds[index] ?? null,
                  },
                  {
                    kind: "evidence",
                    id: record.id,
                    revision: record.revision,
                    schemaVersion: record.schemaVersion,
                  },
                )
          ),
      referenceEdges: [],
    });

    if (validation.state !== "valid") {
      clearCancellation();
      lifecycle.add("evaluate", "skipped", "EVIDENCE_REJECTED");
      lifecycle.add("repair", "skipped", "EVIDENCE_REJECTED");
      lifecycle.add("report", "completed");
      const result = terminalResult(invocationId, lifecycle, {
        operationalStatus: "blocked",
        outcome: "indeterminate",
        workspace,
        applicationModel,
        evidence: evidenceProjection(evidence, "rejected"),
        reasonCodes: ["EVIDENCE_REJECTED", ...validation.reasonCodes],
      });
      await this.#ports.history?.append(result, evidence);
      return result;
    }

    if (discovery.completion === "bounded") {
      clearCancellation();
      lifecycle.add("evaluate", "skipped", "DISCOVERY_BOUNDED");
      lifecycle.add("repair", "skipped", "DISCOVERY_BOUNDED");
      lifecycle.add("report", "completed");
      const result = terminalResult(invocationId, lifecycle, {
        operationalStatus: "completed",
        outcome: "indeterminate",
        workspace,
        applicationModel,
        evidence: evidenceProjection(evidence, "valid"),
        reasonCodes: ["DISCOVERY_BOUNDED"],
      });
      await this.#ports.history?.append(result, evidence);
      return result;
    }

    let proofSuite: ProofSuiteResult;
    let cacheCandidate: CachedEvaluation | undefined;
    lifecycle.add("evaluate", "started");
    if (
      cacheStatus === "hit" &&
      cached !== undefined &&
      cached.evidenceRevision === evidence.revision
    ) {
      proofSuite = cached.proofSuite;
    } else {
      proofSuite = evaluateWorkspaceProofs({
        supported,
        manifests: discovery.manifests,
        lockfiles: discovery.lockfiles,
        packageManagers: discovery.packageManagers,
        conflicts: discovery.conflicts,
        diagnostics: discovery.diagnostics,
        validatedEvidence: [evidence.revision],
      });
      if (this.#ports.cache) {
        cacheCandidate = {
          proofSuite,
          evidenceRevision: evidence.revision,
        };
      }
    }
    lifecycle.add("evaluate", "completed");
    const evaluatedRecords = sealedGraph === undefined
      ? undefined
      : buildCanonicalRuntimeRecords({
          invocationId,
          occurredAt,
          graph: sealedGraph,
          discovery,
          evidence,
          evaluations: proofSuite.evaluations,
          repairs: [],
          engine: ENGINE_PRODUCER,
          ...(cacheStatus === "hit" && cached?.provenance !== undefined
            ? { cachedProvenance: cached.provenance }
            : {}),
        });
    await this.#ports.history?.checkpoint?.({
      unit: "08-proof-terminal",
      invocationId: invocationId as OpaqueId,
      occurredAt,
      revisions: [],
      events: evaluatedRecords === undefined
        ? [event("ProofEvaluationUnavailable", {
            reasonCodes: proofSuite.reasonCodes,
          })]
        : evaluatedRecords.proofExecutions.map((execution) =>
            event(
              "ProofExecutionCompleted",
              execution,
              execution.executionManifest,
            )
          ),
      referenceEdges: [],
    });
    await this.#ports.history?.checkpoint?.({
      unit: "09-promise-aggregation",
      invocationId: invocationId as OpaqueId,
      occurredAt,
      revisions: [],
      events: [event("PromisesAggregated", {
        promises: evaluatedRecords?.promises ?? [],
        outcome: evaluatedRecords?.outcome ?? proofSuite.outcome,
        summary: evaluatedRecords?.summary ?? null,
      })],
      referenceEdges: evaluatedRecords === undefined
        ? []
        : evaluatedRecords.proofExecutions.flatMap((execution) => [
            {
              source: execution.promise,
              relation: "aggregation:effective-proof",
              target: execution.proof,
            },
            ...execution.evidence.map((evidenceRef) => ({
              source: execution.promise,
              relation: "aggregation:evidence",
              target: evidenceRef,
            })),
          ]),
    });
    lifecycle.add("repair", "started");
    const repairs = suggestRepairs(proofSuite.evaluations, effectiveModelRevision);
    lifecycle.add("repair", "completed");
    lifecycle.add("report", "completed");
    clearCancellation();

    const diagnostics = discovery.diagnostics.map((item) => ({
      code: item.code,
      message: item.message,
      ...(item.path === undefined ? {} : { path: item.path }),
    }));
    const records = sealedModel === undefined
      ? undefined
      : buildCanonicalRuntimeRecords({
          invocationId,
          occurredAt,
          graph: modelResolution.status === "sealed"
            ? modelResolution.graph
            : (() => {
                throw new TypeError("sealed model graph disappeared");
              })(),
          discovery,
          evidence,
          evaluations: proofSuite.evaluations,
          repairs,
          engine: ENGINE_PRODUCER,
          ...(cacheStatus === "hit" && cached?.provenance !== undefined
            ? { cachedProvenance: cached.provenance }
            : {}),
        });
    const priorDocumentKeys = new Set(
      evaluatedRecords?.revisionDocuments.map((document) =>
        `${document.kind}\0${document.id}\0${document.revision}\0${document.schemaVersion}`
      ) ?? [],
    );
    const repairDocuments = records === undefined
      ? []
      : records.revisionDocuments.filter((document) =>
          !priorDocumentKeys.has(
            `${document.kind}\0${document.id}\0${document.revision}\0${document.schemaVersion}`,
          )
        );
    await this.#ports.history?.checkpoint?.({
      unit: "10-repair-proposal",
      invocationId: invocationId as OpaqueId,
      occurredAt,
      revisions: repairDocuments,
      events: records === undefined || records.repairRecords.length === 0
        ? [event("RepairsNotProposed", { count: 0 })]
        : records.repairRecords.map((repair) =>
            event(
              "RepairProposed",
              repair,
              {
                kind: "repair",
                id: repair.id,
                revision: repair.revision,
                schemaVersion: repair.schemaVersion,
              },
            )
          ),
      referenceEdges: edgesForDocuments(
        repairDocuments,
        records?.revisionDocuments ?? repairDocuments,
      ),
    });
    const legacyResult = terminalResult(invocationId, lifecycle, {
      operationalStatus: "completed",
      outcome: records?.outcome ?? proofSuite.outcome,
      workspace,
      applicationModel,
      proofs: proofSuite.evaluations,
      ...(records === undefined
        ? {}
        : { promises: records.promises, summary: records.summary }),
      evidence: evidenceProjection(evidence, "valid"),
      repairs,
      reasonCodes: proofSuite.reasonCodes,
      diagnostics,
      cache: { key, status: cacheStatus },
    });
    const result: VerifyResult = records === undefined
      ? legacyResult
      : {
          ...legacyResult,
          proofExecutions: records.proofExecutions,
          evidenceRecords: records.evidenceRecords,
          repairRecords: records.repairRecords,
          executionManifests: records.executionManifests,
          revisionDocuments: records.revisionDocuments,
          ...(records.executionPlan === undefined
            ? {}
            : { executionPlan: records.executionPlan }),
          ...(records.executionContext === undefined
            ? {}
            : { executionContext: records.executionContext }),
        };
    await this.#ports.history?.append(result, evidence);
    if (cacheCandidate !== undefined) {
      const canonicalModel: RevisionRef | undefined =
        result.applicationModel === undefined
          ? undefined
          : {
              kind: "applicationModel",
              id: result.applicationModel.id as OpaqueId,
              revision: result.applicationModel.revision,
              schemaVersion: result.applicationModel.schemaVersion,
            };
      await this.#ports.cache?.publish(
        key,
        canonicalModel === undefined
          ? cacheCandidate
          : {
              ...cacheCandidate,
              provenance: {
                originatingInvocationId: result.invocationId as OpaqueId,
                model: canonicalModel,
                proofs: result.proofExecutions.map(
                  (execution) => execution.proof,
                ),
                proofExecutions: result.proofExecutions,
                evidenceRecords: result.evidenceRecords,
                validationEventIds: [],
              },
            },
      );
    }
    return result;
  }
}

export { LocalVerificationRuntime } from "./local-runtime.js";
export type {
  CheckpointFaultInjector,
  LocalRuntimeOptions,
  ProjectionFaultInjector,
  ProjectionFaultPoint,
} from "./local-runtime.js";
export type {
  CanonicalPromiseEvaluation,
  CanonicalPromiseResult,
  CanonicalProofExecution,
  CanonicalProofResult,
  CanonicalRuntimeRecords,
} from "./canonical-runtime.js";
