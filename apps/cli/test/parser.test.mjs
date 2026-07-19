import assert from "node:assert/strict";
import test from "node:test";
import {
  parseCli,
  toCanonicalVerifyRequest,
} from "../dist/public/index.js";

test("verify defaults to the current workspace", () => {
  assert.deepEqual(parseCli([], "/repo"), {
    ok: true,
    command: {
      kind: "verify",
      workspace: "/repo",
      offline: false,
      noCache: false,
      outputMode: "human",
    },
  });
});

test("verify options bind to a canonical protocol request", () => {
  const parsed = parseCli(
    ["verify", "/repo", "--offline", "--no-cache", "--deadline", "42", "--json"],
    "/unused",
  );
  assert.equal(parsed.ok, true);
  const request = toCanonicalVerifyRequest(parsed.command, {
    invocationId: "invocation:test",
    platform: "test",
  });
  assert.deepEqual(request, {
    schemaVersion: 1,
    command: "verify",
    invocationId: "invocation:test",
    arguments: { noCache: true },
    configurationReferences: [],
    policyReferences: [],
    consentGrantReferences: [],
    offline: true,
    deadlineMs: 42,
    outputMode: "json",
    environment: {
      platform: "test",
      allowlistedBindings: ["/repo"],
    },
    workspace: { rootBinding: "/repo" },
  });
});

test("the complete MVP command grammar parses", () => {
  const cases = [
    [["inspect", "run", "run:1"], "inspectRun"],
    [["inspect", "evidence", "evidence:1"], "inspectEvidence"],
    [["cache", "inspect"], "cacheInspect"],
    [["cache", "clear"], "cacheClear"],
    [["repair", "preview", "run:1", "repair:1"], "repairPreview"],
    [[
      "repair",
      "apply",
      "run:1",
      "repair:1",
      "--workspace",
      "/repo",
      "--grant-workspace-write",
    ], "repairApply"],
    [["version"], "version"],
    [["schema"], "schema"],
  ];
  for (const [argv, kind] of cases) {
    const parsed = parseCli(argv, "/repo");
    assert.equal(parsed.ok, true);
    assert.equal(parsed.command.kind, kind);
  }
});

test("invalid flags and conflicting machine modes are rejected", () => {
  for (const argv of [
    ["verify", "--wat"],
    ["verify", "--deadline", "0"],
    ["--json", "--jsonl"],
    ["inspect", "run"],
    ["cache", "delete"],
    ["repair", "apply", "run:1", "repair:1"],
    ["repair", "preview", "run:1", "repair:1", "--grant-workspace-write"],
  ]) {
    const parsed = parseCli(argv, "/repo");
    assert.equal(parsed.ok, false);
    assert.equal(parsed.error.code, "VFY_CLI_ARGUMENT_INVALID");
  }
});
