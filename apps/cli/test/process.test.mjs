import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { decodeCommandEnvelope } from "@verify-internal/protocol";

const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const bin = join(root, "apps/cli/dist/verify.js");
const processState = join(tmpdir(), `verify-cli-process-state-${process.pid}`);

after(async () => {
  await rm(processState, { recursive: true, force: true });
});

function execute(args, options = {}) {
  return new Promise((resolveResult) => {
    const child = spawn(process.execPath, [bin, ...args], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        NODE_NO_WARNINGS: "1",
        XDG_STATE_HOME: processState,
      },
      ...options,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      resolveResult({ spawnError: error, stdout, stderr });
    });
    child.once("close", (code, signal) => {
      resolveResult({ code, signal, stdout, stderr });
    });
  });
}

test("the npm-style bin emits a pure JSON document and exact satisfied exit", async () => {
  const result = await execute([
    "verify",
    "tooling/corpus/npm-valid",
    "--json",
  ]);
  assert.equal(result.spawnError, undefined);
  assert.equal(result.code, 0);
  assert.equal(result.signal, null);
  assert.equal(result.stdout.trim().split("\n").length, 1);
  const document = JSON.parse(result.stdout);
  assert.equal(document.operationalStatus, "completed");
  assert.equal(document.result.outcome, "satisfied");
  assert.equal(decodeCommandEnvelope(document).kind, "ok");
  assert.ok(document.result.promises.length > 0);
  assert.ok(document.result.proofExecutions.length > 0);
  assert.ok(document.result.evidenceRecords.length > 0);
  assert.ok(document.result.executionManifests.length > 0);
  assert.match(result.stderr, /^\[preflight\]/);
});

test("invalid process input exits 3 without contaminating machine stdout", async () => {
  const result = await execute(["verify", "--unknown", "--json"]);
  assert.equal(result.spawnError, undefined);
  assert.equal(result.code, 3);
  assert.equal(result.signal, null);
  const document = JSON.parse(result.stdout);
  assert.equal(document.operationalStatus, "invalid");
  assert.equal(result.stderr, "");
});

test("retained run, evidence, and cache commands use engine-owned persistence", async () => {
  const verified = await execute([
    "verify",
    "tooling/corpus/npm-valid",
    "--json",
  ]);
  assert.equal(verified.code, 0);
  const envelope = JSON.parse(verified.stdout);
  const invocationId = envelope.invocationId;
  const evidenceId = envelope.result.evidence[0].id;

  const run = await execute(["inspect", "run", invocationId, "--json"]);
  assert.equal(run.code, 0);
  assert.equal(JSON.parse(run.stdout).invocationId, invocationId);

  const evidence = await execute([
    "inspect",
    "evidence",
    evidenceId,
    "--json",
  ]);
  assert.equal(evidence.code, 0);
  assert.equal(JSON.parse(evidence.stdout).metadata.id, evidenceId);

  const cache = await execute(["cache", "inspect", "--json"]);
  assert.equal(cache.code, 0);
  assert.ok(JSON.parse(cache.stdout).entries.length > 0);

  const cleared = await execute(["cache", "clear", "--json"]);
  assert.equal(cleared.code, 0);
  assert.equal(JSON.parse(cleared.stdout).historyPreserved, true);

  const retainedAfterClear = await execute([
    "inspect",
    "run",
    invocationId,
    "--json",
  ]);
  assert.equal(retainedAfterClear.code, 0);
});

test("repair preview is read-only and explicit apply is atomically re-verified", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "verify-cli-repair-"));
  try {
    await mkdir(join(workspace, "packages", "a"), { recursive: true });
    await mkdir(join(workspace, "packages", "b"), { recursive: true });
    await writeFile(
      join(workspace, "package.json"),
      JSON.stringify({
        name: "repair-root",
        private: true,
        workspaces: ["packages/*"],
      }),
    );
    await writeFile(
      join(workspace, "package-lock.json"),
      JSON.stringify({
        name: "repair-root",
        lockfileVersion: 3,
        packages: { "": { name: "repair-root", workspaces: ["packages/*"] } },
      }),
    );
    const duplicate = JSON.stringify({
      name: "@fixture/duplicate",
      version: "1.0.0",
    });
    await writeFile(join(workspace, "packages", "a", "package.json"), duplicate);
    await writeFile(join(workspace, "packages", "b", "package.json"), duplicate);

    const violated = await execute(["verify", workspace, "--json"]);
    assert.equal(violated.code, 1);
    const result = JSON.parse(violated.stdout);
    const repair = result.result.repairRecords[0];
    assert.equal(repair.action.kind, "jsonPatch");
    const target = join(workspace, repair.action.target);
    const before = await readFile(target, "utf8");

    const previewed = await execute([
      "repair",
      "preview",
      result.invocationId,
      repair.id,
      "--workspace",
      workspace,
      "--json",
    ]);
    assert.equal(previewed.code, 0);
    assert.equal(JSON.parse(previewed.stdout).writePerformed, false);
    assert.equal(await readFile(target, "utf8"), before);

    const missingGrant = await execute([
      "repair",
      "apply",
      result.invocationId,
      repair.id,
      "--workspace",
      workspace,
      "--json",
    ]);
    assert.equal(missingGrant.code, 3);
    assert.equal(await readFile(target, "utf8"), before);

    const applied = await execute([
      "repair",
      "apply",
      result.invocationId,
      repair.id,
      "--workspace",
      workspace,
      "--grant-workspace-write",
      "--json",
    ]);
    assert.equal(applied.code, 0, applied.stderr);
    const application = JSON.parse(applied.stdout);
    assert.equal(application.writeAuthorized, true);
    assert.equal(application.writePerformed, true);
    assert.deepEqual(application.lifecycle, ["accepted", "applied", "verified"]);
    assert.equal(application.verification.status, "passed");
    assert.notEqual(await readFile(target, "utf8"), before);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("SIGINT begins cancellation and yields the canonical cancelled exit", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "verify-cli-cancel-"));
  try {
    await writeFile(
      join(workspace, "package.json"),
      JSON.stringify({
        name: "cancel-fixture",
        private: true,
        workspaces: ["packages/*"],
      }),
    );
    await writeFile(join(workspace, "package-lock.json"), "{}");
    const packages = join(workspace, "packages");
    await mkdir(packages);
    await Promise.all(
      Array.from({ length: 2_000 }, async (_, index) => {
        const directory = join(packages, `package-${index}`);
        await mkdir(directory);
        await writeFile(
          join(directory, "package.json"),
          JSON.stringify({ name: `package-${index}`, version: "1.0.0" }),
        );
      }),
    );
    const child = spawn(
      process.execPath,
      [bin, "verify", workspace, "--json"],
      {
        cwd: root,
        stdio: ["ignore", "pipe", "pipe", "ipc"],
        env: {
          ...process.env,
          NODE_NO_WARNINGS: "1",
          XDG_STATE_HOME: join(workspace, "state"),
        },
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const ready = await new Promise((resolveReady) => {
      child.once("message", (message) => {
        resolveReady({ ok: message?.type === "verify.cli.ready" });
      });
      child.once("error", (error) => resolveReady({ ok: false, error }));
    });
    assert.equal(ready.ok, true);
    const cancellationStartedAt = Date.now();
    child.kill("SIGINT");
    const result = await new Promise((resolveClose, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => {
        resolveClose({ code, signal });
      });
    });
    assert.equal(result.signal, null);
    assert.equal(
      result.code,
      5,
      `stdout=${stdout.trim()} stderr=${stderr.trim()}`,
    );
    assert.ok(Date.now() - cancellationStartedAt < 1_000);
    assert.equal(JSON.parse(stdout).operationalStatus, "cancelled");
    assert.match(stderr, /\[discover\]/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
