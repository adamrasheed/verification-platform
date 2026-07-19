import assert from "node:assert/strict";
import test from "node:test";
import {
  authorize,
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
