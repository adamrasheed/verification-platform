import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  CancellationError,
  CancellationSource,
  DurableStorageLimitError,
  EvidenceBlobIntegrityError,
  EvidenceBlobStore,
  LocalCacheStore,
  LocalProjectionConflict,
  LocalProjectionRepository,
  SqliteEngineUnitOfWork,
  assertDurableEvidenceAdmission,
  decideRetry,
  deriveCacheKey,
  evaluateCacheEligibility,
  planRetention,
  runDeterministicDag,
  stableTopologicalOrder,
} from "../dist/public/index.js";

const digest = (character) => `sha256:${character.repeat(64)}`;

function baseCommit() {
  const application = {
    kind: "application",
    id: "app:one",
    revision: digest("1"),
    schemaVersion: 1,
    payload: { name: "one" },
  };
  const model = {
    kind: "applicationModel",
    id: "model:one",
    revision: digest("2"),
    schemaVersion: 1,
    payload: { app: "app:one" },
  };
  const subject = {
    kind: model.kind,
    id: model.id,
    revision: model.revision,
    schemaVersion: model.schemaVersion,
  };
  return {
    idempotencyKey: "commit:one",
    invocationId: "invocation:one",
    expectedNextSequence: 1,
    revisions: [application, model],
    events: [
      {
        schemaVersion: 1,
        eventId: "event:one",
        eventType: "ApplicationModelSealed",
        occurredAt: "2026-07-18T20:00:00.000Z",
        invocationId: "invocation:one",
        subject,
        correlationId: "operation:one",
        sequence: 1,
        producer: {
          id: "engine",
          version: "0.0.0",
          artifactDigest: digest("a"),
        },
        dataClassification: "MINIMAL_METADATA",
        payload: { sealed: true },
      },
    ],
    referenceEdges: [
      {
        source: subject,
        relation: "contains",
        target: {
          kind: application.kind,
          id: application.id,
          revision: application.revision,
          schemaVersion: application.schemaVersion,
        },
      },
    ],
    currentRevisionMutations: [
      {
        slot: "current:model",
        expectedCurrent: null,
        nextCurrent: subject,
      },
    ],
  };
}

async function temporaryDirectory(name) {
  return mkdtemp(join(tmpdir(), `verify-${name}-`));
}

test("SQLite UoW uses WAL and commits metadata, events, and edges atomically", async () => {
  const root = await temporaryDirectory("sqlite");
  const databasePath = join(root, "engine.sqlite");
  const store = new SqliteEngineUnitOfWork(databasePath);
  try {
    assert.equal(store.journalMode, "wal");
    const commit = baseCommit();
    const receipt = await store.commit(commit);
    assert.equal(receipt.lastSequence, 1);
    assert.equal(store.readInvocation("invocation:one").length, 1);
    assert.deepEqual(store.listInvocationIds(), ["invocation:one"]);
    assert.equal(store.readEvent("event:one").eventType, "ApplicationModelSealed");
    assert.equal(store.readEvent("event:missing"), undefined);
    assert.equal(store.readAcceptedCommit("commit:one").idempotencyKey, "commit:one");
    assert.equal(store.readAcceptedCommit("commit:missing"), undefined);
    assert.equal(store.readCurrentRevision("current:model").id, "model:one");
    assert.equal(store.readCurrentRevision("current:missing"), null);
    assert.equal(store.readReferenceEdges().length, 1);
    assert.equal(store.readRevision(commit.revisions[1]).id, "model:one");
    assert.deepEqual(await store.commit(structuredClone(commit)), receipt);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("fault injection around every SQLite write boundary rolls back the whole unit", async () => {
  const points = [
    "after-revisions",
    "after-events",
    "after-reference-edges",
    "after-current-revisions",
    "before-commit",
  ];
  for (const point of points) {
    const store = new SqliteEngineUnitOfWork(":memory:", (candidate) => {
      if (candidate === point) throw new Error(`fault:${point}`);
    });
    const commit = baseCommit();
    await assert.rejects(store.commit(commit), new RegExp(`fault:${point}`));
    assert.equal(store.readRevision(commit.revisions[0]), undefined);
    assert.deepEqual(store.readInvocation("invocation:one"), []);
    assert.deepEqual(store.readReferenceEdges(), []);
    store.close();
  }
});

test("SQLite UoW rejects stale sequence and conflicting idempotency", async () => {
  const store = new SqliteEngineUnitOfWork(":memory:");
  try {
    const commit = baseCommit();
    await store.commit(commit);
    const conflict = structuredClone(commit);
    conflict.events[0].payload.sealed = false;
    await assert.rejects(
      store.commit(conflict),
      (error) => error.code === "IDEMPOTENCY_CONFLICT",
    );
    const stale = structuredClone(commit);
    stale.idempotencyKey = "commit:two";
    stale.events[0].eventId = "event:two";
    await assert.rejects(
      store.commit(stale),
      (error) => error.code === "SEQUENCE_CONFLICT",
    );
    assert.equal(store.readInvocation("invocation:one").length, 1);
  } finally {
    store.close();
  }
});

test("concurrent SQLite writers converge on one idempotent committed unit", async () => {
  const root = await temporaryDirectory("sqlite-concurrency");
  const path = join(root, "engine.sqlite");
  const first = new SqliteEngineUnitOfWork(path);
  const second = new SqliteEngineUnitOfWork(path);
  try {
    const commit = baseCommit();
    const [left, right] = await Promise.all([
      first.commit(commit),
      second.commit(structuredClone(commit)),
    ]);
    assert.deepEqual(left, right);
    assert.equal(first.readInvocation("invocation:one").length, 1);
    assert.equal(second.readReferenceEdges().length, 1);
  } finally {
    first.close();
    second.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Evidence blobs use stage, digest, publish, verify, and orphan recovery", async () => {
  const root = await temporaryDirectory("blobs");
  try {
    const store = new EvidenceBlobStore(root);
    const bytes = new TextEncoder().encode("validated evidence");
    const staged = await store.stage(bytes, "capture-1");
    const destination = await store.commit(staged);
    assert.deepEqual(
      [...await store.read(staged.digest)],
      [...bytes],
    );
    assert.equal((await readFile(destination)).byteLength, bytes.byteLength);

    await store.stage(new TextEncoder().encode("orphan"), "orphan-1");
    const recovery = await store.recover();
    assert.deepEqual(recovery.removedStagingFiles, ["orphan-1.blob"]);
    assert.deepEqual(recovery.removedOrphanBlobDigests, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("missing or corrupted Evidence bytes cannot be read as valid", async () => {
  const root = await temporaryDirectory("blob-corruption");
  try {
    const store = new EvidenceBlobStore(root);
    const staged = await store.stage(new TextEncoder().encode("trusted"), "one");
    const destination = await store.commit(staged);
    await writeFile(destination, "corrupt");
    await assert.rejects(
      store.read(staged.digest),
      EvidenceBlobIntegrityError,
    );
    const report = await store.recover();
    assert.deepEqual(report.corruptBlobDigests, [staged.digest]);
    await assert.rejects(
      store.read(digest("f")),
      EvidenceBlobIntegrityError,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("post-publish Evidence fault leaves only a recoverable unreferenced blob", async () => {
  const root = await temporaryDirectory("blob-publish-fault");
  try {
    const faulty = new EvidenceBlobStore(root, (point) => {
      if (point === "after-publish") throw new Error("power loss");
    });
    const staged = await faulty.stage(
      new TextEncoder().encode("surviving child"),
      "faulted-capture",
    );
    await assert.rejects(faulty.commit(staged), /power loss/);
    const recovered = await new EvidenceBlobStore(root).recover(new Set());
    assert.deepEqual(recovered.removedOrphanBlobDigests, [staged.digest]);
    await assert.rejects(
      new EvidenceBlobStore(root).read(staged.digest),
      EvidenceBlobIntegrityError,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("retention is stable, bounded, and preserves shared Evidence", () => {
  const evidence = (id, character, byteSize) => ({
    ref: {
      kind: "evidence",
      id,
      revision: digest(character),
      schemaVersion: 1,
    },
    digest: digest(character),
    byteSize,
  });
  const shared = evidence("e:shared", "a", 30);
  const runs = [
    { runId: "run:old", completedAtEpochMs: 1, evidence: [shared] },
    {
      runId: "run:new",
      completedAtEpochMs: 100,
      evidence: [shared, evidence("e:new", "b", 20)],
    },
    {
      runId: "run:latest",
      completedAtEpochMs: 200,
      evidence: [evidence("e:latest", "c", 20)],
    },
  ];
  const plan = planRetention(
    runs,
    {
      maximumRuns: 2,
      maximumAgeMs: 1_000,
      maximumEvidenceBytes: 70,
      hardEvidenceBytes: 100,
    },
    200,
    "2026-07-18T20:00:00.000Z",
  );
  assert.deepEqual(plan.deleteRuns, ["run:old"]);
  assert.deepEqual(plan.deleteEvidence, []);
  assert.deepEqual(plan.tombstones, []);
  assert.throws(
    () => assertDurableEvidenceAdmission(90, 11, 100),
    DurableStorageLimitError,
  );
});

test("DAG admission and final projection are deterministic under varied completion order", async () => {
  const makeNodes = (delays) => [
    {
      nodeId: "a",
      dependencies: [],
      stableOrder: 1,
      async run() {
        await new Promise((resolve) => setTimeout(resolve, delays.a));
        return "A";
      },
    },
    {
      nodeId: "b",
      dependencies: [],
      stableOrder: 2,
      async run() {
        await new Promise((resolve) => setTimeout(resolve, delays.b));
        return "B";
      },
    },
    {
      nodeId: "c",
      dependencies: ["a", "b"],
      stableOrder: 3,
      async run() {
        return "C";
      },
    },
  ];
  const first = await runDeterministicDag(
    makeNodes({ a: 10, b: 1 }),
    2,
    new CancellationSource(),
  );
  const second = await runDeterministicDag(
    makeNodes({ a: 1, b: 10 }),
    2,
    new CancellationSource(),
  );
  assert.deepEqual(first.stableNodeOrder, ["a", "b", "c"]);
  assert.deepEqual(
    first.results.map(({ nodeId, status }) => [nodeId, status]),
    second.results.map(({ nodeId, status }) => [nodeId, status]),
  );
  assert.equal(first.maximumObservedConcurrency, 2);
  assert.throws(
    () =>
      stableTopologicalOrder([
        { nodeId: "x", dependencies: ["y"], stableOrder: 1, run: async () => 1 },
        { nodeId: "y", dependencies: ["x"], stableOrder: 2, run: async () => 1 },
      ]),
    /cycle/,
  );
});

test("hierarchical cancellation is idempotent and stops DAG admission", async () => {
  const parent = new CancellationSource();
  const child = new CancellationSource(parent);
  let observed;
  child.subscribe((reason) => {
    observed = reason;
  });
  assert.equal(parent.cancel("caller"), true);
  assert.equal(parent.cancel("shutdown"), false);
  assert.equal(observed, "caller");
  assert.throws(() => child.throwIfCancelled(), CancellationError);

  const result = await runDeterministicDag(
    [
      { nodeId: "a", dependencies: [], stableOrder: 1, run: async () => "A" },
      { nodeId: "b", dependencies: ["a"], stableOrder: 2, run: async () => "B" },
    ],
    1,
    child,
  );
  assert.deepEqual(
    result.results.map(({ status }) => status),
    ["cancelled", "cancelled"],
  );
});

test("retry decisions allow only bounded, allowlisted, retry-safe errors", () => {
  const policy = {
    maximumAttempts: 3,
    initialBackoffMs: 100,
    maximumBackoffMs: 500,
    multiplier: 2,
    retryableErrorCodes: ["VFY_EXECUTION_TIMEOUT"],
  };
  const allowed = decideRetry({
    status: "error",
    retrySafe: true,
    errorCode: "VFY_EXECUTION_TIMEOUT",
    errorRetryability: "safe",
    policyGrant: false,
    attemptOrdinal: 2,
    remainingDeadlineMs: 1_000,
    cancelled: false,
    policy,
  });
  assert.deepEqual(allowed, { retry: true, backoffMs: 200 });
  for (const status of ["passed", "failed", "indeterminate", "cancelled"]) {
    assert.equal(
      decideRetry({
        status,
        retrySafe: true,
        errorCode: "VFY_EXECUTION_TIMEOUT",
        errorRetryability: "safe",
        policyGrant: false,
        attemptOrdinal: 1,
        remainingDeadlineMs: 1_000,
        cancelled: false,
        policy,
      }).retry,
      false,
    );
  }
});

function cacheEntry(planKey, executionId) {
  return {
    schemaVersion: 1,
    planKey,
    proof: {
      kind: "proof",
      id: "proof:one",
      revision: digest("3"),
      schemaVersion: 1,
    },
    model: {
      kind: "applicationModel",
      id: "model:one",
      revision: digest("2"),
      schemaVersion: 1,
    },
    originatingExecutionId: executionId,
    originatingResultDigest: digest("4"),
    evidenceRefs: [],
    validationEventIds: [],
    reproducibility: "hermetic",
    value: { verdict: "passed" },
  };
}

test("cache keys are canonical and eligibility fails closed", async () => {
  const sha = async (bytes) =>
    `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const input = {
    engineArtifact: digest("a"),
    contractVersion: "1",
    pluginAndToolArtifacts: [],
    proof: { kind: "proof", id: "p", revision: digest("1"), schemaVersion: 1 },
    model: {
      kind: "applicationModel",
      id: "m",
      revision: digest("2"),
      schemaVersion: 1,
    },
    inputDigests: [digest("3")],
    configuration: { a: 1, b: 2 },
    policy: {},
    environment: {},
    reproducibility: "hermetic",
    discoveryOutputDigest: digest("4"),
  };
  assert.equal(
    await deriveCacheKey(input, sha),
    await deriveCacheKey(
      { ...input, configuration: { b: 2, a: 1 } },
      sha,
    ),
  );
  assert.deepEqual(
    evaluateCacheEligibility({
      policyMode: "content_addressed",
      everyInputHasDigest: false,
      observational: false,
      nowEpochMs: 0,
      evidenceComplete: true,
      validationComplete: true,
      integrityValid: true,
      classificationValid: true,
      redactionValid: true,
      authorizationSufficient: true,
    }),
    { eligible: false, reasonCode: "unstable_input" },
  );
});

test("cache publication has one atomic winner and corruption is a diagnosed miss", async () => {
  const root = await temporaryDirectory("cache");
  try {
    const store = new LocalCacheStore(root);
    const planKey = digest("9");
    const publications = await Promise.all([
      store.publish(cacheEntry(planKey, "execution:a"), "writer-a"),
      store.publish(cacheEntry(planKey, "execution:b"), "writer-b"),
    ]);
    assert.equal(
      publications.filter(({ wonPublication }) => wonPublication).length,
      1,
    );
    assert.ok(publications.every(({ disposition }) =>
      disposition === "published" || disposition === "reused"));
    assert.equal(publications[0].entry.originatingExecutionId,
      publications[1].entry.originatingExecutionId);
    assert.equal((await store.lookup(planKey, () => true)).disposition, "hit");

    const hex = planKey.slice(7);
    await writeFile(
      join(root, "entries", hex.slice(0, 2), `${hex}.json`),
      "{corrupt",
    );
    assert.deepEqual(await store.lookup(planKey, () => true), {
      disposition: "miss",
      reasonCode: "corrupt",
    });

    await mkdir(join(root, "stage"), { recursive: true });
    await writeFile(join(root, "stage", "abandoned.json"), "partial");
    assert.deepEqual(await store.recover(), ["abandoned.json"]);
    await store.clear();
    await assert.rejects(readdir(join(root, "entries")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local inspect projections read retained runs without reevaluation and survive cache clear", async () => {
  const root = await temporaryDirectory("projections");
  const repository = new LocalProjectionRepository(
    join(root, "engine.sqlite"),
    new EvidenceBlobStore(join(root, "evidence")),
  );
  try {
    repository.appendRun({
      invocationId: "invocation:retained",
      result: { kind: "verify", operationalStatus: "completed" },
    });
    repository.putCacheMetadata({
      planKey: digest("8"),
      originatingExecutionId: "execution:one",
      byteSize: 123,
      createdAt: "2026-07-18T20:00:00.000Z",
    });
    assert.equal(repository.listCacheMetadata().length, 1);
    repository.clearCacheMetadata();
    assert.deepEqual(repository.listCacheMetadata(), []);
    assert.deepEqual(repository.readRun("invocation:retained"), {
      invocationId: "invocation:retained",
      result: { kind: "verify", operationalStatus: "completed" },
    });
    const deletedRef = {
      kind: "evidence",
      id: "evidence:deleted",
      revision: digest("d"),
      schemaVersion: 1,
    };
    repository.putTombstone({
      ref: deletedRef,
      deletedAt: "2026-07-18T21:00:00.000Z",
      reason: "explicit",
    });
    assert.equal(repository.readTombstone(deletedRef).reason, "explicit");
    const evidence = {
      evidenceId: "evidence:one",
      metadata: { evidenceType: "manifest", classification: "LOCAL_SOURCE" },
      body: { packageManager: "npm", workspaceCount: 2 },
    };
    const appended = await repository.appendEvidence(evidence, "evidence-1");
    const replayed = await repository.appendEvidence(
      structuredClone(evidence),
      "evidence-1-retry",
    );
    assert.deepEqual(replayed, appended);
    assert.deepEqual(await repository.readEvidence("evidence:one"), appended);
    await assert.rejects(
      repository.appendEvidence(
        { ...evidence, body: { packageManager: "npm", workspaceCount: 3 } },
        "evidence-1-conflict",
      ),
      LocalProjectionConflict,
    );
    repository.appendRun({
      invocationId: "invocation:retained",
      result: { kind: "verify", operationalStatus: "completed" },
    });
    assert.throws(
      () =>
        repository.appendRun({
          invocationId: "invocation:retained",
          result: { kind: "verify", operationalStatus: "blocked" },
        }),
      LocalProjectionConflict,
    );
  } finally {
    repository.close();
    await rm(root, { recursive: true, force: true });
  }
});
