import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createControlApiHandler } from "../dist/public/index.js";

const current = new Date("2026-08-10T20:00:00Z");
const principal = {
  kind: "workload",
  id: "principal:workload:one",
  authenticated: true,
  audience: "verify-cloud-api",
  issuedAt: "2026-08-10T19:55:00Z",
  expiresAt: "2026-08-10T20:05:00Z",
  revoked: false,
};

function grant(request, overrides = {}) {
  return {
    grantId: `grant:${request.action}`,
    principalId: principal.id,
    action: request.action,
    resource: structuredClone(request.resource),
    policyRevision: "policy-revision:one",
    expiresAt: "2026-08-10T20:05:00Z",
    revoked: false,
    ...overrides,
  };
}

function fixtures(overrides = {}) {
  const calls = {
    intents: [], publications: [], lists: [], reads: [],
    dispatchAdmissions: [], dispatchReads: [], cancellations: [], grants: [], audit: [],
  };
  const options = {
    expectedAudience: "verify-cloud-api",
    authenticator: {
      authenticate: (token) => token === "valid-token" ? principal : undefined,
    },
    grants: {
      resolve: (_principal, request) => {
        calls.grants.push(structuredClone(request));
        return [grant(request)];
      },
    },
    intents: {
      issue: (input) => {
        calls.intents.push(structuredClone(input));
        return {
          intent: {
            schemaVersion: 1,
            intentId: "intent:one",
            audience: "verify-cloud-publication",
            tenantId: input.authorization.tenantId,
            projectId: input.authorization.projectId,
            purpose: "metadata-publication",
            manifestDigest: input.manifestDigest,
            payloadDigest: `sha256:${"b".repeat(64)}`,
            idempotencyKey: input.idempotencyKey,
            retentionClass: input.retentionClass,
            limits: input.limits,
            policy: { policyId: "policy:one", revisionId: "revision:one" },
            nonce: input.nonce,
            issuedAt: input.now.toISOString(),
            expiresAt: input.expiresAt,
          },
          signature: { algorithm: "Ed25519", keyId: "key:one", value: "A".repeat(86) },
        };
      },
    },
    publications: {
      ingest: (request, authorization, now) => {
        calls.publications.push({ request, authorization, now });
        return {
          schemaVersion: 1,
          intentId: "intent:one",
          publishedRunId: "published-run:one",
          tenantId: authorization.tenantId,
          projectId: authorization.projectId,
          idempotencyKey: request.idempotencyKey,
          payloadDigest: `sha256:${"b".repeat(64)}`,
          acceptedAt: now.toISOString(),
        };
      },
    },
    publishedRuns: {
      listPublishedRuns: (authorization, options) => {
        calls.lists.push({ authorization, options });
        return { schemaVersion: 1, items: [] };
      },
      resolvePublishedRun: (authorization, publishedRunId) => {
        calls.reads.push({ authorization, publishedRunId });
        return {
          state: "deleted_reference",
          publishedAt: "2026-08-01T00:00:00Z",
          publishedRunId,
          tombstone: {
            schemaVersion: 1,
            objectType: "publishedRun",
            opaqueId: publishedRunId,
            deletedAt: "2026-08-02T00:00:00Z",
            authority: "principal:one",
            reasonClass: "tenant-request",
            affectedEdgeIds: [],
          },
        };
      },
    },
    dispatches: {
      admit: (admission) => {
        calls.dispatchAdmissions.push(structuredClone(admission));
        return {
          schemaVersion: 1,
          admittedAt: admission.admittedAt,
          result: {
            kind: "dispatchVerification",
            dispatchId: "dispatch:one",
            state: "accepted",
            workloadBinding: admission.request.arguments.workloadBinding,
            reasonCodes: [],
          },
        };
      },
      resolve: (authorization, dispatchId) => {
        calls.dispatchReads.push({ authorization, dispatchId });
        return dispatchRecord(dispatchId, authorization);
      },
      requestCancellation: (authorization, dispatchId, cancellationId, now) => {
        calls.cancellations.push({ authorization, dispatchId, cancellationId, now });
        return {
          ...dispatchRecord(dispatchId, authorization),
          state: "cancellation_requested",
          updatedAt: now.toISOString(),
          cancellation: {
            cancellationId,
            requestedAt: now.toISOString(),
            gatewayAcknowledgement: "accepted",
            workloadAcknowledgement: "pending",
          },
        };
      },
    },
    audit: { record: (event) => calls.audit.push(structuredClone(event)) },
    now: () => current,
    correlationId: () => "correlation:one",
    ...overrides,
  };
  return { calls, handler: createControlApiHandler(options) };
}

function dispatchRecord(dispatchId, authorization = {
  tenantId: "tenant:one",
  projectId: "project:one",
}) {
  return {
    schemaVersion: 1,
    dispatchId,
    tenantId: authorization.tenantId,
    projectId: authorization.projectId,
    workloadBinding: "workload:github:owner/repository",
    state: "queued",
    admittedAt: current.toISOString(),
    updatedAt: current.toISOString(),
    reasonCodes: [],
  };
}

function dispatchRequest() {
  return {
    schemaVersion: 1,
    command: "dispatchVerification",
    invocationId: "invocation:dispatch-one",
    arguments: {
      workloadBinding: "workload:github:owner/repository",
      idempotencyKey: "idempotency:dispatch-one",
      verifyRequest: {
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
      },
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
  };
}

function jsonRequest(path, method = "GET", body, headers = {}) {
  return new Request(`https://api.verification.invalid${path}`, {
    method,
    headers: {
      authorization: "Bearer valid-token",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const intentBody = {
  schemaVersion: 1,
  manifest: { schemaVersion: 1 },
  manifestDigest: `sha256:${"a".repeat(64)}`,
  retentionClass: "metadata-30d",
  limits: {
    maxEncodedPayloadBytes: 1024,
    maxPromiseCount: 10,
    maxProofCount: 20,
    maxEvidenceCount: 20,
  },
  nonce: "nonce:one",
  expiresAt: "2026-08-10T20:04:00Z",
};

test("the seven closed routes bind exact actions and resources", async () => {
  const { calls, handler } = fixtures();
  const intent = await handler(jsonRequest(
    "/v1/tenants/tenant:one/projects/project:one/publication-intents",
    "POST",
    intentBody,
    { "idempotency-key": "idempotency:intent:one" },
  ));
  assert.equal(intent.status, 201);
  const publication = await handler(jsonRequest(
    "/v1/tenants/tenant:one/projects/project:one/publications",
    "POST",
    {
      schemaVersion: 1,
      signedIntent: await intent.json(),
      manifest: intentBody.manifest,
      manifestDigest: intentBody.manifestDigest,
      payload: { schemaVersion: 1 },
    },
    { "idempotency-key": "idempotency:publication:one" },
  ));
  assert.equal(publication.status, 201);
  assert.equal((await publication.json()).publishedRunId, "published-run:one");
  const list = await handler(jsonRequest(
    "/v1/tenants/tenant:one/projects/project:one/runs?limit=25&cursor=cursor:one",
  ));
  assert.equal(list.status, 200);
  const read = await handler(jsonRequest(
    "/v1/tenants/tenant:one/projects/project:one/runs/published-run:one",
  ));
  assert.equal(read.status, 200);
  const createDispatch = await handler(jsonRequest(
    "/v1/tenants/tenant:one/projects/project:one/dispatches",
    "POST",
    dispatchRequest(),
    { "idempotency-key": "idempotency:dispatch-one" },
  ));
  assert.equal(createDispatch.status, 202);
  assert.equal((await createDispatch.json()).dispatchId, "dispatch:one");
  const getDispatch = await handler(jsonRequest(
    "/v1/tenants/tenant:one/projects/project:one/dispatches/dispatch:one",
  ));
  assert.equal(getDispatch.status, 200);
  const cancelDispatch = await handler(jsonRequest(
    "/v1/tenants/tenant:one/projects/project:one/dispatches/dispatch:one/cancellations",
    "POST",
    { schemaVersion: 1 },
    { "idempotency-key": "cancellation:one" },
  ));
  assert.equal(cancelDispatch.status, 202);
  assert.deepEqual(calls.grants, [
    { action: "run:publish", resource: { tenantId: "tenant:one", resourceType: "project", resourceId: "project:one" } },
    { action: "run:publish", resource: { tenantId: "tenant:one", resourceType: "project", resourceId: "project:one" } },
    { action: "project:read", resource: { tenantId: "tenant:one", resourceType: "project", resourceId: "project:one" } },
    { action: "run:readPublished", resource: { tenantId: "tenant:one", resourceType: "publishedRun", resourceId: "published-run:one" } },
    { action: "dispatch:create", resource: { tenantId: "tenant:one", resourceType: "project", resourceId: "project:one" } },
    { action: "project:read", resource: { tenantId: "tenant:one", resourceType: "project", resourceId: "project:one" } },
    { action: "dispatch:cancel", resource: { tenantId: "tenant:one", resourceType: "dispatch", resourceId: "dispatch:one" } },
  ]);
  assert.equal(calls.intents[0].idempotencyKey, "idempotency:intent:one");
  assert.equal(calls.publications[0].request.idempotencyKey, "idempotency:publication:one");
  assert.deepEqual(calls.lists[0].options, { limit: 25, cursor: "cursor:one" });
  assert.equal(calls.dispatchAdmissions[0].request.arguments.verifyRequest.offline, true);
  assert.equal(calls.dispatchReads[0].dispatchId, "dispatch:one");
  assert.equal(calls.cancellations[0].cancellationId, "cancellation:one");
});

test("dispatch boundaries reject idempotency drift, online work, and missing resources", async () => {
  const { calls, handler } = fixtures();
  const mismatched = await handler(jsonRequest(
    "/v1/tenants/tenant:one/projects/project:one/dispatches",
    "POST",
    dispatchRequest(),
    { "idempotency-key": "idempotency:other" },
  ));
  assert.equal(mismatched.status, 409);
  const online = dispatchRequest();
  online.arguments.verifyRequest.offline = false;
  const rejected = await handler(jsonRequest(
    "/v1/tenants/tenant:one/projects/project:one/dispatches",
    "POST",
    online,
    { "idempotency-key": "idempotency:dispatch-one" },
  ));
  assert.equal(rejected.status, 400);
  for (const additive of [
    { ...dispatchRequest(), sourceCanary: "SOURCE_CANARY" },
    (() => {
      const request = dispatchRequest();
      request.arguments.secretCanary = "SECRET_CANARY";
      return request;
    })(),
    (() => {
      const request = dispatchRequest();
      request.arguments.verifyRequest.environment.sourceCanary = "SOURCE_CANARY";
      return request;
    })(),
  ]) {
    const response = await handler(jsonRequest(
      "/v1/tenants/tenant:one/projects/project:one/dispatches",
      "POST",
      additive,
      { "idempotency-key": "idempotency:dispatch-one" },
    ));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.retryability, "never");
  }
  const malformedCancellation = await handler(jsonRequest(
    "/v1/tenants/tenant:one/projects/project:one/dispatches/dispatch:one/cancellations",
    "POST",
    { schemaVersion: 1, reason: "SOURCE_CANARY" },
    { "idempotency-key": "cancellation:one" },
  ));
  assert.equal(malformedCancellation.status, 400);
  assert.equal(calls.dispatchAdmissions.length, 0);
  assert.equal(JSON.stringify(calls.audit).includes("SOURCE_CANARY"), false);
  assert.equal(JSON.stringify(calls.audit).includes("SECRET_CANARY"), false);

  const missing = fixtures({
    dispatches: {
      admit: () => { throw new Error("not used"); },
      resolve: () => undefined,
      requestCancellation: () => undefined,
    },
  });
  const missingRead = await missing.handler(jsonRequest(
    "/v1/tenants/tenant:one/projects/project:one/dispatches/dispatch:missing",
  ));
  const missingCancellation = await missing.handler(jsonRequest(
    "/v1/tenants/tenant:one/projects/project:one/dispatches/dispatch:missing/cancellations",
    "POST",
    { schemaVersion: 1 },
    { "idempotency-key": "cancellation:missing" },
  ));
  assert.equal(missingRead.status, 404);
  assert.equal(missingCancellation.status, 404);
  assert.equal((await missingRead.json()).error.code, "VFY_CONTROL_API_NOT_AUTHORIZED");
  assert.equal((await missingCancellation.json()).error.code, "VFY_CONTROL_API_NOT_AUTHORIZED");
});

test("unauthenticated, cross-tenant, IDOR, and missing-resource reads reveal no protected existence", async () => {
  const unauthenticated = fixtures();
  const noToken = await unauthenticated.handler(new Request(
    "https://api.verification.invalid/v1/tenants/tenant:one/projects/project:one/runs/published-run:one",
  ));
  assert.equal(noToken.status, 401);

  const denied = fixtures({
    grants: { resolve: () => [] },
  });
  const crossTenant = await denied.handler(jsonRequest(
    "/v1/tenants/tenant:other/projects/project:one/runs/published-run:one",
  ));
  assert.equal(crossTenant.status, 404);

  const missing = fixtures({
    publishedRuns: {
      listPublishedRuns: () => ({ schemaVersion: 1, items: [] }),
      resolvePublishedRun: () => undefined,
    },
  });
  const missingResource = await missing.handler(jsonRequest(
    "/v1/tenants/tenant:one/projects/project:one/runs/published-run:missing",
  ));
  assert.equal(missingResource.status, 404);
  assert.deepEqual(await crossTenant.json(), await missingResource.json());
  assert.equal(denied.calls.reads.length, 0);
});

test("hostile body, header, path, and pagination inputs fail before mutation", async () => {
  const { calls, handler } = fixtures();
  const extra = await handler(jsonRequest(
    "/v1/tenants/tenant:one/projects/project:one/publication-intents",
    "POST",
    { ...intentBody, unexpected: true },
    { "idempotency-key": "idempotency:one" },
  ));
  assert.equal(extra.status, 400);
  const missingKey = await handler(jsonRequest(
    "/v1/tenants/tenant:one/projects/project:one/publication-intents",
    "POST",
    intentBody,
  ));
  assert.equal(missingKey.status, 400);
  const duplicate = await handler(new Request(
    "https://api.verification.invalid/v1/tenants/tenant:one/projects/project:one/publication-intents",
    {
      method: "POST",
      headers: {
        authorization: "Bearer valid-token",
        "content-type": "application/json",
        "idempotency-key": "idempotency:one",
      },
      body: `{"schemaVersion":1,"schemaVersion":1}`,
    },
  ));
  assert.equal(duplicate.status, 400);
  const compressed = await handler(jsonRequest(
    "/v1/tenants/tenant:one/projects/project:one/publication-intents",
    "POST",
    intentBody,
    { "content-encoding": "gzip", "idempotency-key": "idempotency:one" },
  ));
  assert.equal(compressed.status, 400);
  const query = await handler(jsonRequest(
    "/v1/tenants/tenant:one/projects/project:one/runs?tenantId=tenant:other",
  ));
  assert.equal(query.status, 400);
  const escaped = await handler(jsonRequest(
    "/v1/tenants/tenant:one/projects/project:one/runs/published%2Frun",
  ));
  assert.equal(escaped.status, 404);
  assert.equal(calls.intents.length, 0);
});

test("idempotency conflicts are stable and audit never captures bearer or request bodies", async () => {
  const { calls, handler } = fixtures({
    intents: { issue: () => { throw new TypeError("VFY_PUBLICATION_IDEMPOTENCY_CONFLICT"); } },
  });
  const response = await handler(jsonRequest(
    "/v1/tenants/tenant:one/projects/project:one/publication-intents",
    "POST",
    { ...intentBody, nonce: "SECRET_CANARY" },
    { "idempotency-key": "idempotency:conflict" },
  ));
  assert.equal(response.status, 409);
  const serializedAudit = JSON.stringify(calls.audit);
  assert.equal(serializedAudit.includes("valid-token"), false);
  assert.equal(serializedAudit.includes("SECRET_CANARY"), false);
  assert.equal(serializedAudit.includes("idempotency:conflict"), false);
  assert.equal(calls.audit[0].outcome, "allowed");
  assert.equal(calls.audit[1].outcome, "failed");
});

test("OpenAPI declares exactly the implemented routes and closes both mutation schemas", async () => {
  const document = JSON.parse(await readFile(
    new URL("../resources/openapi.json", import.meta.url),
    "utf8",
  ));
  assert.equal(document.openapi, "3.1.1");
  assert.deepEqual(Object.keys(document.paths), [
    "/v1/tenants/{tenantId}/projects/{projectId}/dispatches",
    "/v1/tenants/{tenantId}/projects/{projectId}/dispatches/{dispatchId}",
    "/v1/tenants/{tenantId}/projects/{projectId}/dispatches/{dispatchId}/cancellations",
    "/v1/tenants/{tenantId}/projects/{projectId}/publication-intents",
    "/v1/tenants/{tenantId}/projects/{projectId}/publications",
    "/v1/tenants/{tenantId}/projects/{projectId}/runs",
    "/v1/tenants/{tenantId}/projects/{projectId}/runs/{publishedRunId}",
  ]);
  assert.equal(document.components.schemas.PublicationIntentRequest.additionalProperties, false);
  assert.equal(document.components.schemas.PublicationRequest.additionalProperties, false);
  assert.equal(document.components.schemas.DispatchCancellationRequest.additionalProperties, false);
  assert.equal(document.components.schemas.PublicationIntentRequest.properties.limits.additionalProperties, false);
  assert.deepEqual(document.security, [{ bearerIdentity: [] }]);
  for (const path of [
    document.paths["/v1/tenants/{tenantId}/projects/{projectId}/dispatches"],
    document.paths["/v1/tenants/{tenantId}/projects/{projectId}/dispatches/{dispatchId}/cancellations"],
    document.paths["/v1/tenants/{tenantId}/projects/{projectId}/publication-intents"],
    document.paths["/v1/tenants/{tenantId}/projects/{projectId}/publications"],
  ]) {
    assert.ok(path.post.parameters.some((parameter) => parameter.$ref.endsWith("/IdempotencyKey")));
  }
});
