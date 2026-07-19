#!/usr/bin/env node
import process from "node:process";
import { dirname, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import {
  buildProvenance,
  buildSbom,
  canonicalDocument,
  inspectNpmTarball,
  packFileManifest,
  readJson,
  validateCandidate,
  validatePackedArtifact,
} from "./lib.mjs";

if (process.argv.length !== 3) {
  console.error("usage: node tooling/release/check-candidate.mjs <candidate.json>");
  process.exit(2);
}
const candidatePath = resolve(process.cwd(), process.argv[2]);
const { candidate, failures } = await validateCandidate(candidatePath);
const policy = await readJson(
  resolve(process.cwd(), "tooling/release/candidate-policy.json"),
);
const performance = candidate.performanceReport?.path === undefined
  ? undefined
  : await readJson(
      resolve(dirname(candidatePath), candidate.performanceReport.path),
    );
const security = candidate.securityReport?.path === undefined
  ? undefined
  : await readJson(resolve(dirname(candidatePath), candidate.securityReport.path));
const allTrue = (record) =>
  record !== null &&
  typeof record === "object" &&
  Object.keys(record).length > 0 &&
  Object.values(record).every((value) => value === true);
if (
  performance?.status !== "passed" ||
  performance.kind !== "performance" ||
  !allTrue(performance.requirements) ||
  policy.requiredPerformanceClaims.some(
    (claim) => performance.requirements?.[claim] !== true,
  ) ||
  !/^sha256:[a-f0-9]{64}$/.test(
    performance.artifact?.measurementSha256 ?? "",
  ) ||
  !Number.isFinite(performance.measurements?.warmDiscovery100k?.p95Ms) ||
  !Number.isFinite(performance.measurements?.warmDiscovery100k?.budgetMs) ||
  performance.measurements?.warmDiscovery100k?.p95Ms >
    performance.measurements?.warmDiscovery100k?.budgetMs
) {
  failures.push("bound performance report is not a complete pass");
}
if (
  security?.status !== "passed" ||
  security.kind !== "security" ||
  !allTrue(security.claims) ||
  policy.requiredSecurityClaims.some(
    (claim) => security.claims?.[claim] !== true,
  ) ||
  !Array.isArray(security.gates) ||
  security.gates.length === 0 ||
  !security.gates?.every((gate) =>
    gate.status === "passed" &&
    /^sha256:[a-f0-9]{64}$/.test(gate.stdoutSha256)
  ) ||
  policy.requiredSecurityGates.some(
    (id) => !security.gates?.some((gate) => gate.id === id),
  )
) {
  failures.push("bound security report is not a complete pass");
}
if (candidate.testAttestation?.path !== undefined) {
  const attestation = await readJson(
    resolve(dirname(candidatePath), candidate.testAttestation.path),
  );
  if (
    JSON.stringify(attestation.command) !==
    JSON.stringify(policy.requiredTestCommand)
  ) {
    failures.push("tested-byte attestation used an unauthorized command");
  }
}
if (candidate.artifact?.path !== undefined) {
  const artifactPath = resolve(dirname(candidatePath), candidate.artifact.path);
  let entries;
  try {
    entries = inspectNpmTarball(await readFile(artifactPath));
  } catch (error) {
    failures.push(`artifact is not a valid npm tarball: ${error.message}`);
  }
  if (entries !== undefined) {
  const validation = validatePackedArtifact(
    entries,
    policy,
  );
  failures.push(...validation.errors);
  if (validation.manifest !== undefined) {
    const expectedPackManifest = canonicalDocument(packFileManifest(entries));
    const actualPackManifest = await readFile(
      resolve(dirname(candidatePath), candidate.packManifest.path),
      "utf8",
    );
    if (actualPackManifest !== expectedPackManifest) {
      failures.push("pack manifest is not the deterministic artifact projection");
    }
    const packageDirectory = resolve(
      process.cwd(),
      candidate.source.packageDirectory,
    );
    const sbom = await buildSbom(
      process.cwd(),
      packageDirectory,
      validation.manifest,
    );
    const actualSbom = await readFile(
      resolve(dirname(candidatePath), candidate.sbom.path),
      "utf8",
    );
    if (actualSbom !== canonicalDocument(sbom)) {
      failures.push("SBOM differs from deterministic regeneration");
    }
    const provenance = buildProvenance({
      artifactName: candidate.artifact.path.split("/").at(-1),
      artifactDigest: candidate.artifact.sha256,
      artifactSize: candidate.artifact.size,
      packageDirectory: candidate.source.packageDirectory,
      packageName: candidate.source.packageName,
      packageVersion: candidate.source.packageVersion,
      sourceRevision: candidate.source.sourceRevision,
      sbomDigest: candidate.sbom.sha256,
      nodeVersion: candidate.source.nodeVersion,
      npmVersion: candidate.source.npmVersion,
    });
    const actualProvenance = await readFile(
      resolve(dirname(candidatePath), candidate.provenance.path),
      "utf8",
    );
    if (actualProvenance !== canonicalDocument(provenance)) {
      failures.push("provenance differs from deterministic regeneration");
    }
  }
  }
}
if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`release candidate valid: ${candidate.artifact.sha256}`);
