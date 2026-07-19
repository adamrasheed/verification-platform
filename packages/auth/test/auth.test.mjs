import assert from "node:assert/strict";
import test from "node:test";
import {
  authorize,
  authorizePluginOperation,
  passiveCliPolicy,
  repairApplyCliPolicy,
} from "../dist/public/index.js";

const principal = { kind: "local-user", id: "uid:1000", authenticated: true };

test("authorization is deny-default", () => {
  const decision = authorize(principal, {
    operation: "verify",
    workspaceRoot: "/workspace",
    permissions: ["workspace.read"],
  }, undefined);
  assert.equal(decision.allowed, false);
  assert.equal(decision.reasonCode, "NO_EXTERNAL_GRANT");
});

test("CLI boundary grants only passive local permissions", () => {
  const policy = passiveCliPolicy(principal, "/workspace");
  const passive = authorize(principal, {
    operation: "verify",
    workspaceRoot: "/workspace/repository",
    permissions: ["workspace.read"],
  }, policy);
  const active = authorize(principal, {
    operation: "execute",
    workspaceRoot: "/workspace/repository",
    permissions: ["subprocess", "network", "workspace.write", "secret.read"],
  }, policy);
  assert.equal(passive.allowed, true);
  assert.equal(active.allowed, false);
  assert.deepEqual(active.granted, []);
});

test("workspace files cannot expand the bound root", () => {
  const decision = authorize(principal, {
    operation: "verify",
    workspaceRoot: "/outside",
    permissions: ["workspace.read"],
  }, passiveCliPolicy(principal, "/workspace"));
  assert.equal(decision.allowed, false);
  assert.equal(decision.reasonCode, "WORKSPACE_OUT_OF_SCOPE");
});

test("Repair write authority is separate and scoped to one workspace", () => {
  const policy = repairApplyCliPolicy(principal, "/workspace");
  assert.equal(authorize(principal, {
    operation: "applyRepair",
    workspaceRoot: "/workspace",
    permissions: ["workspace.write"],
  }, policy).allowed, true);
  assert.equal(authorize(principal, {
    operation: "applyRepair",
    workspaceRoot: "/outside",
    permissions: ["workspace.write"],
  }, policy).allowed, false);
  assert.equal(authorize(principal, {
    operation: "applyRepair",
    workspaceRoot: "/workspace",
    permissions: ["network"],
  }, policy).allowed, false);
});

test("plugin authority binds exact identity, destinations, secrets, effects, tier, and expiry", () => {
  const principal = { kind: "local-user", id: "local:1", authenticated: true };
  const request = {
    pluginId: "synthetic-brokered",
    operationId: "operation:1",
    destinationIds: ["api"],
    secretReferenceIds: ["secret:provider"],
    filesystemReadRoots: ["/workspace"],
    filesystemWriteRoots: [],
    subprocess: false,
    sideEffects: [],
    enforcementTier: "native-sandbox-v1",
    maximumMemoryBytes: 256 * 1024 * 1024,
    maximumCpuNanoseconds: 30_000_000_000,
    maximumPluginProcesses: 1,
    expiresAt: "2026-07-19T01:00:00Z",
  };
  const policy = {
    principalId: "local:1",
    pluginIds: ["synthetic-brokered"],
    destinationIds: ["api"],
    secretReferenceIds: ["secret:provider"],
    filesystemReadRoots: ["/workspace"],
    allowFilesystemWrite: false,
    allowSubprocess: false,
    allowedSideEffects: [],
    enforcementTiers: ["native-sandbox-v1"],
    maximumMemoryBytes: 256 * 1024 * 1024,
    maximumCpuNanoseconds: 30_000_000_000,
    maximumPluginProcesses: 1,
    maximumExpiresAt: "2026-07-19T02:00:00Z",
  };
  const decision = authorizePluginOperation(
    principal,
    request,
    policy,
    "authorization:1",
    new Date("2026-07-19T00:00:00Z"),
  );
  assert.equal(decision.allowed, true);
  assert.equal(decision.authorizationId, "authorization:1");
  assert.equal(
    authorizePluginOperation(
      principal,
      { ...request, destinationIds: ["telemetry"] },
      policy,
      "authorization:2",
      new Date("2026-07-19T00:00:00Z"),
    ).reasonCode,
    "DESTINATION_DENIED",
  );
  assert.equal(
    authorizePluginOperation(
      principal,
      { ...request, enforcementTier: "conformance-process-v1" },
      policy,
      "authorization:3",
      new Date("2026-07-19T00:00:00Z"),
    ).reasonCode,
    "ENFORCEMENT_TIER_DENIED",
  );
  assert.equal(
    authorizePluginOperation(
      principal,
      { ...request, maximumMemoryBytes: 512 * 1024 * 1024 },
      policy,
      "authorization:4",
      new Date("2026-07-19T00:00:00Z"),
    ).reasonCode,
    "RESOURCE_LIMIT_DENIED",
  );
});
