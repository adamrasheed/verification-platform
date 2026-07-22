import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  chmod,
  copyFile,
  readFile,
  rm,
} from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  createLinuxNamespaceSandboxLauncher,
  createMacOsAppSandboxLauncher,
} from "@verify-internal/plugin-runtime";
import {
  packageRoot,
  runProviderConformance,
} from "./helpers.mjs";

const executeFile = promisify(execFile);
const repositoryRoot = path.resolve(packageRoot, "../..");

async function digest(file) {
  return `sha256:${createHash("sha256").update(await readFile(file)).digest("hex")}`;
}

test("Linux production host runs the GitHub repository-policy provider", {
  skip: process.platform !== "linux"
    || process.env.VERIFY_RUN_GITHUB_PROVIDER_LINUX_NATIVE !== "1",
  timeout: 60_000,
}, async (context) => {
  const nativeDirectory = path.join(packageRoot, ".tmp", "native-linux-provider");
  context.after(async () => rm(nativeDirectory, { recursive: true, force: true }));
  await executeFile(process.execPath, [
    path.join(repositoryRoot, "tooling/native/linux/build-host.mjs"),
    "--output",
    nativeDirectory,
  ]);
  const host = path.join(nativeDirectory, "VerifyPluginHost");
  const seccomp = path.join(nativeDirectory, "VerifyPluginSeccomp.so");
  const nodePath = path.join(nativeDirectory, "node");
  const bubblewrapPath = "/usr/bin/bwrap";
  await copyFile(process.execPath, nodePath);
  await chmod(nodePath, 0o555);
  const sandbox = createLinuxNamespaceSandboxLauncher({
    nativeDirectory,
    nodePath,
    bubblewrapPath,
    expectedHostDigest: await digest(host),
    expectedNodeDigest: await digest(nodePath),
    expectedBubblewrapDigest: await digest(bubblewrapPath),
    expectedSeccompLibraryDigest: await digest(seccomp),
  });
  assert.equal(sandbox.production, true);
  assert.equal(await sandbox.available(), true);
  await runProviderConformance(sandbox, 30_000);
});

test("macOS development host runs the GitHub repository-policy provider", {
  skip: process.platform !== "darwin"
    || process.env.VERIFY_RUN_GITHUB_PROVIDER_MACOS_NATIVE !== "1",
  timeout: 60_000,
}, async (context) => {
  const appBundlePath = path.join(
    packageRoot,
    ".tmp",
    "native-macos-provider",
    "VerifyPluginHost.app",
  );
  context.after(async () => rm(path.dirname(appBundlePath), { recursive: true, force: true }));
  await executeFile(process.execPath, [
    path.join(repositoryRoot, "tooling/native/macos/build-host.mjs"),
    "--output",
    appBundlePath,
  ]);
  const sandbox = createMacOsAppSandboxLauncher({
    appBundlePath,
    allowDevelopmentSignature: true,
  });
  assert.equal(sandbox.production, false);
  assert.equal(await sandbox.available(), true);
  await runProviderConformance(sandbox, 30_000);
});

test("signed macOS production host runs the GitHub repository-policy provider", {
  skip: process.platform !== "darwin"
    || process.env.VERIFY_RUN_GITHUB_PROVIDER_MACOS_PRODUCTION !== "1",
  timeout: 60_000,
}, async () => {
  const appBundlePath = path.resolve(
    requiredEnvironment("VERIFY_MACOS_PRODUCTION_APP"),
  );
  const manifest = JSON.parse(await readFile(path.resolve(
    requiredEnvironment("VERIFY_MACOS_PRODUCTION_MANIFEST"),
  ), "utf8"));
  assert.equal(manifest.platform, "macos");
  assert.equal(manifest.identity.notarized, true);
  assert.equal(manifest.identity.timestamped, true);
  const sandbox = createMacOsAppSandboxLauncher({
    appBundlePath,
    expectedTeamIdentifier: manifest.identity.teamIdentifier,
    expectedSigningAuthority: manifest.identity.signingAuthority,
    expectedHostCdHash: manifest.identity.host.cdHash,
    expectedHelperCdHash: manifest.identity.helper.cdHash,
    expectedSupervisorCdHash: manifest.identity.supervisor.cdHash,
  });
  assert.equal(sandbox.production, true);
  assert.equal(await sandbox.available(), true);
  await runProviderConformance(sandbox, 30_000);
});

function requiredEnvironment(name) {
  const value = process.env[name];
  assert.ok(value, `${name} is required for production conformance`);
  return value;
}
