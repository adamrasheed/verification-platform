import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  sha256,
  validateNativeHostReleaseManifest,
  verifyNativeHostReleaseManifest,
} from "../lib.mjs";

const bytes = Buffer.from("signed-native-host-archive");
const digest = sha256(bytes);
const cdHash = "a".repeat(40);
const thumbprint = "B".repeat(40);

function macManifest() {
  return {
    schemaVersion: 1,
    kind: "verify-native-host-release",
    platform: "macos",
    version: "1.2.3",
    artifact: { file: "VerifyPluginHost-macos-1.2.3.zip", sha256: digest },
    identity: {
      teamIdentifier: "A1B2C3D4E5",
      signingAuthority: "Developer ID Application: Verify Inc. (A1B2C3D4E5)",
      host: { identifier: "dev.verify.plugin-host", cdHash },
      helper: { identifier: "dev.verify.plugin-host.node", cdHash },
      supervisor: { identifier: "dev.verify.plugin-supervisor", cdHash },
      notarized: true,
      timestamped: true,
    },
  };
}

function windowsManifest() {
  const identity = {
    sha256: digest,
    signerThumbprint: thumbprint,
    subject: "CN=Verify Inc.",
    timestamped: true,
  };
  return {
    schemaVersion: 1,
    kind: "verify-native-host-release",
    platform: "windows",
    version: "1.2.3-rc.1",
    artifact: { file: "VerifyPluginHost-windows-1.2.3-rc.1.zip", sha256: digest },
    identity: { host: identity, node: { ...identity } },
  };
}

test("native host release manifests seal exact production identity pins", () => {
  assert.equal(validateNativeHostReleaseManifest(macManifest()).platform, "macos");
  assert.equal(validateNativeHostReleaseManifest(windowsManifest()).platform, "windows");
});

test("release manifests reject spoofed authorities, missing timestamps, and extra fields", () => {
  const spoofed = macManifest();
  spoofed.identity.signingAuthority = "Developer ID Application: Attacker (Z9Y8X7W6V5)";
  assert.throws(() => validateNativeHostReleaseManifest(spoofed));
  const untimestamped = windowsManifest();
  untimestamped.identity.host.timestamped = false;
  assert.throws(() => validateNativeHostReleaseManifest(untimestamped));
  const expanded = windowsManifest();
  expanded.identity.host.untrusted = true;
  assert.throws(() => validateNativeHostReleaseManifest(expanded));
});

test("artifact verification rejects traversal and byte substitution", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "verify-native-release-"));
  const manifest = macManifest();
  await writeFile(path.join(root, manifest.artifact.file), bytes);
  await verifyNativeHostReleaseManifest(manifest, root);
  const traversal = macManifest();
  traversal.artifact.file = "../outside.zip";
  await assert.rejects(verifyNativeHostReleaseManifest(traversal, root));
  await writeFile(path.join(root, manifest.artifact.file), "substituted");
  await assert.rejects(verifyNativeHostReleaseManifest(manifest, root));
});
