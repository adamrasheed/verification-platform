#!/usr/bin/env node
import process from "node:process";
import { resolve } from "node:path";
import { promoteCandidate } from "./lib.mjs";

if (process.argv.length !== 4) {
  console.error(
    "usage: node tooling/release/promote-tested-bytes.mjs <candidate.json> <destination.tgz>",
  );
  process.exit(2);
}
const result = await promoteCandidate(
  resolve(process.cwd(), process.argv[2]),
  resolve(process.cwd(), process.argv[3]),
);
console.log(`promoted tested bytes: ${result.digest}`);
