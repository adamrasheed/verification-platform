import type {
  ByteCount,
  CanonicalValue,
  DataClassification,
  DurationMs,
  Evidence,
  ExecutionManifest,
  OpaqueId,
  ProofAttemptRef,
  PublishedObjectRef,
  RepairSuggestion,
  RevisionRef,
  Rfc3339Utc,
  Sha256Digest,
} from "@verify-internal/contracts";
import type { StructuredError } from "./errors.js";

export const PROTOCOL_SCHEMA_MAJOR = 1 as const;

export type OutputMode = "human" | "json" | "jsonl";

export interface WorkspaceBinding {
  readonly rootBinding: OpaqueId;
  readonly expectedRevision?: Sha256Digest;
}

export interface CommandEnvironment {
  readonly platform: string;
  readonly allowlistedBindings: readonly OpaqueId[];
}

export interface CommandRequest<
  TCommand extends CommandName,
  TArguments extends CanonicalValue = CanonicalValue,
> {
  readonly schemaVersion: typeof PROTOCOL_SCHEMA_MAJOR;
  readonly command: TCommand;
  readonly invocationId: OpaqueId;
  readonly arguments: TArguments;
  readonly configurationReferences: readonly OpaqueId[];
  readonly policyReferences: readonly OpaqueId[];
  readonly consentGrantReferences: readonly OpaqueId[];
  readonly offline: boolean;
  readonly deadlineMs?: DurationMs;
  readonly outputMode: OutputMode;
  readonly environment: CommandEnvironment;
}

export interface VerifyRequest
  extends CommandRequest<"verify", CanonicalValue> {
  readonly workspace: WorkspaceBinding;
}

export interface DispatchVerificationArguments {
  readonly workloadBinding: OpaqueId;
  readonly verifyRequest: VerifyRequest;
  readonly idempotencyKey: OpaqueId;
}

export interface DispatchVerificationRequest
  extends CommandRequest<
    "dispatchVerification",
    DispatchVerificationArguments & CanonicalValue
  > {}

export interface PublishedVerificationRequest
  extends CommandRequest<"publishedVerification", CanonicalValue> {}

export interface GetRunArguments {
  readonly runId: OpaqueId;
}

export interface GetRunRequest
  extends CommandRequest<"getRun", GetRunArguments & CanonicalValue> {}

export interface GetPublishedRunArguments {
  readonly publishedRunId: OpaqueId;
}

export interface GetPublishedRunRequest
  extends CommandRequest<
    "getPublishedRun",
    GetPublishedRunArguments & CanonicalValue
  > {}

export type AnyCommandRequest =
  | VerifyRequest
  | DispatchVerificationRequest
  | PublishedVerificationRequest
  | GetRunRequest
  | GetPublishedRunRequest;

export type CommandName =
  | "verify"
  | "dispatchVerification"
  | "publishedVerification"
  | "getRun"
  | "getPublishedRun";

export type OperationalStatus =
  | "completed"
  | "invalid"
  | "blocked"
  | "cancelled"
  | "internal_error";

export type VerifyOutcome =
  | "satisfied"
  | "violated"
  | "indeterminate"
  | "not_evaluated";

export type PromiseStatus = "satisfied" | "violated" | "indeterminate";

export type ProofExecutionStatus =
  | "passed"
  | "failed"
  | "indeterminate"
  | "error"
  | "cancelled";

export interface EngineIdentity {
  readonly version: string;
  readonly artifactDigest: Sha256Digest;
}

export interface CommandEnvelope<TResult extends CommandResult | null> {
  readonly schemaVersion: typeof PROTOCOL_SCHEMA_MAJOR;
  readonly command: CommandName;
  readonly invocationId: OpaqueId;
  readonly engine: EngineIdentity;
  readonly operationalStatus: OperationalStatus;
  readonly startedAt: Rfc3339Utc;
  readonly durationMs: DurationMs;
  readonly result: TResult;
  readonly diagnostics: readonly StructuredError[];
}

export interface VerificationSummary {
  readonly requiredPromiseCount: number;
  readonly advisoryPromiseCount: number;
  readonly satisfiedCount: number;
  readonly violatedCount: number;
  readonly indeterminateCount: number;
}

/**
 * Local Promise projection. Every identity is revision-addressed and every
 * contributing attempt is explicit; adapters do not collapse these to string
 * IDs or recalculate the command-level outcome.
 */
export interface LocalPromiseResult {
  readonly promise: RevisionRef;
  readonly status: PromiseStatus;
  readonly proofAttempts: readonly ProofAttemptRef[];
  readonly evidence: readonly RevisionRef[];
  readonly reasonCodes: readonly string[];
}

export type ProofLifecycleState =
  | "queued"
  | "running"
  | "passed"
  | "failed"
  | "indeterminate"
  | "error"
  | "cancelled";

export type LocalProofResult =
  | {
      readonly status: "passed";
      readonly evidence: readonly RevisionRef[];
    }
  | {
      readonly status: "failed" | "indeterminate";
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
 * Canonical local Proof attempt projection from EDD §10. The manifest link is
 * explicit so result digests remain traceable to the exact execution inputs.
 */
export interface LocalProofExecution {
  readonly attemptId: OpaqueId;
  readonly attemptRef: ProofAttemptRef;
  readonly proof: RevisionRef;
  readonly promise: RevisionRef;
  readonly model: RevisionRef;
  readonly executionContext: RevisionRef;
  readonly planKey: Sha256Digest;
  readonly executionManifest: RevisionRef;
  readonly state: ProofLifecycleState;
  readonly effective: boolean;
  readonly startedAt?: Rfc3339Utc;
  readonly completedAt?: Rfc3339Utc;
  readonly evidence: readonly RevisionRef[];
  readonly result?: LocalProofResult;
  readonly resultDigest?: Sha256Digest;
  readonly attemptRecordDigest?: Sha256Digest;
}

export type LocalExecutionManifest = ExecutionManifest;
export type LocalEvidenceRecord = Evidence;
export type LocalRepairRecord = RepairSuggestion;

export interface VerifyResult {
  readonly kind: "verify";
  readonly outcome: VerifyOutcome;
  readonly partial?: true;
  readonly workspace?: {
    readonly rootBinding: OpaqueId;
    readonly packageManager?: string;
    readonly modelRevision: Sha256Digest;
  };
  readonly reasonCodes?: readonly string[];
  readonly applicationModel: RevisionRef;
  readonly summary: VerificationSummary;
  readonly promises: readonly LocalPromiseResult[];
  readonly proofExecutions: readonly LocalProofExecution[];
  readonly evidence: readonly RevisionRef[];
  readonly evidenceRecords?: readonly LocalEvidenceRecord[];
  readonly repairs: readonly RevisionRef[];
  readonly repairRecords?: readonly LocalRepairRecord[];
  readonly executionManifests: readonly LocalExecutionManifest[];
  readonly cacheDecisions: readonly CanonicalValue[];
}

export type DispatchState =
  | "accepted"
  | "unavailable"
  | "unauthorized"
  | "expired"
  | "cancelled"
  | "transport_error";

export interface DispatchVerificationResult {
  readonly kind: "dispatchVerification";
  readonly dispatchId: OpaqueId;
  readonly state: DispatchState;
  readonly workloadBinding: OpaqueId;
  readonly verifyInvocationId?: OpaqueId;
  readonly publishedRunId?: OpaqueId;
  readonly reasonCodes: readonly string[];
}

export interface PublishedArtifactIdentity {
  readonly id: string;
  readonly version: string;
  readonly artifactDigest: Sha256Digest;
}

export interface PublishedPromiseResult {
  readonly promise: PublishedObjectRef;
  readonly status: PromiseStatus;
  readonly reasonCodes: readonly string[];
}

export interface PublishedProofResult {
  readonly proof: PublishedObjectRef;
  readonly status: ProofExecutionStatus;
  readonly reasonCodes: readonly string[];
  readonly durationMs?: DurationMs;
}

export interface PublishedEvidenceDescriptor {
  readonly evidence: PublishedObjectRef;
  readonly evidenceType: string;
  readonly byteSize: ByteCount;
  readonly sensitivityClass: Exclude<DataClassification, "SECRET">;
}

export interface PublishedVerificationSummary {
  readonly promiseCount: number;
  readonly proofCount: number;
  readonly evidenceCount: number;
  readonly durationMs: DurationMs;
}

export interface PublishedVerificationResult {
  readonly kind: "publishedVerification";
  readonly purpose: string;
  readonly tenantId: OpaqueId;
  readonly projectId: OpaqueId;
  readonly runId: OpaqueId;
  readonly idempotencyKey: OpaqueId;
  readonly applicationModel: PublishedObjectRef;
  readonly operationalStatus: OperationalStatus;
  readonly outcome: VerifyOutcome;
  readonly engine: PublishedArtifactIdentity;
  readonly protocolVersion: number;
  readonly plugins: readonly PublishedArtifactIdentity[];
  readonly promises: readonly PublishedPromiseResult[];
  readonly proofs: readonly PublishedProofResult[];
  readonly evidence: readonly PublishedEvidenceDescriptor[];
  readonly summary: PublishedVerificationSummary;
  readonly applicationAlias?: string;
  readonly auditCorrelationId: OpaqueId;
  readonly retentionClass: string;
}

export interface GetRunResult {
  readonly kind: "getRun";
  readonly run: CommandEnvelope<VerifyResult>;
}

export interface GetPublishedRunResult {
  readonly kind: "getPublishedRun";
  readonly run: PublishedVerificationResult;
}

export type CommandResult =
  | VerifyResult
  | DispatchVerificationResult
  | PublishedVerificationResult
  | GetRunResult
  | GetPublishedRunResult;

export type AnyCommandEnvelope = CommandEnvelope<CommandResult | null>;

export const RESULT_KIND_FOR_COMMAND: Readonly<
  Record<CommandName, CommandResult["kind"]>
> = {
  verify: "verify",
  dispatchVerification: "dispatchVerification",
  publishedVerification: "publishedVerification",
  getRun: "getRun",
  getPublishedRun: "getPublishedRun",
};
