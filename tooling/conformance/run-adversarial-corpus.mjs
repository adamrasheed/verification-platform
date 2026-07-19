import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { discoverWorkspace } from "../../packages/discovery/dist/public/index.js";
import {
  createNpmWorkspace,
  createOrdinaryFiles,
} from "./generated-corpus.mjs";

const root = process.cwd();
const cli = path.join(root, "apps/cli/dist/verify.js");
const failures = [];

function runCli(workspace, state, args = [], timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      cli,
      "verify",
      workspace,
      "--json",
      ...args,
    ], {
      cwd: root,
      env: { ...process.env, XDG_STATE_HOME: state, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      let document;
      try {
        document = JSON.parse(stdout);
      } catch {
        document = undefined;
      }
      resolve({ code, signal, stdout, stderr, document });
    });
  });
}

async function listFiles(directory) {
  const output = [];
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(target);
      else if (entry.isFile()) output.push(target);
    }
  }
  await walk(directory);
  return output.sort();
}

function semanticProjection(run) {
  return {
    code: run.code,
    operationalStatus: run.document?.operationalStatus,
    outcome: run.document?.result?.outcome,
    packageManager: run.document?.result?.workspace?.packageManager,
    reasonCodes: run.document?.result?.reasonCodes,
  };
}

const temporary = await mkdtemp(path.join(tmpdir(), "verify-adversarial-"));
try {
  const collisionRoot = path.join(temporary, "unicode-case");
  await createNpmWorkspace(collisionRoot, {
    workspaceCount: 4,
    packageNames: [
      "@generated/case",
      "@generated/Case",
      "@generated/café",
      "@generated/cafe\u0301",
    ],
  });
  const collisionState = path.join(temporary, "state-collision");
  const collisionOne = await runCli(
    collisionRoot,
    collisionState,
    ["--no-cache"],
  );
  const collisionTwo = await runCli(
    collisionRoot,
    collisionState,
    ["--no-cache"],
  );
  if (
    collisionOne.document === undefined ||
    JSON.stringify(semanticProjection(collisionOne)) !==
      JSON.stringify(semanticProjection(collisionTwo))
  ) {
    failures.push("Unicode/case collision fixture was not deterministic");
  }

  const boundedRoot = path.join(temporary, "bounded");
  await createNpmWorkspace(boundedRoot, { workspaceCount: 1 });
  await createOrdinaryFiles(boundedRoot, 5_000);
  const bounded = await discoverWorkspace(boundedRoot, {
    limits: { maxFiles: 1_000 },
  });
  if (bounded.completion !== "bounded" || bounded.inspectedFiles > 1_000) {
    failures.push(
      `bounded tree escaped limit: ${bounded.completion}/${bounded.inspectedFiles}`,
    );
  }

  const hostileRoot = path.join(temporary, "special");
  await createNpmWorkspace(hostileRoot, { workspaceCount: 1 });
  let deep = hostileRoot;
  for (let index = 0; index < 70; index += 1) {
    deep = path.join(deep, `d${String(index).padStart(2, "0")}`);
  }
  await mkdir(deep, { recursive: true });
  await writeFile(
    path.join(deep, "secret.txt"),
    "DEEP_SECRET_CANARY_DO_NOT_LEAK\n",
  );
  const outsideSecret = path.join(temporary, "outside-secret.txt");
  await writeFile(outsideSecret, "SYMLINK_SECRET_CANARY_DO_NOT_LEAK\n");
  await symlink(outsideSecret, path.join(hostileRoot, "outside-link"));
  await writeFile(
    path.join(hostileRoot, ".npmrc"),
    "//registry.invalid/:_authToken=NPM_SECRET_CANARY_DO_NOT_LEAK\n",
  );
  if (process.platform !== "win32") {
    const fifo = path.join(hostileRoot, "hostile.fifo");
    const made = await new Promise((resolve) => {
      const child = spawn("mkfifo", [fifo]);
      child.on("error", () => resolve(false));
      child.on("close", (code) => resolve(code === 0));
    });
    if (!made) failures.push("could not create special-file fixture");
  }
  const hostileRun = await runCli(
    hostileRoot,
    path.join(temporary, "state-hostile"),
    ["--no-cache"],
  );
  for (const canary of [
    "DEEP_SECRET_CANARY_DO_NOT_LEAK",
    "SYMLINK_SECRET_CANARY_DO_NOT_LEAK",
    "NPM_SECRET_CANARY_DO_NOT_LEAK",
  ]) {
    if (hostileRun.stdout.includes(canary) || hostileRun.stderr.includes(canary)) {
      failures.push(`hostile corpus leaked ${canary}`);
    }
  }
  if (hostileRun.document === undefined || hostileRun.signal !== null) {
    failures.push("special/deep fixture failed to terminate with JSON");
  }

  const mutationRoot = path.join(temporary, "mutation");
  await createNpmWorkspace(mutationRoot, { workspaceCount: 2 });
  await createOrdinaryFiles(mutationRoot, 2_000);
  await mkdir(path.join(mutationRoot, ".git"), { recursive: true });
  await writeFile(path.join(mutationRoot, ".git", "DIRTY"), "dirty\n");
  const manifestPath = path.join(mutationRoot, "package.json");
  const manifestBefore = createHash("sha256")
    .update(await readFile(manifestPath))
    .digest("hex");
  const mutationTarget = path.join(mutationRoot, "ordinary", "mutation.txt");
  let mutating = true;
  const mutator = (async () => {
    let index = 0;
    while (mutating && index < 100) {
      await writeFile(mutationTarget, `dirty-${index}\n`);
      index += 1;
    }
  })();
  const mutationRun = await runCli(
    mutationRoot,
    path.join(temporary, "state-mutation"),
    ["--no-cache"],
  );
  mutating = false;
  await mutator;
  const manifestAfter = createHash("sha256")
    .update(await readFile(manifestPath))
    .digest("hex");
  if (
    mutationRun.document === undefined ||
    manifestBefore !== manifestAfter
  ) {
    failures.push("dirty/mutating worktree safety failed");
  }

  const cacheRoot = path.join(temporary, "cache");
  await createNpmWorkspace(cacheRoot, { workspaceCount: 2 });
  const cacheState = path.join(temporary, "state-cache");
  const miss = await runCli(cacheRoot, cacheState);
  const hit = await runCli(cacheRoot, cacheState);
  const bypass = await runCli(cacheRoot, cacheState, ["--no-cache"]);
  const disposition = (run) =>
    run.document?.result?.cacheDecisions?.[0]?.status;
  if (
    disposition(miss) !== "miss" ||
    disposition(hit) !== "hit" ||
    disposition(bypass) !== "bypass"
  ) {
    failures.push(
      `cache matrix was ${disposition(miss)}/${disposition(hit)}/${disposition(bypass)}`,
    );
  }
  const cacheFiles = (await listFiles(cacheState)).filter((file) =>
    file.includes(`${path.sep}cache${path.sep}`) && file.endsWith(".json")
  );
  if (cacheFiles.length === 0) {
    failures.push("cache fixture did not publish a cache file");
  } else {
    await writeFile(cacheFiles[0], "{corrupt");
    const corrupted = await runCli(cacheRoot, cacheState);
    if (
      corrupted.document?.operationalStatus !== "completed" ||
      disposition(corrupted) === "hit"
    ) {
      failures.push("corrupt cache did not become a safe miss");
    }
  }

  const existingHostile = await runCli(
    path.join(root, "tooling/corpus/hostile"),
    path.join(temporary, "state-existing-hostile"),
    ["--no-cache"],
  );
  if (
    existingHostile.stdout.includes("SECRET_CANARY_DO_NOT_LEAK") ||
    existingHostile.stdout.includes("VERIFIER_EXECUTED_REPOSITORY_CODE") ||
    existingHostile.stderr.includes("SECRET_CANARY_DO_NOT_LEAK") ||
    existingHostile.stderr.includes("VERIFIER_EXECUTED_REPOSITORY_CODE")
  ) {
    failures.push("existing hostile script/secret corpus leaked");
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(
  "generated adversarial corpus passed: bounds, collisions, special files, mutation, corruption, cache, secrets",
);
