import assert from "node:assert/strict";
import test from "node:test";
import { runCli } from "../dist/public/index.js";
import { fakeIo } from "./helpers.mjs";

test("persistence commands delegate once and never invoke verification", async () => {
  const calls = [];
  let engineCalls = 0;
  const persistence = {
    inspectRun: async (id) => {
      calls.push(["inspectRun", id]);
      return {
        document: { retainedRun: id },
        humanLines: [`retained run: ${id}`],
        exitCode: 0,
      };
    },
    inspectEvidence: async (id) => {
      calls.push(["inspectEvidence", id]);
      return {
        document: { evidence: id },
        humanLines: [`evidence: ${id}`],
        exitCode: 0,
      };
    },
    inspectCache: async () => {
      calls.push(["inspectCache"]);
      return {
        document: { entries: [] },
        humanLines: ["cache entries: 0"],
        exitCode: 0,
      };
    },
    clearCache: async () => {
      calls.push(["clearCache"]);
      return {
        document: { cleared: true, historyPreserved: true },
        humanLines: ["cache cleared", "history preserved"],
        exitCode: 0,
      };
    },
  };
  const engine = {
    verify: async () => {
      engineCalls += 1;
      throw new Error("must not run");
    },
  };
  const cases = [
    [["inspect", "run", "run:1", "--json"], { retainedRun: "run:1" }],
    [["inspect", "evidence", "evidence:1", "--json"], { evidence: "evidence:1" }],
    [["cache", "inspect", "--json"], { entries: [] }],
    [["cache", "clear", "--json"], { cleared: true, historyPreserved: true }],
  ];
  for (const [argv, expected] of cases) {
    const capture = fakeIo();
    assert.equal(
      await runCli(argv, capture.io, { engine, persistence }),
      0,
    );
    assert.deepEqual(JSON.parse(capture.stdout()), expected);
  }
  assert.equal(engineCalls, 0);
  assert.deepEqual(calls, [
    ["inspectRun", "run:1"],
    ["inspectEvidence", "evidence:1"],
    ["inspectCache"],
    ["clearCache"],
  ]);
});

test("unconfigured persistence is a blocked command", async () => {
  const capture = fakeIo();
  const exit = await runCli(["cache", "inspect", "--json"], capture.io);
  assert.equal(exit, 4);
  const document = JSON.parse(capture.stdout());
  assert.equal(document.operationalStatus, "blocked");
  assert.equal(
    document.diagnostics[0].code,
    "VFY_CLI_PERSISTENCE_UNAVAILABLE",
  );
});
