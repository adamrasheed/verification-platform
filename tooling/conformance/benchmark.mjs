import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  mkdtemp,
  readFile,
  rm,
  statfs,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { canonicalize } from "../../packages/contracts/dist/public/index.js";
import { discoverWorkspace } from "../../packages/discovery/dist/public/index.js";
import {
  VerificationEngine,
} from "../../packages/engine/dist/public/index.js";
import { LocalCacheStore } from "../../packages/execution/dist/public/index.js";
import { createReference100kCorpus } from "./generated-corpus.mjs";

const root = process.cwd();
const cli = path.join(root, "apps/cli/dist/verify.js");
const smallWorkspace = path.join(root, "tooling/corpus/npm-valid");
const outputIndex = process.argv.indexOf("--out");
const outputPath = outputIndex < 0
  ? undefined
  : path.resolve(root, process.argv[outputIndex + 1]);
if (outputIndex >= 0 && process.argv[outputIndex + 1] === undefined) {
  throw new Error("--out requires a path");
}

function summarize(samples, budgetMs) {
  const ordered = [...samples].sort((left, right) => left - right);
  const percentile = (value) =>
    ordered[
      Math.min(ordered.length - 1, Math.ceil(ordered.length * value) - 1)
    ];
  return {
    samples: ordered.length,
    medianMs: Number(percentile(0.5).toFixed(3)),
    p95Ms: Number(percentile(0.95).toFixed(3)),
    maximumMs: Number(ordered.at(-1).toFixed(3)),
    budgetMs,
  };
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function artifactDigest(relativePath) {
  return {
    path: relativePath,
    sha256: sha256(await readFile(path.join(root, relativePath))),
  };
}

function runCli(args, environment, observeProgress = false) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    let firstProgressMs;
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: root,
      env: { ...process.env, ...environment, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      if (observeProgress && firstProgressMs === undefined) {
        firstProgressMs = performance.now() - started;
      }
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      resolve({
        code,
        signal,
        stdout,
        stderr,
        elapsedMs: performance.now() - started,
        firstProgressMs,
      });
    });
  });
}

let maximumRssBytes = process.memoryUsage().rss;
const memorySampler = setInterval(() => {
  maximumRssBytes = Math.max(maximumRssBytes, process.memoryUsage().rss);
}, 10);
memorySampler.unref();

const temporary = await mkdtemp(path.join(tmpdir(), "verify-reference-"));
const referenceRoot = path.join(temporary, "reference-100k");
const failures = [];
let report;
try {
  const generatedCorpus = await createReference100kCorpus(referenceRoot);

  // One unmeasured traversal warms filesystem and runtime state.
  const warmup = await discoverWorkspace(referenceRoot);
  if (warmup.inspectedFiles !== 100_000) {
    failures.push(
      `reference fixture inspected ${warmup.inspectedFiles}, expected 100000`,
    );
  }
  const discoverySamples = [];
  for (let index = 0; index < 5; index += 1) {
    const started = performance.now();
    const result = await discoverWorkspace(referenceRoot);
    discoverySamples.push(performance.now() - started);
    if (!["complete", "bounded"].includes(result.completion)) {
      failures.push(`warm discovery ${index} was ${result.completion}`);
    }
  }

  const engineSamples = [];
  const engine = new VerificationEngine();
  let maximumOutputBytes = 0;
  for (let index = 0; index < 25; index += 1) {
    const started = performance.now();
    const result = await engine.verify({
      schemaVersion: 1,
      workspaceRoot: smallWorkspace,
      invocationId: `benchmark:engine:${index}`,
    });
    engineSamples.push(performance.now() - started);
    if (result.outcome !== "satisfied") {
      failures.push(`engine sample ${index} was ${result.outcome}`);
    }
    maximumOutputBytes = Math.max(
      maximumOutputBytes,
      Buffer.byteLength(JSON.stringify(result)),
    );
  }

  const stateRoot = path.join(temporary, "cache-state");
  const cacheSamples = [];
  const cache = new LocalCacheStore(stateRoot);
  const cacheDigest = (character) => `sha256:${character.repeat(64)}`;
  const cacheEntry = {
    schemaVersion: 1,
    planKey: cacheDigest("1"),
    proof: {
      kind: "proof",
      id: "proof:benchmark",
      revision: cacheDigest("2"),
      schemaVersion: 1,
    },
    model: {
      kind: "applicationModel",
      id: "model:benchmark",
      revision: cacheDigest("3"),
      schemaVersion: 1,
    },
    originatingExecutionId: "execution:benchmark",
    originatingResultDigest: cacheDigest("4"),
    evidenceRefs: [],
    validationEventIds: [],
    reproducibility: "hermetic",
    value: { outcome: "satisfied" },
  };
  await cache.publish(cacheEntry, "benchmark-publish");
  await cache.lookup(cacheEntry.planKey, () => true);
  for (let index = 0; index < 25; index += 1) {
    const started = performance.now();
    const result = await cache.lookup(cacheEntry.planKey, () => true);
    cacheSamples.push(performance.now() - started);
    if (result.disposition !== "hit") {
      failures.push(`cache sample ${index} was ${result.disposition}`);
    }
    maximumOutputBytes = Math.max(
      maximumOutputBytes,
      Buffer.byteLength(JSON.stringify(result)),
    );
  }

  const progressState = path.join(temporary, "progress-state");
  const progress = await runCli(
    ["verify", smallWorkspace, "--json", "--no-cache"],
    { XDG_STATE_HOME: progressState },
    true,
  );
  maximumOutputBytes = Math.max(
    maximumOutputBytes,
    Buffer.byteLength(progress.stdout),
  );
  if (progress.code !== 0) failures.push(`progress run exited ${progress.code}`);

  const cancellationState = path.join(temporary, "cancellation-state");
  const cancellation = await runCli(
    ["verify", smallWorkspace, "--json", "--no-cache", "--deadline", "1"],
    { XDG_STATE_HOME: cancellationState },
  );
  maximumOutputBytes = Math.max(
    maximumOutputBytes,
    Buffer.byteLength(cancellation.stdout),
  );
  if (cancellation.code !== 5) {
    failures.push(`deadline cancellation exited ${cancellation.code}, expected 5`);
  }

  const filesystem = await statfs(referenceRoot);
  const measurements = {
    warmDiscovery100k: summarize(discoverySamples, 5_000),
    engineOverhead: summarize(engineSamples, 1_000),
    cacheLookup: summarize(cacheSamples, 50),
    cancellation: {
      samples: 1,
      maximumMs: Number(cancellation.elapsedMs.toFixed(3)),
      budgetMs: 1_000,
    },
    firstProgress: {
      samples: 1,
      maximumMs: progress.firstProgressMs === undefined
        ? Number.MAX_SAFE_INTEGER
        : Number(progress.firstProgressMs.toFixed(3)),
      budgetMs: 250,
    },
    machineOutput: {
      maximumBytes: maximumOutputBytes,
      budgetBytes: 16 * 1024 * 1024,
    },
    memory: {
      maximumRssBytes,
      publishedBoundBytes: 1024 * 1024 * 1024,
    },
  };
  const requirements = {
    warmDiscoveryP95Passed:
      measurements.warmDiscovery100k.p95Ms <=
      measurements.warmDiscovery100k.budgetMs,
    coldVerifyP95Passed:
      measurements.engineOverhead.p95Ms <=
      measurements.engineOverhead.budgetMs,
    cacheLookupP95Passed:
      measurements.cacheLookup.p95Ms <=
      measurements.cacheLookup.budgetMs,
    cancellationWithinOneSecondPassed:
      measurements.cancellation.maximumMs <=
      measurements.cancellation.budgetMs,
    firstProgressWithin250MsPassed:
      measurements.firstProgress.maximumMs <=
      measurements.firstProgress.budgetMs,
    machineOutputBoundPassed:
      measurements.machineOutput.maximumBytes <=
      measurements.machineOutput.budgetBytes,
    memoryBoundPassed:
      measurements.memory.maximumRssBytes <=
      measurements.memory.publishedBoundBytes,
  };
  for (const [name, passed] of Object.entries(requirements)) {
    if (!passed) failures.push(`performance requirement failed: ${name}`);
  }
  const artifacts = await Promise.all([
    artifactDigest("apps/cli/dist/bin/verify.js"),
    artifactDigest("apps/cli/dist/verify.js"),
    artifactDigest("packages/discovery/dist/public/index.js"),
    artifactDigest("packages/engine/dist/public/index.js"),
  ]);
  const hardware = {
    operatingSystem: `${os.platform()} ${os.release()}`,
    architecture: os.arch(),
    cpu: os.cpus()[0]?.model ?? "unknown",
    logicalCpuCount: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
    nodeVersion: process.version,
    filesystem: {
      type: String(filesystem.type),
      blockSize: filesystem.bsize,
    },
  };
  report = {
    schemaVersion: 1,
    kind: "performance",
    status: failures.length === 0 ? "passed" : "failed",
    artifact: {
      command: "node tooling/conformance/benchmark.mjs",
      measurementSha256: sha256(canonicalize(measurements)),
      components: artifacts,
    },
    environment: hardware,
    corpus: {
      generated: true,
      shape: "99,998 ordinary files plus package.json and package-lock.json",
      fileCount: 100_000,
      byteCount: generatedCorpus.byteCount,
      generationIncludedInMeasurements: false,
      coldWarmState: "one unmeasured warm traversal before five samples",
    },
    measurements,
    requirements,
    failures,
  };
} finally {
  clearInterval(memorySampler);
  await rm(temporary, { recursive: true, force: true });
}

const document = `${canonicalize(report)}\n`;
if (outputPath !== undefined) await writeFile(outputPath, document);
process.stdout.write(document);
if (report.status !== "passed") process.exitCode = 1;
