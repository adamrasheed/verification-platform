import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const sourceRoot = path.join(root, "tooling/schema/sources");
const generatedRoot = path.join(root, "tooling/schema/generated");
const checkOnly = process.argv.includes("--check");

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, sortValue(value[key])]),
    );
  }
  return value;
}

const sources = (await readdir(sourceRoot)).filter((file) => file.endsWith(".schema.json")).sort();
const errors = [];
await mkdir(generatedRoot, { recursive: true });

for (const file of sources) {
  const sourcePath = path.join(sourceRoot, file);
  const targetPath = path.join(generatedRoot, file);
  const source = JSON.parse(await readFile(sourcePath, "utf8"));
  const relativeSource = path.relative(root, sourcePath);
  const generated = sortValue({
    $comment: `GENERATED from ${relativeSource}; do not edit`,
    ...source,
  });
  const output = `${JSON.stringify(generated, null, 2)}\n`;

  if (checkOnly) {
    let current = "";
    try {
      current = await readFile(targetPath, "utf8");
    } catch {}
    if (current !== output) errors.push(`${path.relative(root, targetPath)} is stale or hand-edited`);
  } else {
    await writeFile(targetPath, output, "utf8");
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`${checkOnly ? "verified" : "generated"} ${sources.length} schema artifact(s)`);
