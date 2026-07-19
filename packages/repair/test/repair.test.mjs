import assert from "node:assert/strict";
import test from "node:test";
import { linkLaterVerification, suggestRepairs } from "../dist/public/index.js";

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
