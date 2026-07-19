import { createHash } from "node:crypto";
import { canonicalize } from "@verify-internal/contracts";
import type { CanonicalValue } from "@verify-internal/contracts";

export {
  RepairApplyConflict,
  applyRepairPatch,
  previewRepairPatch,
} from "./apply.js";
export type {
  RepairApplyConflictCode,
  RepairPatchPreview,
} from "./apply.js";

export interface FailedProof {
  readonly proofId: string;
  readonly promiseId: string;
  readonly status: string;
  readonly reasonCodes: readonly string[];
  readonly evidence: readonly string[];
  readonly details: readonly { path: string; message: string }[];
}

export interface RepairSuggestion {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly revision: `sha256:${string}`;
  readonly motivatingPromise: string;
  readonly motivatingProof: string;
  readonly evidence: readonly string[];
  readonly action: {
    readonly kind: "json_patch" | "manual";
    readonly target: string;
    readonly operations: readonly {
      readonly op: "add" | "replace" | "remove";
      readonly path: string;
      readonly value?: CanonicalValue;
    }[];
    readonly instruction?: string;
  };
  readonly expectedEffect: string;
  readonly assumptions: readonly string[];
  readonly requiredPermissions: readonly ["workspace.write"];
  readonly verificationPlan: {
    readonly proofId: string;
    readonly promiseId: string;
    readonly modelRevision: string;
  };
  readonly state: "suggested" | "verified";
  readonly verifiedByResultDigest?: string;
}

function sha(value: CanonicalValue): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonicalize(value)).digest("hex")}`;
}

function makeRepair(
  proof: FailedProof,
  modelRevision: string,
  ordinal: number,
): RepairSuggestion | undefined {
  const reason = proof.reasonCodes[0];
  if (!reason) return undefined;
  let action: RepairSuggestion["action"];
  let expectedEffect: string;
  let assumptions: string[];
  switch (reason) {
    case "AMBIGUOUS_LOCAL_DEPENDENCY": {
      const target = proof.details[0]?.path ?? "package.json";
      action = {
        kind: "manual",
        target,
        operations: [],
        instruction: "Replace the ambiguous local dependency range with an explicit workspace: range.",
      };
      expectedEffect = "The dependency resolves to exactly one in-boundary workspace package.";
      assumptions = ["The referenced package is intended to be local."];
      break;
    }
    case "DUPLICATE_WORKSPACE_NAME": {
      const target = proof.details[1]?.path ?? proof.details[0]?.path ?? "package.json";
      action = {
        kind: "json_patch",
        target,
        operations: [{ op: "replace", path: "/name", value: `replace-with-unique-name-${ordinal}` }],
      };
      expectedEffect = "Every workspace member has a unique package name.";
      assumptions = ["The selected duplicate is safe to rename and downstream references will be updated."];
      break;
    }
    case "MISSING_WORKSPACE_NAME": {
      const target = proof.details[0]?.path ?? "package.json";
      action = {
        kind: "json_patch",
        target,
        operations: [{ op: "add", path: "/name", value: `replace-with-package-name-${ordinal}` }],
      };
      expectedEffect = "The workspace member has an explicit unique package name.";
      assumptions = ["The placeholder will be replaced with the intended package name."];
      break;
    }
    case "LOCKFILE_MISSING":
      action = {
        kind: "manual",
        target: ".",
        operations: [],
        instruction: "Generate and commit exactly one lockfile using the repository's selected package manager.",
      };
      expectedEffect = "The workspace has one declared lockfile ownership scope.";
      assumptions = ["A package manager is selected outside the verifier."];
      break;
    case "MULTIPLE_PACKAGE_MANAGERS":
    case "LOCKFILE_OWNERSHIP_AMBIGUOUS":
      action = {
        kind: "manual",
        target: ".",
        operations: [],
        instruction: "Retain one package-manager lockfile and remove conflicting ownership metadata.",
      };
      expectedEffect = "The workspace has one unambiguous lockfile owner.";
      assumptions = ["The repository owner selects the authoritative package manager."];
      break;
    default:
      return undefined;
  }
  const preimage = {
    schemaVersion: 1,
    motivatingPromise: proof.promiseId,
    motivatingProof: proof.proofId,
    reason,
    evidence: [...proof.evidence].sort(),
    action,
    modelRevision,
  } satisfies CanonicalValue;
  const revision = sha(preimage);
  return {
    schemaVersion: 1,
    id: `repair:${revision.slice("sha256:".length)}`,
    revision,
    motivatingPromise: proof.promiseId,
    motivatingProof: proof.proofId,
    evidence: [...proof.evidence].sort(),
    action,
    expectedEffect,
    assumptions,
    requiredPermissions: ["workspace.write"],
    verificationPlan: { proofId: proof.proofId, promiseId: proof.promiseId, modelRevision },
    state: "suggested",
  };
}

export function suggestRepairs(
  evaluations: readonly FailedProof[],
  modelRevision: string,
): readonly RepairSuggestion[] {
  return evaluations
    .filter((proof) => proof.status === "failed")
    .flatMap((proof, index) => {
      const repair = makeRepair(proof, modelRevision, index + 1);
      return repair ? [repair] : [];
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function linkLaterVerification(
  repair: RepairSuggestion,
  verification: {
    readonly modelRevision: string;
    readonly proofId: string;
    readonly promiseId: string;
    readonly status: string;
    readonly resultDigest: string;
  },
): RepairSuggestion {
  if (
    verification.modelRevision !== repair.verificationPlan.modelRevision
    || verification.proofId !== repair.verificationPlan.proofId
    || verification.promiseId !== repair.verificationPlan.promiseId
    || verification.status !== "passed"
  ) {
    return repair;
  }
  return { ...repair, state: "verified", verifiedByResultDigest: verification.resultDigest };
}
