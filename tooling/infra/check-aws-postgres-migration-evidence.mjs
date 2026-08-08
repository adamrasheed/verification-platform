#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const report = JSON.parse(await readFile(
  new URL("../../docs/compliance/release/AWS_POSTGRES_MIGRATION.json", import.meta.url),
  "utf8",
));

assert.equal(report.schemaVersion, 1);
assert.equal(report.kind, "awsPostgresMigrationEvidence");
assert.equal(report.evidenceDate, "2026-08-08");
assert.equal(report.taskId, "M9-T04");
assert.equal(report.outcome, "passed");
assert.deepEqual(report.accountBinding, {
  accountId: "661590454564",
  region: "us-west-2",
  environment: "development",
});
assert.equal(report.source.repository, "adamrasheed/verification-platform");
assert.match(report.source.headSha, /^[0-9a-f]{40}$/);
assert.equal(report.workflow.runId, 31252812822);
assert.equal(report.workflow.jobId, 93091675182);
assert.equal(report.workflow.protectedEnvironment, "development");
for (const field of [
  "conclusion",
  "immutablePlan",
  "apply",
  "imageBuildAndPush",
  "liveMigrationAndProbe",
  "cleanup",
  "postCleanupZeroDrift",
]) {
  assert.equal(report.workflow[field], field === "conclusion" ? "success" : "passed");
}
assert.match(report.workflow.url, /\/actions\/runs\/31252812822$/);
assert.match(report.workflow.jobUrl, /\/actions\/runs\/31252812822\/job\/93091675182$/);
assert.equal(report.topology.publicIp, false);
assert.equal(report.topology.internetGateway, false);
assert.equal(report.topology.natGateway, false);
assert.equal(report.topology.taskRole, false);
assert.match(report.topology.databaseTransport, /verify-full TLS/);
assert.equal(report.migrationProbe.schemaVersion, 1);
assert.equal(report.migrationProbe.kind, "awsPostgresMigrationEvidence");
assert.equal(report.migrationProbe.migrationId, "0001_publication_store");
assert.equal(report.migrationProbe.serverVersion, "17.6");
assert.equal(report.migrationProbe.outcome, "passed");
const expectedChecks = [
  "migrationRecorded",
  "concurrentIdempotency",
  "tenantIsolation",
  "fencedOutbox",
  "atomicDeletion",
  "digestFreeTombstone",
  "restoreReplayGate",
  "activeRetention",
  "tombstoneRetention",
  "syntheticDataRemoved",
];
assert.deepEqual(
  Object.keys(report.migrationProbe.checks).sort(),
  [...expectedChecks].sort(),
);
for (const check of expectedChecks) assert.equal(report.migrationProbe.checks[check], "passed");
assert.equal(report.postCleanupAudit.foundationOutcome, "passed");
assert.equal(report.postCleanupAudit.ephemeralResourcesRemaining, 0);
assert.equal(report.postCleanupAudit.secretValuesRead, false);
assert.deepEqual(report.dataHandling, {
  customerDataUsed: false,
  syntheticDataRemoved: true,
  secretValuesRetained: false,
});

const expectedArtifacts = [
  ".github/workflows/aws-postgres-migration.yml",
  "tooling/infra/run-live-postgres-migration.mjs",
  "tooling/infra/aws/metadata-cloud/migration.tf",
  "tooling/infra/aws/metadata-cloud/migration.Dockerfile",
  "tooling/infra/aws/metadata-cloud/us-west-2-bundle.pem",
  "packages/cloud-client/migrations/0001_publication_store.sql",
];
assert.deepEqual(report.sourceArtifacts.map(({ path: artifactPath }) => artifactPath), expectedArtifacts);
for (const artifact of report.sourceArtifacts) {
  assert.match(artifact.digest, /^sha256:[0-9a-f]{64}$/);
  const resolved = path.resolve(root, artifact.path);
  assert.ok(resolved.startsWith(`${root}${path.sep}`));
  const actual = `sha256:${createHash("sha256").update(await readFile(resolved)).digest("hex")}`;
  assert.equal(actual, artifact.digest, `digest mismatch: ${artifact.path}`);
}

const serialized = JSON.stringify(report);
assert.equal(serialized.includes("SecretString"), false);
assert.equal(serialized.includes("database_endpoint"), false);
console.log("AWS PostgreSQL migration Evidence valid: live probes passed, cleaned up, zero drift");
