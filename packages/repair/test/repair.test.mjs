import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  RepairApplyConflict,
  applyRepairPatch,
  linkLaterVerification,
  previewRepairPatch,
  suggestRepairs,
} from "../dist/public/index.js";

const failed = {
  proofId: "proof:workspace-unique-v1",
  promiseId: "promise:workspace-unique",
  status: "failed",
  reasonCodes: ["DUPLICATE_WORKSPACE_NAME"],
  evidence: ["evidence:one"],
  details: [
    { path: "packages/a/package.json", message: "duplicated" },
    { path: "packages/b/package.json", message: "duplicated" },
  ],
};

test("repair generation is deterministic and cites exact evidence", () => {
  const first = suggestRepairs([failed], "model:one");
  const second = suggestRepairs([failed], "model:one");
  assert.deepEqual(first, second);
  assert.deepEqual(first[0]?.evidence, ["evidence:one"]);
  assert.equal(first[0]?.action.target, "packages/b/package.json");
  assert.deepEqual(first[0]?.requiredPermissions, ["workspace.write"]);
});

test("MVP suggestions never apply a write", () => {
  const repair = suggestRepairs([failed], "model:one")[0];
  assert.equal(repair?.state, "suggested");
  assert.equal(typeof repair?.action, "object");
});

test("only a later exact matching pass verifies a suggestion", () => {
  const repair = suggestRepairs([failed], "model:one")[0];
  assert.ok(repair);
  const wrong = linkLaterVerification(repair, {
    modelRevision: "model:two",
    proofId: failed.proofId,
    promiseId: failed.promiseId,
    status: "passed",
    resultDigest: "sha256:wrong",
  });
  assert.equal(wrong.state, "suggested");
  const verified = linkLaterVerification(repair, {
    modelRevision: "model:one",
    proofId: failed.proofId,
    promiseId: failed.promiseId,
    status: "passed",
    resultDigest: "sha256:pass",
  });
  assert.equal(verified.state, "verified");
});

function sha(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function canonicalRepair(target, bytes) {
  return {
    id: "repair:test",
    revision: `sha256:${"1".repeat(64)}`,
    schemaVersion: 1,
    motivatingPromise: {
      kind: "promise",
      id: "promise:test",
      revision: `sha256:${"2".repeat(64)}`,
      schemaVersion: 1,
    },
    motivatingExecution: {
      attemptId: "attempt:test",
      proof: {
        kind: "proof",
        id: "proof:test",
        revision: `sha256:${"3".repeat(64)}`,
        schemaVersion: 1,
      },
      invocationId: "invocation:test",
    },
    evidence: [],
    generator: {
      id: "generator:test",
      version: "1.0.0",
      artifactDigest: `sha256:${"4".repeat(64)}`,
    },
    action: {
      kind: "jsonPatch",
      target,
      expectedContentDigest: sha(bytes),
      operations: [{
        operation: "replace",
        pointer: "/name",
        value: "fixed",
      }],
    },
    assumptions: [],
    requiredPermissions: {
      filesystem: [{ mode: "write", root: target }],
      network: [],
      subprocess: false,
      secrets: [],
    },
    expectedEffect: "fixed",
    confidence: {
      value: 1,
      basis: "deterministic_rule",
      ruleId: "test",
      signalRefs: [],
    },
    verificationPlan: {
      kind: "executionPlan",
      id: "plan:test",
      revision: `sha256:${"5".repeat(64)}`,
      schemaVersion: 1,
    },
  };
}

test("preview is read-only and apply atomically writes the exact preview", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "verify-repair-"));
  const target = path.join(root, "package.json");
  const before = Buffer.from('{"name":"broken","private":true}\n');
  try {
    await writeFile(target, before);
    const repair = canonicalRepair("package.json", before);
    const preview = previewRepairPatch(repair, root);
    assert.equal((await readFile(target)).toString(), before.toString());
    assert.equal(preview.after.name, "fixed");
    const applied = applyRepairPatch(repair, root);
    assert.deepEqual(applied, preview);
    assert.deepEqual(JSON.parse(await readFile(target, "utf8")), {
      name: "fixed",
      private: true,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("stale, escaping, and symlinked targets are rejected without a write", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "verify-repair-conflict-"));
  const target = path.join(root, "package.json");
  const before = Buffer.from('{"name":"broken"}\n');
  try {
    await writeFile(target, before);
    const stale = canonicalRepair("package.json", Buffer.from("{}"));
    assert.throws(() => applyRepairPatch(stale, root), (error) =>
      error instanceof RepairApplyConflict && error.code === "STALE_TARGET"
    );
    assert.equal((await readFile(target)).toString(), before.toString());
    assert.throws(
      () => previewRepairPatch(canonicalRepair("../outside.json", before), root),
      (error) =>
        error instanceof RepairApplyConflict && error.code === "INVALID_TARGET",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
