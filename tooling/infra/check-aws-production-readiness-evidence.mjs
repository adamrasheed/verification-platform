#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { PRODUCTION_READINESS_THRESHOLDS } from "./production-readiness-contract.mjs";

const root = process.cwd();
const report = JSON.parse(await readFile(
  new URL("../../docs/compliance/release/AWS_PRODUCTION_READINESS.json", import.meta.url),
  "utf8",
));

assert.equal(report.schemaVersion, 1);
assert.equal(report.kind, "awsProductionReadinessReleaseEvidence");
assert.equal(report.evidenceDate, "2026-08-11");
assert.equal(report.taskId, "M9-T08");
assert.equal(report.outcome, "passed");
assert.equal(report.claimScope, "protected development production-readiness drill");
assert.deepEqual(report.accountBinding, {
  accountId: "661590454564",
  region: "us-west-2",
  environment: "development",
});
assert.deepEqual(report.source, {
  repository: "adamrasheed/verification-platform",
  headSha: "50942841e9f8b487cacbb5ca4856635fbfa79305",
  openTofuVersion: "1.12.5",
  awsProviderVersion: "6.56.0",
  nodeVersion: "22.19.0",
  postgresVersion: "17.9",
});
assert.equal(report.workflow.runId, 31460493329);
assert.equal(report.workflow.jobId, 93682875376);
assert.equal(report.workflow.event, "workflow_dispatch");
assert.equal(report.workflow.protectedEnvironment, "development");
for (const field of [
  "conclusion",
  "immutablePlan",
  "apply",
  "imageBuildAndPush",
  "liveReadinessProbe",
  "cleanup",
  "postCleanupZeroDrift",
  "postCleanupFoundationAudit",
]) {
  assert.equal(report.workflow[field], field === "conclusion" ? "success" : "passed");
}
assert.equal(report.workflow.launchAttempts, 2);
assert.equal(report.workflow.transientImagePullFailures, 1);
assert.match(report.workflow.url, /\/actions\/runs\/31460493329$/);
assert.match(report.workflow.jobUrl, /\/actions\/runs\/31460493329\/job\/93682875376$/);
assert.deepEqual(report.topology, {
  runtime: "private AWS Fargate task",
  publicIp: false,
  internetGateway: false,
  natGateway: false,
  ephemeralInterfaceEndpoints: 4,
  endpointAvailabilityZones: 1,
  databaseTransport: "PostgreSQL verify-full TLS with the pinned official us-west-2 RDS CA bundle",
  taskRole: false,
  rootFilesystemReadOnly: true,
  writableScratchPath: "/work",
});
assert.deepEqual(report.thresholds, PRODUCTION_READINESS_THRESHOLDS);
assert.equal(report.readinessProbe.schemaVersion, 1);
assert.equal(report.readinessProbe.kind, "awsProductionReadinessEvidence");
assert.equal(report.readinessProbe.runId, report.source.headSha);
assert.equal(report.readinessProbe.outcome, "passed");
assert.deepEqual(report.readinessProbe.measurements, {
  requestCount: 500,
  successCount: 500,
  availability: 1,
  p95Ms: 490.488,
  postgresRpoMs: 5775,
  postgresRtoMs: 449,
  publicationObjectRpoMs: 5775,
  publicationObjectRtoMs: 449,
  connectionRecoveryMs: 39.554,
});
const expectedChecks = [
  "loadSample",
  "sampledAvailability",
  "controlApiP95",
  "acceptedDispatchDurability",
  "postgresRecovery",
  "publicationObjectRecovery",
  "connectionRecovery",
  "logicalBackupRestore",
  "tombstoneReplay",
  "costAbuse",
  "security",
  "supplyChain",
];
assert.deepEqual(Object.keys(report.readinessProbe.checks), expectedChecks);
for (const check of expectedChecks) assert.equal(report.readinessProbe.checks[check], "passed");
assert.deepEqual(report.postCleanupAudit, {
  ephemeralResourcesCreated: 13,
  ephemeralResourcesDestroyed: 13,
  persistentResourcesRestored: 1,
  ephemeralResourcesRemaining: 0,
  zeroDrift: true,
  foundationOutcome: "passed",
});
assert.deepEqual(report.dataHandling, {
  customerDataUsed: false,
  syntheticDataRemoved: true,
  logicalBackupRemoved: true,
  sourceCanaryRetained: false,
  sourceCanaryLogged: false,
  secretCanaryRetained: false,
  secretCanaryLogged: false,
  identityTokensRetained: false,
  idempotencyKeysLogged: false,
});
assert.deepEqual(report.releaseClaims, {
  developmentDrill: "passed",
  productionDeployment: "not_claimed",
  monthlyProductionAvailability: "not_claimed",
  productionMultiAzFailover: "not_claimed",
});

const expectedArtifacts = [
  ".github/workflows/aws-production-readiness.yml",
  "tooling/infra/run-live-production-readiness.mjs",
  "tooling/infra/production-readiness-contract.mjs",
  "tooling/infra/aws/metadata-cloud/readiness.tf",
  "tooling/infra/aws/metadata-cloud/readiness-runner.Dockerfile",
  "apps/control-api/src/public/handler.ts",
  "packages/cloud-client/src/public/postgres-publication-store.ts",
  "packages/cloud-client/src/public/postgres-workload-dispatch-store.ts",
  "docs/operations/AWS_PRODUCTION_READINESS.md",
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
for (const forbidden of [
  "SecretString",
  "PGPASSWORD",
  "SOURCE_CANARY_M9_READINESS_",
  "SECRET_CANARY_M9_READINESS_",
  "authorization: Bearer",
]) {
  assert.equal(serialized.includes(forbidden), false);
}
console.log("AWS production-readiness Evidence valid: protected development drill passed, cleaned up, zero drift");
