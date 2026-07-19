import assert from "node:assert/strict";
import { execFile } from "node:child_process";
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
  const sandbox = createMacOsAppSandboxLauncher({
    appBundlePath,
    allowDevelopmentSignature: true,
  });
  assert.equal(await sandbox.available(), true);
  assert.equal(sandbox.production, false);

  const fast = await signedManifest("fast.mjs", "synthetic-fast");
  const baseBroker = brokerHarness();
  const runtime = runtimeHarness(baseBroker.broker, { sandbox });
  const fastResult = await runtime.invoke(invocation(fast, {
    enforcementTier: "macos-app-sandbox-development-v1",
    deadlineMs: 10_000,
  }));
  assert.equal(fastResult.contributions[0].behavior, "fast");

  const brokered = await signedManifest("brokered.mjs", "synthetic-brokered", {
    destinations: [destination({ secret: true })],
    secrets: [secretPermission()],
  });
  const provider = brokerHarness();
  const brokeredResult = await runtimeHarness(provider.broker, { sandbox }).invoke(
    invocation(brokered, {
      enforcementTier: "macos-app-sandbox-development-v1",
      destinationIds: ["api"],
      secretReferenceIds: ["secret:provider"],
      deadlineMs: 10_000,
    }),
  );
  assert.equal(brokeredResult.contributions[0].behavior, "brokered");
  assert.equal(provider.transports.length, 1);

  const slow = await signedManifest("slow.mjs", "synthetic-slow");
  await assert.rejects(
    runtime.invoke(invocation(slow, {
      enforcementTier: "macos-app-sandbox-development-v1",
      deadlineMs: 250,
    })),
    (error) => error.code === "VFY_PLUGIN_DEADLINE",
  );

  const manifest = await signedManifest("sandbox-canary.mjs", "synthetic-sandbox");
  const result = await runtime.invoke(invocation(manifest, {
    enforcementTier: "macos-app-sandbox-development-v1",
    deadlineMs: 10_000,
  }));
  assert.equal(result.contributions.length, 1);
  assert.equal(result.contributions[0].filesystem, "ERR_ACCESS_DENIED");
  assert.equal(result.contributions[0].subprocess, "ERR_ACCESS_DENIED");
  assert.match(result.contributions[0].network, /^(?:EPERM|EACCES)$/);
});
