import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  GITHUB_REPOSITORY_POLICY_DESTINATIONS,
  assertGitHubRepositoryPolicyContribution,
  createGitHubRepositoryPolicyPayloadValidator,
} from "../dist/public/index.js";
import {
  defaultResponses,
  packageRoot,
  providerHarness,
  providerInvocation,
  runProviderConformance,
  signedProviderManifest,
} from "./helpers.mjs";

test("manifest permits only the three read-only broker destinations", async () => {
  const manifest = await signedProviderManifest();
  assert.deepEqual(manifest.operations, ["observeProvider"]);
  assert.deepEqual(manifest.sideEffects, []);
  assert.deepEqual(manifest.permissions.filesystemReadRoots, []);
  assert.deepEqual(manifest.permissions.filesystemWriteRoots, []);
  assert.equal(manifest.permissions.subprocess, false);
  assert.equal(GITHUB_REPOSITORY_POLICY_DESTINATIONS.length, 3);
  for (const destination of GITHUB_REPOSITORY_POLICY_DESTINATIONS) {
    assert.equal(destination.host, "api.github.com");
    assert.deepEqual(destination.methods, ["GET"]);
    assert.deepEqual(destination.outboundClassifications, ["MINIMAL_METADATA"]);
  }
  const artifact = await readFile(path.join(packageRoot, "dist", "plugin.js"), "utf8");
  assert.equal(artifact.includes("pulls"), false);
  assert.equal(artifact.includes("POST"), false);
  assert.equal(artifact.includes("PATCH"), false);
  assert.equal(artifact.includes("DELETE"), false);
  assert.equal(artifact.includes("https://"), false);
});

test("Engine payload validator owns binding expansion, API version, and branch encoding", () => {
  const validator = createGitHubRepositoryPolicyPayloadValidator({
    resolveRepositoryBinding(binding) {
      return binding === "opaque:repository:1"
        ? { owner: "creatix", repository: "verification-platform" }
        : undefined;
    },
  });
  const outbound = validator.validateOutbound(
    "github-branch-protection",
    "github-branch-protection",
    "github.repository-policy.request.v1",
    "MINIMAL_METADATA",
    { branch: "release/v1" },
    { repositoryBinding: "opaque:repository:1" },
  );
  assert.equal(
    outbound.path,
    "/repos/creatix/verification-platform/branches/release%2Fv1/protection",
  );
  assert.equal(outbound.body, undefined);
  assert.equal(outbound.headers["x-github-api-version"], "2026-03-10");
  for (const candidate of [
    { branch: "../main" },
    { branch: "main", smuggled: "source" },
  ]) {
    assert.throws(() => validator.validateOutbound(
      "github-branch-protection",
      "github-branch-protection",
      "github.repository-policy.request.v1",
      "MINIMAL_METADATA",
      candidate,
      { repositoryBinding: "opaque:repository:1" },
    ));
  }
  assert.throws(() => validator.validateOutbound(
    "github-telemetry",
    "github-telemetry",
    "github.repository-policy.request.v1",
    "MINIMAL_METADATA",
    {},
    { repositoryBinding: "opaque:repository:1" },
  ));
  assert.throws(() => validator.validateOutbound(
    "github-repository-metadata",
    "github-repository-metadata",
    "github.repository-policy.request.v1",
    "MINIMAL_METADATA",
    {},
    { repositoryBinding: "opaque:unknown" },
  ));
});

test("raw GitHub responses are reduced to the strict contribution schema", async () => {
  const { result } = await runProviderConformance();
  assertGitHubRepositoryPolicyContribution(result.contributions[0]);
  const serialized = JSON.stringify(result.contributions[0]);
  assert.equal(serialized.includes("full_name"), false);
  assert.equal(serialized.includes("url"), false);
  assert.equal(serialized.includes("ruleset_source"), false);
  assert.equal(serialized.includes("commit_message_pattern"), false);
});

test("an explicitly unprotected default branch is a valid observation", async () => {
  const responses = await defaultResponses();
  responses.set(
    "/repos/creatix/verification-platform/branches/release%2Fv1/protection",
    { status: 404, body: { message: "Branch not protected" } },
  );
  const manifest = await signedProviderManifest();
  const harness = await providerHarness({ responses });
  const result = await harness.runtime.invoke(providerInvocation(manifest, harness.sandbox));
  assert.equal(result.contributions[0].branchProtection.enabled, false);
  assert.equal(result.contributions[0].branchProtection.requiredStatusChecks.length, 0);
});

test("provider authentication, permission, absence, throttling, and outage stay typed", async () => {
  const cases = [
    [401, { message: "Bad credentials" }, "VFY_PROVIDER_AUTHENTICATION_FAILED", "policy_required"],
    [403, { message: "Resource not accessible by token" }, "VFY_PROVIDER_PERMISSION_DENIED", "policy_required"],
    [403, { message: "API rate limit exceeded" }, "VFY_PROVIDER_RATE_LIMITED", "safe"],
    [404, { message: "Not Found" }, "VFY_PROVIDER_NOT_FOUND", "never"],
    [429, { message: "Too many requests" }, "VFY_PROVIDER_RATE_LIMITED", "safe"],
    [503, { message: "Service unavailable" }, "VFY_PROVIDER_UNAVAILABLE", "safe"],
  ];
  for (const [status, body, expectedCode, expectedRetryability] of cases) {
    const responses = await defaultResponses();
    responses.set("/repos/creatix/verification-platform", { status, body });
    const manifest = await signedProviderManifest();
    const harness = await providerHarness({ responses });
    await assert.rejects(
      harness.runtime.invoke(providerInvocation(manifest, harness.sandbox)),
      (error) => error.code === expectedCode && error.retryability === expectedRetryability,
      String(status),
    );
  }
});

test("malformed responses, credential canaries, and cancellation fail closed", async () => {
  const malformedResponses = await defaultResponses();
  malformedResponses.set(
    "/repos/creatix/verification-platform",
    { status: 200, body: { default_branch: 42 } },
  );
  const manifest = await signedProviderManifest();
  const malformed = await providerHarness({ responses: malformedResponses });
  await assert.rejects(
    malformed.runtime.invoke(providerInvocation(manifest, malformed.sandbox)),
    (error) => error.code === "VFY_PROVIDER_RESPONSE_INVALID",
  );

  const secretValue = "CANARY_GITHUB_PROVIDER_SECRET";
  const leakedResponses = await defaultResponses();
  leakedResponses.set(
    "/repos/creatix/verification-platform",
    { status: 200, body: { default_branch: secretValue } },
  );
  const leaked = await providerHarness({ responses: leakedResponses, secretValue });
  await assert.rejects(
    leaked.runtime.invoke(providerInvocation(manifest, leaked.sandbox)),
    (error) => error.code === "VFY_PROVIDER_SECRET_LEAK",
  );
  assert.equal(JSON.stringify(leaked.audits).includes(secretValue), false);

  const controller = new AbortController();
  const delayed = await providerHarness({ responseDelayMs: 500 });
  const pending = delayed.runtime.invoke(providerInvocation(manifest, delayed.sandbox, {
    deadlineMs: 5000,
    signal: controller.signal,
  }));
  setTimeout(() => controller.abort(), 25);
  await assert.rejects(pending, (error) => error.code === "VFY_PLUGIN_CANCELLED");
});

test("contribution validator rejects provider additions and malformed policy", () => {
  assert.throws(() => assertGitHubRepositoryPolicyContribution({
    kind: "provider.repository-policy",
    schemaVersion: 1,
    repositoryBinding: "opaque:repository:1",
    defaultBranch: "main",
    branchProtection: {},
    effectiveRules: [],
    providerOpinion: "secure",
  }));
});
