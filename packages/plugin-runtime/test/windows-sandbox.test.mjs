import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  copyFile,
  readFile,
  rm,
} from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  createWindowsAppContainerSandboxLauncher,
} from "../dist/public/index.js";
import {
  brokerHarness,
  destination,
  invocation,
  runtimeHarness,
  secretPermission,
  signedManifest,
} from "./helpers.mjs";

const executeFile = promisify(execFile);
const repositoryRoot = path.resolve(import.meta.dirname, "../../..");

async function digest(file) {
  return `sha256:${createHash("sha256").update(await readFile(file)).digest("hex")}`;
}

test("Windows native host runs synthetic providers and denies ambient capabilities", {
  skip:
    process.platform !== "win32"
    || process.env.VERIFY_RUN_WINDOWS_NATIVE !== "1",
  timeout: 90_000,
}, async (context) => {
  const nativeDirectory = path.resolve(".tmp/native-windows-test");
  context.after(async () => rm(nativeDirectory, {
    recursive: true,
    force: true,
    maxRetries: 50,
    retryDelay: 200,
  }));
  await executeFile(process.execPath, [
    path.join(repositoryRoot, "tooling/native/windows/build-host.mjs"),
    "--output",
    nativeDirectory,
  ]);
  const host = path.join(nativeDirectory, "VerifyPluginHost.exe");
  const nodePath = path.join(nativeDirectory, "node.exe");
  await copyFile(process.execPath, nodePath);
  const identity = {
    expectedHostDigest: await digest(host),
    expectedNodeDigest: await digest(nodePath),
  };
  const sandbox = createWindowsAppContainerSandboxLauncher({
    nativeDirectory,
    nodePath,
    allowDevelopmentIdentity: true,
    ...identity,
  });
  assert.equal(sandbox.production, false);
  assert.equal(await sandbox.available(), true);
  assert.equal(
    await createWindowsAppContainerSandboxLauncher({
      nativeDirectory,
      nodePath,
      allowDevelopmentIdentity: true,
      ...identity,
      expectedHostDigest: `sha256:${"0".repeat(64)}`,
    }).available(),
    false,
  );
  const productionIdentity = createWindowsAppContainerSandboxLauncher({
    nativeDirectory,
    nodePath,
    ...identity,
  });
  assert.equal(productionIdentity.production, true);
  assert.equal(await productionIdentity.available(), false);
  const authorizedInvocation = (manifest, options = {}, launcher = sandbox) =>
    invocation(manifest, {
      ...options,
      enforcementTier: launcher.enforcementTier,
      resourceLimits: launcher.resourceLimits,
    });

  const fast = await signedManifest("fast.mjs", "synthetic-fast");
  const baseBroker = brokerHarness();
  const runtime = runtimeHarness(baseBroker.broker, { sandbox });
  const fastResult = await runtime.invoke(authorizedInvocation(fast, {
    deadlineMs: 10_000,
  }));
  assert.equal(fastResult.contributions[0].behavior, "fast");

  const brokered = await signedManifest("brokered.mjs", "synthetic-brokered", {
    destinations: [destination({ secret: true })],
    secrets: [secretPermission()],
  });
  const provider = brokerHarness();
  const brokeredResult = await runtimeHarness(provider.broker, { sandbox }).invoke(
    authorizedInvocation(brokered, {
      destinationIds: ["api"],
      secretReferenceIds: ["secret:provider"],
      deadlineMs: 10_000,
    }),
  );
  assert.equal(brokeredResult.contributions[0].behavior, "brokered");

  const slow = await signedManifest("slow.mjs", "synthetic-slow");
  await assert.rejects(
    runtime.invoke(authorizedInvocation(slow, { deadlineMs: 250 })),
    (error) => error.code === "VFY_PLUGIN_DEADLINE",
  );

  const canary = await signedManifest(
    "sandbox-canary.mjs",
    "synthetic-sandbox",
  );
  const canaryResult = await runtime.invoke(authorizedInvocation(canary, {
    deadlineMs: 10_000,
  }));
  assert.notEqual(canaryResult.contributions[0].filesystem, "ALLOWED");
  assert.notEqual(canaryResult.contributions[0].subprocess, "ALLOWED");
  assert.notEqual(canaryResult.contributions[0].network, "ALLOWED");
  assert.notEqual(canaryResult.contributions[0].network, "TIMEOUT");

  const memoryFlood = await signedManifest(
    "memory-flood.mjs",
    "synthetic-memory-flood",
  );
  await assert.rejects(
    runtime.invoke(authorizedInvocation(memoryFlood, { deadlineMs: 10_000 })),
    (error) => error.code === "VFY_PLUGIN_RESOURCE_EXHAUSTED",
  );

  const cpuSandbox = createWindowsAppContainerSandboxLauncher({
    nativeDirectory,
    nodePath,
    allowDevelopmentIdentity: true,
    maximumCpuNanoseconds: 1_000_000_000,
    ...identity,
  });
  const cpuFlood = await signedManifest("cpu-flood.mjs", "synthetic-cpu-flood");
  await assert.rejects(
    runtimeHarness(brokerHarness().broker, { sandbox: cpuSandbox }).invoke(
      authorizedInvocation(cpuFlood, { deadlineMs: 10_000 }, cpuSandbox),
    ),
    (error) => error.code === "VFY_PLUGIN_RESOURCE_EXHAUSTED",
  );

  const stderrFlood = await signedManifest(
    "stderr-flood.mjs",
    "synthetic-stderr-flood",
  );
  await assert.rejects(
    runtime.invoke(authorizedInvocation(stderrFlood, { deadlineMs: 10_000 })),
    (error) => error.code === "VFY_PLUGIN_STDERR_OVERSIZED",
  );
});
