import type {
  ByteCount,
  CanonicalValue,
  DataClassification,
  OpaqueId,
  Rfc3339Utc,
  Sha256Digest,
} from "./primitives.js";
import type {
  Confidence,
  PermissionRequest,
  ProducerRef,
} from "./model.js";
import type {
  RevisionRef,
} from "./revisions.js";

export interface ProofAttemptRef {
  readonly attemptId: OpaqueId;
  readonly proof: RevisionRef;
  readonly invocationId: OpaqueId;
}

export interface CustodyStep {
  readonly sequence: number;
  readonly action: "captured" | "normalized" | "classified" | "redacted" | "persisted";
  readonly actor: ProducerRef;
  readonly inputDigest?: Sha256Digest;
  readonly outputDigest: Sha256Digest;
  readonly occurredAt: Rfc3339Utc;
}

export interface Evidence {
  readonly id: OpaqueId;
  readonly revision: Sha256Digest;
  readonly schemaVersion: number;
  readonly evidenceType: string;
  readonly mediaType: string;
  readonly producer: ProducerRef;
  readonly captureMethod: string;
  readonly capturedAt: Rfc3339Utc;
  readonly attempt: ProofAttemptRef;
  readonly subjects: readonly RevisionRef[];
  readonly inputRefs: readonly RevisionRef[];
  readonly contentDigest: Sha256Digest;
  readonly byteSize: ByteCount;
  readonly classification: DataClassification;
  readonly chainOfCustody: readonly CustodyStep[];
  readonly supersedes: readonly RevisionRef[];
}

export interface JsonPatchOperation {
  readonly operation: "add" | "remove" | "replace";
  readonly pointer: string;
  readonly value?: CanonicalValue;
}

export type RepairAction =
  | {
      readonly kind: "jsonPatch";
      readonly target: string;
      readonly expectedContentDigest: Sha256Digest;
      readonly operations: readonly JsonPatchOperation[];
    }
  | {
      readonly kind: "advisoryInstruction";
      readonly instructionCode: string;
      readonly parameters: CanonicalValue;
    };

export interface LlmGenerationProvenance {
  readonly model: string;
  readonly promptTemplateDigest: Sha256Digest;
  readonly parameters: CanonicalValue;
}

export interface RepairSuggestion {
  readonly id: OpaqueId;
  readonly revision: Sha256Digest;
  readonly schemaVersion: number;
  readonly motivatingPromise: RevisionRef;
  readonly motivatingExecution: ProofAttemptRef;
  readonly evidence: readonly RevisionRef[];
  readonly generator: ProducerRef;
  readonly action: RepairAction;
  readonly assumptions: readonly string[];
  readonly requiredPermissions: PermissionRequest;
  readonly expectedEffect: string;
  readonly confidence: Confidence;
  readonly verificationPlan: RevisionRef;
  readonly llmGeneration?: LlmGenerationProvenance;
}
