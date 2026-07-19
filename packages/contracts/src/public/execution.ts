import type {
  CanonicalValue,
  OpaqueId,
  Sha256Digest,
} from "./primitives.js";
import type {
  ProducerRef,
} from "./model.js";
import type {
  RevisionRef,
} from "./revisions.js";

export interface PlannedProof {
  readonly binding: RevisionRef;
  readonly promise: RevisionRef;
  readonly proof: RevisionRef;
  readonly requirement: "required" | "advisory";
  readonly order: number;
  readonly dependencyProofs: readonly RevisionRef[];
}

export interface ExecutionPlan {
  readonly id: OpaqueId;
  readonly revision: Sha256Digest;
  readonly schemaVersion: number;
  readonly applicationModel: RevisionRef;
  readonly executionContext: RevisionRef;
  readonly proofs: readonly PlannedProof[];
  readonly policyRevision?: RevisionRef;
  readonly configurationRevision?: RevisionRef;
  readonly discoveryOutputDigest: Sha256Digest;
}

export interface ArtifactIdentity {
  readonly id: string;
  readonly version: string;
  readonly artifactDigest: Sha256Digest;
}

export interface SourceIdentity {
  readonly inputDigest: Sha256Digest;
  readonly repositoryState: "clean" | "dirty" | "unknown";
}

export interface PlatformIdentity {
  readonly operatingSystem: string;
  readonly architecture: string;
  readonly runtimeVersions: readonly ArtifactIdentity[];
  readonly toolchainVersions: readonly ArtifactIdentity[];
}

export interface IsolationPolicy {
  readonly filesystem: CanonicalValue;
  readonly network: CanonicalValue;
  readonly clock: CanonicalValue;
  readonly randomness: CanonicalValue;
  readonly enforcementTier: string;
}

export interface ExecutionManifest {
  readonly id: OpaqueId;
  readonly revision: Sha256Digest;
  readonly schemaVersion: number;
  readonly engine: ProducerRef;
  readonly applicationModel: RevisionRef;
  readonly promises: readonly RevisionRef[];
  readonly proof: RevisionRef;
  readonly pluginsAndTools: readonly ArtifactIdentity[];
  readonly source: SourceIdentity;
  readonly configurationDigest: Sha256Digest;
  readonly policyDigest: Sha256Digest;
  readonly platform: PlatformIdentity;
  readonly authenticationBindingIds: readonly OpaqueId[];
  readonly isolation: IsolationPolicy;
  readonly discoveryOutputDigest: Sha256Digest;
  readonly executionPlan: RevisionRef;
  readonly executionPlanDigest: Sha256Digest;
}
