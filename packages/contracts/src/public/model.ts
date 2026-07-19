import type {
  CanonicalValue,
  ExtensionEntry,
  OpaqueId,
  Ratio,
  Sha256Digest,
} from "./primitives.js";
import type {
  RevisionRef,
} from "./revisions.js";

export interface ProducerRef {
  readonly id: OpaqueId;
  readonly version: string;
  readonly artifactDigest: Sha256Digest;
}

export interface SchemaRef {
  readonly id: string;
  readonly schemaVersion: number;
  readonly revision: Sha256Digest;
}

export interface ProvenanceRecord {
  readonly producer: ProducerRef;
  readonly method: string;
  readonly inputs: readonly RevisionRef[];
  readonly details: readonly ExtensionEntry[];
}

export interface ScopeRef {
  readonly workspaceId: OpaqueId;
  readonly applicationId?: OpaqueId;
  readonly relativeRoot: string;
}

export interface Confidence {
  readonly value: Ratio;
  readonly basis: "declared" | "policy" | "deterministic_rule" | "heuristic";
  readonly ruleId: string;
  readonly signalRefs: readonly OpaqueId[];
}

export interface ApplicabilityExpression {
  readonly language: SchemaRef;
  readonly expression: CanonicalValue;
}

export interface PredicateExpression {
  readonly language: SchemaRef;
  readonly operator: string;
  readonly arguments: readonly CanonicalValue[];
}

export interface Application {
  readonly id: OpaqueId;
  readonly revision: Sha256Digest;
  readonly schemaVersion: number;
  readonly workspaceId: OpaqueId;
  readonly root: string;
  readonly packageIdentity?: string;
  readonly provenance: readonly ProvenanceRecord[];
  readonly extensions: readonly ExtensionEntry[];
}

export interface Capability {
  readonly id: OpaqueId;
  readonly revision: Sha256Digest;
  readonly schemaVersion: number;
  readonly application: RevisionRef;
  readonly type: string;
  readonly scope: ScopeRef;
  readonly activation: "candidate" | "active" | "retired";
  readonly confidence: Confidence;
  readonly provenance: readonly ProvenanceRecord[];
  readonly extensions: readonly ExtensionEntry[];
}

export interface PromiseDefinition {
  readonly id: OpaqueId;
  readonly revision: Sha256Digest;
  readonly schemaVersion: number;
  readonly subject: RevisionRef;
  readonly capability: RevisionRef;
  readonly predicate: PredicateExpression;
  readonly expected: CanonicalValue;
  readonly criticality: "required" | "advisory";
  readonly provenanceKind: "declared" | "policy" | "discovered";
  readonly applicability: ApplicabilityExpression;
  readonly owner?: string;
  readonly provenance: readonly ProvenanceRecord[];
}

export type PromiseStatus = "satisfied" | "violated" | "indeterminate";
export type ProofVerdict = "passed" | "failed" | "indeterminate";

export interface InputRequirement {
  readonly name: string;
  readonly sourceType: string;
  readonly schema: SchemaRef;
  readonly required: boolean;
}

export interface EvidenceRequirement {
  readonly identity: OpaqueId;
  readonly evidenceType: string;
  readonly mediaTypes: readonly string[];
  readonly minimumCount: number;
  readonly validationSchema: SchemaRef;
}

export interface FilesystemPermission {
  readonly mode: "read" | "write";
  readonly root: string;
}

export interface NetworkPermission {
  readonly brokerDestination: string;
  readonly operations: readonly string[];
}

export interface SecretPermission {
  readonly bindingId: OpaqueId;
  readonly audience: string;
  readonly scopes: readonly string[];
}

export interface PermissionRequest {
  readonly filesystem: readonly FilesystemPermission[];
  readonly network: readonly NetworkPermission[];
  readonly subprocess: boolean;
  readonly secrets: readonly SecretPermission[];
}

export interface CachePolicy {
  readonly mode: "disabled" | "content_addressed";
  readonly maximumAgeMs?: number;
}

export interface RetryPolicy {
  readonly maximumAttempts: number;
  readonly retryableOperations: readonly string[];
}

export interface ProofDefinition {
  readonly id: OpaqueId;
  readonly revision: Sha256Digest;
  readonly schemaVersion: number;
  readonly evaluator: ProducerRef;
  readonly predicateLanguage: SchemaRef;
  readonly inputs: readonly InputRequirement[];
  readonly evidenceRequirements: readonly EvidenceRequirement[];
  readonly dependencies: readonly RevisionRef[];
  readonly permissions: PermissionRequest;
  readonly reproducibility: "hermetic" | "replayable" | "observational";
  readonly cachePolicy: CachePolicy;
  readonly timeoutMs: number;
  readonly retryPolicy: RetryPolicy;
  readonly applicability: ApplicabilityExpression;
  readonly provenance: readonly ProvenanceRecord[];
}

export interface PromiseProofBinding {
  readonly id: OpaqueId;
  readonly revision: Sha256Digest;
  readonly schemaVersion: number;
  readonly modelScope: ScopeRef;
  readonly promise: RevisionRef;
  readonly proof: RevisionRef;
  readonly requirement: "required" | "advisory";
  readonly order: number;
  readonly applicability: ApplicabilityExpression;
  readonly provenance: readonly ProvenanceRecord[];
}

export interface ProviderBinding {
  readonly id: OpaqueId;
  readonly revision: Sha256Digest;
  readonly schemaVersion: number;
  readonly plugin: ProducerRef;
  readonly target: RevisionRef;
  readonly supportedCapabilityTypes: readonly string[];
  readonly configurationRefs: readonly RevisionRef[];
  readonly authenticationBindingIds: readonly OpaqueId[];
  readonly attributes: readonly ExtensionEntry[];
  readonly provenance: readonly ProvenanceRecord[];
}

export interface ApplicationModel {
  readonly id: OpaqueId;
  readonly revision: Sha256Digest;
  readonly schemaVersion: number;
  readonly scope: ScopeRef;
  readonly applications: readonly RevisionRef[];
  readonly capabilities: readonly RevisionRef[];
  readonly promises: readonly RevisionRef[];
  readonly proofs: readonly RevisionRef[];
  readonly promiseProofBindings: readonly RevisionRef[];
  readonly providerBindings: readonly RevisionRef[];
  readonly repairKnowledge: readonly RevisionRef[];
  readonly policyRevision?: RevisionRef;
  readonly configurationRevision?: RevisionRef;
  readonly provenance: readonly ProvenanceRecord[];
}

export type ModelGraphErrorCode =
  | "CROSS_SCOPE_BINDING"
  | "CYCLIC_PROOF_DEPENDENCY"
  | "DANGLING_BINDING"
  | "DUPLICATE_BINDING"
  | "MISSING_PROMISE_BINDING"
  | "WRONG_REFERENCE_KIND";

export class ModelGraphError extends TypeError {
  readonly code: ModelGraphErrorCode;

  constructor(code: ModelGraphErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "ModelGraphError";
    this.code = code;
  }
}

export interface ModelGraphObjects {
  readonly promises: readonly PromiseDefinition[];
  readonly proofs: readonly ProofDefinition[];
  readonly bindings: readonly PromiseProofBinding[];
}

function refKey(ref: RevisionRef): string {
  return `${ref.kind}\0${ref.id}\0${ref.revision}\0${ref.schemaVersion}`;
}

/**
 * Enforces the constructibility invariants introduced by ADR-0010. It does not
 * seal a model or select current revisions; those are Engine responsibilities.
 */
export function assertValidApplicationModelGraph(
  model: ApplicationModel,
  objects: ModelGraphObjects,
): void {
  const modelPromiseRefs = new Set(model.promises.map(refKey));
  const modelProofRefs = new Set(model.proofs.map(refKey));
  const promises = new Set(
    objects.promises.map((item) =>
      refKey({
        kind: "promise",
        id: item.id,
        revision: item.revision,
        schemaVersion: item.schemaVersion,
      }),
    ),
  );
  const proofs = new Map(
    objects.proofs.map((item) => [
      refKey({
        kind: "proof",
        id: item.id,
        revision: item.revision,
        schemaVersion: item.schemaVersion,
      }),
      item,
    ]),
  );
  const bindings = new Map(
    objects.bindings.map((item) => [
      refKey({
        kind: "promiseProofBinding",
        id: item.id,
        revision: item.revision,
        schemaVersion: item.schemaVersion,
      }),
      item,
    ]),
  );

  for (const bindingRef of model.promiseProofBindings) {
    if (bindingRef.kind !== "promiseProofBinding") {
      throw new ModelGraphError("WRONG_REFERENCE_KIND", "model binding reference has the wrong kind");
    }
    if (!bindings.has(refKey(bindingRef))) {
      throw new ModelGraphError("DANGLING_BINDING", "model references an unavailable binding revision");
    }
  }

  const associations = new Set<string>();
  const boundPromises = new Set<string>();
  for (const binding of objects.bindings) {
    if (binding.promise.kind !== "promise" || binding.proof.kind !== "proof") {
      throw new ModelGraphError("WRONG_REFERENCE_KIND", "binding endpoints must be Promise and Proof");
    }
    if (
      binding.modelScope.workspaceId !== model.scope.workspaceId
      || binding.modelScope.applicationId !== model.scope.applicationId
      || binding.modelScope.relativeRoot !== model.scope.relativeRoot
    ) {
      throw new ModelGraphError("CROSS_SCOPE_BINDING", "binding scope differs from its model scope");
    }
    if (
      !modelPromiseRefs.has(refKey(binding.promise))
      || !promises.has(refKey(binding.promise))
      || !modelProofRefs.has(refKey(binding.proof))
      || !proofs.has(refKey(binding.proof))
    ) {
      throw new ModelGraphError("DANGLING_BINDING", "binding endpoint is not sealed in the model");
    }
    const association = `${refKey(binding.promise)}\0${refKey(binding.proof)}`;
    if (associations.has(association)) {
      throw new ModelGraphError("DUPLICATE_BINDING", "Promise-Proof association is duplicated");
    }
    associations.add(association);
    boundPromises.add(refKey(binding.promise));
  }
  for (const promiseRef of model.promises) {
    if (promiseRef.kind !== "promise") {
      throw new ModelGraphError("WRONG_REFERENCE_KIND", "model Promise reference has the wrong kind");
    }
    if (!boundPromises.has(refKey(promiseRef))) {
      throw new ModelGraphError("MISSING_PROMISE_BINDING", "model Promise has no applicable binding definition");
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (proofKey: string): void => {
    if (visiting.has(proofKey)) {
      throw new ModelGraphError("CYCLIC_PROOF_DEPENDENCY", "Proof dependency cycle detected");
    }
    if (visited.has(proofKey)) return;
    visiting.add(proofKey);
    const proof = proofs.get(proofKey);
    if (!proof) {
      throw new ModelGraphError("DANGLING_BINDING", "Proof dependency is unavailable");
    }
    for (const dependency of proof.dependencies) {
      if (dependency.kind !== "proof") {
        throw new ModelGraphError("WRONG_REFERENCE_KIND", "Proof dependency has the wrong kind");
      }
      const dependencyKey = refKey(dependency);
      if (!modelProofRefs.has(dependencyKey) || !proofs.has(dependencyKey)) {
        throw new ModelGraphError("DANGLING_BINDING", "Proof dependency is not sealed in the model");
      }
      visit(dependencyKey);
    }
    visiting.delete(proofKey);
    visited.add(proofKey);
  };
  for (const proofKey of proofs.keys()) visit(proofKey);
}
