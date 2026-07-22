import type {
  EngineLifecycleEvent,
  VerifyResult as EngineVerifyResult,
} from "@verify-internal/engine";
import { ENGINE_ARTIFACT_DIGEST } from "@verify-internal/engine";
import type {
  AnyCommandEnvelope,
  JsonlEventRecord,
  LocalEvidenceRecord,
  LocalExecutionManifest,
  LocalProofExecution,
  LocalRepairRecord,
  StructuredError,
  VerifyResult,
} from "@verify-internal/protocol";

function diagnosticCode(code: string): `VFY_${string}` {
  const normalized = code
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `VFY_ENGINE_${normalized || "DIAGNOSTIC"}`;
}

function diagnosticsFor(result: EngineVerifyResult): readonly StructuredError[] {
  const category = result.operationalStatus === "invalid"
    ? "invalid"
    : result.operationalStatus === "internal_error"
      ? "internal"
      : "environment";
  return result.diagnostics.map((diagnostic) => ({
    code: diagnosticCode(diagnostic.code),
    category,
    retryability: "never",
    message: diagnostic.message,
    component: "@verify-internal/engine",
    operation: "verify",
    blocksRequiredProof: result.operationalStatus !== "completed",
    causes: [],
    diagnosticRefs: [],
    ...(diagnostic.path === undefined ? {} : { details: { path: diagnostic.path } }),
  }));
}

function verifyProtocolResult(
  result: EngineVerifyResult,
  workspaceBinding?: string,
): VerifyResult | null {
  if (result.applicationModel === undefined) return null;
  if (result.operationalStatus !== "completed" && result.operationalStatus !== "blocked") {
    return null;
  }
  const enriched = result as unknown as {
    readonly promises?: VerifyResult["promises"];
    readonly proofExecutions?: readonly LocalProofExecution[];
    readonly evidenceRecords?: readonly LocalEvidenceRecord[];
    readonly repairRecords?: readonly LocalRepairRecord[];
    readonly executionManifests?: readonly LocalExecutionManifest[];
  };
  const promises = Array.isArray(enriched.promises) ? enriched.promises : [];
  const proofExecutions = Array.isArray(enriched.proofExecutions)
    ? enriched.proofExecutions
    : [];
  const evidenceRecords = Array.isArray(enriched.evidenceRecords)
    ? enriched.evidenceRecords
    : undefined;
  const repairRecords = Array.isArray(enriched.repairRecords)
    ? enriched.repairRecords
    : undefined;
  const executionManifests = Array.isArray(enriched.executionManifests)
    ? enriched.executionManifests
    : [];
  const evidenceRefs = evidenceRecords === undefined
    ? result.evidence.map((evidence) => ({
        kind: "evidence",
        id: evidence.id,
        revision: evidence.revision as `sha256:${string}`,
        schemaVersion: 1,
      }))
    : evidenceRecords.map((evidence) => ({
        kind: "evidence",
        id: evidence.id,
        revision: evidence.revision,
        schemaVersion: evidence.schemaVersion,
      }));
  const binding = workspaceBinding ?? result.workspace.binding;
  const workspace = binding === undefined || result.workspace.modelRevision === undefined
    ? undefined
    : {
        rootBinding: binding,
        ...(result.workspace.packageManager === undefined
          ? {}
          : { packageManager: result.workspace.packageManager }),
        modelRevision: result.workspace.modelRevision,
      };
  return {
    kind: "verify",
    outcome: result.outcome,
    ...(result.operationalStatus === "blocked" ? { partial: true } : {}),
    ...(workspace === undefined
      ? {}
      : { workspace: workspace as unknown as NonNullable<VerifyResult["workspace"]> }),
    reasonCodes: result.reasonCodes,
    applicationModel: result.applicationModel as unknown as VerifyResult["applicationModel"],
    summary: result.summary,
    promises,
    proofExecutions,
    evidence: evidenceRefs as unknown as VerifyResult["evidence"],
    ...(evidenceRecords === undefined ? {} : { evidenceRecords }),
    repairs: (repairRecords ?? result.repairs).map((repair) => ({
      kind: "repair",
      id: repair.id,
      revision: repair.revision,
      schemaVersion: repair.schemaVersion,
    })) as unknown as VerifyResult["repairs"],
    ...(repairRecords === undefined ? {} : { repairRecords }),
    executionManifests,
    cacheDecisions: [result.cache],
  };
}

export interface ProtocolProjectionClock {
  readonly startedAt: string;
  readonly durationMs: number;
  readonly workspaceBinding?: string;
}

export function toProtocolEnvelope(
  result: EngineVerifyResult,
  clock: ProtocolProjectionClock,
): AnyCommandEnvelope {
  return {
    schemaVersion: 1,
    command: "verify",
    invocationId: result.invocationId as AnyCommandEnvelope["invocationId"],
    engine: {
      version: result.engineVersion,
      artifactDigest: ENGINE_ARTIFACT_DIGEST,
    },
    operationalStatus: result.operationalStatus,
    startedAt: clock.startedAt as AnyCommandEnvelope["startedAt"],
    durationMs: clock.durationMs as AnyCommandEnvelope["durationMs"],
    result: verifyProtocolResult(result, clock.workspaceBinding),
    diagnostics: diagnosticsFor(result),
  };
}

export function toJsonlEventRecord(
  event: EngineLifecycleEvent,
  result: EngineVerifyResult,
  occurredAt: string,
): JsonlEventRecord {
  return {
    schemaVersion: 1,
    recordType: "event",
    event: {
      schemaVersion: 1,
      eventId: `${result.invocationId}:event:${event.sequence}` as JsonlEventRecord["event"]["eventId"],
      eventType: event.type,
      occurredAt,
      invocationId: result.invocationId as JsonlEventRecord["event"]["invocationId"],
      correlationId: result.invocationId as JsonlEventRecord["event"]["correlationId"],
      sequence: event.sequence,
      producer: {
        id: "@verify-internal/engine" as JsonlEventRecord["event"]["producer"]["id"],
        version: result.engineVersion,
        artifactDigest: ENGINE_ARTIFACT_DIGEST,
      },
      dataClassification: "MINIMAL_METADATA",
      payload: {
        stage: event.stage,
        status: event.status,
        ...(event.reasonCode === undefined ? {} : { reasonCode: event.reasonCode }),
      },
    },
  };
}
