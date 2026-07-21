#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { sha256, validateNativeHostReleaseManifest } from "./lib.mjs";

function option(name) {
  const offset = process.argv.indexOf(name);
  const value = offset < 0 ? undefined : process.argv[offset + 1];
  if (!value || value.startsWith("--")) throw new TypeError(`missing ${name}`);
  return value;
}

if (process.platform !== "darwin") throw new Error("macOS release inspection requires macOS");
const app = path.resolve(option("--app"));
const archive = path.resolve(option("--archive"));
const output = path.resolve(option("--output"));
const version = option("--version");
const teamIdentifier = option("--team-id");
const signingAuthority = option("--authority");
if (!/^[A-Z0-9]{10}$/.test(teamIdentifier)) throw new TypeError("invalid Apple Team ID");
if (
  !signingAuthority.startsWith("Developer ID Application:")
  || !signingAuthority.endsWith(` (${teamIdentifier})`)
) throw new TypeError("invalid Developer ID authority");

const requirement = [
  "=anchor apple generic",
  "certificate 1[field.1.2.840.113635.100.6.2.6] exists",
  "certificate leaf[field.1.2.840.113635.100.6.1.13] exists",
  `certificate leaf[subject.OU] = \"${teamIdentifier}\"`,
  `certificate leaf[subject.CN] = \"${signingAuthority.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}\"`,
].join(" and ");

function inspect(executable, identifier) {
  execFileSync("/usr/bin/codesign", [
    "--verify",
    "--strict",
    "--test-requirement",
    requirement,
    executable,
  ]);
  const inspected = spawnSync("/usr/bin/codesign", ["-dvvv", executable], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (inspected.status !== 0) throw new Error(`could not inspect ${identifier}`);
  const value = `${inspected.stdout}\n${inspected.stderr}`;
  const actualIdentifier = value.match(/^Identifier=(.+)$/m)?.[1];
  const actualTeam = value.match(/^TeamIdentifier=(.+)$/m)?.[1];
  const actualAuthority = value.match(/^Authority=(.+)$/m)?.[1];
  const cdHash = value.match(/^CDHash=([a-f0-9]+)$/m)?.[1];
  if (
    actualIdentifier !== identifier
    || actualTeam !== teamIdentifier
    || actualAuthority !== signingAuthority
    || !cdHash
    || !/^Timestamp=/m.test(value)
  ) throw new Error(`signed identity is invalid for ${identifier}`);
  return { identifier, cdHash };
}

execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", app]);
execFileSync("/usr/sbin/spctl", ["--assess", "--type", "execute", "--verbose=4", app]);
execFileSync("/usr/bin/xcrun", ["stapler", "validate", app]);
const manifest = {
  schemaVersion: 1,
  kind: "verify-native-host-release",
  platform: "macos",
  version,
  artifact: {
    file: path.basename(archive),
    sha256: sha256(await readFile(archive)),
  },
  identity: {
    teamIdentifier,
    signingAuthority,
    host: inspect(path.join(app, "Contents/MacOS/VerifyPluginHost"), "dev.verify.plugin-host"),
    helper: inspect(path.join(app, "Contents/Helpers/node"), "dev.verify.plugin-host.node"),
    supervisor: inspect(
      path.join(app, "Contents/Helpers/VerifyPluginSupervisor"),
      "dev.verify.plugin-supervisor",
    ),
    notarized: true,
    timestamped: true,
  },
};
validateNativeHostReleaseManifest(manifest);
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
