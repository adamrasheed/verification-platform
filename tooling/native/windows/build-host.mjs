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

if (process.platform !== "win32") {
  throw new Error("the Windows native host must be built on Windows");
}

const output = path.resolve(option("--output"));
const host = path.join(output, "VerifyPluginHost.exe");
const source = path.join(scriptRoot, "VerifyPluginHost.cpp");
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });

const compilerArguments = [
  "/nologo",
  "/std:c++17",
  "/O2",
  "/W4",
  "/WX",
  "/EHsc",
  `/Fe:${host}`,
  source,
  "bcrypt.lib",
  "userenv.lib",
  "advapi32.lib",
  "ole32.lib",
];

execFileSync("cl.exe", compilerArguments, { stdio: "inherit" });
