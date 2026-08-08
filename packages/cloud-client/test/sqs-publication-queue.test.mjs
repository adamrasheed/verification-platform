import assert from "node:assert/strict";
import test from "node:test";
import {
  PublicationSqsRelay,
  PublicationSqsWorker,
  decodePublicationQueueReference,
  encodePublicationQueueReference,
  publicationQueueReference,
} from "../dist/public/index.js";

const acceptedEvent = {
  schemaVersion: 1,
  eventId: "outbox:event-one",
  eventType: "PublishedRunAccepted",
  tenantId: "tenant:one",
  aggregateType: "publishedRun",
  aggregateId: "pub_v1_run-one",
  occurredAt: "2026-08-08T12:00:00.000Z",
  payload: {
    publishedRunId: "pub_v1_run-one",
    payloadDigest: `sha256:${"a".repeat(64)}`,
  },
};

function queueReferenceBody(event = acceptedEvent) {
  return encodePublicationQueueReference(publicationQueueReference(event));
}

class FakeTransport {
  messages = [];
  sent = [];
  acknowledged = [];
  deferred = [];
  failSend = false;

  async sendReferenceBody(body) {
    this.sent.push(body);
    if (this.failSend) throw new Error("SECRET_CANARY_transport_failure");
  }

  async receiveOne() {
    return this.messages.shift();
  }

  async acknowledge(receiptHandle) {
    this.acknowledged.push(receiptHandle);
  }

  async defer(receiptHandle, visibilityTimeoutSeconds) {
    this.deferred.push({ receiptHandle, visibilityTimeoutSeconds });
  }
}

test("SQS references are canonical, exact, and omit protected event payload fields", () => {
  const body = queueReferenceBody();
  assert.deepEqual(decodePublicationQueueReference(body), {
    schemaVersion: 1,
    kind: "publicationOutboxReference",
    tenantId: "tenant:one",
    eventId: "outbox:event-one",
    eventType: "PublishedRunAccepted",
    aggregateType: "publishedRun",
    aggregateId: "pub_v1_run-one",
  });
  assert.equal(body.includes("payloadDigest"), false);
  assert.equal(body.includes("sha256:"), false);
  assert.equal(body.includes("occurredAt"), false);
  assert.throws(
    () => decodePublicationQueueReference(body.replace("{", "{\"extra\":true,")),
    /VFY_PUBLICATION_QUEUE_REFERENCE_INVALID/,
  );
  assert.throws(
    () => decodePublicationQueueReference(`{ "schemaVersion": 1, "kind": "publicationOutboxReference" }`),
    /VFY_PUBLICATION_QUEUE_REFERENCE_INVALID/,
  );
});

test("the relay publishes one minimal reference and acknowledges only a successful send", async () => {
  let attempt = 0;
  const acknowledgements = [];
  const failures = [];
  const store = {
    claimOutbox(workerId, now, leaseMs) {
      attempt += 1;
      if (attempt > 2) return undefined;
      return {
        event: acceptedEvent,
        workerId,
        fence: attempt,
        attempt,
        leaseExpiresAt: new Date(now.getTime() + leaseMs).toISOString(),
      };
    },
    acknowledgeOutbox(claim) {
      acknowledgements.push(claim.event.eventId);
    },
    failOutbox(claim, failureCode) {
      failures.push({ eventId: claim.event.eventId, failureCode });
    },
  };
  const transport = new FakeTransport();
  transport.failSend = true;
  const relay = new PublicationSqsRelay(
    store,
    transport,
    () => new Date("2026-08-08T12:00:00.000Z"),
  );
  assert.equal(await relay.relayOne("worker:relay", 10_000), "retry");
  assert.deepEqual(acknowledgements, []);
  assert.deepEqual(failures, [{ eventId: "outbox:event-one", failureCode: "DELIVERY_FAILED" }]);

  transport.failSend = false;
  assert.equal(await relay.relayOne("worker:relay", 10_000), "delivered");
  assert.deepEqual(acknowledgements, ["outbox:event-one"]);
  assert.equal(transport.sent.length, 2);
  assert.equal(new Set(transport.sent).size, 1, "retry preserves one stable reference identity");
});

test("the worker handles duplicates idempotently and deletes only completed deliveries", async () => {
  const transport = new FakeTransport();
  transport.messages.push({
    messageId: "message:one",
    receiptHandle: "receipt:one",
    body: queueReferenceBody(),
    receiveCount: 2,
  });
  const observed = [];
  const worker = new PublicationSqsWorker(transport, (reference) => {
    observed.push(reference);
    return "duplicate";
  });
  assert.equal(await worker.processOne(), "duplicate");
  assert.equal(observed.length, 1);
  assert.deepEqual(transport.acknowledged, ["receipt:one"]);
  assert.deepEqual(transport.deferred, []);
  assert.equal(await worker.processOne(), "idle");
});

test("worker failures use bounded backoff and terminal poison messages remain sanitized for redrive", async () => {
  const transport = new FakeTransport();
  transport.messages.push(
    {
      messageId: "message:retry",
      receiptHandle: "receipt:retry",
      body: queueReferenceBody(),
      receiveCount: 3,
    },
    {
      messageId: "message:terminal",
      receiptHandle: "receipt:terminal",
      body: queueReferenceBody(),
      receiveCount: 5,
    },
  );
  const worker = new PublicationSqsWorker(
    transport,
    () => {
      throw new Error("SECRET_CANARY_DO_NOT_PERSIST");
    },
    {
      baseRetrySeconds: 2,
      maximumRetrySeconds: 30,
      maximumReceiveCount: 5,
      jitter: () => 0.5,
    },
  );
  assert.equal(await worker.processOne(), "retry");
  assert.deepEqual(transport.deferred, [{
    receiptHandle: "receipt:retry",
    visibilityTimeoutSeconds: 6,
  }]);
  assert.equal(await worker.processOne(), "retry");
  assert.equal(transport.deferred.length, 1, "terminal attempt is left for source-bound DLQ redrive");
  assert.deepEqual(transport.acknowledged, []);
  assert.equal(JSON.stringify(transport).includes("SECRET_CANARY"), false);
  assert.equal(queueReferenceBody().includes("payloadDigest"), false);
});
