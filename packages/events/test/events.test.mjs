import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  EngineUnitOfWorkConflict,
  EventRegistryError,
  createEventRegistry,
} from "../dist/public/index.js";
import {
  InMemoryEngineUnitOfWork,
} from "../dist/testing/index.js";

const validCommit = JSON.parse(
  await readFile(
    new URL("../fixtures/valid/atomic-commit.json", import.meta.url),
    "utf8",
  ),
);
const invalidSequences = JSON.parse(
  await readFile(
    new URL(
      "../fixtures/invalid/non-monotonic-sequence.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

function copy(value) {
  return structuredClone(value);
}

async function expectConflict(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof EngineUnitOfWorkConflict);
    assert.equal(error.code, code);
    return true;
  });
}

test("event registry resolves exact type and independent schema version", () => {
  const descriptor = {
    eventType: "ApplicationModelSealed",
    schemaVersion: 1,
    criticality: "reconstruction-critical",
    validatePayload(value) {
      return typeof value === "object" &&
        value !== null &&
        value.sealed === true;
    },
  };
  const registry = createEventRegistry([descriptor]);

  assert.equal(registry.resolve("ApplicationModelSealed", 1), descriptor);
  assert.equal(registry.resolve("ApplicationModelSealed", 2), undefined);
  assert.throws(
    () => createEventRegistry([descriptor, descriptor]),
    (error) =>
      error instanceof EventRegistryError &&
      error.code === "DUPLICATE_EVENT_DESCRIPTOR",
  );
});

test("one commit exposes revisions, events, edges, and current pointer together", async () => {
  const store = new InMemoryEngineUnitOfWork();
  const receipt = await store.commit(validCommit);
  const snapshot = store.snapshot();

  assert.deepEqual(receipt, {
    idempotencyKey: "commit:model-seal:1",
    invocationId: "invocation:1",
    firstSequence: 1,
    lastSequence: 2,
    revisionCount: 2,
    eventCount: 2,
    referenceEdgeCount: 1,
  });
  assert.equal(snapshot.revisions.length, 2);
  assert.deepEqual(
    snapshot.events.map(({ sequence }) => sequence),
    [1, 2],
  );
  assert.equal(snapshot.referenceEdges.length, 1);
  assert.equal(
    snapshot.currentRevisions["workspace:current-model"].id,
    "model:workspace",
  );
});

test("non-monotonic, duplicate, and skipped sequences reveal no partial state", async () => {
  for (const mutation of invalidSequences.mutations) {
    const store = new InMemoryEngineUnitOfWork();
    const commit = copy(validCommit);
    commit.events[mutation.eventIndex].sequence = mutation.sequence;

    await expectConflict(
      store.commit(commit),
      "INVALID_EVENT_SEQUENCE",
    );
    assert.deepEqual(store.snapshot(), {
      revisions: [],
      events: [],
      referenceEdges: [],
      currentRevisions: {},
    });
  }
});

test("an identical idempotent retry returns the receipt without duplicate writes", async () => {
  const store = new InMemoryEngineUnitOfWork();
  const first = await store.commit(validCommit);
  const second = await store.commit(copy(validCommit));

  assert.deepEqual(second, first);
  assert.equal(store.snapshot().events.length, 2);
  assert.equal(store.snapshot().revisions.length, 2);
  assert.equal(store.snapshot().referenceEdges.length, 1);
});

test("reusing an idempotency key for different content is rejected atomically", async () => {
  const store = new InMemoryEngineUnitOfWork();
  await store.commit(validCommit);
  const before = store.snapshot();
  const conflict = copy(validCommit);
  conflict.events[1].payload.sealed = false;

  await expectConflict(
    store.commit(conflict),
    "IDEMPOTENCY_CONFLICT",
  );
  assert.deepEqual(store.snapshot(), before);
});

test("stale expected sequence is rejected without making referenced objects visible", async () => {
  const store = new InMemoryEngineUnitOfWork();
  await store.commit(validCommit);
  const before = store.snapshot();
  const next = copy(validCommit);
  next.idempotencyKey = "commit:model-seal:2";
  next.revisions[0].id = "application:other";
  next.revisions[0].revision =
    "sha256:3333333333333333333333333333333333333333333333333333333333333333";
  next.events = [];
  next.referenceEdges = [];
  next.currentRevisionMutations = [];

  await expectConflict(store.commit(next), "SEQUENCE_CONFLICT");
  assert.deepEqual(store.snapshot(), before);
});

test("a missing event subject rejects the whole commit", async () => {
  const store = new InMemoryEngineUnitOfWork();
  const commit = copy(validCommit);
  commit.events[0].subject.id = "model:missing";

  await expectConflict(store.commit(commit), "MISSING_REVISION");
  assert.deepEqual(store.snapshot(), {
    revisions: [],
    events: [],
    referenceEdges: [],
    currentRevisions: {},
  });
});

test("a failed current-revision predicate preserves all previously visible state", async () => {
  const store = new InMemoryEngineUnitOfWork();
  await store.commit(validCommit);
  const before = store.snapshot();
  const next = copy(validCommit);
  next.idempotencyKey = "commit:model-seal:2";
  next.expectedNextSequence = 3;
  next.events = [];
  next.referenceEdges = [];
  next.currentRevisionMutations[0].expectedCurrent = null;

  await expectConflict(
    store.commit(next),
    "CURRENT_REVISION_CONFLICT",
  );
  assert.deepEqual(store.snapshot(), before);
});
