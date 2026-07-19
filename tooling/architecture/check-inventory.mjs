import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const registryPath = path.join(root, "tooling/architecture/workspaces.json");
const registry = JSON.parse(await readFile(registryPath, "utf8"));
const errors = [];
const ids = new Set();
const paths = new Set();

if (registry.schemaVersion !== 1) {
  errors.push("workspace registry schemaVersion must be 1");
}

for (const entry of registry.entries ?? []) {
  if (!entry.id || ids.has(entry.id)) errors.push(`duplicate or missing id: ${entry.id}`);
  if (!entry.path || paths.has(entry.path)) errors.push(`duplicate or missing path: ${entry.path}`);
  ids.add(entry.id);
  paths.add(entry.path);

  if (!["package", "application"].includes(entry.kind)) {
    errors.push(`${entry.id}: invalid kind ${entry.kind}`);
  }
  if (!["planned", "active", "deprecated"].includes(entry.state)) {
    errors.push(`${entry.id}: invalid state ${entry.state}`);
  }
  if (!entry.owner || !entry.milestone) errors.push(`${entry.id}: owner and milestone are required`);
  if (!entry.governingClauses?.length) errors.push(`${entry.id}: governingClauses are required`);

  let packageJsonExists = false;
  try {
    await stat(path.join(root, entry.path, "package.json"));
    packageJsonExists = true;
  } catch {}

  if (entry.state === "active" && !packageJsonExists) {
    errors.push(`${entry.id}: active workspace has no package.json`);
  }
  if (entry.state === "planned" && packageJsonExists) {
    errors.push(`${entry.id}: planned workspace is enabled by package.json`);
  }
}

for (const entry of registry.entries ?? []) {
  for (const dependency of entry.allowedDependencies ?? []) {
    if (!ids.has(dependency)) errors.push(`${entry.id}: unknown allowed dependency ${dependency}`);
    const target = registry.entries.find((candidate) => candidate.id === dependency);
    if (entry.kind === "package" && target?.kind === "application") {
      errors.push(`${entry.id}: package cannot depend on application ${dependency}`);
    }
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(`workspace inventory valid: ${registry.entries.length} MVP entries, 0 future workspaces enabled`);
