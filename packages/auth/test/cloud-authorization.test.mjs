import assert from "node:assert/strict";
import test from "node:test";
import {
  CLOUD_ACTION_CATALOG,
  authorizeCloudAction,
} from "../dist/public/index.js";

const now = new Date("2026-07-22T21:00:00Z");

function principal(overrides = {}) {
  return {
    kind: "user",
    id: "principal:one",
    authenticated: true,
    audience: "verify-cloud-api",
    issuedAt: "2026-07-22T20:00:00Z",
    expiresAt: "2026-07-22T22:00:00Z",
    revoked: false,
    ...overrides,
  };
}

function entryFor(action) {
  const entry = CLOUD_ACTION_CATALOG.find((candidate) => candidate.action === action);
  assert.ok(entry, `missing action ${action}`);
  return entry;
}

function requestFor(entry, overrides = {}) {
  return {
    action: entry.action,
    resource: {
      tenantId: "tenant:one",
      resourceType: entry.resourceType,
      resourceId: `${entry.resourceType}:one`,
      ...overrides,
    },
  };
}

function grantFor(request, overrides = {}) {
  return {
    grantId: `grant:${request.action}`,
    principalId: "principal:one",
    action: request.action,
    resource: structuredClone(request.resource),
    policyRevision: "policy-revision:one",
    expiresAt: "2026-07-22T22:00:00Z",
    revoked: false,
    ...overrides,
  };
}

test("every cloud action requires one exact server-expanded resource grant", () => {
  assert.equal(CLOUD_ACTION_CATALOG.length, 10);
  for (const entry of CLOUD_ACTION_CATALOG) {
    const request = requestFor(entry);
    assert.deepEqual(
      authorizeCloudAction(
        principal(),
        request,
        [grantFor(request)],
        "verify-cloud-api",
        now,
      ),
      {
        allowed: true,
        grantId: `grant:${request.action}`,
        policyRevision: "policy-revision:one",
      },
      entry.action,
    );
  }
});

test("the cross-tenant and IDOR matrix is indistinguishable and deny-default", () => {
  for (const entry of CLOUD_ACTION_CATALOG) {
    const request = requestFor(entry);
    const exactGrant = grantFor(request);
    for (const grants of [
      [],
      [grantFor(request, { resource: { ...request.resource, tenantId: "tenant:other" } })],
      [grantFor(request, { resource: { ...request.resource, resourceId: "resource:other" } })],
      [grantFor(request, { principalId: "principal:other" })],
      [{ ...exactGrant, revoked: true }],
      [{ ...exactGrant, expiresAt: "2026-07-22T20:59:59Z" }],
    ]) {
      assert.deepEqual(
        authorizeCloudAction(principal(), request, grants, "verify-cloud-api", now),
        { allowed: false, reasonCode: "NOT_AUTHORIZED" },
        entry.action,
      );
    }
  }
});

test("authentication, audience, validity, and revocation fail before resource lookup", () => {
  const request = requestFor(CLOUD_ACTION_CATALOG[0]);
  const grant = grantFor(request);
  for (const [mutation, reasonCode] of [
    [{ authenticated: false }, "UNAUTHENTICATED"],
    [{ audience: "another-service" }, "INVALID_AUDIENCE"],
    [{ issuedAt: "2026-07-22T21:00:01Z" }, "TOKEN_EXPIRED"],
    [{ expiresAt: "2026-07-22T21:00:00Z" }, "TOKEN_EXPIRED"],
    [{ revoked: true }, "TOKEN_REVOKED"],
  ]) {
    assert.deepEqual(
      authorizeCloudAction(
        principal(mutation),
        request,
        [grant],
        "verify-cloud-api",
        now,
      ),
      { allowed: false, reasonCode },
    );
  }
});

test("workload and operator principals receive no implicit tenant authority", () => {
  const request = requestFor(entryFor("dispatch:create"));
  for (const kind of ["workload", "operator"]) {
    assert.deepEqual(
      authorizeCloudAction(
        principal({ kind }),
        request,
        [],
        "verify-cloud-api",
        now,
      ),
      { allowed: false, reasonCode: "NOT_AUTHORIZED" },
    );
  }
});

test("an action bound to the wrong resource type is an invalid request", () => {
  const request = requestFor(entryFor("run:readPublished"), { resourceType: "project" });
  assert.deepEqual(
    authorizeCloudAction(
      principal(),
      request,
      [grantFor(request)],
      "verify-cloud-api",
      now,
    ),
    { allowed: false, reasonCode: "INVALID_REQUEST" },
  );
});
