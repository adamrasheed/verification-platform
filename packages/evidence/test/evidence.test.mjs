import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  captureValidateAndCommitWorkspaceEvidence,
  normalizeWorkspaceEvidence,
  validateEvidence,
} from "../dist/public/index.js";

function candidate() {
  return {
    workspaceBinding: "workspace:test",
    evidenceType: "workspace.manifest-observations",
    mediaType: "application/vnd.verify.workspace-observations+json",
    observations: [{
      path: "packages/a/package.json",
      name: "@x/a",
      version: "1.0.0",
      dependencies: { "@x/b": "workspace:*" },
      workspaceMember: true,
      contentDigest: `sha256:${"a".repeat(64)}`,
    }],
    lockfiles: ["package-lock.json"],
    packageManagers: ["npm"],
    completion: "complete",
    diagnostics: [],
  };
}

const fixture = JSON.parse(
  await readFile(new URL("../fixtures/candidate.json", import.meta.url), "utf8"),
);

test("normalization is deterministic and validates", () => {
  const first = normalizeWorkspaceEvidence(candidate());
  const second = normalizeWorkspaceEvidence(candidate());
  assert.equal(first.revision, second.revision);
  assert.equal(validateEvidence(first).state, "valid");
});

test("absolute and escaping paths are rejected", () => {
  assert.throws(() => normalizeWorkspaceEvidence({
    ...candidate(),
    observations: [{ ...candidate().observations[0], path: "/private/repository/package.json" }],
  }), /workspace-relative/);
  assert.throws(() => normalizeWorkspaceEvidence({
    ...candidate(),
    observations: [{ ...candidate().observations[0], path: "../package.json" }],
  }), /workspace-relative/);
});

test("secret-shaped values are redacted before retention", () => {
  const evidence = normalizeWorkspaceEvidence({
    ...candidate(),
    observations: [{
      ...candidate().observations[0],
      dependencies: { canary: "Bearer abcdefghijklmnop" },
    }],
  });
  assert.equal(JSON.stringify(evidence).includes("abcdefghijklmnop"), false);
  assert.equal(evidence.redactions, 1);
  assert.equal(validateEvidence(evidence).state, "valid");
});

test("validation detects immutable content tampering", () => {
  const evidence = normalizeWorkspaceEvidence(candidate());
  const tampered = { ...evidence, body: { changed: true } };
  assert.equal(validateEvidence(tampered).state, "rejected");
  assert.equal(validateEvidence(tampered).reasonCodes.includes("CONTENT_DIGEST_MISMATCH"), true);
});

test("candidate schema control values and content identities fail closed", () => {
  assert.throws(
    () => normalizeWorkspaceEvidence({
      ...fixture,
      observations: [{ ...fixture.observations[0], contentDigest: "sha256:short" }],
    }),
    /exact SHA-256/,
  );
  assert.throws(
    () => normalizeWorkspaceEvidence({ ...fixture, completion: "successful" }),
    /control-flow/,
  );
  assert.throws(
    () => normalizeWorkspaceEvidence({ ...fixture, packageManagers: ["npm", "npm"] }),
    /unique supported/,
  );
});

test("normalization rejects ambiguous and non-normalized paths", () => {
  for (const invalidPath of ["packages//a/package.json", "packages/./a/package.json", "a\u0000b"]) {
    assert.throws(
      () => normalizeWorkspaceEvidence({
        ...fixture,
        observations: [{ ...fixture.observations[0], path: invalidPath }],
      }),
      /workspace-relative/,
    );
  }
  assert.throws(
    () => normalizeWorkspaceEvidence({
      ...fixture,
      observations: [
        fixture.observations[0],
        { ...fixture.observations[0] },
      ],
    }),
    /unique/,
  );
});

test("validation is immutable and checks sealed identity metadata", () => {
  const evidence = normalizeWorkspaceEvidence(fixture);
  const before = structuredClone(evidence);
  const decision = validateEvidence(evidence);
  assert.deepEqual(evidence, before);
  assert.equal(decision.state, "valid");
  const tampered = { ...evidence, id: "evidence:tampered" };
  const rejected = validateEvidence(tampered);
  assert.equal(rejected.state, "rejected");
  assert.equal(rejected.reasonCodes.includes("EVIDENCE_ID_MISMATCH"), true);
  assert.equal(rejected.reasonCodes.includes("EVIDENCE_REVISION_MISMATCH"), true);
});

test("capture commit exposes Evidence and its exact attempt edge atomically", async () => {
  const captures = [];
  const validations = [];
  const attempt = {
    attemptId: "attempt:1",
    invocationId: "invocation:1",
    proof: {
      kind: "proof",
      id: "proof:1",
      revision: `sha256:${"b".repeat(64)}`,
      schemaVersion: 1,
    },
  };
  const port = {
    async commitCapture(unit) {
      captures.push(structuredClone(unit));
    },
    async appendValidation(validation) {
      validations.push(structuredClone(validation));
    },
  };
  const result = await captureValidateAndCommitWorkspaceEvidence(fixture, attempt, port);
  assert.equal(captures.length, 1);
  assert.deepEqual(captures[0].attempt, attempt);
  assert.equal(captures[0].evidence.revision, result.evidence.revision);
  assert.equal(validations.length, 1);

  const failedCaptures = [];
  await assert.rejects(
    captureValidateAndCommitWorkspaceEvidence(fixture, attempt, {
      async commitCapture() {
        throw new Error("injected atomic commit failure");
      },
      async appendValidation(validation) {
        failedCaptures.push(validation);
      },
    }),
    /injected atomic commit failure/,
  );
  assert.equal(failedCaptures.length, 0);
});
