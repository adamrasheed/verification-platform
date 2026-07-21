#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { verifyNativeHostReleaseManifest } from "./lib.mjs";

const manifestPath = process.argv[2];
if (!manifestPath) {
  console.error("usage: node tooling/native/release/check-manifest.mjs <manifest.json> [artifact-root]");
  process.exit(2);
}
const resolved = path.resolve(manifestPath);
const artifactRoot = path.resolve(process.argv[3] ?? path.dirname(resolved));
const manifest = JSON.parse(await readFile(resolved, "utf8"));
await verifyNativeHostReleaseManifest(manifest, artifactRoot);
console.log(`native host release manifest valid: ${manifest.platform} ${manifest.version}`);
