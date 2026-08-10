import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import {
  InMemoryCustomerWorkloadDispatchStore,
  PostgresCustomerWorkloadDispatchStore,
  assertCustomerWorkloadDispatchRequest,
  customerWorkloadDispatchDigest,
  dispatchAdmission,
} from "../dist/public/index.js";

function request(overrides = {}) {
  const verifyRequest = {
    schemaVersion: 1,
    command: "verify",
    invocationId: "invocation:verify-one",
    arguments: {},
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
  };
  return {
    schemaVersion: 1,
    command: "dispatchVerification",
    invocationId: "invocation:dispatch-one",
    arguments: {
      workloadBinding: "workload:github:owner/repository",
      verifyRequest,
      idempotencyKey: "idempotency:dispatch-one",
    },
    configurationReferences: [],
    policyReferences: [],
    consentGrantReferences: [],
    offline: false,
    outputMode: "json",
    environment: {
      platform: "control-api",
      allowlistedBindings: ["workload:github:owner/repository"],
    },
    ...overrides,
  };
}

const authorization = { tenantId: "tenant:one", projectId: "project:one" };
const at = (seconds) => new Date(`2026-08-10T22:00:${String(seconds).padStart(2, "0")}.000Z`);

test("dispatch admission requires an offline nested verify and exact workload bindings", () => {
  assert.doesNotThrow(() => assertCustomerWorkloadDispatchRequest(request()));
  const online = request();
  online.arguments.verifyRequest.offline = false;
  assert.throws(
    () => assertCustomerWorkloadDispatchRequest(online),
    /VFY_DISPATCH_REQUEST_INVALID/,
  );
  const confusedWorkspace = request();
  confusedWorkspace.arguments.verifyRequest.environment.allowlistedBindings = [];
  assert.throws(
    () => assertCustomerWorkloadDispatchRequest(confusedWorkspace),
    /VFY_DISPATCH_REQUEST_INVALID/,
  );
  const confusedWorkload = request();
  confusedWorkload.environment.allowlistedBindings = ["workload:other"];
  assert.throws(
    () => assertCustomerWorkloadDispatchRequest(confusedWorkload),
    /VFY_DISPATCH_REQUEST_INVALID/,
  );
});

test("admission is tenant-idempotent and changed bytes fail without a second dispatch", () => {
  const store = new InMemoryCustomerWorkloadDispatchStore(() => "fixed-dispatch");
  const admission = dispatchAdmission(authorization, request(), at(0));
  const first = store.admit(admission);
  const retry = store.admit(structuredClone(admission));
  assert.deepEqual(retry, first);
  assert.equal(store.size, 1);
  assert.equal(first.result.state, "accepted");
  assert.equal(first.result.dispatchId, "dispatch_v1_fixed-dispatch");

  const changed = request();
  changed.arguments.verifyRequest.invocationId = "invocation:changed";
  assert.throws(
    () => store.admit(dispatchAdmission(authorization, changed, at(1))),
    /VFY_DISPATCH_IDEMPOTENCY_CONFLICT/,
  );
  assert.throws(
    () => store.admit(dispatchAdmission(
      { tenantId: "tenant:one", projectId: "project:other" },
      request(),
      at(1),
    )),
    /key is bound to another project/,
  );
  assert.equal(store.size, 1);
});

test("tenant/project reads and workload claims are exactly bound", () => {
  const store = new InMemoryCustomerWorkloadDispatchStore(() => "scope-dispatch");
  const receipt = store.admit(dispatchAdmission(authorization, request(), at(0)));
  assert.equal(
    store.resolve({ tenantId: "tenant:other", projectId: "project:one" }, receipt.result.dispatchId),
    undefined,
  );
  assert.equal(
    store.resolve({ tenantId: "tenant:one", projectId: "project:other" }, receipt.result.dispatchId),
    undefined,
  );
  assert.equal(store.claimOffer("workload:other", "runner:one", at(1), 10_000), undefined);
  const claim = store.claimOffer(
    "workload:github:owner/repository",
    "runner:one",
    at(1),
    10_000,
  );
  assert.ok(claim);
  assert.equal(claim.tenantId, "tenant:one");
  assert.equal(claim.projectId, "project:one");
  assert.equal(JSON.stringify(claim).includes("SOURCE_CANARY"), false);
});

test("fenced acceptance, heartbeat, and allowlisted completion reject stale workers", () => {
  const store = new InMemoryCustomerWorkloadDispatchStore(() => "fenced-dispatch");
  const receipt = store.admit(dispatchAdmission(authorization, request(), at(0)));
  const stale = store.claimOffer(
    "workload:github:owner/repository",
    "runner:stale",
    at(1),
    5_000,
  );
  assert.ok(stale);
  const current = store.claimOffer(
    "workload:github:owner/repository",
    "runner:current",
    at(7),
    10_000,
  );
  assert.ok(current);
  assert.equal(current.fence, stale.fence + 1);
  assert.throws(() => store.acceptOffer(stale, at(7)), /VFY_DISPATCH_STALE_FENCE/);
  store.acceptOffer(current, at(8));
  const heartbeat = store.heartbeat(current, at(9), 10_000);
  assert.notEqual(heartbeat.leaseExpiresAt, current.leaseExpiresAt);

  const completion = {
    schemaVersion: 1,
    idempotencyKey: "idempotency:dispatch-one",
    verifyInvocationId: "invocation:verify-one",
    publishedRunId: "published-run:allowlisted-one",
    completedAt: at(10).toISOString(),
  };
  const completed = store.finalize(heartbeat, completion, at(11));
  assert.equal(completed.state, "completed");
  assert.equal(completed.publishedRunId, "published-run:allowlisted-one");
  assert.equal(Object.hasOwn(completed, "verifyResult"), false);
  assert.deepEqual(store.finalize(heartbeat, completion, at(12)), completed);
  assert.throws(
    () => store.finalize(heartbeat, { ...completion, publishedRunId: "published-run:changed" }, at(12)),
    /VFY_DISPATCH_COMPLETION_CONFLICT/,
  );
  assert.equal(store.resolve(authorization, receipt.result.dispatchId).state, "completed");
});

test("gateway and workload cancellation acknowledgements remain independently observable", () => {
  const store = new InMemoryCustomerWorkloadDispatchStore(() => "cancel-dispatch");
  const receipt = store.admit(dispatchAdmission(authorization, request(), at(0)));
  const claim = store.claimOffer(
    "workload:github:owner/repository",
    "runner:one",
    at(1),
    20_000,
  );
  assert.ok(claim);
  store.acceptOffer(claim, at(2));
  const requested = store.requestCancellation(
    authorization,
    receipt.result.dispatchId,
    "cancellation:one",
    at(3),
  );
  assert.equal(requested.cancellation.gatewayAcknowledgement, "accepted");
  assert.equal(requested.cancellation.workloadAcknowledgement, "pending");
  const forwarded = store.observeCancellation(claim, at(4));
  assert.equal(forwarded.gatewayAcknowledgement, "forwarded");
  store.acknowledgeCancellation(claim, "accepted", at(5));
  assert.equal(store.resolve(authorization, receipt.result.dispatchId).state, "cancellation_requested");
  store.acknowledgeCancellation(claim, "terminal", at(6));
  const terminal = store.resolve(authorization, receipt.result.dispatchId);
  assert.equal(terminal.state, "cancelled");
  assert.equal(terminal.cancellation.workloadAcknowledgement, "terminal");
  assert.throws(
    () => store.acknowledgeCancellation(claim, "accepted", at(7)),
    /terminal cancellation cannot regress/,
  );
});

test("dispatch digests cover the full canonical request without retaining source", () => {
  const first = request();
  const second = request();
  second.arguments.verifyRequest.policyReferences = ["policy:changed"];
  assert.notEqual(customerWorkloadDispatchDigest(first), customerWorkloadDispatchDigest(second));
  assert.equal(JSON.stringify(dispatchAdmission(authorization, first, at(0))).includes("source"), false);
});

test("PostgreSQL atomically persists dispatch, outbox, fencing, cancellation, and completion", {
  skip: process.env.VERIFY_POSTGRES_URL ? false : "VERIFY_POSTGRES_URL is not configured",
}, async () => {
  const pool = new Pool({ connectionString: process.env.VERIFY_POSTGRES_URL });
  const store = new PostgresCustomerWorkloadDispatchStore(pool);
  try {
    await store.migrate();
    await pool.query(`TRUNCATE TABLE
      workload_dispatch_outbox,
      workload_dispatch_idempotency,
      workload_dispatches
      CASCADE`);
    const admission = dispatchAdmission(authorization, request(), at(0));
    const [first, retry] = await Promise.all([
      store.admit(admission),
      store.admit(structuredClone(admission)),
    ]);
    assert.deepEqual(retry, first);
    await assert.rejects(
      store.admit(dispatchAdmission(
        { tenantId: "tenant:one", projectId: "project:other" },
        request(),
        at(1),
      )),
      /key is bound to another project/,
    );
    const counts = await pool.query(`SELECT
      (SELECT count(*)::int FROM workload_dispatches) AS dispatches,
      (SELECT count(*)::int FROM workload_dispatch_idempotency) AS idempotency,
      (SELECT count(*)::int FROM workload_dispatch_outbox) AS outbox`);
    assert.deepEqual(counts.rows[0], { dispatches: 1, idempotency: 1, outbox: 1 });
    assert.equal(
      await store.resolve({ tenantId: "tenant:other", projectId: "project:one" }, first.result.dispatchId),
      undefined,
    );

    const stale = await store.claimOffer(
      "workload:github:owner/repository",
      "runner:stale",
      at(1),
      5_000,
    );
    assert.ok(stale);
    const current = await store.claimOffer(
      "workload:github:owner/repository",
      "runner:current",
      at(7),
      20_000,
    );
    assert.ok(current);
    await assert.rejects(store.acceptOffer(stale, at(8)), /VFY_DISPATCH_STALE_FENCE/);
    await store.acceptOffer(current, at(8));
    const heartbeat = await store.heartbeat(current, at(9), 20_000);
    const completed = await store.finalize(heartbeat, {
      schemaVersion: 1,
      idempotencyKey: "idempotency:dispatch-one",
      verifyInvocationId: "invocation:verify-one",
      publishedRunId: "published-run:allowlisted-one",
      completedAt: at(10).toISOString(),
    }, at(11));
    assert.equal(completed.state, "completed");
    assert.equal(completed.publishedRunId, "published-run:allowlisted-one");
    const outbox = await pool.query(
      "SELECT status, event::text FROM workload_dispatch_outbox",
    );
    assert.equal(outbox.rows[0].status, "delivered");
    assert.equal(outbox.rows[0].event.includes("verifyRequest"), false);
    assert.equal(outbox.rows[0].event.includes("SOURCE_CANARY"), false);

    const cancellationRequest = request();
    cancellationRequest.arguments.idempotencyKey = "idempotency:cancel-postgres";
    cancellationRequest.invocationId = "invocation:dispatch-cancel-postgres";
    cancellationRequest.arguments.verifyRequest.invocationId = "invocation:verify-cancel-postgres";
    const cancellable = await store.admit(
      dispatchAdmission(authorization, cancellationRequest, at(12)),
    );
    const cancellationClaim = await store.claimOffer(
      "workload:github:owner/repository",
      "runner:cancel",
      at(13),
      20_000,
    );
    await store.acceptOffer(cancellationClaim, at(14));
    await store.requestCancellation(
      authorization,
      cancellable.result.dispatchId,
      "cancellation:postgres",
      at(15),
    );
    assert.equal(
      (await store.observeCancellation(cancellationClaim, at(16))).gatewayAcknowledgement,
      "forwarded",
    );
    await store.acknowledgeCancellation(cancellationClaim, "terminal", at(17));
    const cancelled = await store.resolve(authorization, cancellable.result.dispatchId);
    assert.equal(cancelled.state, "cancelled");
    assert.equal(cancelled.cancellation.workloadAcknowledgement, "terminal");

    const exhaustedRequest = request();
    exhaustedRequest.arguments.idempotencyKey = "idempotency:exhausted-postgres";
    exhaustedRequest.invocationId = "invocation:dispatch-exhausted-postgres";
    exhaustedRequest.arguments.verifyRequest.invocationId = "invocation:verify-exhausted-postgres";
    const exhausted = await store.admit(
      dispatchAdmission(authorization, exhaustedRequest, at(18)),
    );
    await pool.query(
      `UPDATE workload_dispatches
          SET attempt = 5, lease_expires_at = $1
        WHERE tenant_id = $2 AND project_id = $3 AND dispatch_id = $4`,
      [at(18), authorization.tenantId, authorization.projectId, exhausted.result.dispatchId],
    );
    assert.equal(await store.claimOffer(
      "workload:github:owner/repository",
      "runner:exhausted",
      at(19),
      20_000,
    ), undefined);
    const failed = await store.resolve(authorization, exhausted.result.dispatchId);
    assert.equal(failed.state, "failed");
    assert.deepEqual(failed.reasonCodes, ["DISPATCH_ATTEMPTS_EXHAUSTED"]);
    const exhaustedOutbox = await pool.query(
      `SELECT status FROM workload_dispatch_outbox
        WHERE tenant_id = $1 AND project_id = $2 AND dispatch_id = $3`,
      [authorization.tenantId, authorization.projectId, exhausted.result.dispatchId],
    );
    assert.equal(exhaustedOutbox.rows[0].status, "delivered");
  } finally {
    await pool.query(`TRUNCATE TABLE
      workload_dispatch_outbox,
      workload_dispatch_idempotency,
      workload_dispatches
      CASCADE`).catch(() => undefined);
    await pool.end();
  }
});
