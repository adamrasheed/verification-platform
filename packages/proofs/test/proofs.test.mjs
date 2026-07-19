import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  MVP_PROOF_REGISTRY,
  aggregateInvocation,
  aggregatePromiseAttempts,
  buildPromiseEvidenceEdges,
  compareReexecutionDeterminism,
  evaluateWorkspaceProofs,
  selectEffectiveAttempt,
} from "../dist/public/index.js";

const attemptFixture = JSON.parse(
  await readFile(new URL("../fixtures/attempts.json", import.meta.url), "utf8"),
);

const base = {
  supported: true,
  manifests: [
    { path: "package.json", name: "root", dependencies: {}, workspaceMember: true },
    { path: "packages/a/package.json", name: "@x/a", version: "1.0.0", dependencies: {}, workspaceMember: true },
    { path: "packages/b/package.json", name: "@x/b", version: "1.0.0", dependencies: { "@x/a": "workspace:*" }, workspaceMember: true },
  ],
  lockfiles: ["package-lock.json"],
  packageManagers: ["npm"],
  conflicts: [],
  diagnostics: [],
  validatedEvidence: ["evidence:workspace"],
};

test("registry contains four exact, revisioned MVP proofs", () => {
  assert.equal(MVP_PROOF_REGISTRY.length, 4);
  assert.equal(new Set(MVP_PROOF_REGISTRY.map((item) => item.revision)).size, 4);
  assert.equal(MVP_PROOF_REGISTRY.every((item) => item.definition.revision === item.revision), true);
  assert.equal(MVP_PROOF_REGISTRY.some((item) => "promise" in item.definition), false);
  assert.deepEqual(
    MVP_PROOF_REGISTRY.map((item) => item.predicateAst.operator),
    MVP_PROOF_REGISTRY.map((item) => item.predicate),
  );
});

test("healthy workspace is satisfied deterministically", () => {
  const first = evaluateWorkspaceProofs(base);
  const second = evaluateWorkspaceProofs(base);
  assert.equal(first.outcome, "satisfied");
  assert.equal(first.resultDigest, second.resultDigest);
  assert.equal(first.evaluations.every((item) => item.evidence.length > 0), true);
});

test("duplicate workspace names violate a promise", () => {
  const result = evaluateWorkspaceProofs({
    ...base,
    manifests: [
      ...base.manifests,
      { path: "packages/c/package.json", name: "@x/a", version: "2.0.0", dependencies: {}, workspaceMember: true },
    ],
  });
  assert.equal(result.outcome, "violated");
  assert.equal(result.reasonCodes.includes("DUPLICATE_WORKSPACE_NAME"), true);
});

test("missing evidence is indeterminate rather than a violation", () => {
  const result = evaluateWorkspaceProofs({ ...base, validatedEvidence: [] });
  assert.equal(result.outcome, "indeterminate");
  assert.equal(result.evaluations.every((item) => item.status === "indeterminate"), true);
});

test("unsupported repositories are not evaluated", () => {
  const result = evaluateWorkspaceProofs({ ...base, supported: false });
  assert.equal(result.outcome, "not_evaluated");
  assert.equal(result.evaluations.length, 0);
});

test("workspace protocol references require an in-boundary target", () => {
  const result = evaluateWorkspaceProofs({
    ...base,
    manifests: [{
      path: "package.json",
      name: "root",
      dependencies: { "@x/missing": "workspace:*" },
      workspaceMember: true,
    }],
  });
  assert.equal(result.outcome, "violated");
  assert.equal(result.reasonCodes.includes("LOCAL_DEPENDENCY_TARGET_MISSING"), true);
});

function attempt(status, overrides = {}) {
  return {
    attemptId: "attempt:1",
    sequence: 1,
    authorized: true,
    proof: attemptFixture.proof,
    model: attemptFixture.model,
    executionContext: attemptFixture.executionContext,
    planKey: `sha256:${"9".repeat(64)}`,
    evaluator: {
      id: "evaluator:test",
      version: "1",
      artifactDigest: `sha256:${"6".repeat(64)}`,
    },
    status,
    reasonCodes: status === "failed" ? ["CONTRADICTED"] : [],
    evidence: [{
      evidence: attemptFixture.evidence,
      contentDigest: `sha256:${"7".repeat(64)}`,
      validation: "valid",
    }],
    observationDigest: `sha256:${"8".repeat(64)}`,
    ...overrides,
  };
}

test("effective-attempt aggregation never converts error into violation", () => {
  const errored = aggregatePromiseAttempts({
    promise: attemptFixture.promise,
    requiredProofs: [attemptFixture.proof],
    attempts: [attempt("error", { reasonCodes: ["ENVIRONMENT_ERROR"] })],
  });
  assert.equal(errored.status, "indeterminate");
  assert.equal(aggregateInvocation([errored]).outcome, "indeterminate");

  const failed = aggregatePromiseAttempts({
    promise: attemptFixture.promise,
    requiredProofs: [attemptFixture.proof],
    attempts: [attempt("failed")],
  });
  assert.equal(failed.status, "violated");
});

test("pass/fail without validated Evidence is indeterminate", () => {
  const aggregation = aggregatePromiseAttempts({
    promise: attemptFixture.promise,
    requiredProofs: [attemptFixture.proof],
    attempts: [attempt("passed", {
      evidence: [{
        evidence: attemptFixture.evidence,
        contentDigest: `sha256:${"7".repeat(64)}`,
        validation: "rejected",
      }],
    })],
  });
  assert.equal(aggregation.status, "indeterminate");
  assert.equal(aggregation.reasonCodes.includes("VALIDATED_EVIDENCE_REQUIRED"), true);
});

test("result digest ignores attempt IDs and cache provenance but retains Evidence content", () => {
  const first = aggregatePromiseAttempts({
    promise: attemptFixture.promise,
    requiredProofs: [attemptFixture.proof],
    attempts: [attempt("passed", { attemptId: "attempt:a", cacheProvenance: { hit: false } })],
  });
  const second = aggregatePromiseAttempts({
    promise: attemptFixture.promise,
    requiredProofs: [attemptFixture.proof],
    attempts: [attempt("passed", { attemptId: "attempt:b", cacheProvenance: { hit: true } })],
  });
  assert.equal(first.resultDigest, second.resultDigest);
  assert.equal(
    compareReexecutionDeterminism(
      aggregateInvocation([first]),
      aggregateInvocation([second]),
    ).equivalent,
    true,
  );
  assert.equal(buildPromiseEvidenceEdges(first).length, 1);
  assert.equal(buildPromiseEvidenceEdges(first)[0].promise.id, attemptFixture.promise.id);
});

test("effective selection uses the last authorized unique attempt", () => {
  const first = attempt("error", { attemptId: "attempt:1", sequence: 1 });
  const second = attempt("passed", { attemptId: "attempt:2", sequence: 2 });
  assert.equal(
    selectEffectiveAttempt(attemptFixture.proof, [first, second]).attempt.attemptId,
    "attempt:2",
  );
  assert.throws(
    () => selectEffectiveAttempt(attemptFixture.proof, [
      first,
      attempt("passed", { attemptId: "attempt:duplicate", sequence: 1 }),
    ]),
    /unique sequence/,
  );
});

test("cross-context attempts cannot aggregate into a semantic verdict", () => {
  const otherProof = {
    ...attemptFixture.proof,
    id: "proof:other",
    revision: `sha256:${"a".repeat(64)}`,
  };
  const otherContext = {
    ...attemptFixture.executionContext,
    id: "context:other",
    revision: `sha256:${"b".repeat(64)}`,
  };
  const aggregation = aggregatePromiseAttempts({
    promise: attemptFixture.promise,
    requiredProofs: [attemptFixture.proof, otherProof],
    attempts: [
      attempt("passed"),
      attempt("passed", {
        attemptId: "attempt:other",
        proof: otherProof,
        executionContext: otherContext,
      }),
    ],
  });
  assert.equal(aggregation.status, "indeterminate");
  assert.equal(aggregation.reasonCodes.includes("EXECUTION_CONTEXT_MISMATCH"), true);
});
