#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const report = JSON.parse(await readFile(
  new URL("../../docs/compliance/release/AWS_CUSTOMER_WORKLOAD.json", import.meta.url),
  "utf8",
));

assert.equal(report.schemaVersion, 1);
assert.equal(report.kind, "awsCustomerWorkloadEvidence");
assert.equal(report.evidenceDate, "2026-08-10");
assert.equal(report.taskId, "M9-T07");
assert.equal(report.outcome, "passed");
assert.deepEqual(report.accountBinding, {
  accountId: "661590454564",
  region: "us-west-2",
  environment: "development",
});
assert.equal(report.source.repository, "adamrasheed/verification-platform");
assert.equal(report.source.headSha, "248b0b4f0dbe4c96878a5861e786bf3d9e94bee4");
assert.equal(report.source.openTofuVersion, "1.12.5");
assert.equal(report.source.awsProviderVersion, "6.56.0");
assert.equal(report.source.nodeVersion, "22.19.0");
assert.equal(report.source.postgresVersion, "17.9");
assert.equal(report.workflow.runId, 31454245521);
assert.equal(report.workflow.jobId, 93664681242);
assert.equal(report.workflow.event, "workflow_dispatch");
assert.equal(report.workflow.protectedEnvironment, "development");
for (const field of [
  "conclusion",
  "immutablePlan",
  "apply",
  "imageBuildAndPush",
  "liveCustomerWorkloadProbe",
  "cleanup",
  "postCleanupZeroDrift",
  "postCleanupFoundationAudit",
]) {
  assert.equal(report.workflow[field], field === "conclusion" ? "success" : "passed");
}
assert.match(report.workflow.url, /\/actions\/runs\/31454245521$/);
assert.match(report.workflow.jobUrl, /\/actions\/runs\/31454245521\/job\/93664681242$/);
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
assert.equal(report.customerWorkloadProbe.schemaVersion, 1);
assert.equal(report.customerWorkloadProbe.kind, "awsCustomerWorkloadEvidence");
assert.equal(report.customerWorkloadProbe.runId, report.source.headSha);
assert.equal(report.customerWorkloadProbe.outcome, "passed");
const expectedChecks = [
  "privatePostgresTls",
  "exactRepositoryBinding",
  "canonicalOfflineEngine",
  "durableFencedHeartbeat",
  "allowlistedPublication",
  "publicationReferenceOnlyCompletion",
  "forwardedTerminalCancellation",
  "tenantIsolation",
  "sourceEgressCanaryAbsent",
];
assert.deepEqual(Object.keys(report.customerWorkloadProbe.checks), expectedChecks);
for (const check of expectedChecks) assert.equal(report.customerWorkloadProbe.checks[check], "passed");
assert.deepEqual(report.postCleanupAudit, {
  ephemeralResourcesCreated: 16,
  ephemeralResourcesDestroyed: 16,
  persistentResourcesRestored: 1,
  ephemeralResourcesRemaining: 0,
  zeroDrift: true,
  foundationOutcome: "passed",
});
assert.deepEqual(report.dataHandling, {
  customerDataUsed: false,
  syntheticDataRemoved: true,
  sourceCanaryRetained: false,
  sourceCanaryLogged: false,
  identityTokensRetained: false,
  secretValuesRetained: false,
});

const expectedArtifacts = [
  ".github/workflows/aws-customer-workload-conformance.yml",
  "tooling/infra/run-live-customer-workload-conformance.mjs",
  "tooling/infra/aws/metadata-cloud/customer-workload-runner.tf",
  "tooling/infra/aws/metadata-cloud/customer-workload-runner.Dockerfile",
  "apps/github-action/src/public/customer-workload.ts",
  "packages/cloud-client/src/public/postgres-workload-dispatch-store.ts",
  "packages/cloud-client/migrations/0002_customer_workload_dispatch.sql",
  "apps/control-api/src/public/handler.ts",
  "docs/operations/AWS_CUSTOMER_WORKLOAD_CONFORMANCE.md",
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
for (const forbidden of ["SecretString", "PGPASSWORD", "SOURCE_CANARY_M9_WORKLOAD_", "authorization: Bearer"]) {
  assert.equal(serialized.includes(forbidden), false);
}
console.log("AWS customer workload Evidence valid: live probes passed, cleaned up, zero drift");
