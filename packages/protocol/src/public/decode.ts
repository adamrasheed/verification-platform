import type {
  DurationMs,
  OpaqueId,
  RevisionRef,
  Rfc3339Utc,
  Sha256Digest,
} from "@verify-internal/contracts";
import {
  decodeStructuredError,
  protocolError,
  type StructuredError,
} from "./errors.js";
import {
  PROTOCOL_SCHEMA_MAJOR,
  RESULT_KIND_FOR_COMMAND,
  type AnyCommandEnvelope,
  type AnyCommandRequest,
  type CommandName,
  type CommandResult,
  type DispatchState,
  type LocalPromiseResult,
  type LocalProofExecution,
  type OperationalStatus,
  type ProofExecutionStatus,
  type PromiseStatus,
  type PublishedVerificationResult,
  type VerifyOutcome,
  type VerifyResult,
} from "./types.js";

export type ProtocolReadResult<T> =
  | {
      readonly kind: "ok";
      readonly value: T;
    }
  | {
      readonly kind: "invalid";
      readonly error: StructuredError;
    }
  | {
      readonly kind: "incompatible_result";
      readonly error: StructuredError;
    };

const COMMAND_NAMES = Object.keys(RESULT_KIND_FOR_COMMAND) as readonly CommandName[];
const OPERATIONAL_STATUSES: readonly OperationalStatus[] = [
  "completed",
  "invalid",
  "blocked",
  "cancelled",
  "internal_error",
];
const VERIFY_OUTCOMES: readonly VerifyOutcome[] = [
  "satisfied",
  "violated",
  "indeterminate",
  "not_evaluated",
];
const DISPATCH_STATES: readonly DispatchState[] = [
  "accepted",
  "unavailable",
  "unauthorized",
  "expired",
  "cancelled",
  "transport_error",
];
const PROMISE_STATUSES: readonly PromiseStatus[] = [
  "satisfied",
  "violated",
  "indeterminate",
];
const PROOF_STATUSES: readonly ProofExecutionStatus[] = [
  "passed",
  "failed",
  "indeterminate",
  "error",
  "cancelled",
];
const PROOF_LIFECYCLE_STATES = [
  "queued",
  "running",
  "passed",
  "failed",
  "indeterminate",
  "error",
  "cancelled",
] as const;
const PUBLISHED_SENSITIVITY_CLASSES = [
  "LOCAL_SOURCE",
  "SENSITIVE_EVIDENCE",
  "MINIMAL_METADATA",
  "EXPLICIT_SHARE",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasString(record: Record<string, unknown>, key: string): boolean {
  return typeof record[key] === "string";
}

function isNonNegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isSha256(value: unknown): value is Sha256Digest {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
}

function isCommandName(value: unknown): value is CommandName {
  return typeof value === "string" && COMMAND_NAMES.includes(value as CommandName);
}

function isOperationalStatus(value: unknown): value is OperationalStatus {
  return (
    typeof value === "string" &&
    OPERATIONAL_STATUSES.includes(value as OperationalStatus)
  );
}

function invalid<T>(message: string, operation: string): ProtocolReadResult<T> {
  return {
    kind: "invalid",
    error: protocolError("VFY_REQUEST_INVALID", message, operation),
  };
}

function incompatible<T>(
  message: string,
  operation: string,
): ProtocolReadResult<T> {
  return {
    kind: "incompatible_result",
    error: protocolError(
      "VFY_COMPATIBILITY_UNKNOWN_CONTROL_VALUE",
      message,
      operation,
    ),
  };
}

function decodeDiagnostics(
  value: unknown,
): ProtocolReadResult<readonly StructuredError[]> {
  if (!Array.isArray(value)) {
    return invalid("diagnostics must be an array", "decodeCommandEnvelope");
  }
  const diagnostics: StructuredError[] = [];
  for (const candidate of value) {
    const decision = decodeStructuredError(candidate);
    if (decision.kind === "invalid") {
      return invalid(
        "diagnostics contains an invalid StructuredError",
        "decodeCommandEnvelope",
      );
    }
    if (decision.kind === "incompatible") {
      return incompatible(
        "diagnostics contains an unknown control-flow value",
        "decodeCommandEnvelope",
      );
    }
    diagnostics.push(decision.error);
  }
  return { kind: "ok", value: diagnostics };
}

function isRevisionRef(value: unknown): value is RevisionRef {
  return (
    isRecord(value) &&
    hasString(value, "kind") &&
    hasString(value, "id") &&
    isSha256(value.revision) &&
    Number.isSafeInteger(value.schemaVersion) &&
    (value.schemaVersion as number) > 0
  );
}

function isRevisionRefArray(value: unknown): value is readonly RevisionRef[] {
  return Array.isArray(value) && value.every(isRevisionRef);
}

function isProofAttemptRef(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasString(value, "attemptId") &&
    isRevisionRef(value.proof) &&
    hasString(value, "invocationId")
  );
}

function isProducerRef(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasString(value, "id") &&
    hasString(value, "version") &&
    isSha256(value.artifactDigest)
  );
}

function decodeLocalPromises(
  value: unknown,
): ProtocolReadResult<readonly LocalPromiseResult[]> {
  if (!Array.isArray(value)) {
    return invalid("promises must be an array", "decodeVerifyResult");
  }
  const decoded: LocalPromiseResult[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      return invalid("invalid local Promise result", "decodeVerifyResult");
    }
    if (
      typeof item.status !== "string" ||
      !PROMISE_STATUSES.includes(item.status as PromiseStatus)
    ) {
      return incompatible("unknown local Promise status", "decodeVerifyResult");
    }
    if (
      !isRevisionRef(item.promise) ||
      item.promise.kind !== "promise" ||
      !Array.isArray(item.proofAttempts) ||
      !item.proofAttempts.every((attempt) =>
        isProofAttemptRef(attempt) &&
        isRecord(attempt) &&
        isRecord(attempt.proof) &&
        attempt.proof.kind === "proof"
      ) ||
      !isRevisionRefArray(item.evidence) ||
      !item.evidence.every((evidence) => evidence.kind === "evidence") ||
      !hasStringArray(item.reasonCodes)
    ) {
      return invalid("invalid local Promise result", "decodeVerifyResult");
    }
    decoded.push(item as unknown as LocalPromiseResult);
  }
  return { kind: "ok", value: decoded };
}

function decodeLocalProofResult(value: unknown): ProtocolReadResult<true> {
  if (!isRecord(value) || typeof value.status !== "string") {
    return invalid("invalid local Proof result", "decodeVerifyResult");
  }
  if (!PROOF_STATUSES.includes(value.status as ProofExecutionStatus)) {
    return incompatible("unknown local Proof result status", "decodeVerifyResult");
  }
  switch (value.status) {
    case "passed":
      return isRevisionRefArray(value.evidence)
        ? { kind: "ok", value: true }
        : invalid("passed Proof result requires Evidence", "decodeVerifyResult");
    case "failed":
    case "indeterminate":
      return isRevisionRefArray(value.evidence) &&
        hasStringArray(value.reasonCodes)
        ? { kind: "ok", value: true }
        : invalid(
            "terminal Proof result requires Evidence and reason codes",
            "decodeVerifyResult",
          );
    case "error":
      return isRecord(value.error) &&
        hasString(value.error, "code") &&
        hasString(value.error, "message")
        ? { kind: "ok", value: true }
        : invalid("error Proof result requires an error", "decodeVerifyResult");
    case "cancelled":
      return value.reason === "caller" ||
        value.reason === "deadline" ||
        value.reason === "shutdown"
        ? { kind: "ok", value: true }
        : incompatible("unknown Proof cancellation reason", "decodeVerifyResult");
  }
  return incompatible("unknown local Proof result status", "decodeVerifyResult");
}

function decodeLocalProofExecutions(
  value: unknown,
): ProtocolReadResult<readonly LocalProofExecution[]> {
  if (!Array.isArray(value)) {
    return invalid("proofExecutions must be an array", "decodeVerifyResult");
  }
  const decoded: LocalProofExecution[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      return invalid("invalid local Proof execution", "decodeVerifyResult");
    }
    if (
      typeof item.state !== "string" ||
      !(PROOF_LIFECYCLE_STATES as readonly string[]).includes(item.state)
    ) {
      return incompatible("unknown Proof lifecycle state", "decodeVerifyResult");
    }
    if (
      !hasString(item, "attemptId") ||
      !isProofAttemptRef(item.attemptRef) ||
      !isRevisionRef(item.proof) ||
      !isRevisionRef(item.promise) ||
      !isRevisionRef(item.model) ||
      !isRevisionRef(item.executionContext) ||
      !isSha256(item.planKey) ||
      !isRevisionRef(item.executionManifest) ||
      typeof item.effective !== "boolean" ||
      (item.startedAt !== undefined && typeof item.startedAt !== "string") ||
      (item.completedAt !== undefined && typeof item.completedAt !== "string") ||
      !isRevisionRefArray(item.evidence) ||
      (item.resultDigest !== undefined && !isSha256(item.resultDigest)) ||
      (item.attemptRecordDigest !== undefined &&
        !isSha256(item.attemptRecordDigest))
    ) {
      return invalid("invalid local Proof execution", "decodeVerifyResult");
    }
    if (item.result !== undefined) {
      const result = decodeLocalProofResult(item.result);
      if (result.kind !== "ok") return result;
    }
    decoded.push(item as unknown as LocalProofExecution);
  }
  return { kind: "ok", value: decoded };
}

function isArtifactIdentity(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasString(value, "id") &&
    hasString(value, "version") &&
    isSha256(value.artifactDigest)
  );
}

function isExecutionManifest(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasString(value, "id") &&
    isSha256(value.revision) &&
    isNonNegativeInteger(value.schemaVersion) &&
    (value.schemaVersion as number) > 0 &&
    isProducerRef(value.engine) &&
    isRevisionRef(value.applicationModel) &&
    isRevisionRefArray(value.promises) &&
    isRevisionRef(value.proof) &&
    Array.isArray(value.pluginsAndTools) &&
    value.pluginsAndTools.every(isArtifactIdentity) &&
    isRecord(value.source) &&
    isSha256(value.source.inputDigest) &&
    (value.source.repositoryState === "clean" ||
      value.source.repositoryState === "dirty" ||
      value.source.repositoryState === "unknown") &&
    isSha256(value.configurationDigest) &&
    isSha256(value.policyDigest) &&
    isRecord(value.platform) &&
    Array.isArray(value.platform.runtimeVersions) &&
    value.platform.runtimeVersions.every(isArtifactIdentity) &&
    Array.isArray(value.platform.toolchainVersions) &&
    value.platform.toolchainVersions.every(isArtifactIdentity) &&
    Array.isArray(value.authenticationBindingIds) &&
    value.authenticationBindingIds.every((id) => typeof id === "string") &&
    isRecord(value.isolation) &&
    hasString(value.isolation, "enforcementTier") &&
    isSha256(value.discoveryOutputDigest) &&
    isRevisionRef(value.executionPlan) &&
    isSha256(value.executionPlanDigest)
  );
}

function isEvidenceRecord(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasString(value, "id") &&
    isSha256(value.revision) &&
    isNonNegativeInteger(value.schemaVersion) &&
    (value.schemaVersion as number) > 0 &&
    hasString(value, "evidenceType") &&
    hasString(value, "mediaType") &&
    isProducerRef(value.producer) &&
    hasString(value, "captureMethod") &&
    hasString(value, "capturedAt") &&
    isProofAttemptRef(value.attempt) &&
    isRevisionRefArray(value.subjects) &&
    isRevisionRefArray(value.inputRefs) &&
    isSha256(value.contentDigest) &&
    isNonNegativeInteger(value.byteSize) &&
    typeof value.classification === "string" &&
    [
      "SECRET",
      "LOCAL_SOURCE",
      "SENSITIVE_EVIDENCE",
      "MINIMAL_METADATA",
      "EXPLICIT_SHARE",
    ].includes(value.classification) &&
    Array.isArray(value.chainOfCustody) &&
    isRevisionRefArray(value.supersedes)
  );
}

function isRepairRecord(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasString(value, "id") &&
    isSha256(value.revision) &&
    isNonNegativeInteger(value.schemaVersion) &&
    (value.schemaVersion as number) > 0 &&
    isRevisionRef(value.motivatingPromise) &&
    isProofAttemptRef(value.motivatingExecution) &&
    isRevisionRefArray(value.evidence) &&
    isProducerRef(value.generator) &&
    isRecord(value.action) &&
    (value.action.kind === "jsonPatch" ||
      value.action.kind === "advisoryInstruction") &&
    hasStringArray(value.assumptions) &&
    isRecord(value.requiredPermissions) &&
    hasString(value, "expectedEffect") &&
    isRecord(value.confidence) &&
    isRevisionRef(value.verificationPlan)
  );
}

function isPublishedObjectRef(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const kinds = ["applicationModel", "promise", "proof", "evidence"];
  return (
    typeof value.objectType === "string" &&
    kinds.includes(value.objectType) &&
    hasString(value, "publicationId") &&
    hasString(value, "tenantBinding") &&
    value.revision === undefined &&
    value.id === undefined
  );
}

function hasStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function validateSummary(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return [
    "requiredPromiseCount",
    "advisoryPromiseCount",
    "satisfiedCount",
    "violatedCount",
    "indeterminateCount",
  ].every((key) => isNonNegativeInteger(value[key]));
}

function decodeVerifyResult(
  value: Record<string, unknown>,
): ProtocolReadResult<VerifyResult> {
  if (
    typeof value.outcome !== "string" ||
    !VERIFY_OUTCOMES.includes(value.outcome as VerifyOutcome)
  ) {
    return incompatible("unknown verify outcome", "decodeVerifyResult");
  }
  const promises = decodeLocalPromises(value.promises);
  if (promises.kind !== "ok") return promises;
  const proofExecutions = decodeLocalProofExecutions(value.proofExecutions);
  if (proofExecutions.kind !== "ok") return proofExecutions;
  if (
    !isRevisionRef(value.applicationModel) ||
    !validateSummary(value.summary) ||
    !Array.isArray(value.evidence) ||
    !value.evidence.every(isRevisionRef) ||
    (value.evidenceRecords !== undefined &&
      (!Array.isArray(value.evidenceRecords) ||
        !value.evidenceRecords.every(isEvidenceRecord))) ||
    !Array.isArray(value.repairs) ||
    !value.repairs.every(isRevisionRef) ||
    (value.repairRecords !== undefined &&
      (!Array.isArray(value.repairRecords) ||
        !value.repairRecords.every(isRepairRecord))) ||
    !Array.isArray(value.executionManifests) ||
    !value.executionManifests.every(isExecutionManifest) ||
    !Array.isArray(value.cacheDecisions) ||
    (value.partial !== undefined && value.partial !== true)
  ) {
    return invalid("invalid verify result shape", "decodeVerifyResult");
  }
  return { kind: "ok", value: value as unknown as VerifyResult };
}

function decodeDispatchResult(
  value: Record<string, unknown>,
): ProtocolReadResult<CommandResult> {
  if (
    typeof value.state !== "string" ||
    !DISPATCH_STATES.includes(value.state as DispatchState)
  ) {
    return incompatible("unknown dispatch state", "decodeDispatchResult");
  }
  if (
    !hasString(value, "dispatchId") ||
    !hasString(value, "workloadBinding") ||
    !hasStringArray(value.reasonCodes) ||
    (value.verifyInvocationId !== undefined &&
      typeof value.verifyInvocationId !== "string") ||
    (value.publishedRunId !== undefined &&
      typeof value.publishedRunId !== "string")
  ) {
    return invalid("invalid dispatch result shape", "decodeDispatchResult");
  }
  return { kind: "ok", value: value as unknown as CommandResult };
}

function decodePublishedResult(
  value: Record<string, unknown>,
): ProtocolReadResult<PublishedVerificationResult> {
  if (!isOperationalStatus(value.operationalStatus)) {
    return incompatible(
      "unknown published operational status",
      "decodePublishedResult",
    );
  }
  if (
    typeof value.outcome !== "string" ||
    !VERIFY_OUTCOMES.includes(value.outcome as VerifyOutcome)
  ) {
    return incompatible("unknown published outcome", "decodePublishedResult");
  }
  if (
    !hasString(value, "purpose") ||
    !hasString(value, "tenantId") ||
    !hasString(value, "projectId") ||
    !hasString(value, "runId") ||
    !hasString(value, "idempotencyKey") ||
    !isPublishedObjectRef(value.applicationModel) ||
    !isRecord(value.engine) ||
    !hasString(value.engine, "id") ||
    !hasString(value.engine, "version") ||
    !isSha256(value.engine.artifactDigest) ||
    !Number.isSafeInteger(value.protocolVersion) ||
    !Array.isArray(value.plugins) ||
    !Array.isArray(value.promises) ||
    !Array.isArray(value.proofs) ||
    !Array.isArray(value.evidence) ||
    !isRecord(value.summary) ||
    !hasString(value, "auditCorrelationId") ||
    !hasString(value, "retentionClass")
  ) {
    return invalid(
      "invalid published verification shape",
      "decodePublishedResult",
    );
  }
  for (const plugin of value.plugins) {
    if (
      !isRecord(plugin) ||
      !hasString(plugin, "id") ||
      !hasString(plugin, "version") ||
      !isSha256(plugin.artifactDigest)
    ) {
      return invalid("invalid published plugin identity", "decodePublishedResult");
    }
  }
  for (const promise of value.promises) {
    if (
      !isRecord(promise) ||
      !isPublishedObjectRef(promise.promise) ||
      typeof promise.status !== "string" ||
      !PROMISE_STATUSES.includes(promise.status as PromiseStatus) ||
      !hasStringArray(promise.reasonCodes)
    ) {
      return incompatible(
        "invalid or unknown published Promise status",
        "decodePublishedResult",
      );
    }
  }
  for (const proof of value.proofs) {
    if (
      !isRecord(proof) ||
      !isPublishedObjectRef(proof.proof) ||
      typeof proof.status !== "string" ||
      !PROOF_STATUSES.includes(proof.status as ProofExecutionStatus) ||
      !hasStringArray(proof.reasonCodes)
    ) {
      return incompatible(
        "invalid or unknown published Proof status",
        "decodePublishedResult",
      );
    }
  }
  for (const evidence of value.evidence) {
    if (
      !isRecord(evidence) ||
      !isPublishedObjectRef(evidence.evidence) ||
      !hasString(evidence, "evidenceType") ||
      !isNonNegativeInteger(evidence.byteSize) ||
      typeof evidence.sensitivityClass !== "string" ||
      !(PUBLISHED_SENSITIVITY_CLASSES as readonly string[]).includes(
        evidence.sensitivityClass,
      )
    ) {
      return invalid(
        "invalid published Evidence descriptor",
        "decodePublishedResult",
      );
    }
  }
  for (const key of [
    "promiseCount",
    "proofCount",
    "evidenceCount",
    "durationMs",
  ]) {
    if (!isNonNegativeInteger(value.summary[key])) {
      return invalid("invalid published summary", "decodePublishedResult");
    }
  }
  return {
    kind: "ok",
    value: value as unknown as PublishedVerificationResult,
  };
}

function decodeResult(
  value: unknown,
): ProtocolReadResult<CommandResult> {
  if (!isRecord(value) || typeof value.kind !== "string") {
    return invalid("result must have a kind", "decodeCommandEnvelope");
  }
  switch (value.kind) {
    case "verify":
      return decodeVerifyResult(value);
    case "dispatchVerification":
      return decodeDispatchResult(value);
    case "publishedVerification":
      return decodePublishedResult(value);
    case "getRun": {
      const nested = decodeCommandEnvelope(value.run);
      if (
        nested.kind !== "ok" ||
        nested.value.command !== "verify" ||
        nested.value.result?.kind !== "verify"
      ) {
        return invalid("getRun must contain a retained verify envelope", "decodeResult");
      }
      return { kind: "ok", value: value as unknown as CommandResult };
    }
    case "getPublishedRun": {
      if (!isRecord(value.run) || value.run.kind !== "publishedVerification") {
        return invalid(
          "getPublishedRun must contain a published projection",
          "decodeResult",
        );
      }
      const nested = decodePublishedResult(value.run);
      return nested.kind === "ok"
        ? { kind: "ok", value: value as unknown as CommandResult }
        : nested;
    }
    default:
      return incompatible("unknown result kind", "decodeCommandEnvelope");
  }
}

function validateVerifyStatusCombination(
  envelope: Record<string, unknown>,
  result: VerifyResult | null,
): ProtocolReadResult<true> {
  const status = envelope.operationalStatus as OperationalStatus;
  if (status === "completed" && result === null) {
    return invalid("completed verify requires a result", "decodeCommandEnvelope");
  }
  if (result === null || status === "completed") return { kind: "ok", value: true };
  if (
    result.outcome !== "not_evaluated" &&
    !(
      status === "blocked" &&
      result.outcome === "indeterminate" &&
      result.partial === true
    )
  ) {
    return invalid(
      "non-completed verify result has an invalid outcome",
      "decodeCommandEnvelope",
    );
  }
  return { kind: "ok", value: true };
}

export function decodeCommandEnvelope(
  value: unknown,
): ProtocolReadResult<AnyCommandEnvelope> {
  if (!isRecord(value)) {
    return invalid("command envelope must be an object", "decodeCommandEnvelope");
  }
  if (value.schemaVersion !== PROTOCOL_SCHEMA_MAJOR) {
    return {
      kind: "incompatible_result",
      error: protocolError(
        "VFY_COMPATIBILITY_UNSUPPORTED_SCHEMA",
        "unsupported command envelope schema major",
        "decodeCommandEnvelope",
      ),
    };
  }
  if (!isCommandName(value.command)) {
    return incompatible("unknown command", "decodeCommandEnvelope");
  }
  if (!isOperationalStatus(value.operationalStatus)) {
    return incompatible("unknown operational status", "decodeCommandEnvelope");
  }
  if (
    !hasString(value, "invocationId") ||
    !isRecord(value.engine) ||
    !hasString(value.engine, "version") ||
    !isSha256(value.engine.artifactDigest) ||
    !hasString(value, "startedAt") ||
    !isNonNegativeInteger(value.durationMs)
  ) {
    return invalid("invalid command envelope fields", "decodeCommandEnvelope");
  }
  const diagnostics = decodeDiagnostics(value.diagnostics);
  if (diagnostics.kind !== "ok") return diagnostics;

  let result: CommandResult | null = null;
  if (value.result !== null) {
    const decoded = decodeResult(value.result);
    if (decoded.kind !== "ok") return decoded;
    result = decoded.value;
    if (RESULT_KIND_FOR_COMMAND[value.command] !== result.kind) {
      return invalid(
        "command and result kind do not match",
        "decodeCommandEnvelope",
      );
    }
  }
  if (value.operationalStatus === "completed" && result === null) {
    return invalid("completed command requires a result", "decodeCommandEnvelope");
  }
  if (value.command === "verify") {
    const combination = validateVerifyStatusCombination(
      value,
      result as VerifyResult | null,
    );
    if (combination.kind !== "ok") return combination;
  }
  const envelope: AnyCommandEnvelope = {
    schemaVersion: PROTOCOL_SCHEMA_MAJOR,
    command: value.command,
    invocationId: value.invocationId as OpaqueId,
    engine: {
      version: value.engine.version as string,
      artifactDigest: value.engine.artifactDigest,
    },
    operationalStatus: value.operationalStatus,
    startedAt: value.startedAt as Rfc3339Utc,
    durationMs: value.durationMs as DurationMs,
    result,
    diagnostics: diagnostics.value,
  };
  return { kind: "ok", value: envelope };
}

function validRequestBase(value: Record<string, unknown>): boolean {
  return (
    value.schemaVersion === PROTOCOL_SCHEMA_MAJOR &&
    typeof value.invocationId === "string" &&
    Array.isArray(value.configurationReferences) &&
    value.configurationReferences.every((entry) => typeof entry === "string") &&
    Array.isArray(value.policyReferences) &&
    value.policyReferences.every((entry) => typeof entry === "string") &&
    Array.isArray(value.consentGrantReferences) &&
    value.consentGrantReferences.every((entry) => typeof entry === "string") &&
    typeof value.offline === "boolean" &&
    (value.deadlineMs === undefined ||
      (Number.isSafeInteger(value.deadlineMs) &&
        (value.deadlineMs as number) > 0)) &&
    (value.outputMode === "human" ||
      value.outputMode === "json" ||
      value.outputMode === "jsonl") &&
    isRecord(value.environment) &&
    typeof value.environment.platform === "string" &&
    Array.isArray(value.environment.allowlistedBindings) &&
    value.environment.allowlistedBindings.every(
      (entry) => typeof entry === "string",
    ) &&
    value.arguments !== undefined
  );
}

export function decodeCommandRequest(
  value: unknown,
): ProtocolReadResult<AnyCommandRequest> {
  if (!isRecord(value)) {
    return invalid("command request must be an object", "decodeCommandRequest");
  }
  if (value.schemaVersion !== PROTOCOL_SCHEMA_MAJOR) {
    return {
      kind: "incompatible_result",
      error: protocolError(
        "VFY_COMPATIBILITY_UNSUPPORTED_SCHEMA",
        "unsupported command request schema major",
        "decodeCommandRequest",
      ),
    };
  }
  if (!isCommandName(value.command)) {
    return incompatible("unknown command", "decodeCommandRequest");
  }
  if (!validRequestBase(value)) {
    return invalid("invalid common request fields", "decodeCommandRequest");
  }
  switch (value.command) {
    case "verify":
      if (
        !isRecord(value.workspace) ||
        typeof value.workspace.rootBinding !== "string" ||
        (value.workspace.expectedRevision !== undefined &&
          !isSha256(value.workspace.expectedRevision))
      ) {
        return invalid("verify requires a valid workspace", "decodeCommandRequest");
      }
      break;
    case "dispatchVerification":
      if (
        !isRecord(value.arguments) ||
        typeof value.arguments.workloadBinding !== "string" ||
        typeof value.arguments.idempotencyKey !== "string" ||
        decodeCommandRequest(value.arguments.verifyRequest).kind !== "ok"
      ) {
        return invalid(
          "dispatchVerification requires a workload and nested verify request",
          "decodeCommandRequest",
        );
      }
      break;
    case "getRun":
      if (!isRecord(value.arguments) || typeof value.arguments.runId !== "string") {
        return invalid("getRun requires runId", "decodeCommandRequest");
      }
      break;
    case "getPublishedRun":
      if (
        !isRecord(value.arguments) ||
        typeof value.arguments.publishedRunId !== "string"
      ) {
        return invalid(
          "getPublishedRun requires publishedRunId",
          "decodeCommandRequest",
        );
      }
      break;
    case "publishedVerification":
      break;
  }
  return { kind: "ok", value: value as unknown as AnyCommandRequest };
}
