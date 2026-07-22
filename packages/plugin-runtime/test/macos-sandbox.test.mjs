import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  createMacOsAppSandboxLauncher,
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

async function runMacOsSandboxConformance(sandbox, createCpuSandbox) {
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
  assert.equal(provider.transports.length, 1);

  const slow = await signedManifest("slow.mjs", "synthetic-slow");
  await assert.rejects(
    runtime.invoke(authorizedInvocation(slow, {
      deadlineMs: 250,
    })),
    (error) => error.code === "VFY_PLUGIN_DEADLINE",
  );

  const manifest = await signedManifest("sandbox-canary.mjs", "synthetic-sandbox");
  const result = await runtime.invoke(authorizedInvocation(manifest, {
    deadlineMs: 10_000,
  }));
  assert.equal(result.contributions.length, 1);
  assert.equal(result.contributions[0].filesystem, "ERR_ACCESS_DENIED");
  assert.equal(result.contributions[0].subprocess, "ERR_ACCESS_DENIED");
  assert.match(result.contributions[0].network, /^(?:EPERM|EACCES)$/);

  const memoryFlood = await signedManifest(
    "memory-flood.mjs",
    "synthetic-memory-flood",
  );
  await assert.rejects(
    runtime.invoke(authorizedInvocation(memoryFlood, {
      deadlineMs: 10_000,
    })),
    (error) => error.code === "VFY_PLUGIN_RESOURCE_EXHAUSTED",
  );

  const cpuSandbox = createCpuSandbox();
  const cpuFlood = await signedManifest("cpu-flood.mjs", "synthetic-cpu-flood");
  await assert.rejects(
    runtimeHarness(brokerHarness().broker, { sandbox: cpuSandbox }).invoke(
      authorizedInvocation(cpuFlood, {
        deadlineMs: 10_000,
      }, cpuSandbox),
    ),
    (error) => error.code === "VFY_PLUGIN_RESOURCE_EXHAUSTED",
  );

  const stderrFlood = await signedManifest(
    "stderr-flood.mjs",
    "synthetic-stderr-flood",
  );
  await assert.rejects(
    runtime.invoke(authorizedInvocation(stderrFlood, {
      deadlineMs: 10_000,
    })),
    (error) => error.code === "VFY_PLUGIN_STDERR_OVERSIZED",
  );
}

test("macOS native host runs synthetic providers and denies ambient capabilities", {
  skip: process.platform !== "darwin",
  timeout: 60_000,
}, async () => {
  const appBundlePath = path.resolve(".tmp/native-macos-test/VerifyPluginHost.app");
  await executeFile(process.execPath, [
    path.join(repositoryRoot, "tooling/native/macos/build-host.mjs"),
    "--output",
    appBundlePath,
  ]);
  await assert.rejects(
    executeFile(process.execPath, [
      path.join(repositoryRoot, "tooling/native/macos/build-host.mjs"),
      "--release",
      "--output",
      path.resolve(".tmp/native-macos-test/unsigned.app"),
    ]),
    (error) => error.stderr.includes(
      "release builds require a non-ad-hoc signing identity",
    ),
  );
  const sandbox = createMacOsAppSandboxLauncher({
    appBundlePath,
    allowDevelopmentSignature: true,
  });
  assert.equal(await sandbox.available(), true);
  assert.equal(sandbox.production, false);
  const productionIdentity = createMacOsAppSandboxLauncher({ appBundlePath });
  assert.equal(productionIdentity.production, true);
  assert.equal(await productionIdentity.available(), false);
  await runMacOsSandboxConformance(sandbox, () => createMacOsAppSandboxLauncher({
    appBundlePath,
    allowDevelopmentSignature: true,
    maximumCpuNanoseconds: 1_000_000_000,
  }));
});

test("signed macOS production host passes the same conformance suite", {
  skip: process.platform !== "darwin"
    || process.env.VERIFY_RUN_MACOS_PRODUCTION !== "1",
  timeout: 60_000,
}, async () => {
  const appBundlePath = path.resolve(
    assertRequiredEnvironment("VERIFY_MACOS_PRODUCTION_APP"),
  );
  const manifestPath = path.resolve(
    assertRequiredEnvironment("VERIFY_MACOS_PRODUCTION_MANIFEST"),
  );
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.platform, "macos");
  assert.equal(manifest.identity.notarized, true);
  assert.equal(manifest.identity.timestamped, true);
  const launcherOptions = {
    appBundlePath,
    expectedTeamIdentifier: manifest.identity.teamIdentifier,
    expectedSigningAuthority: manifest.identity.signingAuthority,
    expectedHostCdHash: manifest.identity.host.cdHash,
    expectedHelperCdHash: manifest.identity.helper.cdHash,
    expectedSupervisorCdHash: manifest.identity.supervisor.cdHash,
  };
  const sandbox = createMacOsAppSandboxLauncher(launcherOptions);
  assert.equal(sandbox.production, true);
  assert.equal(await sandbox.available(), true);
  await runMacOsSandboxConformance(sandbox, () => createMacOsAppSandboxLauncher({
    ...launcherOptions,
    maximumCpuNanoseconds: 1_000_000_000,
  }));
});

function assertRequiredEnvironment(name) {
  const value = process.env[name];
  assert.ok(value, `${name} is required for production conformance`);
  return value;
}
