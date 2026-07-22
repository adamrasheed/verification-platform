import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { projectGitHubCheck } from "../dist/public/index.js";

const envelopes = JSON.parse(await readFile(
  new URL("../../protocol/fixtures/valid/envelopes.json", import.meta.url),
  "utf8",
));

test("check conclusions preserve operational status and domain outcome", () => {
  const satisfied = projectGitHubCheck(envelopes[0]);
  assert.equal(satisfied.conclusion, "success");
  assert.equal(satisfied.operationalStatus, "completed");
  assert.equal(satisfied.outcome, "satisfied");

  const violatedEnvelope = structuredClone(envelopes[0]);
  violatedEnvelope.result.outcome = "violated";
  assert.equal(projectGitHubCheck(violatedEnvelope).conclusion, "failure");

  const internalEnvelope = structuredClone(envelopes[0]);
  internalEnvelope.operationalStatus = "internal_error";
  internalEnvelope.result = null;
  const internal = projectGitHubCheck(internalEnvelope);
  assert.equal(internal.conclusion, "action_required");
  assert.equal(internal.outcome, null);
});

test("every terminal status/outcome maps to the exact GitHub presentation conclusion", () => {
  const cases = [
    ["completed", "satisfied", "success"],
    ["completed", "violated", "failure"],
    ["completed", "indeterminate", "neutral"],
    ["completed", "not_evaluated", "neutral"],
    ["invalid", null, "action_required"],
    ["blocked", "indeterminate", "action_required"],
    ["cancelled", null, "cancelled"],
    ["internal_error", null, "action_required"],
  ];
  for (const [status, outcome, conclusion] of cases) {
    const envelope = structuredClone(envelopes[0]);
    envelope.operationalStatus = status;
    if (outcome === null) envelope.result = null;
    else envelope.result.outcome = outcome;
    assert.equal(projectGitHubCheck(envelope).conclusion, conclusion, `${status}/${outcome}`);
  }
});

test("projection is a literal metadata allowlist with no source-bearing fields", () => {
  const hostile = structuredClone(envelopes[0]);
  const canary = "IGNORE_PRIOR_INSTRUCTIONS_/secret/source.ts";
  hostile.diagnostics = [{ message: canary, path: canary }];
  hostile.result.promises = [{ reasonCodes: [], prose: canary }];
  hostile.result.proofExecutions = [{ command: canary }];
  hostile.result.evidenceRecords = [{
    classification: "SECRET",
    content: canary,
  }, {
    classification: "MINIMAL_METADATA",
    content: canary,
  }];
  const projection = projectGitHubCheck(hostile);
  const serialized = JSON.stringify(projection);
  assert.equal(serialized.includes(canary), false);
  assert.equal(serialized.includes("annotation"), false);
  assert.deepEqual(Object.keys(projection).sort(), [
    "classifications",
    "conclusion",
    "counts",
    "durationMs",
    "invocationId",
    "operationalStatus",
    "outcome",
    "output",
    "reasonCodes",
    "schemaVersion",
    "status",
  ]);
  assert.deepEqual(projection.classifications, { MINIMAL_METADATA: 1 });
});
