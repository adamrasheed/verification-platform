import assert from "node:assert/strict";
import test from "node:test";
import { validateJsonlTranscript } from "@verify-internal/protocol";
import { runCli } from "../dist/public/index.js";
import {
  attemptRef,
  canonicalExecution,
  canonicalPromiseResult,
  canonicalRepairRecord,
  engineResult,
  fakeIo,
  golden,
  sha,
  sha2,
  sha3,
} from "./helpers.mjs";

function dependencyFor(result) {
  return {
    engine: {
      verify: async () => result,
    },
    createInvocationId: () => "invocation:test",
  };
}

test("human output matches the satisfied golden and progress stays on stderr", async () => {
  const capture = fakeIo();
  const exit = await runCli([], capture.io, dependencyFor(engineResult()));
  assert.equal(exit, 0);
  assert.equal(capture.stdout(), await golden("human-satisfied.txt"));
  assert.equal(
    capture.stderr(),
    "[preflight] started\n[report] completed\n",
  );
});

test("preflight progress is observable before the Engine resolves", async () => {
  const capture = fakeIo();
  let resolveEngine;
  const pending = new Promise((resolve) => {
    resolveEngine = resolve;
  });
  const run = runCli([], capture.io, {
    engine: { verify: () => pending },
    createInvocationId: () => "invocation:progress",
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(capture.stderr(), "[preflight] started\n");
  resolveEngine(engineResult());
  assert.equal(await run, 0);
});

test("human output matches the violated golden", async () => {
  const capture = fakeIo();
  const violated = engineResult({
    outcome: "violated",
    summary: {
      requiredPromiseCount: 1,
      advisoryPromiseCount: 0,
      satisfiedCount: 0,
      violatedCount: 1,
      indeterminateCount: 0,
    },
    proofs: [{
      proofId: "proof:test",
      promiseId: "promise:test",
      status: "failed",
      reasonCodes: ["TEST_VIOLATION"],
      evidence: [sha3],
      details: [],
      resultDigest: sha,
    }],
    repairs: [{
      schemaVersion: 1,
      id: "repair:test",
      revision: sha2,
      motivatingPromise: "promise:test",
      motivatingProof: "proof:test",
      evidence: [sha3],
      action: {
        kind: "manual",
        target: ".",
        operations: [],
        instruction: "fix it",
      },
      expectedEffect: "passes",
      assumptions: [],
      requiredPermissions: ["workspace.write"],
      verificationPlan: {
        proofId: "proof:test",
        promiseId: "promise:test",
        modelRevision: sha2,
      },
      state: "suggested",
    }],
    proofExecutions: [
      canonicalExecution("failed", ["TEST_VIOLATION"]),
    ],
    promises: [canonicalPromiseResult("violated", ["TEST_VIOLATION"])],
    repairRecords: [canonicalRepairRecord()],
  });
  const exit = await runCli(
    ["verify"],
    capture.io,
    dependencyFor(violated),
  );
  assert.equal(exit, 1);
  assert.equal(capture.stdout(), await golden("human-violated.txt"));
});

test("JSON stdout is exactly one protocol document", async () => {
  const capture = fakeIo();
  const exit = await runCli(
    ["verify", "--json"],
    capture.io,
    dependencyFor(engineResult()),
  );
  assert.equal(exit, 0);
  assert.equal(capture.stdout().split("\n").length, 2);
  const document = JSON.parse(capture.stdout());
  assert.equal(document.command, "verify");
  assert.equal(document.result.outcome, "satisfied");
  assert.deepEqual(document.result.workspace, {
    rootBinding: sha,
    packageManager: "npm",
    modelRevision: sha2,
  });
  assert.deepEqual(document.result.reasonCodes, []);
  assert.equal(capture.stdout().startsWith("{"), true);
  assert.equal(capture.stdout().endsWith("}\n"), true);
  assert.match(capture.stderr(), /^\[preflight\]/);
});

test("machine output preserves the Promise to Proof to Evidence to Repair loop", async () => {
  const capture = fakeIo();
  const repair = {
    schemaVersion: 1,
    id: "repair:test",
    revision: sha2,
    motivatingPromise: "promise:test",
    motivatingProof: "proof:test",
    evidence: [sha3],
    action: {
      kind: "manual",
      target: "package.json",
      operations: [],
      instruction: "replace the ambiguous range",
    },
    expectedEffect: "the proof passes",
    assumptions: [],
    requiredPermissions: ["workspace.write"],
    verificationPlan: {
      proofId: "proof:test",
      promiseId: "promise:test",
      modelRevision: sha2,
    },
    state: "suggested",
  };
  const repairRecord = canonicalRepairRecord();
  const violated = engineResult({
    outcome: "violated",
    summary: {
      requiredPromiseCount: 1,
      advisoryPromiseCount: 0,
      satisfiedCount: 0,
      violatedCount: 1,
      indeterminateCount: 0,
    },
    proofs: [{
      proofId: "proof:test",
      promiseId: "promise:test",
      status: "failed",
      reasonCodes: ["AMBIGUOUS_LOCAL_DEPENDENCY"],
      evidence: [sha3],
      details: [],
      resultDigest: sha,
    }],
    repairs: [repair],
    proofExecutions: [
      canonicalExecution("failed", ["AMBIGUOUS_LOCAL_DEPENDENCY"]),
    ],
    promises: [
      canonicalPromiseResult("violated", ["AMBIGUOUS_LOCAL_DEPENDENCY"]),
    ],
    repairRecords: [repairRecord],
  });
  assert.equal(
    await runCli(
      ["verify", "--json"],
      capture.io,
      dependencyFor(violated),
    ),
    1,
  );
  const result = JSON.parse(capture.stdout()).result;
  assert.deepEqual(result.promises[0], {
    promise: {
      kind: "promise",
      id: "promise:test",
      revision: sha,
      schemaVersion: 1,
    },
    status: "violated",
    proofAttempts: [attemptRef],
    evidence: [{
      kind: "evidence",
      id: "evidence:test",
      revision: sha3,
      schemaVersion: 1,
    }],
    reasonCodes: ["AMBIGUOUS_LOCAL_DEPENDENCY"],
  });
  assert.equal(result.proofExecutions[0].evidence[0].revision, sha3);
  assert.deepEqual(
    result.repairRecords[0].action,
    repairRecord.action,
  );
  assert.equal(result.repairs[0].id, "repair:test");
});

test("CLI projects the Engine Promise result without reinterpreting Proof attempts", async () => {
  const capture = fakeIo();
  const result = engineResult({
    promises: [canonicalPromiseResult("satisfied")],
    proofExecutions: [canonicalExecution("failed", ["CONFLICTING_ATTEMPT"])],
  });
  assert.equal(
    await runCli(["verify", "--json"], capture.io, dependencyFor(result)),
    0,
  );
  const projected = JSON.parse(capture.stdout()).result;
  assert.equal(projected.promises[0].status, "satisfied");
  assert.deepEqual(projected.promises[0].reasonCodes, []);
  assert.equal(projected.proofExecutions[0].result.status, "failed");
});

test("legacy Engine results without canonical Promise results project an empty list", async () => {
  const capture = fakeIo();
  const result = engineResult();
  delete result.promises;
  assert.equal(
    await runCli(["verify", "--json"], capture.io, dependencyFor(result)),
    0,
  );
  assert.deepEqual(JSON.parse(capture.stdout()).result.promises, []);
});

test("JSONL emits ordered events and exactly one terminal protocol result", async () => {
  const capture = fakeIo();
  const exit = await runCli(
    ["verify", "--jsonl"],
    capture.io,
    dependencyFor(engineResult()),
  );
  assert.equal(exit, 0);
  const decoded = validateJsonlTranscript(capture.stdout());
  assert.equal(decoded.kind, "ok");
  assert.equal(decoded.value.events.length, 2);
  assert.equal(decoded.value.result.result.outcome, "satisfied");
  const records = capture.stdout().trimEnd().split("\n").map(JSON.parse);
  assert.deepEqual(records.map((record) => record.recordType), [
    "event",
    "event",
    "result",
  ]);
});

test("cancellation is passed to the engine and maps to exit 5", async () => {
  const capture = fakeIo();
  const controller = new AbortController();
  const engine = {
    verify: async (_request, signal) => {
      await new Promise((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener("abort", resolve, { once: true });
      });
      return engineResult({
        operationalStatus: "cancelled",
        outcome: "indeterminate",
        applicationModel: undefined,
        summary: {
          requiredPromiseCount: 0,
          advisoryPromiseCount: 0,
          satisfiedCount: 0,
          violatedCount: 0,
          indeterminateCount: 0,
        },
        proofs: [],
        evidence: [],
        repairs: [],
        reasonCodes: ["CANCELLED"],
      });
    },
  };
  const running = runCli(["verify", "--json"], capture.io, {
    engine,
    signal: controller.signal,
    createInvocationId: () => "invocation:test",
  });
  controller.abort();
  assert.equal(await running, 5);
  assert.equal(JSON.parse(capture.stdout()).operationalStatus, "cancelled");
});
