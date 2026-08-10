#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const report = JSON.parse(await readFile(
  new URL("../../docs/compliance/release/AWS_CONTROL_API.json", import.meta.url),
  "utf8",
));

assert.equal(report.schemaVersion, 1);
assert.equal(report.kind, "awsControlApiEvidence");
assert.equal(report.evidenceDate, "2026-08-10");
assert.equal(report.taskId, "M9-T06");
assert.equal(report.outcome, "passed");
assert.deepEqual(report.accountBinding, {
  accountId: "661590454564",
  region: "us-west-2",
  environment: "development",
});
assert.equal(report.source.repository, "adamrasheed/verification-platform");
assert.equal(report.source.headSha, "4c086139d8fa2d65d9b31e2ed948dedec5f5a45d");
assert.equal(report.source.openTofuVersion, "1.12.5");
assert.equal(report.source.awsProviderVersion, "6.56.0");
assert.equal(report.source.nodeVersion, "22.19.0");
assert.equal(report.source.postgresVersion, "17.9");
assert.equal(report.workflow.runId, 31439141302);
assert.equal(report.workflow.jobId, 93619908939);
assert.equal(report.workflow.event, "workflow_dispatch");
assert.equal(report.workflow.protectedEnvironment, "development");
for (const field of [
  "conclusion",
  "immutablePlan",
  "apply",
  "imageBuildAndPush",
  "liveControlApiProbe",
  "cleanup",
  "postCleanupZeroDrift",
  "postCleanupFoundationAudit",
]) {
  assert.equal(report.workflow[field], field === "conclusion" ? "success" : "passed");
}
assert.match(report.workflow.url, /\/actions\/runs\/31439141302$/);
assert.match(report.workflow.jobUrl, /\/actions\/runs\/31439141302\/job\/93619908939$/);
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
});
assert.equal(report.controlApiProbe.schemaVersion, 1);
assert.equal(report.controlApiProbe.kind, "awsControlApiEvidence");
assert.equal(report.controlApiProbe.runId, report.source.headSha);
assert.equal(report.controlApiProbe.outcome, "passed");
const expectedChecks = [
  "privatePostgresTls",
  "realHttpBoundary",
  "signedIdentity",
  "exactAuthorization",
  "tenantIsolation",
  "intentIdempotency",
  "publicationIdempotency",
  "boundedReadAndList",
  "tokenExpiryAndRevocation",
  "sanitizedAudit",
];
assert.deepEqual(Object.keys(report.controlApiProbe.checks), expectedChecks);
for (const check of expectedChecks) assert.equal(report.controlApiProbe.checks[check], "passed");
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
  sensitiveCanaryRetained: false,
  identityTokensRetained: false,
  secretValuesRetained: false,
});

const expectedArtifacts = [
  ".github/workflows/aws-control-api-conformance.yml",
  "tooling/infra/run-live-control-api-conformance.mjs",
  "tooling/infra/control-api-node-http.mjs",
  "tooling/infra/aws/metadata-cloud/control-api-runner.tf",
  "tooling/infra/aws/metadata-cloud/data.tf",
  "tooling/infra/aws/metadata-cloud/control-api-runner.Dockerfile",
  "apps/control-api/src/public/postgres-control-store.ts",
  "apps/control-api/migrations/0001_control_api.sql",
  "docs/operations/AWS_CONTROL_API_CONFORMANCE.md",
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
for (const forbidden of ["SecretString", "PGPASSWORD", "never-audit-body", "authorization: Bearer"]) {
  assert.equal(serialized.includes(forbidden), false);
}
console.log("AWS control API Evidence valid: live probes passed, cleaned up, zero drift");
