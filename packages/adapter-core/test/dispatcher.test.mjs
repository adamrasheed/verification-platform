import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  LocalAdapterError,
  LocalCanonicalDispatcher,
} from "../dist/public/index.js";
import { decodeCommandEnvelope } from "@verify-internal/protocol";

const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const workspace = join(root, "tooling/corpus/npm-valid");

async function withDispatcher(run) {
  const stateRoot = await mkdtemp(join(tmpdir(), "verify-adapter-core-"));
  const dispatcher = new LocalCanonicalDispatcher({
    workspace: { id: "workspace:bound", root: workspace },
    stateRoot,
    platform: "test",
    now: (() => {
      let value = 1_000;
      return () => value += 5;
    })(),
    nowIso: () => "2026-07-21T00:00:00.000Z",
    createInvocationId: () => "invocation:adapter-test",
  });
  try {
    await run(dispatcher);
  } finally {
    dispatcher.close();
    await rm(stateRoot, { recursive: true, force: true });
  }
}

test("one bound workspace produces the canonical opaque envelope and scoped reads", async () => {
  await withDispatcher(async (dispatcher) => {
    const progress = [];
    const dispatch = await dispatcher.verify({
      workspaceBinding: "workspace:bound",
      offline: true,
      noCache: true,
    }, new AbortController().signal, (event) => progress.push(event));

    assert.equal(decodeCommandEnvelope(dispatch.envelope).kind, "ok");
    assert.equal(dispatch.envelope.operationalStatus, "completed");
    assert.equal(dispatch.envelope.result.outcome, "satisfied");
    assert.equal(dispatch.envelope.result.workspace.rootBinding, "workspace:bound");
    assert.equal(JSON.stringify(dispatch.envelope).includes(workspace), false);
    assert.ok(progress.length > 0);
    assert.ok(progress.length <= 256);

    const retained = dispatcher.getRun({
      workspaceBinding: "workspace:bound",
      invocationId: dispatch.envelope.invocationId,
    });
    assert.equal(decodeCommandEnvelope(retained).kind, "ok");
    assert.equal(retained.result.resultDigest, dispatch.envelope.result.resultDigest);

    const evidenceId = dispatch.envelope.result.evidenceRecords[0].id;
    const evidence = await dispatcher.getEvidence({
      workspaceBinding: "workspace:bound",
      invocationId: dispatch.envelope.invocationId,
      evidenceId,
    });
    assert.equal(evidence.metadata.id, evidenceId);

    const reference = dispatch.envelope.result.applicationModel;
    const provenance = dispatcher.getProvenance({
      workspaceBinding: "workspace:bound",
      invocationId: dispatch.envelope.invocationId,
      reference,
    });
    assert.deepEqual(provenance.root, reference);
    assert.ok(provenance.objects.length > 0);
    assert.ok(provenance.objects.length <= 128);

    assert.deepEqual(dispatcher.inspectPermissions("workspace:bound"), {
      schemaVersion: 1,
      profile: "local-workspace",
      workspaceBinding: "workspace:bound",
      offline: true,
      tools: [
        "verification.verify",
        "verification.get_run",
        "verification.get_evidence",
        "verification.get_provenance",
        "verification.inspect_permissions",
      ],
      mutations: [],
      publication: false,
      providerCredentials: false,
    });
  });
});

test("workspace confusion, unlinked reads, and invalid deadlines fail closed", async () => {
  await withDispatcher(async (dispatcher) => {
    await assert.rejects(
      dispatcher.verify({
        workspaceBinding: "workspace:other",
        offline: true,
        noCache: true,
      }, new AbortController().signal),
      (error) => error instanceof LocalAdapterError
        && error.code === "VFY_ADAPTER_BINDING_DENIED",
    );
    await assert.rejects(
      dispatcher.verify({
        workspaceBinding: "workspace:bound",
        offline: true,
        noCache: true,
        deadlineMs: 0,
      }, new AbortController().signal),
      (error) => error instanceof LocalAdapterError
        && error.code === "VFY_ADAPTER_INVALID_REQUEST",
    );
    assert.throws(
      () => dispatcher.getRun({
        workspaceBinding: "workspace:bound",
        invocationId: "invocation:not-retained",
      }),
      (error) => error instanceof LocalAdapterError
        && error.code === "VFY_ADAPTER_NOT_FOUND",
    );
  });
});

test("caller cancellation reaches the engine and never yields a verdict", async () => {
  await withDispatcher(async (dispatcher) => {
    const controller = new AbortController();
    controller.abort("caller cancelled");
    const dispatch = await dispatcher.verify({
      workspaceBinding: "workspace:bound",
      offline: true,
      noCache: true,
    }, controller.signal);
    assert.equal(dispatch.envelope.operationalStatus, "cancelled");
    assert.equal(dispatch.envelope.result, null);
    assert.equal(decodeCommandEnvelope(dispatch.envelope).kind, "ok");
  });
});

test("the adapter passes an explicit deadline unchanged to the Engine runtime", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "verify-adapter-deadline-"));
  const { LocalVerificationRuntime } = await import("@verify-internal/engine");
  const backing = new LocalVerificationRuntime(stateRoot);
  let received;
  const runtime = {
    async verify(request, noCache) {
      received = request;
      return backing.verify(request, noCache);
    },
    readRun: (...args) => backing.readRun(...args),
    readHistoryEvents: (...args) => backing.readHistoryEvents(...args),
    readEvidence: (...args) => backing.readEvidence(...args),
    readCanonicalRevision: (...args) => backing.readCanonicalRevision(...args),
    readHistoryEdges: (...args) => backing.readHistoryEdges(...args),
    close: () => backing.close(),
  };
  const dispatcher = new LocalCanonicalDispatcher({
    workspace: { id: "workspace:deadline", root: workspace },
    runtime,
  });
  try {
    const dispatch = await dispatcher.verify({
      workspaceBinding: "workspace:deadline",
      offline: true,
      noCache: true,
      deadlineMs: 5_000,
    }, new AbortController().signal);
    assert.equal(received.deadlineMs, 5_000);
    assert.equal(dispatch.request.deadlineMs, 5_000);
  } finally {
    dispatcher.close();
    await rm(stateRoot, { recursive: true, force: true });
  }
});
