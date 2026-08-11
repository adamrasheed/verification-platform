import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { sha256Bytes } from "./lib.mjs";

const root = process.cwd();
const reportPath = path.resolve(
  root,
  process.argv[2] ?? "docs/compliance/release/METADATA_CLOUD_FOUNDATION.json",
);
const report = JSON.parse(await readFile(reportPath, "utf8"));
const errors = [];

const exactKeys = (value, keys, label) => {
  if (Object.keys(value).sort().join(",") !== [...keys].sort().join(",")) {
    errors.push(`${label}: fields are not exact`);
  }
};

exactKeys(report, [
  "schemaVersion", "kind", "evidenceDate", "releaseClass", "releaseStatus",
  "verification", "releaseBlockers", "commands", "artifacts",
], "report");
if (report.schemaVersion !== 2
  || report.kind !== "metadataCloudReleaseEvidence"
  || report.releaseClass !== "contractFoundation"
  || report.releaseStatus !== "not_releasable") {
  errors.push("report: foundation identity or release status is invalid");
}
exactKeys(report.verification ?? {}, [
  "contractConformance", "security", "supplyChain", "serviceSlo",
  "disasterRecovery", "providerDeployment",
], "verification");
for (const field of ["contractConformance", "security", "supplyChain"]) {
  if (report.verification?.[field] !== "passed") errors.push(`verification: ${field} must pass`);
}
for (const field of ["serviceSlo", "providerDeployment"]) {
  if (report.verification?.[field] !== "blocked") errors.push(`verification: ${field} must remain blocked`);
}
if (report.verification?.disasterRecovery !== "passed") {
  errors.push("verification: disasterRecovery must pass the protected development restore and replay drill");
}
const expectedBlockers = [
  ["providerDeployment", "M9-T08"],
  ["serviceSlo", "M9-T08"],
];
if (!Array.isArray(report.releaseBlockers)
  || report.releaseBlockers.length !== expectedBlockers.length
  || report.releaseBlockers.some((entry, index) => {
    exactKeys(entry, ["claim", "gate", "reason"], `releaseBlocker ${index}`);
    return entry.claim !== expectedBlockers[index][0]
      || entry.gate !== expectedBlockers[index][1]
      || !entry.reason;
  })) {
  errors.push("releaseBlockers: exact deployed M9 Evidence gates are required");
}
if (JSON.stringify(report).includes("D-002")) {
  errors.push("report: resolved D-002 cannot remain a release blocker");
}
const expectedCommands = [
  "npm test",
  "npm run check:conformance",
  "npm run check:schemas",
  "npm run check:package-content",
  "npm run check:aws-production-readiness-evidence",
];
if (!Array.isArray(report.commands)
  || report.commands.length !== expectedCommands.length
  || report.commands.some((entry) => {
    exactKeys(entry, ["command", "outcome"], "command");
    return entry.outcome !== "passed";
  })
  || expectedCommands.some((expected, index) => report.commands[index]?.command !== expected)) {
  errors.push("commands: exact passed foundation commands are required");
}
const expectedArtifacts = [
  "tooling/conformance/evidence/m8-cloud-foundation.json",
  "tooling/conformance/evidence/m8-durable-mapping-auth.json",
  "tooling/conformance/evidence/m8-publication-ingestion.json",
  "tooling/conformance/evidence/m8-projection-outbox.json",
  "tooling/conformance/evidence/m8-retention-bounded-reads.json",
  "tooling/conformance/evidence/m8-isolation-canary-foundation.json",
  "docs/compliance/release/SECURITY_REPORT.json",
  "docs/compliance/release/AWS_DEVELOPMENT_FOUNDATION.json",
  "docs/compliance/release/AWS_POSTGRES_MIGRATION.json",
  "docs/compliance/release/AWS_SQS_WORKER.json",
  "docs/compliance/release/AWS_CONTROL_API.json",
  "docs/compliance/release/AWS_CUSTOMER_WORKLOAD.json",
  "docs/compliance/release/AWS_PRODUCTION_READINESS.json",
  "package-lock.json",
  "tooling/release/package-policy.json",
];
if (!Array.isArray(report.artifacts)
  || report.artifacts.length !== expectedArtifacts.length
  || new Set(report.artifacts.map((entry) => entry.path)).size !== expectedArtifacts.length
  || expectedArtifacts.some((expected) => !report.artifacts.some((entry) => entry.path === expected))) {
  errors.push("artifacts: exact foundation inventory is required");
} else {
  for (const artifact of report.artifacts) {
    exactKeys(artifact, ["path", "digest"], `artifact ${artifact.path ?? "unknown"}`);
    const resolved = path.resolve(root, artifact.path);
    if (!resolved.startsWith(`${root}${path.sep}`)) {
      errors.push(`artifacts: path escapes workspace: ${artifact.path}`);
      continue;
    }
    const actual = sha256Bytes(await readFile(resolved));
    if (actual !== artifact.digest) errors.push(`artifacts: digest mismatch: ${artifact.path}`);
  }
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log("metadata-cloud foundation Evidence valid: not releasable pending deployed M9 Evidence");
