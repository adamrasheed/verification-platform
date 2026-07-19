import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const packagesRoot = path.join(root, "packages");
const files = [];

for (const packageEntry of await readdir(packagesRoot, { withFileTypes: true })) {
  if (!packageEntry.isDirectory()) continue;
  const schemaRoot = path.join(packagesRoot, packageEntry.name, "schemas");
  let entries;
  try {
    entries = await readdir(schemaRoot, { withFileTypes: true });
  } catch {
    continue;
  }
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".json")) {
      files.push(path.join(schemaRoot, entry.name));
    }
  }
}

const ids = new Map();
const errors = [];
for (const file of files.sort()) {
  let schema;
  try {
    schema = JSON.parse(await readFile(file, "utf8"));
  } catch {
    errors.push(`${path.relative(root, file)}: invalid JSON`);
    continue;
  }
  if (schema.$schema !== "https://json-schema.org/draft/2020-12/schema") {
    errors.push(`${path.relative(root, file)}: must declare JSON Schema 2020-12`);
  }
  if (typeof schema.$id !== "string" || schema.$id.length === 0) {
    errors.push(`${path.relative(root, file)}: missing $id`);
  } else if (ids.has(schema.$id)) {
    errors.push(`${path.relative(root, file)}: duplicate $id also used by ${ids.get(schema.$id)}`);
  } else {
    ids.set(schema.$id, path.relative(root, file));
  }
}

if (files.length === 0) errors.push("no package schemas found");
if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`package schemas valid: ${files.length} unique schema documents`);
