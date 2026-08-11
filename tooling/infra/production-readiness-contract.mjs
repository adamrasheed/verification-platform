import assert from "node:assert/strict";

export const PRODUCTION_READINESS_THRESHOLDS = Object.freeze({
  minimumRequestSamples: 500,
  minimumAvailability: 0.999,
  maximumControlApiP95Ms: 500,
  maximumPostgresRpoMs: 5 * 60 * 1_000,
  maximumPostgresRtoMs: 4 * 60 * 60 * 1_000,
  maximumPublicationObjectRpoMs: 15 * 60 * 1_000,
  maximumPublicationObjectRtoMs: 8 * 60 * 60 * 1_000,
  maximumConnectionRecoveryMs: 30_000,
  minimumAbuseAttempts: 100,
});

const exactKeys = (value, keys, label) => {
  assert.equal(value !== null && typeof value === "object" && !Array.isArray(value), true, `${label} must be an object`);
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `${label} fields must be exact`);
};

const finiteNonNegative = (value, label) => {
  assert.equal(Number.isFinite(value) && value >= 0, true, `${label} must be finite and non-negative`);
};

export function percentile(samples, percentileValue) {
  assert.equal(Array.isArray(samples) && samples.length > 0, true, "samples must be non-empty");
  assert.equal(percentileValue > 0 && percentileValue <= 1, true, "percentile must be in (0, 1]");
  for (const [index, sample] of samples.entries()) finiteNonNegative(sample, `sample ${index}`);
  const ordered = [...samples].sort((left, right) => left - right);
  return ordered[Math.ceil(ordered.length * percentileValue) - 1];
}

export function evaluateProductionReadiness(measurement) {
  exactKeys(measurement, [
    "schemaVersion",
    "load",
    "durability",
    "recovery",
    "deletionRecovery",
    "abuse",
    "security",
    "supplyChain",
  ], "measurement");
  assert.equal(measurement.schemaVersion, 1);

  exactKeys(measurement.load, ["requestCount", "successCount", "durationMs"], "load");
  assert.equal(Array.isArray(measurement.load.durationMs), true, "load durationMs must be an array");
  assert.equal(measurement.load.durationMs.length, measurement.load.requestCount);
  assert.equal(Number.isInteger(measurement.load.requestCount), true);
  assert.equal(Number.isInteger(measurement.load.successCount), true);
  const p95Ms = percentile(measurement.load.durationMs, 0.95);
  const availability = measurement.load.successCount / measurement.load.requestCount;

  exactKeys(measurement.durability, ["acceptedDispatches", "recoveredDispatches", "duplicateDispatches"], "durability");
  for (const [key, value] of Object.entries(measurement.durability)) {
    assert.equal(Number.isInteger(value) && value >= 0, true, `durability ${key} must be a non-negative integer`);
  }

  exactKeys(measurement.recovery, [
    "postgresRpoMs",
    "postgresRtoMs",
    "publicationObjectRpoMs",
    "publicationObjectRtoMs",
    "connectionRecoveryMs",
  ], "recovery");
  for (const [key, value] of Object.entries(measurement.recovery)) finiteNonNegative(value, `recovery ${key}`);

  exactKeys(measurement.deletionRecovery, [
    "logicalBackupRestored",
    "tombstoneLedgerReplayed",
    "activeRecordRecovered",
    "deletedRecordResurrections",
  ], "deletionRecovery");
  for (const key of ["logicalBackupRestored", "tombstoneLedgerReplayed", "activeRecordRecovered"]) {
    assert.equal(typeof measurement.deletionRecovery[key], "boolean", `${key} must be boolean`);
  }
  assert.equal(Number.isInteger(measurement.deletionRecovery.deletedRecordResurrections), true);

  exactKeys(measurement.abuse, ["attemptCount", "rejectedCount", "durableRowsCreated", "nonRetryableRejection"], "abuse");
  for (const key of ["attemptCount", "rejectedCount", "durableRowsCreated"]) {
    assert.equal(Number.isInteger(measurement.abuse[key]) && measurement.abuse[key] >= 0, true, `${key} must be non-negative`);
  }
  assert.equal(typeof measurement.abuse.nonRetryableRejection, "boolean");

  exactKeys(measurement.security, ["crossTenantDenied", "sourceCanaryAbsent", "secretCanaryAbsent", "auditSanitized"], "security");
  exactKeys(measurement.supplyChain, ["immutableImage", "dependencyReview", "sbom", "provenance"], "supplyChain");
  for (const group of [measurement.security, measurement.supplyChain]) {
    for (const [key, value] of Object.entries(group)) assert.equal(typeof value, "boolean", `${key} must be boolean`);
  }

  const checks = {
    loadSample: measurement.load.requestCount >= PRODUCTION_READINESS_THRESHOLDS.minimumRequestSamples,
    sampledAvailability: availability >= PRODUCTION_READINESS_THRESHOLDS.minimumAvailability,
    controlApiP95: p95Ms < PRODUCTION_READINESS_THRESHOLDS.maximumControlApiP95Ms,
    acceptedDispatchDurability:
      measurement.durability.acceptedDispatches > 0
      && measurement.durability.recoveredDispatches === measurement.durability.acceptedDispatches
      && measurement.durability.duplicateDispatches === 0,
    postgresRecovery:
      measurement.recovery.postgresRpoMs <= PRODUCTION_READINESS_THRESHOLDS.maximumPostgresRpoMs
      && measurement.recovery.postgresRtoMs <= PRODUCTION_READINESS_THRESHOLDS.maximumPostgresRtoMs,
    publicationObjectRecovery:
      measurement.recovery.publicationObjectRpoMs <= PRODUCTION_READINESS_THRESHOLDS.maximumPublicationObjectRpoMs
      && measurement.recovery.publicationObjectRtoMs <= PRODUCTION_READINESS_THRESHOLDS.maximumPublicationObjectRtoMs,
    connectionRecovery: measurement.recovery.connectionRecoveryMs <= PRODUCTION_READINESS_THRESHOLDS.maximumConnectionRecoveryMs,
    logicalBackupRestore: measurement.deletionRecovery.logicalBackupRestored,
    tombstoneReplay:
      measurement.deletionRecovery.tombstoneLedgerReplayed
      && measurement.deletionRecovery.activeRecordRecovered
      && measurement.deletionRecovery.deletedRecordResurrections === 0,
    costAbuse:
      measurement.abuse.attemptCount >= PRODUCTION_READINESS_THRESHOLDS.minimumAbuseAttempts
      && measurement.abuse.rejectedCount === measurement.abuse.attemptCount
      && measurement.abuse.durableRowsCreated === 0
      && measurement.abuse.nonRetryableRejection,
    security: Object.values(measurement.security).every(Boolean),
    supplyChain: Object.values(measurement.supplyChain).every(Boolean),
  };
  return Object.freeze({
    schemaVersion: 1,
    kind: "productionReadinessEvaluation",
    outcome: Object.values(checks).every(Boolean) ? "passed" : "failed",
    measurements: Object.freeze({
      requestCount: measurement.load.requestCount,
      successCount: measurement.load.successCount,
      availability,
      p95Ms,
      ...measurement.recovery,
    }),
    checks: Object.freeze(Object.fromEntries(
      Object.entries(checks).map(([key, passed]) => [key, passed ? "passed" : "failed"]),
    )),
  });
}
