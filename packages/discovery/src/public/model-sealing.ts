import { createHash } from "node:crypto";
import {
  CanonicalRevisionDeriver,
  CanonicalSemanticIdDeriver,
  assertValidApplicationModelGraph,
  canonicalize,
} from "@verify-internal/contracts";
import type {
  ApplicabilityExpression,
  Application,
  ApplicationModel,
  CanonicalValue,
  Capability,
  Confidence,
  OpaqueId,
  PromiseDefinition,
  PromiseProofBinding,
  ProofDefinition,
  ProvenanceRecord,
  RevisionRef,
  ScopeRef,
  Sha256Digest,
} from "@verify-internal/contracts";
import type { WorkspaceDiscovery } from "./index.js";

export type MvpWorkspacePredicate =
  | "manifest.structuralValidity"
  | "workspace.uniqueMembership"
  | "workspace.localDependencyReference"
  | "workspace.singleLockfileOwnership";

export interface SealableProofDefinition {
  readonly predicate: MvpWorkspacePredicate;
  readonly definition: ProofDefinition;
}

export interface SealedWorkspaceModel {
  readonly model: ApplicationModel;
  readonly applications: readonly Application[];
  readonly capabilities: readonly Capability[];
  readonly promises: readonly PromiseDefinition[];
  readonly proofs: readonly ProofDefinition[];
  readonly bindings: readonly PromiseProofBinding[];
}

export type WorkspaceModelResolution =
  | {
      readonly status: "sealed";
      readonly graph: SealedWorkspaceModel;
      readonly diagnostics: readonly [];
    }
  | {
      readonly status: "not_evaluated" | "invalid";
      readonly diagnostics: readonly { readonly code: string; readonly message: string }[];
    };

function sha256(bytes: Uint8Array): Sha256Digest {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

const semanticIds = new CanonicalSemanticIdDeriver(sha256);
const revisions = new CanonicalRevisionDeriver(sha256);
const producer = {
  id: "engine:passive-workspace-resolver" as OpaqueId,
  version: "1",
  artifactDigest: sha256(new TextEncoder().encode("passive-workspace-resolver:v1")),
};
const predicateLanguage = {
  id: "predicate.workspace-integrity",
  schemaVersion: 1,
  revision: sha256(new TextEncoder().encode("predicate.workspace-integrity:v1")),
};
const applicabilityLanguage = {
  id: "applicability.constant",
  schemaVersion: 1,
  revision: sha256(new TextEncoder().encode("applicability.constant:v1")),
};

function canonical(value: unknown): CanonicalValue {
  return JSON.parse(JSON.stringify(value)) as CanonicalValue;
}

async function revision(
  kind: RevisionRef["kind"],
  id: OpaqueId,
  payload: unknown,
): Promise<Sha256Digest> {
  return revisions.derive({
    kind,
    id,
    schemaVersion: 1,
    payload: canonical(payload),
  });
}

function ref(
  kind: RevisionRef["kind"],
  object: { readonly id: OpaqueId; readonly revision: Sha256Digest; readonly schemaVersion: number },
): RevisionRef {
  return { kind, id: object.id, revision: object.revision, schemaVersion: object.schemaVersion };
}

function provenance(method: string, inputs: readonly RevisionRef[] = []): readonly ProvenanceRecord[] {
  return [{ producer, method, inputs, details: [] }];
}

function predicateId(predicate: MvpWorkspacePredicate): string {
  return `predicate:${predicate}:v1`;
}

export async function resolveAndSealWorkspaceModel(
  discovery: WorkspaceDiscovery,
  proofRegistry: readonly SealableProofDefinition[],
): Promise<WorkspaceModelResolution> {
  if (discovery.packageManagers.length === 0) {
    return {
      status: "not_evaluated",
      diagnostics: [{ code: "UNSUPPORTED_ECOSYSTEM", message: "No supported workspace ecosystem was discovered." }],
    };
  }
  if (discovery.completion !== "complete") {
    return {
      status: "invalid",
      diagnostics: [{ code: "INCOMPLETE_DISCOVERY", message: "Only complete discovery can be sealed." }],
    };
  }
  const workspaceManifests = discovery.manifests.filter((item) => item.workspaceMember);
  if (workspaceManifests.length === 0) {
    return {
      status: "invalid",
      diagnostics: [{
        code: "AMBIGUOUS_APPLICATION_IDENTITY",
        message: "The workspace has no bounded Application candidate.",
      }],
    };
  }
  const registryByPredicate = new Map(
    proofRegistry.map((entry) => [entry.predicate, entry] as const),
  );
  const predicates: readonly MvpWorkspacePredicate[] = [
    "manifest.structuralValidity",
    "workspace.uniqueMembership",
    "workspace.localDependencyReference",
    "workspace.singleLockfileOwnership",
  ];
  if (
    registryByPredicate.size !== predicates.length
    || predicates.some((predicate) => !registryByPredicate.has(predicate))
  ) {
    return {
      status: "invalid",
      diagnostics: [{
        code: "INCOMPLETE_PROOF_REGISTRY",
        message: "All four exact MVP Proof definitions must exist before model sealing.",
      }],
    };
  }

  const applications: Application[] = [];
  for (const manifest of workspaceManifests) {
    const root = manifest.path === "package.json"
      ? "."
      : manifest.path.slice(0, -"/package.json".length);
    const packageIdentity = manifest.name;
    const identityKey = packageIdentity ?? `unnamed:${root}`;
    const id = await semanticIds.derive({
      kind: "application",
      schemaVersion: 1,
      naturalKey: {
        workspaceId: discovery.workspaceBinding,
        root,
        packageIdentity: identityKey,
      },
    });
    const fields = {
      workspaceId: discovery.workspaceBinding as OpaqueId,
      root,
      ...(packageIdentity === undefined ? {} : { packageIdentity }),
      provenance: provenance("passive-package-manifest"),
      extensions: [],
    };
    applications.push({
      id,
      revision: await revision("application", id, fields),
      schemaVersion: 1,
      ...fields,
    });
  }
  applications.sort((left, right) => left.root < right.root ? -1 : left.root > right.root ? 1 : 0);
  const rootApplication = applications.find((item) => item.root === ".") ?? applications[0];
  if (!rootApplication) throw new TypeError("sealed model unexpectedly has no Application");
  const applicationRef = ref("application", rootApplication);
  const scope: ScopeRef = {
    workspaceId: discovery.workspaceBinding as OpaqueId,
    applicationId: rootApplication.id,
    relativeRoot: ".",
  };
  const confidence: Confidence = {
    value: 1 as Confidence["value"],
    basis: "deterministic_rule",
    ruleId: "workspace.supported-ecosystem.v1",
    signalRefs: [],
  };
  const capabilityId = await semanticIds.derive({
    kind: "capability",
    schemaVersion: 1,
    naturalKey: {
      applicationId: rootApplication.id,
      capabilityType: "workspace.dependencyIntegrity",
      scope,
    },
  });
  const capabilityFields = {
    application: applicationRef,
    type: "workspace.dependencyIntegrity",
    scope,
    activation: "active" as const,
    confidence,
    provenance: provenance("supported-workspace-rule", [applicationRef]),
    extensions: [],
  };
  const capability: Capability = {
    id: capabilityId,
    revision: await revision("capability", capabilityId, capabilityFields),
    schemaVersion: 1,
    ...capabilityFields,
  };
  const capabilityRef = ref("capability", capability);
  const applicability: ApplicabilityExpression = {
    language: applicabilityLanguage,
    expression: true,
  };

  const promises: PromiseDefinition[] = [];
  const bindings: PromiseProofBinding[] = [];
  for (const [order, predicate] of predicates.entries()) {
    const proof = registryByPredicate.get(predicate)?.definition;
    if (!proof) throw new TypeError("Proof registry changed during model resolution");
    const proofRef = ref("proof", proof);
    const promiseId = await semanticIds.derive({
      kind: "promise",
      schemaVersion: 1,
      naturalKey: {
        subjectId: rootApplication.id,
        predicateId: predicateId(predicate),
        scope,
      },
    });
    const promiseFields = {
      subject: applicationRef,
      capability: capabilityRef,
      predicate: {
        language: predicateLanguage,
        operator: predicate,
        arguments: [],
      },
      expected: true,
      criticality: "required" as const,
      provenanceKind: "discovered" as const,
      applicability,
      provenance: provenance("mvp-workspace-promise-rule", [applicationRef, capabilityRef]),
    };
    const promise: PromiseDefinition = {
      id: promiseId,
      revision: await revision("promise", promiseId, promiseFields),
      schemaVersion: 1,
      ...promiseFields,
    };
    promises.push(promise);
    const promiseRef = ref("promise", promise);
    const bindingId = `binding:${sha256(
      new TextEncoder().encode(canonicalize(canonical({
        domain: "verification-platform/promise-proof-binding-id",
        promise: promiseRef,
        proof: proofRef,
        scope,
      }))),
    ).slice("sha256:".length)}` as OpaqueId;
    const bindingFields = {
      modelScope: scope,
      promise: promiseRef,
      proof: proofRef,
      requirement: "required" as const,
      order,
      applicability,
      provenance: provenance("mvp-proof-registry-binding", [promiseRef, proofRef]),
    };
    bindings.push({
      id: bindingId,
      revision: await revision("promiseProofBinding", bindingId, bindingFields),
      schemaVersion: 1,
      ...bindingFields,
    });
  }

  const proofDefinitions = predicates.map(
    (predicate) => registryByPredicate.get(predicate)?.definition as ProofDefinition,
  );
  const modelId = `model:${discovery.workspaceBinding.slice("sha256:".length)}` as OpaqueId;
  const modelFields = {
    scope,
    applications: applications.map((item) => ref("application", item)),
    capabilities: [capabilityRef],
    promises: promises.map((item) => ref("promise", item)),
    proofs: proofDefinitions.map((item) => ref("proof", item)),
    promiseProofBindings: bindings.map((item) => ref("promiseProofBinding", item)),
    providerBindings: [],
    repairKnowledge: [],
    provenance: provenance("passive-workspace-model-seal", [
      ...applications.map((item) => ref("application", item)),
      capabilityRef,
      ...promises.map((item) => ref("promise", item)),
      ...proofDefinitions.map((item) => ref("proof", item)),
      ...bindings.map((item) => ref("promiseProofBinding", item)),
    ]),
  };
  const model: ApplicationModel = {
    id: modelId,
    revision: await revision("applicationModel", modelId, modelFields),
    schemaVersion: 1,
    ...modelFields,
  };
  assertValidApplicationModelGraph(model, {
    promises,
    proofs: proofDefinitions,
    bindings,
  });
  return {
    status: "sealed",
    graph: {
      model,
      applications,
      capabilities: [capability],
      promises,
      proofs: proofDefinitions,
      bindings,
    },
    diagnostics: [],
  };
}

export async function discoverAndSealWorkspace(
  workspaceRoot: string,
  proofRegistry: readonly SealableProofDefinition[],
  policy: import("./index.js").DiscoveryPolicy = {},
): Promise<{
  readonly discovery: WorkspaceDiscovery;
  readonly resolution: WorkspaceModelResolution;
}> {
  const { discoverWorkspace } = await import("./index.js");
  const discovery = await discoverWorkspace(workspaceRoot, policy);
  return {
    discovery,
    resolution: await resolveAndSealWorkspaceModel(discovery, proofRegistry),
  };
}
