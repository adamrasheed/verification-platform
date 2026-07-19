#!/usr/bin/env node
import process from "node:process";
import { run } from "./lib.mjs";

const result = await run(
  process.execPath,
  ["--test", "tooling/release/test/release.test.mjs"],
  { cwd: process.cwd(), env: process.env },
);
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
process.exit(result.code ?? 1);
