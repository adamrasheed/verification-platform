import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  manifestSigningBytes,
} from "@verify-internal/plugin-sdk";
import {
  PluginRuntimeError,
  ProviderEgressBroker,
  ProviderPluginRuntime,
} from "@verify-internal/plugin-runtime";
import {
  createConformanceProcessLauncher,
} from "@verify-internal/plugin-runtime/testing";
import {
  GITHUB_REPOSITORY_POLICY_DESTINATION_IDS,
  GITHUB_REPOSITORY_POLICY_PLUGIN_ID,
  assertGitHubRepositoryPolicyContribution,
  createGitHubRepositoryPolicyManifest,
  createGitHubRepositoryPolicyPayloadValidator,
} from "../dist/public/index.js";

export const packageRoot = path.resolve(import.meta.dirname, "..");
const fixtureRoot = path.join(packageRoot, "test", "fixtures");
const keyPair = generateKeyPairSync("ed25519");
const publicKeyPem = keyPair.publicKey.export({ type: "spki", format: "pem" });

async function fixture(name) {
  return JSON.parse(await readFile(path.join(fixtureRoot, name), "utf8"));
}

export async function defaultResponses() {
  return new Map([
    ["/repos/creatix/verification-platform", {
      status: 200,
      body: await fixture("repository.json"),
    }],
    ["/repos/creatix/verification-platform/branches/release%2Fv1/protection", {
      status: 200,
      body: await fixture("branch-protection.json"),
    }],
    ["/repos/creatix/verification-platform/rules/branches/release%2Fv1", {
      status: 200,
      body: await fixture("effective-rules.json"),
    }],
  ]);
}

export async function signedProviderManifest() {
  const entryPoint = "dist/plugin.js";
  const artifact = await readFile(path.join(packageRoot, entryPoint));
  const manifest = createGitHubRepositoryPolicyManifest({
    artifactDigest: `sha256:${createHash("sha256").update(artifact).digest("hex")}`,
    entryPoint,
    platforms: [{ os: process.platform, architecture: process.arch }],
    sourceRevision: "revision:github-policy-conformance",
    buildUrl: "https://github.com/adamrasheed/verification-platform/actions",
    publisherId: "verify.first-party",
    keyId: "key:github-policy-conformance",
    signature: "AA==",
  });
  manifest.signature.value = sign(
    null,
    manifestSigningBytes(manifest),
    keyPair.privateKey,
  ).toString("base64");
  return manifest;
}

async function delay(ms, signal) {
  if (!ms) return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new PluginRuntimeError("VFY_PLUGIN_CANCELLED", "plugin invocation was cancelled"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function providerHarness({
  responses,
  responseDelayMs = 0,
  secretValue = "CANARY_GITHUB_PROVIDER_SECRET",
  sandbox = createConformanceProcessLauncher(),
} = {}) {
  const effectiveResponses = responses ?? await defaultResponses();
  const transports = [];
  const audits = [];
  const broker = new ProviderEgressBroker({
    resolver: {
      async resolve(host) {
        assert.equal(host, "api.github.com");
        return ["140.82.112.6"];
      },
    },
    transport: {
      async send(request) {
        transports.push(request);
        await delay(responseDelayMs, request.signal);
        const pathName = new URL(request.url).pathname;
        const response = effectiveResponses.get(pathName);
        if (!response) throw new Error(`unexpected provider path ${pathName}`);
        return {
          status: response.status,
          contentType: response.contentType ?? "application/json; charset=utf-8",
          body: new TextEncoder().encode(JSON.stringify(response.body)),
        };
      },
    },
    secrets: {
      async resolve(referenceId) {
        return {
          referenceId,
          pluginId: GITHUB_REPOSITORY_POLICY_PLUGIN_ID,
          operationId: "operation:github-policy",
          audience: "github-api",
          scopes: ["repository-metadata:read", "repository-administration:read"],
          expiresAt: "2027-01-01T00:00:00Z",
          headerName: "authorization",
          value: secretValue,
        };
      },
    },
    audit: {
      async append(event) {
        audits.push(event);
      },
    },
    payloads: createGitHubRepositoryPolicyPayloadValidator({
      resolveRepositoryBinding(binding) {
        return binding === "opaque:repository:1"
          ? { owner: "creatix", repository: "verification-platform" }
          : undefined;
      },
    }),
    now: () => new Date("2026-07-22T00:00:00Z"),
  });
  const runtime = new ProviderPluginRuntime({
    engineVersion: "0.2.0",
    publishers: [{
      publisherId: "verify.first-party",
      keyId: "key:github-policy-conformance",
      publicKeyPem,
      notBefore: "2026-01-01T00:00:00Z",
      notAfter: "2027-01-01T00:00:00Z",
    }],
    revocations: { publisherKeyIds: [], artifactDigests: [] },
    sandbox,
    egress: broker,
    now: () => new Date("2026-07-22T00:00:00Z"),
    redactDiagnostic: (value) => value.replaceAll(secretValue, "[REDACTED]"),
    artifactStagingRoot: path.join(packageRoot, ".tmp", "artifact-staging"),
    conformanceMode: true,
  });
  return { runtime, broker, transports, audits, secretValue, sandbox };
}

export function providerInvocation(manifest, sandbox, {
  deadlineMs = 5000,
  signal = new AbortController().signal,
} = {}) {
  const expiresAt = new Date(Date.now() + deadlineMs + 1000).toISOString();
  const destinationIds = [...GITHUB_REPOSITORY_POLICY_DESTINATION_IDS];
  const secretReferenceIds = ["secret:github-policy"];
  const grant = {
    pluginId: GITHUB_REPOSITORY_POLICY_PLUGIN_ID,
    operationId: "operation:github-policy",
    destinationIds,
    secretReferenceIds,
    filesystemReadRoots: [],
    filesystemWriteRoots: [],
    subprocess: false,
    sideEffects: [],
    enforcementTier: sandbox.enforcementTier,
    maximumMemoryBytes: sandbox.resourceLimits.maximumMemoryBytes,
    maximumCpuNanoseconds: sandbox.resourceLimits.maximumCpuNanoseconds,
    maximumPluginProcesses: sandbox.resourceLimits.maximumPluginProcesses,
    expiresAt,
  };
  return {
    manifest,
    pluginRoot: packageRoot,
    operation: {
      operation: "observeProvider",
      operationId: grant.operationId,
      invocationId: "invocation:github-policy",
      attemptId: "attempt:github-policy",
      applicationModelRevision: `sha256:${"1".repeat(64)}`,
      deadline: new Date(Date.now() + deadlineMs).toISOString(),
      cancellationRequestId: "cancellation:github-policy",
      enforcementTier: "caller-value-must-not-win",
      resourceLimits: {
        maximumMemoryBytes: 0,
        maximumCpuNanoseconds: 0,
        maximumPluginProcesses: 0,
      },
      grantedDestinationIds: destinationIds,
      secretReferenceIds,
      input: { repositoryBinding: "opaque:repository:1" },
    },
    authorization: {
      allowed: true,
      authorizationId: "authorization:github-policy",
      principalId: "local:github-policy",
      grant,
    },
    egressGrant: {
      pluginId: grant.pluginId,
      operationId: grant.operationId,
      destinationIds,
      secretReferenceIds,
      explicitShare: false,
    },
    readRoots: [],
    scratchRoot: path.join(packageRoot, ".tmp", "scratch"),
    allowLocalDevelopment: false,
    signal,
  };
}

export async function runProviderConformance(
  sandbox = createConformanceProcessLauncher(),
  deadlineMs = 5000,
) {
  const manifest = await signedProviderManifest();
  const harness = await providerHarness({ sandbox });
  const result = await harness.runtime.invoke(providerInvocation(manifest, sandbox, { deadlineMs }));
  assert.equal(result.trustTier, "verified-publisher");
  assert.equal(result.enforcementTier, sandbox.enforcementTier);
  assert.equal(result.contributions.length, 1);
  assertGitHubRepositoryPolicyContribution(result.contributions[0]);
  assert.deepEqual(result.contributions[0], {
    kind: "provider.repository-policy",
    schemaVersion: 1,
    repositoryBinding: "opaque:repository:1",
    defaultBranch: "release/v1",
    branchProtection: {
      enabled: true,
      enforceAdmins: true,
      requiredLinearHistory: true,
      allowForcePushes: false,
      allowDeletions: false,
      strictStatusChecks: true,
      requiredStatusChecks: [
        { context: "lint" },
        { context: "test", integrationId: 15368 },
      ],
      reviews: {
        dismissStaleReviews: true,
        requireCodeOwnerReviews: true,
        requireLastPushApproval: true,
        requiredApprovingReviewCount: 2,
        requiredReviewThreadResolution: true,
      },
    },
    effectiveRules: [
      {
        type: "pull_request",
        rulesetId: 42,
        sourceType: "Repository",
        reviews: {
          dismissStaleReviews: true,
          requireCodeOwnerReviews: true,
          requireLastPushApproval: false,
          requiredApprovingReviewCount: 1,
          requiredReviewThreadResolution: true,
        },
      },
      {
        type: "required_status_checks",
        rulesetId: 73,
        sourceType: "Organization",
        strictStatusChecks: true,
        requiredStatusChecks: [
          { context: "build" },
          { context: "security", integrationId: 15368 },
        ],
      },
    ],
  });
  assert.equal(harness.transports.length, 3);
  assert.ok(harness.transports.every((request) => request.method === "GET"));
  assert.ok(harness.transports.every((request) => request.body.byteLength === 0));
  assert.ok(harness.transports.every(
    (request) => request.headers.authorization === harness.secretValue,
  ));
  assert.ok(harness.transports.every(
    (request) => request.headers["x-github-api-version"] === "2026-03-10",
  ));
  assert.equal(JSON.stringify(result).includes(harness.secretValue), false);
  assert.equal(JSON.stringify(harness.audits).includes(harness.secretValue), false);
  return { result, harness };
}
