import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const sourceRoots = ["packages", "apps"];
const forbiddenImports = [
  "node:http",
  "node:https",
  "node:http2",
  "node:net",
  "node:tls",
  "node:dgram",
  "node:dns",
  "node:child_process",
  "undici",
  "node-fetch",
  "axios",
  "got",
];
const forbiddenExecution = [
  /\beval\s*\(/,
  /\bnew\s+Function\s*\(/,
  /\bexecFile\s*\(/,
  /\bspawn\s*\(/,
  /\bfork\s*\(/,
];
const allowedNetworkImports = new Map([
  ["apps/github-action/src/public/check-client.ts", new Set(["node:https"])],
]);
const failures = [];

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (["dist", "lib", "node_modules", "test", "fixtures"].includes(entry.name)) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (
        path.resolve(target) === path.resolve(root, "packages/plugin-runtime")
      ) continue;
      await walk(target);
      continue;
    }
    if (!entry.isFile() || !/\.[cm]?[jt]s$/.test(entry.name)) continue;
    const text = await readFile(target, "utf8");
    const relative = path.relative(root, target);
    for (const specifier of forbiddenImports) {
      const quoted = [`"${specifier}"`, `'${specifier}'`];
      if (
        quoted.some((value) => text.includes(value))
        && !allowedNetworkImports.get(relative)?.has(specifier)
      ) {
        failures.push(`${relative}: forbidden MVP import ${specifier}`);
      }
    }
    for (const expression of forbiddenExecution) {
      if (expression.test(text)) {
        failures.push(`${path.relative(root, target)}: repository execution primitive ${expression}`);
      }
    }
  }
}

for (const sourceRoot of sourceRoots) await walk(path.join(root, sourceRoot));
if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(
  "offline/passive verification source gate passed: only the audited GitHub check publisher has network authority",
);
