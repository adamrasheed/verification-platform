import assert from "node:assert/strict";
import test from "node:test";
import {
  PRODUCTION_READINESS_THRESHOLDS,
  evaluateProductionReadiness,
  percentile,
} from "./production-readiness-contract.mjs";

const passingMeasurement = () => ({
  schemaVersion: 1,
  load: {
    requestCount: 500,
    successCount: 500,
    durationMs: Array.from({ length: 500 }, (_, index) => 20 + (index % 100)),
  },
  durability: { acceptedDispatches: 20, recoveredDispatches: 20, duplicateDispatches: 0 },
  recovery: {
    postgresRpoMs: 0,
    postgresRtoMs: 2_000,
    publicationObjectRpoMs: 0,
    publicationObjectRtoMs: 2_000,
    connectionRecoveryMs: 100,
  },
  deletionRecovery: {
    logicalBackupRestored: true,
    tombstoneLedgerReplayed: true,
    activeRecordRecovered: true,
    deletedRecordResurrections: 0,
  },
  abuse: { attemptCount: 100, rejectedCount: 100, durableRowsCreated: 0, nonRetryableRejection: true },
  security: { crossTenantDenied: true, sourceCanaryAbsent: true, secretCanaryAbsent: true, auditSanitized: true },
  supplyChain: { immutableImage: true, dependencyReview: true, sbom: true, provenance: true },
});

test("readiness thresholds encode the frozen hosted targets", () => {
  assert.deepEqual(PRODUCTION_READINESS_THRESHOLDS, {
    minimumRequestSamples: 500,
    minimumAvailability: 0.999,
    maximumControlApiP95Ms: 500,
    maximumPostgresRpoMs: 300_000,
    maximumPostgresRtoMs: 14_400_000,
    maximumPublicationObjectRpoMs: 900_000,
    maximumPublicationObjectRtoMs: 28_800_000,
    maximumConnectionRecoveryMs: 30_000,
    minimumAbuseAttempts: 100,
  });
  assert.equal(percentile([100, 10, 20, 30], 0.95), 100);
});

test("a complete bounded measurement passes with only derived claims", () => {
  const result = evaluateProductionReadiness(passingMeasurement());
  assert.equal(result.outcome, "passed");
  assert.equal(result.measurements.availability, 1);
  assert.equal(result.measurements.p95Ms, 114);
  assert.deepEqual(new Set(Object.values(result.checks)), new Set(["passed"]));
});

test("one failed request in the minimum sample fails 99.9 percent availability", () => {
  const measurement = passingMeasurement();
  measurement.load.successCount = 499;
  const result = evaluateProductionReadiness(measurement);
  assert.equal(result.outcome, "failed");
  assert.equal(result.checks.sampledAvailability, "failed");
});

test("latency, loss, resurrection, abuse mutation, and missing attestations fail independently", () => {
  const mutations = [
    (value) => { value.load.durationMs.splice(474, 26, ...Array(26).fill(500)); },
    (value) => { value.durability.recoveredDispatches -= 1; },
    (value) => { value.deletionRecovery.deletedRecordResurrections = 1; },
    (value) => { value.abuse.durableRowsCreated = 1; },
    (value) => { value.supplyChain.provenance = false; },
  ];
  for (const mutate of mutations) {
    const measurement = passingMeasurement();
    mutate(measurement);
    assert.equal(evaluateProductionReadiness(measurement).outcome, "failed");
  }
});

test("unknown fields, empty samples, and non-finite measurements fail closed", () => {
  assert.throws(() => evaluateProductionReadiness({ ...passingMeasurement(), invented: true }), /fields must be exact/);
  const empty = passingMeasurement();
  empty.load = { requestCount: 0, successCount: 0, durationMs: [] };
  assert.throws(() => evaluateProductionReadiness(empty), /samples must be non-empty/);
  const nonFinite = passingMeasurement();
  nonFinite.recovery.postgresRtoMs = Number.NaN;
  assert.throws(() => evaluateProductionReadiness(nonFinite), /finite and non-negative/);
});
