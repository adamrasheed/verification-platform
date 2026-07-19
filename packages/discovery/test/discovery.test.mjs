import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createDiscoveryPlan,
  discoverWorkspace,
  parseJsonData,
  resolveAndSealWorkspaceModel,
  resolveDiscoveryLimits,
} from "../dist/public/index.js";

const corpus = path.resolve("../../tooling/corpus");

test("discovers npm workspaces in stable order", async () => {
  const first = await discoverWorkspace(path.join(corpus, "npm-valid"));
  const second = await discoverWorkspace(path.join(corpus, "npm-valid"));
  assert.equal(first.selectedPackageManager, "npm");
  assert.deepEqual(first.manifests.map((manifest) => manifest.path), [
    "package.json",
    "packages/a/package.json",
    "packages/b/package.json",
  ]);
  assert.equal(first.signals.some((item) => item.readerId === "npm-lockfile:v1"), true);
  assert.equal(first.facts.length, first.manifests.length);
  assert.equal(first.candidates.length, first.manifests.length);
  assert.equal(first.modelRevision, second.modelRevision);
});

test("reads pnpm data without evaluating configuration", async () => {
  const result = await discoverWorkspace(path.join(corpus, "pnpm-valid"));
  assert.equal(result.selectedPackageManager, "pnpm");
  assert.deepEqual(result.workspacePatterns, ["packages/*"]);
  assert.equal(result.manifests[1]?.workspaceMember, true);
});

test("retains conflicting package manager facts", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "verify-conflict-"));
  await writeFile(path.join(root, "package.json"), "{\"name\":\"fixture\"}");
  await writeFile(path.join(root, "package-lock.json"), "{\"lockfileVersion\":3}");
  await writeFile(path.join(root, "yarn.lock"), "__metadata:\\n  version: 8\\n");
  const result = await discoverWorkspace(root);
  assert.deepEqual(result.packageManagers, ["npm", "yarn"]);
  assert.equal(result.conflicts[0]?.code, "MULTIPLE_PACKAGE_MANAGERS");
});

test("never follows workspace symlinks", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "verify-root-"));
  const outside = await mkdtemp(path.join(tmpdir(), "verify-outside-"));
  await mkdir(path.join(root, "packages"));
  await writeFile(path.join(root, "package.json"), "{\"workspaces\":[\"packages/*\"]}");
  await writeFile(path.join(outside, "package.json"), "{\"name\":\"secret\"}");
  await symlink(outside, path.join(root, "packages", "escape"));
  const result = await discoverWorkspace(root);
  assert.equal(result.manifests.some((manifest) => manifest.name === "secret"), false);
  assert.equal(result.skipped.some((item) => item.reason === "symbolic_link"), true);
});

test("respects cancellation before reading files", async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await discoverWorkspace(path.join(corpus, "npm-valid"), {
    signal: controller.signal,
  });
  assert.equal(result.completion, "cancelled");
  assert.equal(result.inspectedBytes, 0);
});

test("semantic workspace and model identities survive a moved checkout", async () => {
  const left = await mkdtemp(path.join(tmpdir(), "verify-left-"));
  const right = await mkdtemp(path.join(tmpdir(), "verify-right-"));
  await cp(path.join(corpus, "npm-valid"), left, { recursive: true });
  await cp(path.join(corpus, "npm-valid"), right, { recursive: true });
  const first = await discoverWorkspace(left);
  const second = await discoverWorkspace(right);
  assert.equal(first.workspaceBinding, second.workspaceBinding);
  assert.equal(first.modelRevision, second.modelRevision);
  assert.notEqual(first.workspaceRoot, second.workspaceRoot);
});

test("discovery plans can never grant network, writes, or processes", () => {
  const plan = createDiscoveryPlan("/workspace", { maxFiles: 10 });
  assert.deepEqual(plan.permissions, { network: false, write: false, process: false });
  assert.equal(plan.limits.maxFiles, 10);
  assert.equal(
    resolveDiscoveryLimits({ maxFiles: Number.MAX_SAFE_INTEGER }).maxFiles,
    1_000_000,
  );
  assert.throws(() => resolveDiscoveryLimits({ maxFiles: 0 }), /positive integer/);
});

test("structured JSON rejects duplicate keys before projection", async () => {
  const text = await readFile(
    new URL("../fixtures/duplicate-key-package.json", import.meta.url),
    "utf8",
  );
  assert.throws(() => parseJsonData(text), { code: "DUPLICATE_KEY" });
  const root = await mkdtemp(path.join(tmpdir(), "verify-duplicate-key-"));
  await writeFile(path.join(root, "package.json"), text);
  const result = await discoverWorkspace(root);
  assert.equal(
    result.diagnostics.some((item) => item.code === "DUPLICATE_PACKAGE_JSON_KEY"),
    true,
  );
});

test("nested lockfiles remain visible and make ownership ambiguous", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "verify-nested-lock-"));
  await mkdir(path.join(root, "packages", "a"), { recursive: true });
  await writeFile(path.join(root, "package.json"), JSON.stringify({
    name: "root",
    workspaces: ["packages/*"],
  }));
  await writeFile(path.join(root, "package-lock.json"), "{}");
  await writeFile(path.join(root, "packages", "a", "package.json"), JSON.stringify({
    name: "@x/a",
  }));
  await writeFile(path.join(root, "packages", "a", "package-lock.json"), "{}");
  const result = await discoverWorkspace(root);
  assert.deepEqual(result.lockfiles, [
    "package-lock.json",
    "packages/a/package-lock.json",
  ]);
});

function proofRegistration(predicate, index) {
  const hex = String(index + 1).repeat(64).slice(0, 64);
  return {
    predicate,
    definition: {
      id: `proof:${index}`,
      revision: `sha256:${hex}`,
      schemaVersion: 1,
      evaluator: { id: `evaluator:${index}`, version: "1", artifactDigest: `sha256:${"a".repeat(64)}` },
      predicateLanguage: { id: "predicate.workspace", schemaVersion: 1, revision: `sha256:${"b".repeat(64)}` },
      inputs: [],
      evidenceRequirements: [],
      dependencies: [],
      permissions: { filesystem: [], network: [], subprocess: false, secrets: [] },
      reproducibility: "hermetic",
      cachePolicy: { mode: "content_addressed" },
      timeoutMs: 1000,
      retryPolicy: { maximumAttempts: 1, retryableOperations: [] },
      applicability: {
        language: { id: "applicability.constant", schemaVersion: 1, revision: `sha256:${"c".repeat(64)}` },
        expression: true,
      },
      provenance: [],
    },
  };
}

test("supported discovery seals an exactly traversable model without a hash cycle", async () => {
  const discovery = await discoverWorkspace(path.join(corpus, "npm-valid"));
  const predicates = [
    "manifest.structuralValidity",
    "workspace.uniqueMembership",
    "workspace.localDependencyReference",
    "workspace.singleLockfileOwnership",
  ];
  const result = await resolveAndSealWorkspaceModel(
    discovery,
    predicates.map(proofRegistration),
  );
  assert.equal(result.status, "sealed");
  assert.equal(result.graph.bindings.length, 4);
  assert.equal(result.graph.promises.some((item) => "proof" in item), false);
  assert.equal(result.graph.proofs.some((item) => "promise" in item), false);
  assert.deepEqual(
    result.graph.model.promiseProofBindings.map((item) => item.revision),
    result.graph.bindings.map((item) => item.revision),
  );
});

test("malformed manifests retain a stable unnamed Application for structural evaluation", async () => {
  const discovery = await discoverWorkspace(path.join(corpus, "npm-invalid-manifest"));
  const predicates = [
    "manifest.structuralValidity",
    "workspace.uniqueMembership",
    "workspace.localDependencyReference",
    "workspace.singleLockfileOwnership",
  ];
  const result = await resolveAndSealWorkspaceModel(
    discovery,
    predicates.map(proofRegistration),
  );
  assert.equal(result.status, "sealed");
  assert.equal(result.graph.applications[0].packageIdentity, undefined);
  assert.equal(
    discovery.diagnostics.some((item) => item.code === "INVALID_PACKAGE_JSON"),
    true,
  );
});

test("unknown repositories are explicitly not evaluated during model resolution", async () => {
  const discovery = await discoverWorkspace(path.join(corpus, "unknown"));
  const result = await resolveAndSealWorkspaceModel(discovery, []);
  assert.equal(result.status, "not_evaluated");
  assert.equal(result.diagnostics[0].code, "UNSUPPORTED_ECOSYSTEM");
});
