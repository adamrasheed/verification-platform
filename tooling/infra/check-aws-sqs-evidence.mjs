#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const report = JSON.parse(await readFile(
  new URL("../../docs/compliance/release/AWS_SQS_WORKER.json", import.meta.url),
  "utf8",
));

assert.equal(report.schemaVersion, 1);
assert.equal(report.kind, "awsSqsWorkerEvidence");
assert.equal(report.evidenceDate, "2026-08-08");
assert.equal(report.taskId, "M9-T05");
assert.equal(report.outcome, "passed");
assert.deepEqual(report.accountBinding, {
  accountId: "661590454564",
  region: "us-west-2",
  environment: "development",
});
assert.equal(report.source.repository, "adamrasheed/verification-platform");
assert.equal(report.source.headSha, "7f023c871e0ee07959de23e38f73a00df8756659");
assert.equal(report.source.openTofuVersion, "1.12.5");
assert.equal(report.source.awsProviderVersion, "6.56.0");
assert.equal(report.source.awsSdkSqsVersion, "3.1106.0");
assert.equal(report.workflow.runId, 31255571094);
assert.equal(report.workflow.jobId, 93098315154);
assert.equal(report.workflow.event, "workflow_dispatch");
assert.equal(report.workflow.protectedEnvironment, "development");
for (const field of [
  "conclusion",
  "immutablePlan",
  "apply",
  "imageBuildAndPush",
  "liveRelayAndWorkerProbe",
  "cleanup",
  "postCleanupZeroDrift",
]) {
  assert.equal(report.workflow[field], field === "conclusion" ? "success" : "passed");
}
assert.match(report.workflow.url, /\/actions\/runs\/31255571094$/);
assert.match(report.workflow.jobUrl, /\/actions\/runs\/31255571094\/job\/93098315154$/);
assert.equal(report.topology.runtime, "private AWS Fargate task");
assert.equal(report.topology.queueType, "Amazon SQS standard");
assert.equal(report.topology.publicIp, false);
assert.equal(report.topology.internetGateway, false);
assert.equal(report.topology.natGateway, false);
assert.equal(report.topology.ephemeralInterfaceEndpoints, 5);
assert.equal(report.topology.endpointAvailabilityZones, 1);
assert.equal(report.queueProbe.schemaVersion, 1);
assert.equal(report.queueProbe.kind, "awsSqsWorkerEvidence");
assert.equal(report.queueProbe.outcome, "passed");
assert.equal(report.queueProbe.queueType, "standard");
assert.equal(report.queueProbe.maxReceiveCount, 5);
const expectedChecks = {
  exactQueueTransport: "passed",
  fencedOutboxRelay: "passed",
  duplicateSideEffectCount: 1,
  boundedVisibilityRetry: "passed",
  sourceBoundDeadLetterRedrive: "passed",
  digestFreeDeadLetter: "passed",
  digestFreeDeletion: "passed",
  secondarySinkInventoryCount: 10,
  boundedCanaryScan: "passed",
  syntheticDataRemoved: "passed",
};
assert.deepEqual(report.queueProbe.checks, expectedChecks);
assert.deepEqual(report.postCleanupAudit, {
  ephemeralResourcesCreated: 19,
  ephemeralResourcesDestroyed: 19,
  persistentResourcesRestored: 1,
  ephemeralResourcesRemaining: 0,
  primaryQueueSyntheticMessagesRemaining: 0,
  deadLetterSyntheticMessagesRemaining: 0,
  zeroDrift: true,
});
assert.deepEqual(report.dataHandling, {
  customerDataUsed: false,
  syntheticDataRemoved: true,
  sourceCanaryRetained: false,
  secretCanaryRetained: false,
  digestCanaryRetained: false,
  secretValuesRetained: false,
});

const expectedArtifacts = [
  ".github/workflows/aws-sqs-conformance.yml",
  "tooling/infra/aws-sqs-publication-transport.mjs",
  "tooling/infra/run-live-sqs-conformance.mjs",
  "tooling/infra/aws/metadata-cloud/queue-runner.tf",
  "tooling/infra/aws/metadata-cloud/queue-runner.Dockerfile",
  "packages/cloud-client/src/public/sqs-publication-queue.ts",
  "packages/cloud-client/schemas/publication-queue-reference.schema.json",
  "docs/operations/M9_SQS_WORKER.md",
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
for (const forbidden of ["SecretString", "PGPASSWORD", "SOURCE_PATH_CANARY", "SECRET_CANARY", "sha256:aaaaaaaa"]) {
  assert.equal(serialized.includes(forbidden), false);
}
console.log("AWS SQS worker Evidence valid: live probes passed, cleaned up, zero drift");
