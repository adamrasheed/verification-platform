import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const registry = JSON.parse(
  await readFile(path.join(root, "tooling/architecture/workspaces.json"), "utf8"),
);

function validateGraph(graph) {
  const errors = [];
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));

  for (const node of graph.nodes) {
    for (const dependency of node.dependencies ?? []) {
      const target = byId.get(dependency);
      if (!target) {
        errors.push(`${node.id}: unknown dependency ${dependency}`);
        continue;
      }
      if (!(node.allowedDependencies ?? []).includes(dependency)) {
        errors.push(`${node.id}: dependency ${dependency} is not allowed`);
      }
      if (node.kind === "package" && target.kind === "application") {
        errors.push(`${node.id}: package-to-application dependency is forbidden`);
      }
    }
    for (const specifier of node.sourceImports ?? []) {
      const match = specifier.match(/^@verify-internal\/([^/]+)\/(.+)$/);
      if (match) errors.push(`${node.id}: deep internal import is forbidden: ${specifier}`);
    }
    for (const dependency of node.externalDependencies ?? []) {
      if (registry.prohibitedProductionDependencies.some(
        (prefix) => dependency === prefix || dependency.startsWith(prefix),
      )) {
        errors.push(`${node.id}: prohibited production dependency ${dependency}`);
      }
    }
  }

  const visiting = new Set();
  const visited = new Set();
  function visit(id, trail) {
    if (visiting.has(id)) {
      errors.push(`dependency cycle: ${[...trail, id].join(" -> ")}`);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    const node = byId.get(id);
    for (const dependency of node?.dependencies ?? []) visit(dependency, [...trail, id]);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of byId.keys()) visit(id, []);

  return errors;
}

async function loadActiveGraph() {
  const nodes = [];
  for (const entry of registry.entries) {
    const manifestPath = path.join(root, entry.path, "package.json");
    try {
      await stat(manifestPath);
    } catch {
      continue;
    }
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const internalPrefix = registry.packageNamePrefix;
    const dependencies = Object.keys(manifest.dependencies ?? {})
      .filter((name) => name.startsWith(internalPrefix))
      .map((name) => name.slice(internalPrefix.length));
    const externalDependencies = Object.keys(manifest.dependencies ?? {})
      .filter((name) => !name.startsWith(internalPrefix));
    const sourceImports = [];
    const sourceRoot = path.join(root, entry.path, "src");
    async function scan(directory) {
      let children;
      try {
        children = await readdir(directory, { withFileTypes: true });
      } catch {
        return;
      }
      for (const child of children) {
        const target = path.join(directory, child.name);
        if (child.isDirectory()) await scan(target);
        else if (/\.[cm]?[jt]sx?$/.test(child.name)) {
          const text = await readFile(target, "utf8");
          for (const match of text.matchAll(/(?:from\s+|import\s*\()\s*["']([^"']+)["']/g)) {
            sourceImports.push(match[1]);
          }
        }
      }
    }
    await scan(sourceRoot);
    nodes.push({
      id: entry.id,
      kind: entry.kind,
      allowedDependencies: entry.allowedDependencies,
      dependencies,
      externalDependencies,
      sourceImports,
    });
  }
  return { nodes };
}

const activeErrors = validateGraph(await loadActiveGraph());
const fixtureRoot = path.join(root, "tooling/architecture/fixtures");
const fixtureFiles = (await readdir(fixtureRoot)).filter((name) => name.endsWith(".json")).sort();
const fixtureErrors = [];

for (const file of fixtureFiles) {
  const fixture = JSON.parse(await readFile(path.join(fixtureRoot, file), "utf8"));
  const errors = validateGraph(fixture.graph);
  const didPass = errors.length === 0;
  if (didPass !== fixture.expectValid) {
    fixtureErrors.push(`${file}: expected valid=${fixture.expectValid}, errors=${errors.join(" | ")}`);
  }
}

const errors = [...activeErrors, ...fixtureErrors];
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(`architecture boundaries valid: active graph + ${fixtureFiles.length} fixtures`);
