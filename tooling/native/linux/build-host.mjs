#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));

function option(name) {
  const offset = process.argv.indexOf(name);
  if (offset < 0 || !process.argv[offset + 1]) {
    throw new TypeError(`missing ${name}`);
  }
  return process.argv[offset + 1];
}

const output = path.resolve(option("--output"));
const host = path.join(output, "VerifyPluginHost");
const seccomp = path.join(output, "VerifyPluginSeccomp.so");

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true, mode: 0o755 });

execFileSync("cc", [
  "-std=c17",
  "-O2",
  "-Wall",
  "-Wextra",
  "-Werror",
  "-D_GNU_SOURCE",
  "-o",
  host,
  path.join(scriptRoot, "VerifyPluginHost.c"),
  "-lcrypto",
], { stdio: "inherit" });

execFileSync("cc", [
  "-std=c17",
  "-O2",
  "-Wall",
  "-Wextra",
  "-Werror",
  "-D_GNU_SOURCE",
  "-shared",
  "-fPIC",
  "-o",
  seccomp,
  path.join(scriptRoot, "VerifyPluginSeccomp.c"),
], { stdio: "inherit" });
