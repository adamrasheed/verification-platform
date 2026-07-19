import { createHash } from "node:crypto";
import { canonicalize } from "@verify-internal/contracts";
import type {
  CanonicalValue,
  OpaqueId,
  ProofDefinition as ContractProofDefinition,
  Sha256Digest,
} from "@verify-internal/contracts";
export * from "./aggregation.js";

export type ProofStatus = "passed" | "failed" | "indeterminate" | "error" | "cancelled";
export type PromiseOutcome = "satisfied" | "violated" | "indeterminate";

export interface WorkspaceManifestInput {
  readonly path: string;
  readonly name?: string;
  readonly version?: string;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly workspaceMember: boolean;
}

export interface WorkspaceProofInput {
  readonly supported: boolean;
  readonly manifests: readonly WorkspaceManifestInput[];
  readonly lockfiles: readonly string[];
  readonly packageManagers: readonly string[];
  readonly conflicts: readonly { code: string; paths: readonly string[] }[];
  readonly diagnostics: readonly { code: string; path?: string }[];
  readonly validatedEvidence: readonly string[];
}

export interface ProofDefinition {
  readonly proofId: string;
  readonly promiseId: string;
  readonly predicate:
    | "manifest.structuralValidity"
    | "workspace.uniqueMembership"
    | "workspace.localDependencyReference"
    | "workspace.singleLockfileOwnership";
  readonly order: number;
  readonly required: true;
  readonly revision: `sha256:${string}`;
  readonly predicateAst: WorkspacePredicateAst;
  /**
   * The canonical Proof has no Promise reference. `promiseId` above belongs to
   * the registry association and is excluded from this revision preimage.
   */
  readonly definition: ContractProofDefinition;
}

export interface WorkspacePredicateAst {
  readonly schemaVersion: 1;
  readonly operator: ProofDefinition["predicate"];
  readonly arguments: readonly CanonicalValue[];
}

export interface ProofEvaluation {
  readonly proofId: string;
  readonly promiseId: string;
  readonly status: ProofStatus;
  readonly reasonCodes: readonly string[];
  readonly evidence: readonly string[];
  readonly details: readonly { path: string; message: string }[];
  readonly resultDigest: `sha256:${string}`;
}

export interface ProofSuiteResult {
  readonly evaluations: readonly ProofEvaluation[];
  readonly outcome: PromiseOutcome | "not_evaluated";
  readonly reasonCodes: readonly string[];
  readonly resultDigest: `sha256:${string}`;
}

function digest(value: CanonicalValue): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonicalize(value)).digest("hex")}`;
}

function definition(
  proofId: string,
  promiseId: string,
  predicate: ProofDefinition["predicate"],
  order: number,
): ProofDefinition {
  const proofDefinitionId = proofId as OpaqueId;
  const evaluator = {
    id: `evaluator:${predicate}` as OpaqueId,
    version: "1",
    artifactDigest: digest({ domain: "verification-platform/mvp-evaluator", predicate, version: 1 }),
  };
  const applicabilityRevision = digest({
    domain: "verification-platform/applicability-language",
    id: "applicability.constant",
    schemaVersion: 1,
  });
  const fields = {
    evaluator,
    predicateLanguage: {
      id: "predicate.workspace-integrity",
      schemaVersion: 1,
      revision: digest({
        domain: "verification-platform/predicate-language",
        id: "predicate.workspace-integrity",
        schemaVersion: 1,
      }),
    },
    inputs: [{
      name: "workspace.observations",
      sourceType: "validatedEvidence",
      schema: {
        id: "workspace.manifest-observations",
        schemaVersion: 1,
        revision: digest({
          domain: "verification-platform/evidence-schema",
          id: "workspace.manifest-observations",
          schemaVersion: 1,
        }),
      },
      required: true,
    }],
    evidenceRequirements: [{
      identity: "workspace.manifest-observations:v1" as OpaqueId,
      evidenceType: "workspace.manifest-observations",
      mediaTypes: ["application/vnd.verify.workspace-observations+json"],
      minimumCount: 1,
      validationSchema: {
        id: "workspace.manifest-observations",
        schemaVersion: 1,
        revision: digest({
          domain: "verification-platform/evidence-schema",
          id: "workspace.manifest-observations",
          schemaVersion: 1,
        }),
      },
    }],
    dependencies: [],
    permissions: {
      filesystem: [],
      network: [],
      subprocess: false,
      secrets: [],
    },
    reproducibility: "hermetic" as const,
    cachePolicy: { mode: "content_addressed" as const },
    timeoutMs: 1_000,
    retryPolicy: { maximumAttempts: 1, retryableOperations: [] },
    applicability: {
      language: {
        id: "applicability.constant",
        schemaVersion: 1,
        revision: applicabilityRevision,
      },
      expression: true,
    },
    provenance: [],
  };
  const revision = digest({
    domain: "verification-platform/revision",
    id: proofId,
    kind: "proof",
    payload: fields as unknown as CanonicalValue,
    schemaVersion: 1,
  });
  const exactDefinition: ContractProofDefinition = {
    id: proofDefinitionId,
    revision,
    schemaVersion: 1,
    ...fields,
  };
  return {
    proofId,
    promiseId,
    predicate,
    order,
    required: true,
    revision,
    predicateAst: {
      schemaVersion: 1,
      operator: predicate,
      arguments: [],
    },
    definition: exactDefinition,
  };
}

export const MVP_PROOF_REGISTRY: readonly ProofDefinition[] = Object.freeze([
  definition("proof:manifest-structural-v1", "promise:manifest-structural", "manifest.structuralValidity", 0),
  definition("proof:workspace-unique-v1", "promise:workspace-unique", "workspace.uniqueMembership", 1),
  definition("proof:local-dependency-v1", "promise:local-dependency", "workspace.localDependencyReference", 2),
  definition("proof:lockfile-ownership-v1", "promise:lockfile-ownership", "workspace.singleLockfileOwnership", 3),
]);

function finish(
  definitionValue: ProofDefinition,
  status: ProofStatus,
  reasonCodes: readonly string[],
  evidence: readonly string[],
  details: readonly { path: string; message: string }[] = [],
): ProofEvaluation {
  const stable = {
    schemaVersion: 1,
    proofId: definitionValue.proofId,
    promiseId: definitionValue.promiseId,
    status,
    reasonCodes: [...reasonCodes].sort(),
    evidence: [...evidence].sort(),
    details: [...details].sort((left, right) =>
      left.path.localeCompare(right.path) || left.message.localeCompare(right.message)),
  } satisfies CanonicalValue;
  return {
    proofId: definitionValue.proofId,
    promiseId: definitionValue.promiseId,
    status,
    reasonCodes: stable.reasonCodes,
    evidence: stable.evidence,
    details: stable.details,
    resultDigest: digest(stable),
  };
}

function manifestStructural(input: WorkspaceProofInput, proof: ProofDefinition): ProofEvaluation {
  const invalidDiagnostics = input.diagnostics.filter((item) =>
    item.code === "INVALID_PACKAGE_JSON"
    || item.code === "DUPLICATE_PACKAGE_JSON_KEY"
    || item.code === "INVALID_WORKSPACE_PATTERN");
  const invalid = invalidDiagnostics.map((item) => ({
    path: item.path ?? ".",
    message: item.code === "INVALID_WORKSPACE_PATTERN"
      ? "workspace declaration contains an unsafe or non-normalized pattern"
      : "manifest is not valid unambiguous structured data",
  }));
  return invalid.length > 0
    ? finish(
        proof,
        "failed",
        [...new Set(invalidDiagnostics.map((item) => item.code))],
        input.validatedEvidence,
        invalid,
      )
    : finish(proof, "passed", [], input.validatedEvidence);
}

function uniqueWorkspace(input: WorkspaceProofInput, proof: ProofDefinition): ProofEvaluation {
  const byName = new Map<string, string[]>();
  const details: { path: string; message: string }[] = [];
  for (const manifest of input.manifests.filter((item) => item.workspaceMember)) {
    if (!manifest.name) {
      details.push({ path: manifest.path, message: "workspace manifest has no package name" });
      continue;
    }
    const paths = byName.get(manifest.name) ?? [];
    paths.push(manifest.path);
    byName.set(manifest.name, paths);
  }
  for (const [name, paths] of [...byName.entries()].sort()) {
    if (paths.length > 1) {
      for (const manifestPath of paths.sort()) {
        details.push({ path: manifestPath, message: `workspace name ${name} is duplicated` });
      }
    }
  }
  const reasons = [
    ...(details.some((item) => item.message.includes("duplicated")) ? ["DUPLICATE_WORKSPACE_NAME"] : []),
    ...(details.some((item) => item.message.includes("no package name")) ? ["MISSING_WORKSPACE_NAME"] : []),
  ];
  return reasons.length > 0
    ? finish(proof, "failed", reasons, input.validatedEvidence, details)
    : finish(proof, "passed", [], input.validatedEvidence);
}

function unambiguousRange(range: string, localVersion: string | undefined): boolean {
  if (range.startsWith("workspace:")) {
    const selector = range.slice("workspace:".length);
    return selector === "*" || selector === "^" || selector === "~"
      || selector === localVersion || selector === `^${localVersion}` || selector === `~${localVersion}`;
  }
  if (!localVersion) return false;
  if (range === "*" || range === localVersion) return true;
  if ((range.startsWith("^") || range.startsWith("~")) && range.slice(1) === localVersion) return true;
  return false;
}

function localDependencies(input: WorkspaceProofInput, proof: ProofDefinition): ProofEvaluation {
  const local = new Map(
    input.manifests
      .filter((item): item is WorkspaceManifestInput & { name: string } => item.workspaceMember && Boolean(item.name))
      .map((item) => [item.name, item]),
  );
  const details: { path: string; message: string }[] = [];
  for (const manifest of input.manifests.filter((item) => item.workspaceMember)) {
    for (const [name, range] of Object.entries(manifest.dependencies).sort()) {
      const target = local.get(name);
      if (!target && range.startsWith("workspace:")) {
        details.push({
          path: manifest.path,
          message: `${name} uses a workspace range but has no in-boundary workspace target`,
        });
      } else if (target && (range.startsWith("file:") || range.startsWith("link:"))) {
        const sourceDirectory = manifest.path === "package.json"
          ? "."
          : manifest.path.slice(0, -"/package.json".length);
        const rawTarget = range.slice(range.indexOf(":") + 1).replaceAll("\\", "/");
        const resolved = normalizeRelative(`${sourceDirectory}/${rawTarget}`);
        const targetDirectory = target.path === "package.json"
          ? "."
          : target.path.slice(0, -"/package.json".length);
        if (resolved === undefined || resolved !== targetDirectory) {
          details.push({
            path: manifest.path,
            message: `${name} path reference does not resolve to its in-boundary workspace target`,
          });
        }
      } else if (target && !unambiguousRange(range, target.version)) {
        details.push({
          path: manifest.path,
          message: `${name} range ${range} does not unambiguously select local ${target.version ?? "package"}`,
        });
      }
    }
  }
  return details.length > 0
    ? finish(
        proof,
        "failed",
        [...new Set(details.map((item) =>
          item.message.includes("no in-boundary")
            ? "LOCAL_DEPENDENCY_TARGET_MISSING"
            : "AMBIGUOUS_LOCAL_DEPENDENCY",
        ))],
        input.validatedEvidence,
        details,
      )
    : finish(proof, "passed", [], input.validatedEvidence);
}

function normalizeRelative(value: string): string | undefined {
  const parts: string[] = [];
  for (const part of value.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return undefined;
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join("/") || ".";
}

function lockfileOwnership(input: WorkspaceProofInput, proof: ProofDefinition): ProofEvaluation {
  if (input.conflicts.some((conflict) => conflict.code === "MULTIPLE_PACKAGE_MANAGERS")) {
    return finish(proof, "failed", ["MULTIPLE_PACKAGE_MANAGERS"], input.validatedEvidence);
  }
  if (input.lockfiles.length === 0) {
    return finish(proof, "failed", ["LOCKFILE_MISSING"], input.validatedEvidence);
  }
  if (input.lockfiles.length > 1 || input.packageManagers.length !== 1) {
    return finish(proof, "failed", ["LOCKFILE_OWNERSHIP_AMBIGUOUS"], input.validatedEvidence);
  }
  if (input.lockfiles[0]?.includes("/")) {
    return finish(proof, "failed", ["LOCKFILE_OUTSIDE_WORKSPACE_ROOT"], input.validatedEvidence);
  }
  return finish(proof, "passed", [], input.validatedEvidence);
}

export function evaluateWorkspaceProofs(input: WorkspaceProofInput): ProofSuiteResult {
  if (!input.supported) {
    const stable = {
      schemaVersion: 1,
      evaluations: [],
      outcome: "not_evaluated",
      reasonCodes: ["UNSUPPORTED_ECOSYSTEM"],
    } satisfies CanonicalValue;
    return {
      evaluations: [],
      outcome: "not_evaluated",
      reasonCodes: ["UNSUPPORTED_ECOSYSTEM"],
      resultDigest: digest(stable),
    };
  }
  if (input.validatedEvidence.length === 0) {
    const evaluations = MVP_PROOF_REGISTRY.map((proof) =>
      finish(proof, "indeterminate", ["VALIDATED_EVIDENCE_REQUIRED"], []));
    const stable = {
      schemaVersion: 1,
      evaluations: evaluations.map((item) => ({
        proofId: item.proofId,
        status: item.status,
        reasonCodes: item.reasonCodes,
        resultDigest: item.resultDigest,
      })),
      outcome: "indeterminate",
      reasonCodes: ["VALIDATED_EVIDENCE_REQUIRED"],
    } satisfies CanonicalValue;
    return { evaluations, outcome: "indeterminate", reasonCodes: stable.reasonCodes, resultDigest: digest(stable) };
  }

  const evaluations = MVP_PROOF_REGISTRY.map((proof) => {
    switch (proof.predicate) {
      case "manifest.structuralValidity":
        return manifestStructural(input, proof);
      case "workspace.uniqueMembership":
        return uniqueWorkspace(input, proof);
      case "workspace.localDependencyReference":
        return localDependencies(input, proof);
      case "workspace.singleLockfileOwnership":
        return lockfileOwnership(input, proof);
    }
  });
  const outcome: PromiseOutcome = evaluations.some((item) => item.status === "failed")
    ? "violated"
    : evaluations.every((item) => item.status === "passed")
      ? "satisfied"
      : "indeterminate";
  const reasonCodes = [...new Set(evaluations.flatMap((item) => item.reasonCodes))].sort();
  const stable = {
    schemaVersion: 1,
    evaluations: evaluations.map((item) => ({
      proofId: item.proofId,
      promiseId: item.promiseId,
      status: item.status,
      reasonCodes: item.reasonCodes,
      evidence: item.evidence,
      details: item.details,
      resultDigest: item.resultDigest,
    })),
    outcome,
    reasonCodes,
  } satisfies CanonicalValue;
  return { evaluations, outcome, reasonCodes, resultDigest: digest(stable) };
}
