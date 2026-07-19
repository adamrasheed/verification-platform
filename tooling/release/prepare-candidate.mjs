#!/usr/bin/env node
import process from "node:process";
import { basename, join, relative, resolve, sep } from "node:path";
import {
  mkdir,
  readFile,
  stat,
} from "node:fs/promises";
import {
  buildProvenance,
  buildSbom,
  canonicalDocument,
  digestFile,
  inspectNpmTarball,
  packFileManifest,
  readJson,
  run,
  validatePackedArtifact,
  writeCanonical,
} from "./lib.mjs";

function usage() {
  console.error(
    "usage: node tooling/release/prepare-candidate.mjs --package <dir> --out <dir> --performance <json> --security <json> --source-revision <git-sha>",
  );
  process.exit(2);
}

const values = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  const value = process.argv[index + 1];
  if (!key?.startsWith("--") || value === undefined) usage();
  values.set(key.slice(2), value);
}
for (const required of [
  "package",
  "out",
  "performance",
  "security",
  "source-revision",
]) {
  if (!values.has(required)) usage();
}
if (!/^[a-f0-9]{40,64}$/.test(values.get("source-revision"))) {
  throw new Error("source-revision must be an exact 40-64 character hex digest");
}

const root = process.cwd();
const packageDirectory = resolve(root, values.get("package"));
const output = resolve(root, values.get("out"));
const packageRelative = relative(root, packageDirectory).split(sep).join("/");
if (packageRelative.startsWith("..") || packageRelative === "") {
  throw new Error("package directory must be a child of the workspace root");
}
if (output === root || output === packageDirectory) {
  throw new Error("output must be a dedicated directory");
}

const policy = await readJson(join(root, "tooling/release/candidate-policy.json"));
const performance = await readJson(resolve(root, values.get("performance")));
const security = await readJson(resolve(root, values.get("security")));
for (const [name, report] of [["performance", performance], ["security", security]]) {
  if (report.schemaVersion !== 1 || report.kind !== name || report.status !== "passed") {
    throw new Error(`${name} report is not a passed schemaVersion 1 report`);
  }
}
const allTrue = (record) =>
  record !== null &&
  typeof record === "object" &&
  Object.keys(record).length > 0 &&
  Object.values(record).every((value) => value === true);
if (
  !allTrue(performance.requirements) ||
  policy.requiredPerformanceClaims.some(
    (claim) => performance.requirements?.[claim] !== true,
  ) ||
  !/^sha256:[a-f0-9]{64}$/.test(
    performance.artifact?.measurementSha256 ?? "",
  ) ||
  !Number.isFinite(performance.measurements?.warmDiscovery100k?.p95Ms) ||
  !Number.isFinite(performance.measurements?.warmDiscovery100k?.budgetMs) ||
  performance.measurements.warmDiscovery100k.p95Ms >
    performance.measurements.warmDiscovery100k.budgetMs
) {
  throw new Error("performance report does not prove every required budget");
}
if (
  !allTrue(security.claims) ||
  policy.requiredSecurityClaims.some(
    (claim) => security.claims?.[claim] !== true,
  ) ||
  !Array.isArray(security.gates) ||
  security.gates.length === 0 ||
  !security.gates.every((gate) =>
    gate.status === "passed" &&
    /^sha256:[a-f0-9]{64}$/.test(gate.stdoutSha256)
  ) ||
  policy.requiredSecurityGates.some(
    (id) => !security.gates.some((gate) => gate.id === id),
  )
) {
  throw new Error("security report does not prove every required gate");
}

try {
  await stat(output);
  throw new Error("output directory already exists; refusing to replace it");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const artifactDirectory = join(output, "artifact");
await mkdir(artifactDirectory, { recursive: true });
const packed = await run(
  "npm",
  ["pack", "--json", "--ignore-scripts", "--pack-destination", artifactDirectory],
  { cwd: packageDirectory, env: { ...process.env, npm_config_ignore_scripts: "true" } },
);
if (packed.code !== 0) {
  throw new Error(`npm pack failed: ${packed.stderr.trim()}`);
}
const packResult = JSON.parse(packed.stdout)[0];
const artifactPath = join(artifactDirectory, packResult.filename);
const artifactBytes = await readFile(artifactPath);
const entries = inspectNpmTarball(artifactBytes);
const validation = validatePackedArtifact(entries, policy);
const tarFiles = entries
  .filter(({ type }) => type === "0")
  .map(({ path }) => path)
  .sort();
const npmFiles = packResult.files
  .map(({ path }) => `package/${path}`)
  .sort();
if (canonicalDocument(tarFiles) !== canonicalDocument(npmFiles)) {
  validation.errors.push("npm pack report and inspected tar entries differ");
}
if (validation.errors.length > 0) {
  throw new Error(validation.errors.join("\n"));
}

const packManifestPath = join(output, "pack-manifest.json");
await writeCanonical(packManifestPath, packFileManifest(entries));
const sbom = await buildSbom(root, packageDirectory, validation.manifest);
const sbomPath = join(output, "sbom.cdx.json");
await writeCanonical(sbomPath, sbom);
const sbomFile = await digestFile(sbomPath);
const npmVersionResult = await run("npm", ["--version"], {
  cwd: root,
  env: process.env,
});
if (npmVersionResult.code !== 0) throw new Error("could not determine npm version");
const artifact = await digestFile(artifactPath);
const provenance = buildProvenance({
  artifactName: basename(artifactPath),
  artifactDigest: artifact.digest,
  artifactSize: artifact.size,
  packageDirectory: packageRelative,
  packageName: validation.manifest.name,
  packageVersion: validation.manifest.version,
  sourceRevision: values.get("source-revision"),
  sbomDigest: sbomFile.digest,
  nodeVersion: process.version,
  npmVersion: npmVersionResult.stdout.trim(),
});
const provenancePath = join(output, "provenance.intoto.json");
await writeCanonical(provenancePath, provenance);

const reportDirectory = join(output, "reports");
await mkdir(reportDirectory, { recursive: true });
const performancePath = join(reportDirectory, "performance.json");
const securityPath = join(reportDirectory, "security.json");
await writeCanonical(performancePath, performance);
await writeCanonical(securityPath, security);

const relativeReference = async (path) => {
  const value = await digestFile(path);
  return {
    path: relative(output, path).split(sep).join("/"),
    sha256: value.digest,
    size: value.size,
  };
};
const candidate = {
  schemaVersion: 1,
  kind: "npmReleaseCandidate",
  status: "pending_test_attestation",
  source: {
    packageDirectory: packageRelative,
    packageName: validation.manifest.name,
    packageVersion: validation.manifest.version,
    sourceRevision: values.get("source-revision"),
    nodeVersion: process.version,
    npmVersion: npmVersionResult.stdout.trim(),
  },
  artifact: await relativeReference(artifactPath),
  packManifest: await relativeReference(packManifestPath),
  sbom: await relativeReference(sbomPath),
  provenance: await relativeReference(provenancePath),
  performanceReport: await relativeReference(performancePath),
  securityReport: await relativeReference(securityPath),
  testAttestation: null,
};
const candidatePath = join(output, "release-candidate.json");
await writeCanonical(candidatePath, candidate);
console.log(candidatePath);
