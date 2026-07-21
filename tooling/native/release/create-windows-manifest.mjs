#!/usr/bin/env node

import { execFileSync } from "node:child_process";
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

if (process.platform !== "win32") throw new Error("Windows release inspection requires Windows");
const directory = path.resolve(option("--directory"));
const archive = path.resolve(option("--archive"));
const output = path.resolve(option("--output"));
const version = option("--version");
const expectedHost = option("--host-thumbprint").toUpperCase();
const expectedNode = option("--node-thumbprint").toUpperCase();

async function inspect(file, expectedThumbprint) {
  const script = [
    "$signature = Get-AuthenticodeSignature -LiteralPath $args[0]",
    "if ($signature.Status -ne 'Valid' -or $null -eq $signature.SignerCertificate -or $null -eq $signature.TimeStamperCertificate) { exit 3 }",
    "[pscustomobject]@{ thumbprint = $signature.SignerCertificate.Thumbprint; subject = $signature.SignerCertificate.Subject } | ConvertTo-Json -Compress",
  ].join("; ");
  const identity = JSON.parse(execFileSync("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    script,
    file,
  ], { encoding: "utf8", windowsHide: true }));
  const signerThumbprint = identity.thumbprint.toUpperCase();
  if (signerThumbprint !== expectedThumbprint) throw new Error(`unexpected signer for ${file}`);
  return {
    sha256: sha256(await readFile(file)),
    signerThumbprint,
    subject: identity.subject,
    timestamped: true,
  };
}

const manifest = {
  schemaVersion: 1,
  kind: "verify-native-host-release",
  platform: "windows",
  version,
  artifact: {
    file: path.basename(archive),
    sha256: sha256(await readFile(archive)),
  },
  identity: {
    host: await inspect(path.join(directory, "VerifyPluginHost.exe"), expectedHost),
    node: await inspect(path.join(directory, "node.exe"), expectedNode),
  },
};
validateNativeHostReleaseManifest(manifest);
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
