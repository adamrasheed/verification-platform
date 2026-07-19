import { readFile } from "node:fs/promises";

export const sha = `sha256:${"a".repeat(64)}`;
export const sha2 = `sha256:${"b".repeat(64)}`;
export const sha3 = `sha256:${"c".repeat(64)}`;

export function revision(kind, id, revision = sha) {
  return { kind, id, revision, schemaVersion: 1 };
}

export const promiseRef = revision("promise", "promise:test", sha);
export const proofRef = revision("proof", "proof:test", sha2);
export const modelRef = revision("applicationModel", "model:test", sha2);
export const contextRef = revision("executionContext", "context:test", sha);
export const manifestRef = revision(
  "executionManifest",
  "manifest:test",
  sha2,
);
export const evidenceRef = revision("evidence", "evidence:test", sha3);
export const attemptRef = {
  attemptId: "attempt:test",
  proof: proofRef,
  invocationId: "invocation:test",
};

export function canonicalPromiseResult(
  status = "satisfied",
  reasonCodes = [],
) {
  return {
    promise: promiseRef,
    status,
    proofAttempts: [attemptRef],
    evidence: [evidenceRef],
    reasonCodes,
  };
}

export function canonicalExecution(
  status = "passed",
  reasonCodes = [],
) {
  const result =
    status === "passed"
      ? { status, evidence: [evidenceRef] }
      : status === "failed" || status === "indeterminate"
        ? { status, evidence: [evidenceRef], reasonCodes }
        : status === "cancelled"
          ? { status, reason: "caller" }
          : { status: "error", error: { code: "TEST_ERROR", message: "failed" } };
  return {
    attemptId: "attempt:test",
    attemptRef,
    promise: promiseRef,
    proof: proofRef,
    model: modelRef,
    executionContext: contextRef,
    executionManifest: manifestRef,
    planKey: sha,
    state: status,
    effective: true,
    startedAt: "2026-07-18T00:00:00.000Z",
    completedAt: "2026-07-18T00:00:00.001Z",
    evidence: [evidenceRef],
    result,
    resultDigest: sha,
    attemptRecordDigest: sha3,
  };
}

export const executionManifest = {
  id: "manifest:test",
  revision: sha2,
  schemaVersion: 1,
  engine: { id: "engine:test", version: "0.1.0-test", artifactDigest: sha },
  applicationModel: modelRef,
  promises: [promiseRef],
  proof: proofRef,
  pluginsAndTools: [],
  source: { inputDigest: sha, repositoryState: "unknown" },
  configurationDigest: sha,
  policyDigest: sha,
  platform: {
    operatingSystem: "test",
    architecture: "test",
    runtimeVersions: [],
    toolchainVersions: [],
  },
  authenticationBindingIds: [],
  isolation: {
    filesystem: {},
    network: {},
    clock: {},
    randomness: {},
    enforcementTier: "test",
  },
  discoveryOutputDigest: sha,
  executionPlan: revision("executionPlan", "plan:test", sha),
  executionPlanDigest: sha,
};

export const evidenceRecord = {
  id: "evidence:test",
  revision: sha3,
  schemaVersion: 1,
  evidenceType: "test",
  mediaType: "application/json",
  producer: { id: "engine:test", version: "0.1.0-test", artifactDigest: sha },
  captureMethod: "test",
  capturedAt: "2026-07-18T00:00:00.000Z",
  attempt: attemptRef,
  subjects: [modelRef],
  inputRefs: [],
  contentDigest: sha,
  byteSize: 12,
  classification: "MINIMAL_METADATA",
  chainOfCustody: [],
  supersedes: [],
};

export function canonicalRepairRecord() {
  return {
    id: "repair:test",
    revision: sha2,
    schemaVersion: 1,
    motivatingPromise: promiseRef,
    motivatingExecution: attemptRef,
    evidence: [evidenceRef],
    generator: { id: "engine:test", version: "0.1.0-test", artifactDigest: sha },
    action: {
      kind: "advisoryInstruction",
      instructionCode: "replace_ambiguous_range",
      parameters: { target: "package.json" },
    },
    assumptions: [],
    requiredPermissions: {
      filesystem: [{ mode: "write", root: "." }],
      network: [],
      subprocess: false,
      secrets: [],
    },
    expectedEffect: "the proof passes",
    confidence: {
      value: 1,
      basis: "deterministic_rule",
      ruleId: "test",
      signalRefs: [],
    },
    verificationPlan: revision("executionPlan", "repair-plan:test", sha3),
  };
}

export function engineResult(overrides = {}) {
  return {
    kind: "verify",
    schemaVersion: 1,
    engineVersion: "0.1.0-test",
    invocationId: "invocation:test",
    operationalStatus: "completed",
    outcome: "satisfied",
    workspace: {
      binding: sha,
      packageManager: "npm",
      modelRevision: sha2,
    },
    applicationModel: {
      kind: "applicationModel",
      id: "model:test",
      revision: sha2,
      schemaVersion: 1,
    },
    summary: {
      requiredPromiseCount: 1,
      advisoryPromiseCount: 0,
      satisfiedCount: 1,
      violatedCount: 0,
      indeterminateCount: 0,
    },
    proofs: [{
      proofId: "proof:test",
      promiseId: "promise:test",
      status: "passed",
      reasonCodes: [],
      evidence: [sha3],
      details: [],
      resultDigest: sha,
    }],
    promises: [canonicalPromiseResult()],
    evidence: [{
      id: "evidence:test",
      revision: sha3,
      evidenceType: "test",
      classification: "MINIMAL_METADATA",
      byteSize: 12,
      validation: "valid",
    }],
    repairs: [],
    proofExecutions: [canonicalExecution()],
    evidenceRecords: [evidenceRecord],
    repairRecords: [],
    executionManifests: [executionManifest],
    reasonCodes: [],
    diagnostics: [],
    cache: { key: sha, status: "miss" },
    events: [
      {
        sequence: 1,
        type: "engine.preflight.started",
        stage: "preflight",
        status: "started",
      },
      {
        sequence: 2,
        type: "engine.report.completed",
        stage: "report",
        status: "completed",
      },
    ],
    resultDigest: sha,
    ...overrides,
  };
}

export function fakeIo() {
  let stdout = "";
  let stderr = "";
  const times = [1_000, 1_007];
  return {
    io: {
      cwd: "/workspace",
      platform: "test-platform",
      stdout: (chunk) => {
        stdout += chunk;
      },
      stderr: (chunk) => {
        stderr += chunk;
      },
      now: () => times.shift() ?? 1_007,
      nowIso: () => "2026-07-18T00:00:00.000Z",
    },
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

export async function golden(name) {
  return readFile(new URL(`./golden/${name}`, import.meta.url), "utf8");
}
