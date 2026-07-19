import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const evidenceRoot = path.join(root, "tooling/conformance/evidence");
const files = (await readdir(evidenceRoot)).filter((file) => file.endsWith(".json")).sort();
const required = [
  "schemaVersion",
  "evidenceId",
  "taskId",
  "owner",
  "governingClauses",
  "testIds",
  "command",
  "outcome",
  "artifacts",
];
const errors = [];

for (const file of files) {
  const value = JSON.parse(await readFile(path.join(evidenceRoot, file), "utf8"));
  for (const field of required) {
    if (!(field in value)) errors.push(`${file}: missing ${field}`);
  }
  if (value.schemaVersion !== 1) errors.push(`${file}: schemaVersion must be 1`);
  if (!value.owner || !value.taskId || !value.command) errors.push(`${file}: empty ownership metadata`);
  if (!value.governingClauses?.length || !value.testIds?.length) {
    errors.push(`${file}: governingClauses and testIds must be non-empty`);
  }
  if (!["passed", "failed", "indeterminate"].includes(value.outcome)) {
    errors.push(`${file}: invalid outcome ${value.outcome}`);
  }
  for (const artifact of value.artifacts ?? []) {
    if (!artifact.path || !/^sha256:[a-f0-9]{64}$/.test(artifact.digest ?? "")) {
      errors.push(`${file}: artifact path and sha256 digest are required`);
      continue;
    }
    const artifactPath = path.resolve(root, artifact.path);
    if (!artifactPath.startsWith(`${root}${path.sep}`)) {
      errors.push(`${file}: artifact escapes workspace: ${artifact.path}`);
      continue;
    }
    try {
      const bytes = await readFile(artifactPath);
      const actual = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
      if (actual !== artifact.digest) {
        errors.push(`${file}: artifact digest mismatch for ${artifact.path}`);
      }
    } catch {
      errors.push(`${file}: artifact is unavailable: ${artifact.path}`);
    }
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`conformance Evidence valid: ${files.length} record(s)`);
