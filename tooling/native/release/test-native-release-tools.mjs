#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import process from "node:process";

const result = spawnSync(process.execPath, [
  "--test",
  "tooling/native/release/test/manifest.test.mjs",
  "tooling/native/release/test/workflow.test.mjs",
], { cwd: process.cwd(), stdio: "inherit" });
process.exit(result.status ?? 1);
