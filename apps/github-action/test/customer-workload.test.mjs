import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  InMemoryCustomerWorkloadDispatchStore,
  dispatchAdmission,
} from "@verify-internal/cloud-client";
import { runCustomerWorkloadOffer } from "../lib/public/index.js";

const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const workspace = join(root, "tooling/corpus/npm-valid");
const authorization = { tenantId: "tenant:one", projectId: "project:one" };
const workloadBinding = "workload:github:owner/repository";
const instant = new Date("2026-08-10T22:00:02.000Z");

function request(binding = workloadBinding) {
  return {
    schemaVersion: 1,
    command: "dispatchVerification",
    invocationId: "invocation:dispatch-one",
    arguments: {
      workloadBinding: binding,
      verifyRequest: {
        schemaVersion: 1,
        command: "verify",
        invocationId: "invocation:verify-one",
        arguments: { noCache: true },
        configurationReferences: [],
        policyReferences: [],
        consentGrantReferences: [],
        offline: true,
        outputMode: "json",
        environment: {
          platform: "github-action",
          allowlistedBindings: ["workspace:checkout"],
        },
        workspace: { rootBinding: "workspace:checkout" },
      },
      idempotencyKey: "idempotency:dispatch-one",
    },
    configurationReferences: [],
    policyReferences: [],
    consentGrantReferences: [],
    offline: false,
    outputMode: "json",
    environment: {
      platform: "control-api",
      allowlistedBindings: [binding],
    },
  };
}

function projection(claim) {
  return {
    schemaVersion: 1,
    kind: "publishedVerification",
    purpose: "verification.metadata",
    tenantId: claim.tenantId,
    projectId: claim.projectId,
    runId: claim.request.arguments.verifyRequest.invocationId,
    idempotencyKey: claim.request.arguments.idempotencyKey,
    applicationModel: {
      objectType: "applicationModel",
      publicationId: `pub_v1_${"A".repeat(43)}`,
      tenantBinding: claim.tenantId,
    },
    operationalStatus: "completed",
    outcome: "satisfied",
    engine: {
      id: "verify-engine",
      version: "1.0.0",
      artifactDigest: `sha256:${"a".repeat(64)}`,
    },
    protocolVersion: 1,
    plugins: [],
    promises: [],
    proofs: [],
    evidence: [],
    summary: { promiseCount: 0, proofCount: 0, evidenceCount: 0, durationMs: 1 },
    auditCorrelationId: "audit:customer-workload-one",
    retentionClass: "metadata-30d",
  };
}

function claimed(store, binding = workloadBinding) {
  store.admit(dispatchAdmission(authorization, request(binding), new Date(
    "2026-08-10T22:00:00.000Z",
  )));
  const claim = store.claimOffer(
    binding,
    "runner:one",
    new Date("2026-08-10T22:00:01.000Z"),
    60_000,
  );
  assert.ok(claim);
  return claim;
}

function transport(store, publishProjection) {
  return {
    acceptOffer: (claim, now) => store.acceptOffer(claim, now),
    heartbeat: (claim, now, leaseMs) => store.heartbeat(claim, now, leaseMs),
    observeCancellation: (claim, now) => store.observeCancellation(claim, now),
    acknowledgeCancellation: (claim, acknowledgement, now) => (
      store.acknowledgeCancellation(claim, acknowledgement, now)
    ),
    publishProjection,
    finalize: (claim, completion, now) => store.finalize(claim, completion, now),
  };
}

function environment(runnerTemp, repository = "owner/repository") {
  return {
    GITHUB_WORKSPACE: workspace,
    GITHUB_REPOSITORY: repository,
    RUNNER_TEMP: runnerTemp,
  };
}

test("customer-owned runner executes offline and publishes only allowlisted metadata", async () => {
  const runnerTemp = await mkdtemp(join(tmpdir(), "verify-customer-workload-"));
  const store = new InMemoryCustomerWorkloadDispatchStore(() => "runner-success");
  const claim = claimed(store);
  let published;
  let publicationContext;
  try {
    const result = await runCustomerWorkloadOffer({
      claim,
      environment: environment(runnerTemp),
      signal: new AbortController().signal,
      now: () => instant,
      heartbeatIntervalMs: 100,
      leaseMs: 60_000,
      projectionBuilder: {
        build(envelope, receivedClaim) {
          assert.equal(envelope.invocationId, "invocation:verify-one");
          return projection(receivedClaim);
        },
      },
      transport: transport(store, async (receivedContext, payload) => {
        publicationContext = structuredClone(receivedContext);
        published = structuredClone(payload);
        return { publishedRunId: "published-run:one" };
      }),
    });

    assert.equal(result.state, "completed");
    assert.equal(result.dispatch.state, "completed");
    assert.equal(result.dispatch.verifyInvocationId, "invocation:verify-one");
    assert.equal(result.dispatch.publishedRunId, "published-run:one");
    assert.equal(Object.hasOwn(result.dispatch, "verifyResult"), false);
    assert.equal(JSON.stringify(published).includes(workspace), false);
    assert.equal(Object.hasOwn(published, "workspace"), false);
    assert.equal(Object.hasOwn(published, "proofExecutions"), false);
    assert.deepEqual(Object.keys(publicationContext).sort(), [
      "attempt",
      "dispatchId",
      "fence",
      "idempotencyKey",
      "projectId",
      "schemaVersion",
      "tenantId",
      "verifyInvocationId",
      "workerId",
      "workloadBinding",
    ]);
    assert.equal(Object.hasOwn(publicationContext, "request"), false);
    assert.equal(Object.hasOwn(publicationContext, "leaseExpiresAt"), false);
  } finally {
    await rm(runnerTemp, { recursive: true, force: true });
  }
});

test("fenced heartbeats continue through a slow publication boundary", async () => {
  const runnerTemp = await mkdtemp(join(tmpdir(), "verify-customer-heartbeat-"));
  const store = new InMemoryCustomerWorkloadDispatchStore(() => "runner-heartbeat");
  const claim = claimed(store);
  let heartbeatCount = 0;
  const base = transport(store, async (context) => {
    assert.equal(Object.hasOwn(context, "leaseExpiresAt"), false);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    return { publishedRunId: "published-run:slow" };
  });
  try {
    const result = await runCustomerWorkloadOffer({
      claim,
      environment: environment(runnerTemp),
      signal: new AbortController().signal,
      now: () => instant,
      heartbeatIntervalMs: 100,
      leaseMs: 60_000,
      projectionBuilder: { build: (_envelope, receivedClaim) => projection(receivedClaim) },
      transport: {
        ...base,
        heartbeat(receivedClaim, now, leaseMs) {
          heartbeatCount += 1;
          return store.heartbeat(receivedClaim, now, leaseMs);
        },
      },
    });
    assert.equal(result.state, "completed");
    assert.ok(heartbeatCount >= 2);
  } finally {
    await rm(runnerTemp, { recursive: true, force: true });
  }
});

test("runner rejects repository-confused offers before accepting or publishing", async () => {
  const store = new InMemoryCustomerWorkloadDispatchStore(() => "runner-confused");
  const claim = claimed(store);
  let called = false;
  await assert.rejects(runCustomerWorkloadOffer({
    claim,
    environment: environment(workspace, "other/repository"),
    signal: new AbortController().signal,
    now: () => instant,
    heartbeatIntervalMs: 100,
    projectionBuilder: { build: () => projection(claim) },
    transport: transport(store, async () => {
      called = true;
      return { publishedRunId: "published-run:forbidden" };
    }),
  }), /VFY_CUSTOMER_WORKLOAD_REQUEST_UNSUPPORTED/);
  assert.equal(called, false);
  assert.equal(store.resolve(authorization, claim.dispatchId).state, "offered");
});

test("forwarded cancellation aborts execution and reaches a terminal workload acknowledgement", async () => {
  const store = new InMemoryCustomerWorkloadDispatchStore(() => "runner-cancelled");
  const claim = claimed(store);
  let cancellationRequested = false;
  let published = false;
  const fakeDispatcher = {
    verify(_request, signal) {
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    },
    close() {},
  };
  const base = transport(store, async () => {
    published = true;
    return { publishedRunId: "published-run:forbidden" };
  });
  const result = await runCustomerWorkloadOffer({
    claim,
    environment: environment(workspace),
    signal: new AbortController().signal,
    dispatcher: fakeDispatcher,
    now: () => instant,
    heartbeatIntervalMs: 100,
    leaseMs: 60_000,
    projectionBuilder: { build: () => projection(claim) },
    transport: {
      ...base,
      heartbeat(receivedClaim, now, leaseMs) {
        if (!cancellationRequested) {
          cancellationRequested = true;
          store.requestCancellation(
            authorization,
            receivedClaim.dispatchId,
            "cancellation:one",
            now,
          );
        }
        return store.heartbeat(receivedClaim, now, leaseMs);
      },
    },
  });

  assert.deepEqual(result, { state: "cancelled", dispatchId: claim.dispatchId });
  assert.equal(published, false);
  const record = store.resolve(authorization, claim.dispatchId);
  assert.equal(record.state, "cancelled");
  assert.equal(record.cancellation.gatewayAcknowledgement, "forwarded");
  assert.equal(record.cancellation.workloadAcknowledgement, "terminal");
});

test("invalid or tenant-confused projections never reach publication", async () => {
  const runnerTemp = await mkdtemp(join(tmpdir(), "verify-customer-projection-"));
  const store = new InMemoryCustomerWorkloadDispatchStore(() => "runner-projection");
  const claim = claimed(store);
  let published = false;
  try {
    await assert.rejects(runCustomerWorkloadOffer({
      claim,
      environment: environment(runnerTemp),
      signal: new AbortController().signal,
      now: () => instant,
      heartbeatIntervalMs: 100,
      projectionBuilder: {
        build: () => ({ ...projection(claim), tenantId: "tenant:other" }),
      },
      transport: transport(store, async () => {
        published = true;
        return { publishedRunId: "published-run:forbidden" };
      }),
    }), /VFY_CLOUD_PAYLOAD_MALFORMED|VFY_CUSTOMER_WORKLOAD_PROJECTION_INVALID/);
    assert.equal(published, false);
  } finally {
    await rm(runnerTemp, { recursive: true, force: true });
  }
});
