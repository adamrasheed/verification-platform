#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import process from "node:process";

const report = JSON.parse(await readFile(
  new URL("../../docs/compliance/release/AWS_DEVELOPMENT_FOUNDATION.json", import.meta.url),
  "utf8",
));

assert.equal(report.schemaVersion, 1);
assert.equal(report.kind, "awsDevelopmentFoundationEvidence");
assert.equal(report.taskId, "M9-T03");
assert.equal(report.outcome, "passed");
assert.deepEqual(report.accountBinding, {
  accountId: "661590454564",
  region: "us-west-2",
  environment: "development",
});
assert.equal(report.deployment.conclusion, "success");
assert.equal(report.deployment.immutablePlan, "passed");
assert.equal(report.deployment.apply, "passed");
assert.equal(report.deployment.postApplyZeroDrift, "passed");
assert.match(report.deployment.url, /\/actions\/runs\/30844264124$/);
assert.equal(report.liveAudit.command, "node tooling/infra/audit-aws-development.mjs");
assert.equal(report.liveAudit.secretValuesRead, false);
assert.equal(report.liveAudit.outcome, "passed");

const { controls } = report;
assert.equal(controls.network.privateSubnetIds.length, 2);
assert.equal(new Set(controls.network.availabilityZones).size, 2);
assert.equal(controls.network.publicIpMapping, false);
assert.equal(controls.network.internetOrNatRoutes, false);
assert.equal(controls.network.s3GatewayEndpointState, "available");
assert.equal(controls.securityGroups.allowedPath, "workload-to-database tcp/5432");
assert.equal(controls.securityGroups.unexpectedRules, 0);
assert.equal(controls.encryption.kmsKeyState, "Enabled");
assert.equal(controls.encryption.kmsRotation, "enabled");
assert.equal(controls.database.status, "available");
assert.equal(controls.database.publiclyAccessible, false);
assert.equal(controls.database.storageEncrypted, true);
assert.equal(controls.database.backupRetentionDays, 35);
assert.equal(controls.database.managedCredentialStatus, "active");
assert.equal(controls.database.managedCredentialEncryptedWithEnvironmentKey, true);
assert.equal(controls.storage.metadataVersioning, "enabled");
assert.equal(controls.storage.metadataExpiryDays, 30);
assert.equal(controls.storage.metadataNoncurrentExpiryDays, 35);
assert.equal(controls.storage.quarantineExpiryDays, 1);
assert.equal(controls.storage.publicAccessBlocked, true);
assert.equal(controls.storage.insecureTransportDenied, true);
assert.equal(controls.queues.maxReceiveCount, 5);
assert.equal(controls.queues.redriveSourceBound, true);
assert.equal(controls.queues.kmsEncrypted, true);
assert.equal(controls.compute.status, "ACTIVE");
assert.equal(controls.compute.containerInsights, "enabled");
assert.equal(controls.logs.retentionDays, 30);
assert.equal(controls.logs.groups.length, 4);
assert.equal(controls.cost.monthlyBudgetUsd, 100);
assert.deepEqual(controls.cost.actualAlertPercents, [80, 100]);
assert.equal(JSON.stringify(report).includes("database_endpoint"), false);
assert.equal(JSON.stringify(report).includes("SecretString"), false);

console.log("AWS development foundation Evidence valid: live, bounded, zero drift");
