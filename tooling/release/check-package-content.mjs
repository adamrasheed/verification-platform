import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const policy = JSON.parse(await readFile(path.join(root, "tooling/release/package-policy.json"), "utf8"));
const fixtures = JSON.parse(await readFile(path.join(root, "tooling/release/fixtures.json"), "utf8"));

function validate({ manifest, packedFiles }) {
  const errors = [];
  for (const script of policy.forbiddenLifecycleScripts) {
    if (manifest.scripts?.[script]) errors.push(`forbidden lifecycle script ${script}`);
  }
  for (const dependency of Object.keys(manifest.dependencies ?? {})) {
    if (policy.forbiddenProductionDependencyPrefixes.some(
      (prefix) => dependency === prefix || dependency.startsWith(prefix),
    )) {
      errors.push(`forbidden production dependency ${dependency}`);
    }
  }
  const allowed = policy.allowedPackedPathPrefixes;
  for (const file of packedFiles) {
    if (!allowed.some((prefix) => prefix.endsWith("/") ? file.startsWith(prefix) : file === prefix)) {
      errors.push(`undeclared packed file ${file}`);
    }
  }
  return errors;
}

const failures = [];
for (const fixture of fixtures) {
  const errors = validate(fixture);
  if ((errors.length === 0) !== fixture.expectValid) {
    failures.push(`${fixture.name}: expected valid=${fixture.expectValid}; ${errors.join(" | ")}`);
  }
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`package-content policy valid: ${fixtures.length} fixtures`);
