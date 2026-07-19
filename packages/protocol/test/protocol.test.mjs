import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  COMMAND_PROTOCOL_COMPATIBILITY,
  classifySchemaMajor,
  cliExitCodeForEnvelope,
  cliExitCodeForReadResult,
  consentDenialRetryability,
  createCompatibilityPolicy,
  decodeCommandEnvelope,
  decodeCommandRequest,
  decodeStructuredError,
  readCompatible,
  validateJsonlTranscript,
} from "../dist/public/index.js";

const envelopes = JSON.parse(
  await readFile(
    new URL("../fixtures/valid/envelopes.json", import.meta.url),
    "utf8",
  ),
);
const invalidFixtures = JSON.parse(
  await readFile(
    new URL("../fixtures/invalid/envelopes.json", import.meta.url),
    "utf8",
  ),
);
const compatibility = JSON.parse(
  await readFile(
    new URL("../fixtures/valid/compatibility.json", import.meta.url),
    "utf8",
  ),
);
const requests = JSON.parse(
  await readFile(
    new URL("../fixtures/valid/requests.json", import.meta.url),
    "utf8",
  ),
);
const transcript = await readFile(
  new URL("../fixtures/valid/transcript.jsonl", import.meta.url),
  "utf8",
);

function clone(value) {
  return structuredClone(value);
}

test("all five stable result discriminants decode under the common envelope", () => {
  assert.deepEqual(
    envelopes.map((envelope) => decodeCommandEnvelope(envelope).kind),
    ["ok", "ok", "ok", "ok", "ok"],
  );
  assert.deepEqual(
    envelopes.map((envelope) => envelope.result.kind),
    [
      "verify",
      "dispatchVerification",
      "publishedVerification",
      "getRun",
      "getPublishedRun",
    ],
  );
});

test("common request decoder validates workspace and positive deadlines", () => {
  assert.deepEqual(
    requests.map((request) => decodeCommandRequest(request).kind),
    ["ok", "ok"],
  );
  const invalidDeadline = clone(requests[0]);
  invalidDeadline.deadlineMs = 0;
  assert.equal(decodeCommandRequest(invalidDeadline).kind, "invalid");
  const unknownCommand = clone(requests[0]);
  unknownCommand.command = "verifyMaybe";
  assert.equal(decodeCommandRequest(unknownCommand).kind, "incompatible_result");
});

test("readers ignore additive object fields", () => {
  const envelope = clone(envelopes[0]);
  envelope.futureEnvelopeField = { value: true };
  envelope.result.futureResultField = "ignored";
  assert.equal(decodeCommandEnvelope(envelope).kind, "ok");
});

test("local results preserve typed revision and attempt projections", () => {
  const envelope = clone(envelopes[0]);
  const shaA = `sha256:${"a".repeat(64)}`;
  const shaB = `sha256:${"b".repeat(64)}`;
  const ref = (kind, id, revision = shaA) => ({
    kind,
    id,
    revision,
    schemaVersion: 1,
  });
  const promise = ref("promise", "promise-1");
  const proof = ref("proof", "proof-1", shaB);
  const model = ref("applicationModel", "model-1", shaB);
  const evidence = ref("evidence", "evidence-1", shaB);
  const attempt = {
    attemptId: "attempt-1",
    proof,
    invocationId: envelope.invocationId,
  };
  const manifest = {
    id: "manifest-1",
    revision: shaA,
    schemaVersion: 1,
    engine: { id: "engine", version: "1.0.0", artifactDigest: shaA },
    applicationModel: model,
    promises: [promise],
    proof,
    pluginsAndTools: [],
    source: { inputDigest: shaA, repositoryState: "unknown" },
    configurationDigest: shaA,
    policyDigest: shaA,
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
    discoveryOutputDigest: shaA,
    executionPlan: ref("executionPlan", "plan-1"),
    executionPlanDigest: shaA,
  };
  envelope.result.promises = [{
    promise,
    status: "violated",
    proofAttempts: [attempt],
    evidence: [evidence],
    reasonCodes: ["TEST_FAILED"],
  }];
  envelope.result.proofExecutions = [{
    attemptId: attempt.attemptId,
    attemptRef: attempt,
    proof,
    promise,
    model,
    executionContext: ref("executionContext", "context-1"),
    planKey: shaA,
    executionManifest: ref("executionManifest", manifest.id, manifest.revision),
    state: "failed",
    effective: true,
    evidence: [evidence],
    result: {
      status: "failed",
      evidence: [evidence],
      reasonCodes: ["TEST_FAILED"],
    },
    resultDigest: shaA,
    attemptRecordDigest: shaB,
  }];
  envelope.result.evidence = [evidence];
  envelope.result.evidenceRecords = [{
    id: evidence.id,
    revision: evidence.revision,
    schemaVersion: 1,
    evidenceType: "test",
    mediaType: "application/json",
    producer: { id: "engine", version: "1.0.0", artifactDigest: shaA },
    captureMethod: "test",
    capturedAt: envelope.startedAt,
    attempt,
    subjects: [model],
    inputRefs: [],
    contentDigest: shaA,
    byteSize: 1,
    classification: "MINIMAL_METADATA",
    chainOfCustody: [],
    supersedes: [],
  }];
  envelope.result.repairs = [ref("repair", "repair-1", shaB)];
  envelope.result.repairRecords = [{
    id: "repair-1",
    revision: shaB,
    schemaVersion: 1,
    motivatingPromise: promise,
    motivatingExecution: attempt,
    evidence: [evidence],
    generator: { id: "engine", version: "1.0.0", artifactDigest: shaA },
    action: {
      kind: "advisoryInstruction",
      instructionCode: "fix_test",
      parameters: {},
    },
    assumptions: [],
    requiredPermissions: {
      filesystem: [],
      network: [],
      subprocess: false,
      secrets: [],
    },
    expectedEffect: "passes",
    confidence: {
      value: 1,
      basis: "deterministic_rule",
      ruleId: "test",
      signalRefs: [],
    },
    verificationPlan: ref("executionPlan", "repair-plan-1"),
  }];
  envelope.result.executionManifests = [manifest];
  assert.equal(decodeCommandEnvelope(envelope).kind, "ok");

  const simplified = clone(envelope);
  simplified.result.proofExecutions[0].proof = "proof-1";
  assert.equal(decodeCommandEnvelope(simplified).kind, "invalid");

  const futureState = clone(envelope);
  futureState.result.proofExecutions[0].state = "future_state";
  assert.equal(
    decodeCommandEnvelope(futureState).kind,
    "incompatible_result",
  );

  const wrongPromiseType = clone(envelope);
  wrongPromiseType.result.promises[0].promise.kind = "proof";
  assert.equal(decodeCommandEnvelope(wrongPromiseType).kind, "invalid");

  const wrongAttemptProofType = clone(envelope);
  wrongAttemptProofType.result.promises[0].proofAttempts[0].proof.kind =
    "promise";
  assert.equal(decodeCommandEnvelope(wrongAttemptProofType).kind, "invalid");

  const wrongEvidenceType = clone(envelope);
  wrongEvidenceType.result.promises[0].evidence[0].kind = "repair";
  assert.equal(decodeCommandEnvelope(wrongEvidenceType).kind, "invalid");
});

test("unknown control values are incompatible and never success", () => {
  for (const fixture of invalidFixtures) {
    const envelope = clone(envelopes[0]);
    Object.assign(envelope, fixture.patch);
    if (fixture.resultPatch) Object.assign(envelope.result, fixture.resultPatch);
    const decoded = decodeCommandEnvelope(envelope);
    assert.equal(decoded.kind, fixture.expected, fixture.name);
    assert.equal(
      cliExitCodeForReadResult(decoded),
      fixture.expected === "incompatible_result" ? 6 : 3,
      fixture.name,
    );
  }
});

test("verify status/outcome combinations enforce partial-result rules", () => {
  const blocked = clone(envelopes[0]);
  blocked.operationalStatus = "blocked";
  blocked.result.outcome = "indeterminate";
  blocked.result.partial = true;
  assert.equal(decodeCommandEnvelope(blocked).kind, "ok");

  delete blocked.result.partial;
  assert.equal(decodeCommandEnvelope(blocked).kind, "invalid");

  blocked.result.outcome = "not_evaluated";
  assert.equal(decodeCommandEnvelope(blocked).kind, "ok");
});

test("published references cannot masquerade as local RevisionRef", () => {
  const published = clone(envelopes[2]);
  published.result.applicationModel.revision =
    "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
  assert.equal(decodeCommandEnvelope(published).kind, "invalid");
});

test("StructuredError registry preserves unknown codes with known categories", () => {
  const error = {
    code: "VFY_FUTURE_NEW_CONDITION",
    category: "network",
    retryability: "safe",
    message: "sanitized",
    component: "future",
    operation: "observe",
    blocksRequiredProof: true,
    causes: [],
    diagnosticRefs: [],
  };
  assert.equal(decodeStructuredError(error).kind, "unknown_code");
  assert.equal(
    decodeStructuredError({ ...error, category: "future_category" }).kind,
    "incompatible",
  );
  assert.equal(consentDenialRetryability(true), "policy_required");
  assert.equal(consentDenialRetryability(false), "never");
});

test("CLI exit mapping covers every frozen verify outcome and operational state", () => {
  const expected = [
    ["completed", "satisfied", 0],
    ["completed", "violated", 1],
    ["completed", "indeterminate", 2],
    ["completed", "not_evaluated", 2],
    ["invalid", "not_evaluated", 3],
    ["blocked", "not_evaluated", 4],
    ["cancelled", "not_evaluated", 5],
    ["internal_error", "not_evaluated", 6],
  ];
  for (const [status, outcome, code] of expected) {
    const envelope = clone(envelopes[0]);
    envelope.operationalStatus = status;
    envelope.result.outcome = outcome;
    if (status !== "completed" && outcome === "indeterminate") {
      envelope.result.partial = true;
    }
    assert.equal(cliExitCodeForEnvelope(envelope), code, `${status}/${outcome}`);
  }
});

test("protocol major 1 is current and no previous production major is invented", () => {
  assert.equal(COMMAND_PROTOCOL_COMPATIBILITY.currentMajor, 1);
  assert.equal(COMMAND_PROTOCOL_COMPATIBILITY.previousMajor, undefined);
  assert.equal(classifySchemaMajor(1, COMMAND_PROTOCOL_COMPATIBILITY), "current");
  assert.equal(
    classifySchemaMajor(compatibility.actual.unsupported[0], COMMAND_PROTOCOL_COMPATIBILITY),
    "unsupported",
  );
});

test("compatibility helper selects current and immediately previous readers", () => {
  const policy = createCompatibilityPolicy(
    compatibility.syntheticNextRelease.currentMajor,
    compatibility.syntheticNextRelease.previousMajor,
  );
  const readers = {
    policy,
    current: (value) => `v2:${value.value}`,
    previous: (value) => `v1:${value.value}`,
  };
  assert.deepEqual(
    readCompatible(compatibility.syntheticNextRelease.current, readers),
    { kind: "ok", support: "current", value: "v2:current" },
  );
  assert.deepEqual(
    readCompatible(compatibility.syntheticNextRelease.previous, readers),
    { kind: "ok", support: "previous", value: "v1:previous" },
  );
  assert.throws(() => createCompatibilityPolicy(3, 1), /immediately precede/);
});

test("JSONL accepts ordered events followed by exactly one terminal result", () => {
  const decoded = validateJsonlTranscript(transcript);
  assert.equal(decoded.kind, "ok");
  assert.equal(decoded.value.events.length, 1);
  assert.equal(decoded.value.result.invocationId, "inv-jsonl");
});

test("JSONL rejects missing, duplicate, early, mismatched, and unknown terminals", () => {
  const lines = transcript.trimEnd().split("\n");
  assert.equal(validateJsonlTranscript(lines[0]).kind, "invalid");
  assert.equal(
    validateJsonlTranscript(`${lines[1]}\n${lines[0]}\n`).kind,
    "invalid",
  );
  assert.equal(
    validateJsonlTranscript(`${lines[0]}\n${lines[1]}\n${lines[1]}\n`).kind,
    "invalid",
  );
  const mismatch = JSON.parse(lines[1]);
  mismatch.envelope.invocationId = "different";
  assert.equal(
    validateJsonlTranscript(`${lines[0]}\n${JSON.stringify(mismatch)}\n`).kind,
    "invalid",
  );
  const unknown = JSON.parse(lines[0]);
  unknown.recordType = "progress";
  assert.equal(
    validateJsonlTranscript(`${JSON.stringify(unknown)}\n${lines[1]}\n`).kind,
    "incompatible_result",
  );
});
