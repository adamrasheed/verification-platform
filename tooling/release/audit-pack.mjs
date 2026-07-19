#!/usr/bin/env node
import process from "node:process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  inspectNpmTarball,
  readJson,
  run,
  validatePackedArtifact,
} from "./lib.mjs";

if (process.argv.length !== 3) {
  console.error("usage: node tooling/release/audit-pack.mjs <package-directory>");
  process.exit(2);
}
const root = process.cwd();
const packageDirectory = resolve(root, process.argv[2]);
const temporary = await mkdtemp(join(tmpdir(), "verify-pack-audit-"));
try {
  const result = await run(
    "npm",
    [
      "pack",
      "--json",
      "--ignore-scripts",
      "--pack-destination",
      temporary,
    ],
    {
      cwd: packageDirectory,
      env: { ...process.env, npm_config_ignore_scripts: "true" },
    },
  );
  if (result.code !== 0) throw new Error(result.stderr.trim());
  const metadata = JSON.parse(result.stdout)[0];
  const entries = inspectNpmTarball(
    await readFile(join(temporary, metadata.filename)),
  );
  const policy = await readJson(
    join(root, "tooling/release/candidate-policy.json"),
  );
  const validation = validatePackedArtifact(entries, policy);
  const tarFiles = entries
    .filter(({ type }) => type === "0")
    .map(({ path }) => path)
    .sort();
  const reportedFiles = metadata.files
    .map(({ path }) => `package/${path}`)
    .sort();
  if (JSON.stringify(tarFiles) !== JSON.stringify(reportedFiles)) {
    validation.errors.push("npm report differs from inspected tar files");
  }
  if (validation.errors.length > 0) {
    console.error(validation.errors.join("\n"));
    process.exitCode = 1;
  } else {
    console.log(
      `npm pack valid: ${metadata.name}@${metadata.version} (${tarFiles.length} files)`,
    );
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
