import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptRoot, "../../..");

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

if (process.platform !== "darwin") {
  throw new Error("the macOS App Sandbox host can only be built on macOS");
}

const identity = option("--identity", "-");
const keychain = option("--keychain", undefined);
const release = process.argv.includes("--release");
const nodeBinary = path.resolve(option("--node", process.execPath));
const output = path.resolve(option(
  "--output",
  path.join(repositoryRoot, ".tmp/native-macos/VerifyPluginHost.app"),
));
const contents = path.join(output, "Contents");
const host = path.join(contents, "MacOS/VerifyPluginHost");
const helper = path.join(contents, "Helpers/node");
const supervisor = path.join(contents, "Helpers/VerifyPluginSupervisor");

if (release && identity === "-") {
  throw new Error("release builds require a non-ad-hoc signing identity");
}

function sign(target, identifier, entitlements) {
  const arguments_ = [
    "--force",
    release ? "--timestamp" : "--timestamp=none",
    "--options",
    "runtime",
    "--sign",
    identity,
  ];
  if (keychain) arguments_.push("--keychain", path.resolve(keychain));
  if (entitlements) arguments_.push("--entitlements", entitlements);
  arguments_.push("--identifier", identifier, target);
  execFileSync("codesign", arguments_, { stdio: "inherit" });
}

rmSync(output, { recursive: true, force: true });
mkdirSync(path.dirname(host), { recursive: true, mode: 0o755 });
mkdirSync(path.dirname(helper), { recursive: true, mode: 0o755 });
cpSync(path.join(scriptRoot, "Info.plist"), path.join(contents, "Info.plist"));
cpSync(nodeBinary, helper);

execFileSync("swiftc", [
  "-O",
  "-o",
  host,
  path.join(scriptRoot, "VerifyPluginHost.swift"),
], { stdio: "inherit" });
execFileSync("swiftc", [
  "-O",
  "-o",
  supervisor,
  path.join(scriptRoot, "VerifyPluginSupervisor.swift"),
], { stdio: "inherit" });
sign(supervisor, "dev.verify.plugin-supervisor");
sign(
  helper,
  "dev.verify.plugin-host.node",
  path.join(scriptRoot, "verify-plugin-helper.entitlements"),
);
sign(
  output,
  "dev.verify.plugin-host",
  path.join(scriptRoot, "verify-plugin-host.entitlements"),
);
execFileSync("codesign", [
  "--verify",
  "--deep",
  "--strict",
  "--verbose=2",
  output,
], { stdio: "inherit" });

console.log(output);
