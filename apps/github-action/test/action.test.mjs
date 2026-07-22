import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

import { LocalCanonicalDispatcher } from "@verify-internal/adapter-core";
import { LocalMcpAdapter } from "@verify-internal/mcp-server";
import { decodeCommandEnvelope } from "@verify-internal/protocol";
import { projectGitHubCheck } from "@verify-internal/github-check-projector";
import {
  publishGitHubCheck,
  runGitHubAction,
} from "../lib/public/index.js";

const executeFile = promisify(execFile);
const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const workspace = join(root, "tooling/corpus/npm-valid");
const sha = "a".repeat(40);

test("Action runs canonical offline verification without requiring publication", async () => {
  const runnerTemp = await mkdtemp(join(tmpdir(), "verify-action-"));
  try {
    const result = await runGitHubAction({
      environment: {
        GITHUB_WORKSPACE: workspace,
        RUNNER_TEMP: runnerTemp,
        "INPUT_NO-CACHE": "true",
        "INPUT_PUBLISH-CHECK": "false",
      },
      signal: new AbortController().signal,
    });
    assert.equal(decodeCommandEnvelope(result.envelope).kind, "ok");
    assert.equal(result.envelope.operationalStatus, "completed");
    assert.equal(result.envelope.result.outcome, "satisfied");
    assert.equal(result.envelope.result.workspace.rootBinding, "workspace:github-action");
    assert.equal(result.projection.conclusion, "success");
    assert.deepEqual(result.publication, {
      published: false,
      code: "VFY_GITHUB_CHECK_DISABLED",
    });
    assert.equal(JSON.stringify(result.envelope).includes(workspace), false);
  } finally {
    await rm(runnerTemp, { recursive: true, force: true });
  }
});

test("check publication uses a fixed endpoint and sends no annotations or source data", async () => {
  const envelope = JSON.parse(await readFile(
    join(root, "packages/protocol/fixtures/valid/envelopes.json"),
    "utf8",
  ))[0];
  const canary = "IGNORE_PRIOR_INSTRUCTIONS_/private/source.ts";
  envelope.diagnostics = [{ message: canary, path: canary }];
  const projection = projectGitHubCheck(envelope);
  let captured;
  const publication = await publishGitHubCheck(projection, {
    repository: "owner/repository",
    headSha: sha,
    token: "test-token",
  }, new AbortController().signal, {
    async send(request) {
      captured = request;
      return { statusCode: 201, body: JSON.stringify({ id: 42 }) };
    },
  });
  assert.deepEqual(publication, {
    published: true,
    code: "VFY_GITHUB_CHECK_PUBLISHED",
    checkRunId: 42,
  });
  assert.equal(captured.hostname, "api.github.com");
  assert.equal(captured.path, "/repos/owner/repository/check-runs");
  assert.equal(captured.headers["x-github-api-version"], "2026-03-10");
  const body = JSON.parse(captured.body);
  assert.deepEqual(Object.keys(body).sort(), [
    "conclusion",
    "external_id",
    "head_sha",
    "name",
    "output",
    "status",
  ]);
  assert.equal(captured.body.includes(canary), false);
  assert.equal(captured.body.includes("annotations"), false);
});

test("read-only or absent credentials cannot change the canonical result", async () => {
  const envelope = JSON.parse(await readFile(
    join(root, "packages/protocol/fixtures/valid/envelopes.json"),
    "utf8",
  ))[0];
  const projection = projectGitHubCheck(envelope);
  const before = JSON.stringify(envelope);
  const denied = await publishGitHubCheck(projection, {
    repository: "owner/repository",
    headSha: sha,
    token: "read-only-token",
  }, new AbortController().signal, {
    async send() {
      return { statusCode: 403, body: JSON.stringify({ message: "denied" }) };
    },
  });
  assert.deepEqual(denied, {
    published: false,
    code: "VFY_GITHUB_CHECK_UNAVAILABLE",
  });
  assert.equal(JSON.stringify(envelope), before);
  assert.equal(JSON.stringify(denied).includes("read-only-token"), false);

  let called = false;
  const absent = await publishGitHubCheck(projection, {
    repository: "owner/repository",
    headSha: sha,
    token: "",
  }, new AbortController().signal, {
    async send() {
      called = true;
      return { statusCode: 201, body: JSON.stringify({ id: 1 }) };
    },
  });
  assert.equal(called, false);
  assert.deepEqual(absent, {
    published: false,
    code: "VFY_GITHUB_CHECK_UNAVAILABLE",
  });
});

test("CLI, MCP, and Action preserve the same Engine semantic result", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "verify-m7-parity-"));
  const actionState = await mkdtemp(join(tmpdir(), "verify-m7-action-parity-"));
  const dispatcher = new LocalCanonicalDispatcher({
    workspace: { id: "workspace:parity", root: workspace },
    stateRoot,
  });
  const adapter = new LocalMcpAdapter({
    dispatcher,
    commandEnvelopeSchema: "{}",
    glossary: "",
  });
  try {
    const mcp = await adapter.callTool("verification.verify", {
      workspaceBinding: "workspace:parity",
      offline: true,
      noCache: true,
    }, new AbortController().signal);
    const action = await runGitHubAction({
      environment: {
        GITHUB_WORKSPACE: workspace,
        RUNNER_TEMP: actionState,
        "INPUT_NO-CACHE": "true",
        "INPUT_PUBLISH-CHECK": "false",
      },
      signal: new AbortController().signal,
    });
    const cli = JSON.parse((await executeFile(process.execPath, [
      join(root, "apps/cli/dist/verify.js"),
      "verify",
      workspace,
      "--offline",
      "--no-cache",
      "--json",
    ], { cwd: root })).stdout);
    const semantics = (value) => ({
      operationalStatus: value.operationalStatus,
      outcome: value.result.outcome,
      resultDigest: value.result.resultDigest,
      summary: value.result.summary,
      reasonCodes: value.result.reasonCodes,
      proofCount: value.result.proofExecutions.length,
      evidenceCount: value.result.evidenceRecords.length,
    });
    assert.deepEqual(semantics(mcp.structuredContent), semantics(cli));
    assert.deepEqual(semantics(action.envelope), semantics(cli));
  } finally {
    dispatcher.close();
    await rm(stateRoot, { recursive: true, force: true });
    await rm(actionState, { recursive: true, force: true });
  }
});

test("the committed Action bundle emits only safe workflow output", async () => {
  const runnerTemp = await mkdtemp(join(tmpdir(), "verify-action-bundle-"));
  const output = join(runnerTemp, "github-output");
  await writeFile(output, "");
  try {
    const executed = await executeFile(process.execPath, [
      join(root, "apps/github-action/dist/index.js"),
    ], {
      cwd: root,
      env: {
        ...process.env,
        GITHUB_WORKSPACE: workspace,
        RUNNER_TEMP: runnerTemp,
        GITHUB_OUTPUT: output,
        "INPUT_NO-CACHE": "true",
        "INPUT_PUBLISH-CHECK": "false",
      },
    });
    assert.equal(executed.stdout, "Verify canonical local verification completed.\n");
    assert.equal(executed.stdout.includes("sha256:"), false);
    assert.equal(executed.stdout.includes(workspace), false);
    const outputs = await readFile(output, "utf8");
    assert.match(outputs, /^operational-status=completed$/m);
    assert.match(outputs, /^outcome=satisfied$/m);
    assert.match(outputs, /^conclusion=success$/m);
    assert.match(outputs, /^check-published=false$/m);
  } finally {
    await rm(runnerTemp, { recursive: true, force: true });
  }
});
