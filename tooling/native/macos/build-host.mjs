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
const nodeBinary = path.resolve(option("--node", process.execPath));
const output = path.resolve(option(
  "--output",
  path.join(repositoryRoot, ".tmp/native-macos/VerifyPluginHost.app"),
));
const contents = path.join(output, "Contents");
const host = path.join(contents, "MacOS/VerifyPluginHost");
const helper = path.join(contents, "Helpers/node");
const supervisor = path.join(contents, "Helpers/VerifyPluginSupervisor");

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
execFileSync("codesign", [
  "--force",
  "--timestamp=none",
  "--options",
  "runtime",
  "--sign",
  identity,
  "--identifier",
  "dev.verify.plugin-supervisor",
  supervisor,
], { stdio: "inherit" });
execFileSync("codesign", [
  "--force",
  "--timestamp=none",
  "--options",
  "runtime",
  "--sign",
  identity,
  "--entitlements",
  path.join(scriptRoot, "verify-plugin-helper.entitlements"),
  "--identifier",
  "dev.verify.plugin-host.node",
  helper,
], { stdio: "inherit" });
execFileSync("codesign", [
  "--force",
  "--timestamp=none",
  "--options",
  "runtime",
  "--sign",
  identity,
  "--entitlements",
  path.join(scriptRoot, "verify-plugin-host.entitlements"),
  "--identifier",
  "dev.verify.plugin-host",
  output,
], { stdio: "inherit" });
execFileSync("codesign", [
  "--verify",
  "--deep",
  "--strict",
  "--verbose=2",
  output,
], { stdio: "inherit" });

console.log(output);
