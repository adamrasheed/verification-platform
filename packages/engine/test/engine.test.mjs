import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  deriveCanonicalPromiseEvaluation,
  LocalVerificationRuntime,
  VerificationEngine,
} from "../dist/public/index.js";

const corpus = path.resolve("../../tooling/corpus");

class MemoryPorts {
  cache = new Map();
  history = [];
  async get(key) { return structuredClone(this.cache.get(key)); }
  async publish(key, value) {
    if (this.cache.has(key)) return "existing";
    this.cache.set(key, structuredClone(value));
    return "published";
  }
  async append(result, evidence) { this.history.push({ result, evidence }); }
}

test("full lifecycle satisfies a valid npm workspace", async () => {
  const ports = new MemoryPorts();
  const engine = new VerificationEngine({ cache: ports, history: ports, createInvocationId: () => "invocation:test" });
  const result = await engine.verify({
    schemaVersion: 1,
    workspaceRoot: path.join(corpus, "npm-valid"),
  });
  assert.equal(result.operationalStatus, "completed");
  assert.equal(result.outcome, "satisfied");
  assert.equal(result.proofs.length, 4);
  assert.equal(result.proofs.every((proof) => proof.evidence.length === 1), true);
  assert.equal(result.proofExecutions.length, 4);
  assert.equal(new Set(result.proofExecutions.map((item) => item.attemptId)).size, 4);
  assert.equal(result.proofExecutions.every((item) => item.effective), true);
  assert.equal(result.proofExecutions.every((item) => item.result.status === "passed"), true);
  assert.equal(result.promises.length, 4);
  assert.equal(result.promises.every((promise) => promise.status === "satisfied"), true);
  assert.equal(
    result.promises.every((promise) =>
      promise.promise.kind === "promise" &&
      promise.proofAttempts.length === 1 &&
      promise.evidence.length === 1
    ),
    true,
  );
  assert.equal(result.executionManifests.length, 4);
  assert.equal(result.evidenceRecords.length, 4);
  assert.equal(
    result.evidenceRecords.every((evidence) =>
      evidence.chainOfCustody.map((step) => step.action).join(",") ===
        "captured,normalized,classified,redacted,persisted" &&
      evidence.producer.id === "@verify-internal/engine" &&
      evidence.subjects.length > 0
    ),
    true,
  );
  assert.equal(result.events.at(-1)?.type, "engine.report.completed");
  assert.equal(ports.history.length, 1);
});

test("Engine Promise aggregation owns applicability, binding requirement, and criticality semantics", () => {
  const sha = (character) => `sha256:${character.repeat(64)}`;
  const revision = (kind, id, character) => ({
    kind,
    id,
    revision: sha(character),
    schemaVersion: 1,
  });
  const promise = (id, criticality, applicable = true) => ({
    id,
    revision: sha(id.at(-1)),
    schemaVersion: 1,
    criticality,
    applicability: {
      language: { id: "applicability.constant", revision: sha("f"), schemaVersion: 1 },
      expression: applicable,
    },
  });
  const requiredPromise = promise("promise:a", "required");
  const missingPromise = promise("promise:b", "required");
  const advisoryPromise = promise("promise:c", "advisory");
  const inactivePromise = promise("promise:d", "advisory", false);
  const promiseRef = (value) => revision("promise", value.id, value.id.at(-1));
  const proofA = revision("proof", "proof:a", "1");
  const proofAdvisory = revision("proof", "proof:advisory", "2");
  const proofMissing = revision("proof", "proof:missing", "3");
  const proofC = revision("proof", "proof:c", "4");
  const proofD = revision("proof", "proof:d", "5");
  const binding = (id, promiseValue, proof, requirement, applicable = true) => ({
    id,
    revision: sha("e"),
    schemaVersion: 1,
    promise: promiseRef(promiseValue),
    proof,
    requirement,
    applicability: {
      language: { id: "applicability.constant", revision: sha("f"), schemaVersion: 1 },
      expression: applicable,
    },
  });
  const execution = (id, promiseValue, proof, status, reasonCodes = []) => ({
    attemptId: `attempt:${id}`,
    attemptRef: {
      attemptId: `attempt:${id}`,
      proof,
      invocationId: "invocation:aggregation",
    },
    promise: promiseRef(promiseValue),
    proof,
    effective: true,
    evidence: [revision("evidence", `evidence:${id}`, "9")],
    result: status === "passed"
      ? { status, evidence: [] }
      : { status, evidence: [], reasonCodes },
  });
  const graph = {
    promises: [
      requiredPromise,
      missingPromise,
      advisoryPromise,
      inactivePromise,
    ],
    bindings: [
      binding("binding:a", requiredPromise, proofA, "required"),
      binding("binding:a-advisory", requiredPromise, proofAdvisory, "advisory"),
      binding("binding:missing", missingPromise, proofMissing, "required", false),
      binding("binding:c", advisoryPromise, proofC, "required"),
      binding("binding:d", inactivePromise, proofD, "required"),
    ],
  };
  const result = deriveCanonicalPromiseEvaluation(graph, [
    execution("a", requiredPromise, proofA, "passed"),
    execution("a-advisory", requiredPromise, proofAdvisory, "failed", ["ADVISORY_FAILED"]),
    execution("c", advisoryPromise, proofC, "failed", ["ADVISORY_PROMISE_FAILED"]),
    execution("d", inactivePromise, proofD, "passed"),
  ]);

  assert.deepEqual(
    result.promises.map(({ status, reasonCodes }) => ({ status, reasonCodes })),
    [
      { status: "satisfied", reasonCodes: [] },
      { status: "indeterminate", reasonCodes: ["NO_APPLICABLE_REQUIRED_PROOF"] },
      { status: "violated", reasonCodes: ["ADVISORY_PROMISE_FAILED"] },
      { status: "indeterminate", reasonCodes: ["PROMISE_NOT_APPLICABLE"] },
    ],
  );
  assert.deepEqual(result.summary, {
    requiredPromiseCount: 2,
    advisoryPromiseCount: 2,
    satisfiedCount: 1,
    violatedCount: 1,
    indeterminateCount: 2,
  });
  assert.equal(result.outcome, "indeterminate");
});

test("violations retain evidence and deterministic repairs", async () => {
  const engine = new VerificationEngine({ createInvocationId: () => "invocation:violation" });
  const result = await engine.verify({
    schemaVersion: 1,
    workspaceRoot: path.join(corpus, "npm-duplicate"),
  });
  assert.equal(result.outcome, "violated");
  assert.equal(result.reasonCodes.includes("DUPLICATE_WORKSPACE_NAME"), true);
  assert.equal(result.repairs.length > 0, true);
  assert.equal(result.repairs.every((repair) => repair.evidence.length > 0), true);
  assert.equal(result.repairRecords.length, result.repairs.length);
  assert.equal(
    result.repairRecords.every((repair) =>
      repair.motivatingPromise.kind === "promise" &&
      repair.motivatingExecution.proof.kind === "proof" &&
      repair.evidence.every((item) => item.kind === "evidence") &&
      repair.generator.id === "@verify-internal/engine" &&
      repair.verificationPlan.kind === "executionPlan"
    ),
    true,
  );
});

test("unknown repositories are explicitly not evaluated", async () => {
  const engine = new VerificationEngine({ createInvocationId: () => "invocation:unknown" });
  const result = await engine.verify({
    schemaVersion: 1,
    workspaceRoot: path.join(corpus, "unknown"),
  });
  assert.equal(result.operationalStatus, "completed");
  assert.equal(result.outcome, "not_evaluated");
  assert.deepEqual(result.reasonCodes, ["UNSUPPORTED_ECOSYSTEM"]);
});

test("cache changes performance metadata but never the semantic digest", async () => {
  const ports = new MemoryPorts();
  let ordinal = 0;
  const engine = new VerificationEngine({
    cache: ports,
    history: ports,
    createInvocationId: () => `invocation:${++ordinal}`,
  });
  const first = await engine.verify({ schemaVersion: 1, workspaceRoot: path.join(corpus, "npm-valid") });
  const second = await engine.verify({ schemaVersion: 1, workspaceRoot: path.join(corpus, "npm-valid") });
  assert.equal(first.cache.status, "miss");
  assert.equal(second.cache.status, "hit");
  assert.equal(first.resultDigest, second.resultDigest);
  assert.notEqual(first.invocationId, second.invocationId);
});

test("authority failures are blocked, not violations", async () => {
  const engine = new VerificationEngine({ createInvocationId: () => "invocation:blocked" });
  const principal = { kind: "automation", id: "automation:test", authenticated: true };
  const result = await engine.verify({
    schemaVersion: 1,
    workspaceRoot: path.join(corpus, "npm-valid"),
    principal,
    authorityPolicy: {
      source: "external-policy",
      principalId: principal.id,
      workspaceRoots: [],
      grants: [],
    },
  });
  assert.equal(result.operationalStatus, "blocked");
  assert.equal(result.outcome, "indeterminate");
});

test("caller cancellation propagates to discovery and prevents a verdict", async () => {
  const controller = new AbortController();
  controller.abort("caller");
  const engine = new VerificationEngine({ createInvocationId: () => "invocation:cancelled" });
  const result = await engine.verify({
    schemaVersion: 1,
    workspaceRoot: path.join(corpus, "npm-valid"),
    signal: controller.signal,
  });
  assert.equal(result.operationalStatus, "cancelled");
  assert.equal(result.outcome, "indeterminate");
  assert.equal(result.cache.status, "bypass");
  assert.equal(result.proofs.length, 0);
});

test("durable local runtime supports run, Evidence, and cache inspection", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "verify-runtime-"));
  const runtime = new LocalVerificationRuntime(stateRoot, {
    now: () => new Date("2026-07-18T00:00:00.000Z"),
  });
  try {
    const result = await runtime.verify({
      schemaVersion: 1,
      workspaceRoot: path.join(corpus, "npm-valid"),
      invocationId: "invocation:durable",
    });
    assert.equal(result.outcome, "satisfied");
    const canonicalEvidence = result.evidenceRecords[0];
    const canonicalManifest = result.executionManifests[0];
    assert.ok(canonicalEvidence);
    assert.ok(canonicalManifest);
    assert.equal(runtime.readRun(result.invocationId)?.resultDigest, result.resultDigest);
    const evidence = await runtime.readEvidence(result.evidence[0].id);
    assert.equal(evidence.metadata.revision, result.evidence[0].revision);
    const exactEvidence = await runtime.readEvidence(canonicalEvidence.id);
    assert.equal(exactEvidence.metadata.attempt.attemptId, canonicalEvidence.attempt.attemptId);
    assert.equal(
      runtime.readCanonicalRevision({
        kind: "executionManifest",
        id: canonicalManifest.id,
        revision: canonicalManifest.revision,
        schemaVersion: canonicalManifest.schemaVersion,
      })?.revision,
      canonicalManifest.revision,
    );
    const historyEvents = runtime.readHistoryEvents(result.invocationId);
    const captureIndex = historyEvents.findIndex((event) => event.eventType === "EvidenceCaptured");
    const validationIndex = historyEvents.findIndex((event) => event.eventType === "EvidenceValidated");
    const terminalAttemptIndex = historyEvents.findIndex((event) => event.eventType === "ProofExecutionCompleted");
    assert.ok(captureIndex >= 0);
    assert.ok(validationIndex > captureIndex);
    assert.ok(terminalAttemptIndex > validationIndex);
    assert.equal(historyEvents.at(-1)?.eventType, "VerificationInvocationCompleted");
    assert.equal(runtime.readHistoryEdges().some((edge) =>
      edge.relation.includes(`attempt:${canonicalEvidence.attempt.attemptId}:evidence`)
    ), true);
    assert.equal(
      runtime.readHistoryEdges().some(
        (edge) =>
          edge.source.kind === "promise" &&
          edge.relation === "aggregation:effective-proof" &&
          edge.target.kind === "proof",
      ),
      true,
    );
    assert.equal(
      runtime.readHistoryEdges().some(
        (edge) =>
          edge.source.kind === "promise" &&
          edge.relation === "aggregation:evidence" &&
          edge.target.kind === "evidence",
      ),
      true,
    );
    assert.equal(runtime.inspectCache().entries.length, 1);
    const cleared = await runtime.clearCache();
    assert.equal(cleared.historyPreserved, true);
    assert.equal(runtime.inspectCache().entries.length, 0);
    assert.equal(runtime.readRun(result.invocationId)?.resultDigest, result.resultDigest);
  } finally {
    runtime.close();
  }
});

test("runtime UoW faults expose no partial canonical history or projections", async () => {
  const points = [
    "after-revisions",
    "after-events",
    "after-reference-edges",
    "after-current-revisions",
    "before-commit",
  ];
  for (const point of points) {
    const stateRoot = await mkdtemp(path.join(tmpdir(), `verify-runtime-fault-${point}-`));
    const runtime = new LocalVerificationRuntime(stateRoot, {
      now: () => new Date("2026-07-18T00:00:00.000Z"),
      commitFault(candidate) {
        if (candidate === point) throw new Error(`fault:${point}`);
      },
    });
    const invocationId = `invocation:fault:${point}`;
    try {
      await assert.rejects(
        runtime.verify({
          schemaVersion: 1,
          workspaceRoot: path.join(corpus, "npm-valid"),
          invocationId,
        }),
        new RegExp(`fault:${point}`),
      );
      assert.equal(runtime.readRun(invocationId), undefined);
      assert.deepEqual(runtime.readHistoryEvents(invocationId), []);
      assert.deepEqual(runtime.readHistoryEdges(), []);
      assert.equal(runtime.inspectCache().entries.length, 0);
    } finally {
      runtime.close();
    }
  }
});

test("post-commit projection faults reconcile run and Evidence after restart", async () => {
  const points = [
    "after-canonical-commit",
    "before-legacy-evidence-projection",
    "before-canonical-evidence-projection",
    "before-run-projection",
  ];
  for (const point of points) {
    const stateRoot = await mkdtemp(
      path.join(tmpdir(), `verify-projection-recovery-${point}-`),
    );
    const invocationId = `invocation:projection:${point}`;
    const failing = new LocalVerificationRuntime(stateRoot, {
      now: () => new Date("2026-07-18T00:00:00.000Z"),
      projectionFault(candidate) {
        if (candidate === point) throw new Error(`projection-fault:${point}`);
      },
    });
    let authoritative;
    try {
      await assert.rejects(
        failing.verify({
          schemaVersion: 1,
          workspaceRoot: path.join(corpus, "npm-valid"),
          invocationId,
        }),
        new RegExp(`projection-fault:${point}`),
      );
      const terminal = failing.readHistoryEvents(invocationId).find(
        (event) => event.eventType === "VerificationInvocationCompleted",
      );
      assert.ok(terminal);
      authoritative = terminal.payload.result;
      assert.equal(authoritative.outcome, "satisfied");
      assert.equal(failing.inspectCache().entries.length, 0);
    } finally {
      failing.close();
    }

    const recovered = new LocalVerificationRuntime(stateRoot, {
      now: () => new Date("2026-07-18T00:00:01.000Z"),
    });
    try {
      assert.equal(
        recovered.readRun(invocationId)?.resultDigest,
        authoritative.resultDigest,
      );
      const legacyEvidence = await recovered.readEvidence(
        authoritative.evidence[0].id,
      );
      assert.equal(
        legacyEvidence.metadata.revision,
        authoritative.evidence[0].revision,
      );
      const canonicalEvidence = await recovered.readEvidence(
        authoritative.evidenceRecords[0].id,
      );
      assert.equal(
        canonicalEvidence.metadata.revision,
        authoritative.evidenceRecords[0].revision,
      );
    } finally {
      recovered.close();
    }
  }
});

test("restart marks admitted invocations without terminal history abandoned", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "verify-abandoned-"));
  const invocationId = "invocation:admitted-crash";
  const admitted = new LocalVerificationRuntime(stateRoot, {
    now: () => new Date("2026-07-18T00:00:00.000Z"),
  });
  await admitted.admit(invocationId, path.join(corpus, "npm-valid"));
  assert.deepEqual(
    admitted.readHistoryEvents(invocationId).map((event) => event.eventType),
    ["VerificationInvocationAdmitted"],
  );
  admitted.close();

  const recovered = new LocalVerificationRuntime(stateRoot, {
    now: () => new Date("2026-07-18T00:01:00.000Z"),
  });
  try {
    await recovered.readEvidence("evidence:recovery-barrier");
    const events = recovered.readHistoryEvents(invocationId);
    assert.deepEqual(events.map((event) => event.eventType), [
      "VerificationInvocationAdmitted",
      "VerificationInvocationAbandoned",
    ]);
    assert.equal(events[1].payload.reasonCode, "PROCESS_INTERRUPTED");
    assert.equal(events[1].payload.semanticOutcome, null);
    assert.equal(recovered.readRun(invocationId), undefined);
  } finally {
    recovered.close();
  }
});

test("recovery preserves a live owner's invocation and abandons it only after close", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "verify-owner-lease-"));
  const invocationId = "invocation:live-owner";
  const workspaceRoot = path.join(corpus, "npm-valid");
  const now = () => new Date("2026-07-18T00:00:00.000Z");
  const owner = new LocalVerificationRuntime(stateRoot, { now });
  let observer;
  let recovered;
  try {
    await owner.admit(invocationId, workspaceRoot);
    const admittedPrefix = JSON.stringify(
      owner.readHistoryEvents(invocationId),
    );

    observer = new LocalVerificationRuntime(stateRoot, { now });
    await observer.readEvidence("evidence:recovery-barrier");
    assert.equal(
      JSON.stringify(observer.readHistoryEvents(invocationId)),
      admittedPrefix,
    );
    assert.equal(
      observer.readHistoryEvents(invocationId).some(
        (event) => event.eventType === "VerificationInvocationAbandoned",
      ),
      false,
    );

    await owner.checkpoint({
      unit: "01-discovery-plan",
      invocationId,
      occurredAt: "2026-07-18T00:00:00.000Z",
      revisions: [],
      events: [{
        eventType: "DiscoveryPlanAuthorized",
        dataClassification: "MINIMAL_METADATA",
        payload: { ownerStillLive: true },
      }],
      referenceEdges: [],
    });
    assert.deepEqual(
      owner.readHistoryEvents(invocationId).map((event) => event.eventType),
      ["VerificationInvocationAdmitted", "DiscoveryPlanAuthorized"],
    );

    owner.close();
    recovered = new LocalVerificationRuntime(stateRoot, { now });
    await recovered.readEvidence("evidence:recovery-barrier");
    assert.deepEqual(
      recovered.readHistoryEvents(invocationId).map(
        (event) => event.eventType,
      ),
      [
        "VerificationInvocationAdmitted",
        "DiscoveryPlanAuthorized",
        "VerificationInvocationAbandoned",
      ],
    );
  } finally {
    owner.close();
    observer?.close();
    recovered?.close();
  }
});

test("external owner heartbeats renew the lease until the owner process dies", async () => {
  const stateRoot = await mkdtemp(
    path.join(tmpdir(), "verify-external-owner-heartbeat-"),
  );
  const invocationId = "invocation:external-owner";
  const workspaceRoot = path.join(corpus, "npm-valid");
  const leaseMs = 180;
  const heartbeatMs = 40;
  const runtimeModule = new URL(
    "../dist/public/index.js",
    import.meta.url,
  ).href;
  const childSource = `
    const [
      runtimeModule,
      stateRoot,
      workspaceRoot,
      invocationId,
      leaseText,
      heartbeatText,
    ] = process.argv.slice(1);
    const { LocalVerificationRuntime } = await import(runtimeModule);
    const { createInterface } = await import("node:readline");
    const runtime = new LocalVerificationRuntime(stateRoot, {
      ownerLeaseMs: Number(leaseText),
      ownerHeartbeatIntervalMs: Number(heartbeatText),
    });
    await runtime.admit(invocationId, workspaceRoot);
    process.stdout.write("READY\\n");
    const lines = createInterface({ input: process.stdin });
    lines.on("line", async (line) => {
      if (line !== "CHECKPOINT") return;
      try {
        await runtime.checkpoint({
          unit: "01-discovery-plan",
          invocationId,
          occurredAt: new Date().toISOString(),
          revisions: [],
          events: [{
            eventType: "DiscoveryPlanAuthorized",
            dataClassification: "MINIMAL_METADATA",
            payload: { externalOwner: true },
          }],
          referenceEdges: [],
        });
        process.stdout.write("CHECKPOINTED\\n");
      } catch (error) {
        process.stderr.write(String(error) + "\\n");
        process.exit(1);
      }
    });
  `;
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      childSource,
      runtimeModule,
      stateRoot,
      workspaceRoot,
      invocationId,
      String(leaseMs),
      String(heartbeatMs),
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const waitForMarker = (marker) => new Promise((resolve, reject) => {
    let output = "";
    const onData = (chunk) => {
      output += chunk.toString();
      if (!output.includes(marker)) return;
      cleanup();
      resolve();
    };
    const onExit = (code, signal) => {
      cleanup();
      reject(new Error(
        `owner child exited before ${marker}: ${code ?? signal}; ${stderr}`,
      ));
    };
    const cleanup = () => {
      child.stdout.off("data", onData);
      child.off("exit", onExit);
    };
    child.stdout.on("data", onData);
    child.on("exit", onExit);
  });
  const delay = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds));
  let observer;
  let recovered;
  try {
    await waitForMarker("READY");
    await delay(leaseMs * 2);

    observer = new LocalVerificationRuntime(stateRoot, {
      ownerLeaseMs: leaseMs,
      ownerHeartbeatIntervalMs: heartbeatMs,
    });
    await observer.readEvidence("evidence:recovery-barrier");
    assert.deepEqual(
      observer.readHistoryEvents(invocationId).map(
        (event) => event.eventType,
      ),
      ["VerificationInvocationAdmitted"],
    );

    const checkpointed = waitForMarker("CHECKPOINTED");
    child.stdin.write("CHECKPOINT\n");
    await checkpointed;
    assert.deepEqual(
      observer.readHistoryEvents(invocationId).map(
        (event) => event.eventType,
      ),
      ["VerificationInvocationAdmitted", "DiscoveryPlanAuthorized"],
    );

    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGTERM");
    await exited;
    await delay(leaseMs + heartbeatMs);

    recovered = new LocalVerificationRuntime(stateRoot, {
      ownerLeaseMs: leaseMs,
      ownerHeartbeatIntervalMs: heartbeatMs,
    });
    await recovered.readEvidence("evidence:recovery-barrier");
    assert.deepEqual(
      recovered.readHistoryEvents(invocationId).map(
        (event) => event.eventType,
      ),
      [
        "VerificationInvocationAdmitted",
        "DiscoveryPlanAuthorized",
        "VerificationInvocationAbandoned",
      ],
    );
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
    observer?.close();
    recovered?.close();
  }
});

test("cache hits reuse exact validated Evidence and missing canonical refs miss", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "verify-cache-provenance-"));
  const now = () => new Date("2026-07-18T00:00:00.000Z");
  const firstRuntime = new LocalVerificationRuntime(stateRoot, { now });
  let first;
  let second;
  try {
    first = await firstRuntime.verify({
      schemaVersion: 1,
      workspaceRoot: path.join(corpus, "npm-valid"),
      invocationId: "invocation:cache-origin",
    });
    second = await firstRuntime.verify({
      schemaVersion: 1,
      workspaceRoot: path.join(corpus, "npm-valid"),
      invocationId: "invocation:cache-hit",
    });
    assert.equal(second.cache.status, "hit");
    assert.equal(
      second.proofExecutions.every((execution) => {
        const origin = first.proofExecutions.find(
          (candidate) => candidate.proof.id === execution.proof.id,
        );
        return execution.cachedFromExecution === origin?.attemptId &&
          execution.validationEventIds.length === 1;
      }),
      true,
    );
    assert.deepEqual(
      second.evidenceRecords.map((evidence) => evidence.revision),
      first.evidenceRecords.map((evidence) => evidence.revision),
    );
    for (const execution of second.proofExecutions) {
      const validation = firstRuntime.readHistoryEvents(first.invocationId)
        .find((event) => event.eventId === execution.validationEventIds[0]);
      assert.equal(validation?.eventType, "EvidenceValidated");
      assert.equal(
        validation?.subject?.revision,
        execution.evidence[0].revision,
      );
    }
  } finally {
    firstRuntime.close();
  }

  const missing = first.evidenceRecords[0];
  const database = new DatabaseSync(path.join(stateRoot, "history.sqlite"));
  database.prepare("DELETE FROM revisions WHERE revision_key = ?").run(
    JSON.stringify({
      id: missing.id,
      kind: "evidence",
      revision: missing.revision,
      schemaVersion: missing.schemaVersion,
    }),
  );
  database.close();

  const afterDeletion = new LocalVerificationRuntime(stateRoot, { now });
  try {
    const result = await afterDeletion.verify({
      schemaVersion: 1,
      workspaceRoot: path.join(corpus, "npm-valid"),
      invocationId: "invocation:cache-reference-miss",
    });
    assert.equal(result.cache.status, "miss");
    assert.equal(
      result.proofExecutions.every(
        (execution) => execution.cachedFromExecution === undefined,
      ),
      true,
    );
  } finally {
    afterDeletion.close();
  }
});

test("progressive checkpoints retain the exact completed prefix across crashes", async () => {
  const boundaries = [
    ["02-discovery", "DiscoveryCompleted"],
    ["03-model-seal", "ApplicationModelSealed"],
    ["06-evidence-capture", "EvidenceCaptured"],
    ["07-evidence-validation", "EvidenceValidated"],
    ["09-promise-aggregation", "PromisesAggregated"],
    ["10-repair-proposal", "RepairProposed"],
  ];
  for (const [unit, expectedLastType] of boundaries) {
    const stateRoot = await mkdtemp(
      path.join(tmpdir(), `verify-progressive-${unit}-`),
    );
    const invocationId = `invocation:progressive:${unit}`;
    const failing = new LocalVerificationRuntime(stateRoot, {
      now: () => new Date("2026-07-18T00:00:00.000Z"),
      checkpointFault(candidate) {
        if (candidate === unit) throw new Error(`checkpoint-crash:${unit}`);
      },
    });
    let retainedPrefix;
    try {
      await assert.rejects(
        failing.verify({
          schemaVersion: 1,
          workspaceRoot: path.join(corpus, "npm-duplicate"),
          invocationId,
        }),
        new RegExp(`checkpoint-crash:${unit}`),
      );
      retainedPrefix = failing.readHistoryEvents(invocationId);
      assert.equal(retainedPrefix.at(-1)?.eventType, expectedLastType);
      assert.equal(
        retainedPrefix.some(
          (event) => event.eventType === "VerificationInvocationCompleted",
        ),
        false,
      );
      const unitNumber = Number(unit.slice(0, 2));
      assert.equal(
        retainedPrefix.some((event) => {
          const match = /:unit:(\d{2})-/.exec(event.eventId);
          return match !== null && Number(match[1]) > unitNumber;
        }),
        false,
      );
      if (unit === "06-evidence-capture") {
        const capture = retainedPrefix.find(
          (event) => event.eventType === "EvidenceCaptured",
        );
        assert.ok(capture?.payload.record?.id);
        const retainedEvidence = await failing.readEvidence(
          capture.payload.record.id,
        );
        assert.equal(
          retainedEvidence.metadata.revision,
          capture.payload.record.revision,
        );
      }
    } finally {
      failing.close();
    }

    const recovered = new LocalVerificationRuntime(stateRoot, {
      now: () => new Date("2026-07-18T00:01:00.000Z"),
    });
    try {
      await recovered.readEvidence("evidence:recovery-barrier");
      const afterRestart = recovered.readHistoryEvents(invocationId);
      assert.deepEqual(
        afterRestart.slice(0, retainedPrefix.length),
        retainedPrefix,
      );
      assert.equal(
        afterRestart.at(-1)?.eventType,
        "VerificationInvocationAbandoned",
      );
      assert.equal(afterRestart.at(-1)?.payload.semanticOutcome, null);
      assert.equal(recovered.readRun(invocationId), undefined);
    } finally {
      recovered.close();
    }
  }
});

test("an abandoned invocation is immutable and its ID cannot be reused", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "verify-abandoned-seal-"));
  const invocationId = "invocation:abandoned-seal";
  const workspaceRoot = path.join(corpus, "npm-valid");
  const failing = new LocalVerificationRuntime(stateRoot, {
    now: () => new Date("2026-07-18T00:00:00.000Z"),
    checkpointFault(unit) {
      if (unit === "02-discovery") throw new Error("crash-after-discovery");
    },
  });
  try {
    await assert.rejects(
      failing.verify({ schemaVersion: 1, workspaceRoot, invocationId }),
      /crash-after-discovery/,
    );
  } finally {
    failing.close();
  }

  const recovered = new LocalVerificationRuntime(stateRoot, {
    now: () => new Date("2026-07-18T00:01:00.000Z"),
  });
  try {
    await recovered.readEvidence("evidence:recovery-barrier");
    const before = JSON.stringify(recovered.readHistoryEvents(invocationId));
    assert.equal(
      recovered.readHistoryEvents(invocationId).at(-1)?.eventType,
      "VerificationInvocationAbandoned",
    );
    await assert.rejects(
      recovered.verify({ schemaVersion: 1, workspaceRoot, invocationId }),
      (error) => error.code === "IDEMPOTENCY_CONFLICT",
    );
    await assert.rejects(
      recovered.admit(invocationId, workspaceRoot),
      (error) => error.code === "IDEMPOTENCY_CONFLICT",
    );
    await assert.rejects(
      recovered.checkpoint({
        unit: "03-model-seal",
        invocationId,
        occurredAt: "2026-07-18T00:01:00.000Z",
        revisions: [],
        events: [{
          eventType: "ApplicationModelNotSealed",
          dataClassification: "MINIMAL_METADATA",
          payload: { status: "rejected" },
        }],
        referenceEdges: [],
      }),
      (error) => error.code === "IDEMPOTENCY_CONFLICT",
    );
    await assert.rejects(
      recovered.append({ invocationId, engineVersion: "0.1.0" }, undefined),
      (error) => error.code === "IDEMPOTENCY_CONFLICT",
    );
    const after = JSON.stringify(recovered.readHistoryEvents(invocationId));
    assert.equal(after, before);
    assert.equal(
      recovered.readHistoryEvents(invocationId).some(
        (event) => event.eventType === "VerificationInvocationCompleted",
      ),
      false,
    );
  } finally {
    recovered.close();
  }
});

test("a completed invocation rejects reuse while exact terminal append replay is harmless", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "verify-completed-seal-"));
  const runtime = new LocalVerificationRuntime(stateRoot, {
    now: () => new Date("2026-07-18T00:00:00.000Z"),
  });
  const invocationId = "invocation:completed-seal";
  const workspaceRoot = path.join(corpus, "unknown");
  try {
    const result = await runtime.verify(
      {
        schemaVersion: 1,
        workspaceRoot,
        invocationId,
      },
      true,
    );
    const before = JSON.stringify(runtime.readHistoryEvents(invocationId));
    const retainedTerminal = runtime.readHistoryEvents(invocationId).find(
      (event) => event.eventType === "VerificationInvocationCompleted",
    );
    assert.ok(retainedTerminal);
    const retainedProjectionEvidence =
      retainedTerminal.payload.projectionEvidence;
    const replayEvidence = retainedProjectionEvidence === null
      ? undefined
      : {
          ...retainedProjectionEvidence.metadata,
          body: retainedProjectionEvidence.body,
        };
    await runtime.append(result, replayEvidence);
    const retainedUnitOne = runtime.readHistoryEvents(invocationId).find(
      (event) => event.eventId.includes(":unit:01-discovery-plan:"),
    );
    assert.ok(retainedUnitOne);
    await runtime.checkpoint({
      unit: "01-discovery-plan",
      invocationId,
      occurredAt: retainedUnitOne.occurredAt,
      revisions: [],
      events: [{
        eventType: retainedUnitOne.eventType,
        dataClassification: retainedUnitOne.dataClassification,
        payload: retainedUnitOne.payload,
      }],
      referenceEdges: [],
    });
    assert.equal(
      JSON.stringify(runtime.readHistoryEvents(invocationId)),
      before,
    );
    await assert.rejects(
      runtime.verify({ schemaVersion: 1, workspaceRoot, invocationId }),
      (error) => error.code === "IDEMPOTENCY_CONFLICT",
    );
    await assert.rejects(
      runtime.admit(invocationId, workspaceRoot),
      (error) => error.code === "IDEMPOTENCY_CONFLICT",
    );
    await assert.rejects(
      runtime.checkpoint({
        unit: "04-execution-plan",
        invocationId,
        occurredAt: "2026-07-18T00:00:00.000Z",
        revisions: [],
        events: [{
          eventType: "ExecutionPlanAuthorized",
          dataClassification: "MINIMAL_METADATA",
          payload: { newWork: true },
        }],
        referenceEdges: [],
      }),
      (error) => error.code === "IDEMPOTENCY_CONFLICT",
    );
    assert.equal(
      JSON.stringify(runtime.readHistoryEvents(invocationId)),
      before,
    );
  } finally {
    runtime.close();
  }
});

test("checkpoint replay is idempotent and changed provenance is rejected", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "verify-checkpoint-retry-"));
  const runtime = new LocalVerificationRuntime(stateRoot, {
    now: () => new Date("2026-07-18T00:00:00.000Z"),
  });
  const invocationId = "invocation:checkpoint-retry";
  const units = [
    "01-discovery-plan",
    "02-discovery",
    "03-model-seal",
    "04-execution-plan",
    "05-attempt-start",
    "06-evidence-capture",
    "07-evidence-validation",
    "08-proof-terminal",
    "09-promise-aggregation",
    "10-repair-proposal",
  ];
  const checkpoint = (unit) => ({
    unit,
    invocationId,
    occurredAt: "2026-07-18T00:00:00.000Z",
    revisions: [],
    events: [{
      eventType: `CheckpointAccepted:${unit}`,
      dataClassification: "MINIMAL_METADATA",
      payload: { unit },
    }],
    referenceEdges: [],
  });
  try {
    await runtime.admit(invocationId, path.join(corpus, "npm-valid"));
    await runtime.admit(invocationId, path.join(corpus, "npm-valid"));
    await assert.rejects(
      runtime.admit(invocationId, path.join(corpus, "pnpm-valid")),
      (error) => error.code === "IDEMPOTENCY_CONFLICT",
    );
    for (const unit of units) {
      const candidate = checkpoint(unit);
      await runtime.checkpoint(candidate);
      await runtime.checkpoint(structuredClone(candidate));
    }
    assert.deepEqual(
      runtime.readHistoryEvents(invocationId).map((event) => event.eventType),
      [
        "VerificationInvocationAdmitted",
        ...units.map((unit) => `CheckpointAccepted:${unit}`),
      ],
    );
    await assert.rejects(
      runtime.checkpoint({
        ...checkpoint("01-discovery-plan"),
        referenceEdges: [{
          source: {
            kind: "promise",
            id: "promise:changed",
            revision: `sha256:${"1".repeat(64)}`,
            schemaVersion: 1,
          },
          relation: "aggregation:evidence",
          target: {
            kind: "evidence",
            id: "evidence:changed",
            revision: `sha256:${"2".repeat(64)}`,
            schemaVersion: 1,
          },
        }],
      }),
      (error) => error.code === "IDEMPOTENCY_CONFLICT",
    );
  } finally {
    runtime.close();
  }
});

test("a new sealed model supersedes the workspace current revision atomically", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "verify-model-current-"));
  const runtime = new LocalVerificationRuntime(stateRoot, {
    now: () => new Date("2026-07-18T00:00:00.000Z"),
  });
  const digest = (character) => `sha256:${character.repeat(64)}`;
  const model = (id, character) => ({
    kind: "applicationModel",
    id,
    revision: digest(character),
    schemaVersion: 1,
    payload: { generation: character },
  });
  const ref = (document) => ({
    kind: document.kind,
    id: document.id,
    revision: document.revision,
    schemaVersion: document.schemaVersion,
  });
  const slot = "current-model:workspace:test";
  const first = model("application-model:first", "1");
  const second = model("application-model:second", "2");
  const seal = (invocationId, document) => ({
    unit: "03-model-seal",
    invocationId,
    occurredAt: "2026-07-18T00:00:00.000Z",
    revisions: [document],
    events: [{
      eventType: "ApplicationModelSealed",
      subject: ref(document),
      dataClassification: "MINIMAL_METADATA",
      payload: { applicationModel: ref(document) },
    }],
    referenceEdges: [],
    currentRevision: { slot, next: ref(document) },
  });
  try {
    await runtime.checkpoint(seal("invocation:model:first", first));
    assert.deepEqual(runtime.readCurrentRevision(slot), ref(first));
    await runtime.checkpoint(seal("invocation:model:second", second));
    assert.deepEqual(runtime.readCurrentRevision(slot), ref(second));
    assert.equal(
      runtime.readHistoryEdges().some((edge) =>
        edge.relation === "superseded-by" &&
        edge.source.id === first.id &&
        edge.source.revision === first.revision &&
        edge.target.id === second.id &&
        edge.target.revision === second.revision
      ),
      true,
    );
    await runtime.checkpoint(structuredClone(
      seal("invocation:model:second", second),
    ));
  } finally {
    runtime.close();
  }
});

test("bounded discovery completes without starting a dangling Proof attempt", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "verify-bounded-attempts-"));
  const runtime = new LocalVerificationRuntime(stateRoot, {
    now: () => new Date("2026-07-18T00:00:00.000Z"),
  });
  try {
    const result = await runtime.verify({
      schemaVersion: 1,
      workspaceRoot: path.join(corpus, "npm-valid"),
      invocationId: "invocation:bounded-attempts",
      discoveryLimits: { maxFiles: 1 },
    });
    assert.equal(result.outcome, "indeterminate");
    const events = runtime.readHistoryEvents(result.invocationId);
    assert.equal(
      events.some((event) => event.eventType === "ProofExecutionStarted"),
      false,
    );
    assert.equal(
      events.some((event) => event.eventType === "ProofAttemptsNotStarted"),
      true,
    );
    assert.equal(
      events.at(-1)?.eventType,
      "VerificationInvocationCompleted",
    );
  } finally {
    runtime.close();
  }
});
