import assert from "node:assert/strict";
import test from "node:test";
import {
  isPublicProviderAddress,
} from "../dist/public/index.js";
import {
  brokerHarness,
  destination,
  secretPermission,
  signedManifest,
} from "./helpers.mjs";

async function requestManifest(options = {}) {
  return signedManifest("brokered.mjs", "synthetic-brokered", {
    destinations: [destination(options)],
    secrets: options.secret === false ? [] : [secretPermission()],
  });
}

function grant(overrides = {}) {
  return {
    pluginId: "synthetic-brokered",
    operationId: "operation:1",
    destinationIds: ["api"],
    secretReferenceIds: ["secret:provider"],
    explicitShare: false,
    ...overrides,
  };
}

function request(overrides = {}) {
  return {
    providerRequestId: "provider:1",
    destinationId: "api",
    method: "GET",
    pathTemplateId: "repository-policy",
    pathParameters: {},
    outboundSchemaId: "repository-policy.v1",
    classification: "MINIMAL_METADATA",
    body: { repositoryBinding: "opaque:repository" },
    secretReferenceId: "secret:provider",
    ...overrides,
  };
}

test("address policy rejects local, private, metadata, documentation, and invalid targets", () => {
  for (const value of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "192.0.2.1",
    "198.51.100.1",
    "203.0.113.1",
    "::1",
    "fd00::1",
    "not-an-ip",
  ]) assert.equal(isPublicProviderAddress(value), false, value);
  assert.equal(isPublicProviderAddress("8.8.8.8"), true);
  assert.equal(isPublicProviderAddress("2606:4700:4700::1111"), true);
});

test("broker attaches an exact scoped secret without returning or auditing it", async () => {
  const manifest = await requestManifest({ secret: true });
  const harness = brokerHarness();
  const response = await harness.broker.execute(
    manifest,
    grant(),
    request(),
    new AbortController().signal,
  );
  assert.deepEqual(response.body, { protected: true });
  assert.equal(harness.transports[0].headers.authorization, "CANARY_PROVIDER_SECRET");
  assert.equal(JSON.stringify(response).includes("CANARY_PROVIDER_SECRET"), false);
  assert.equal(JSON.stringify(harness.audits).includes("CANARY_PROVIDER_SECRET"), false);
  assert.equal(harness.audits[0].eventType, "ProviderRequestCompleted");
});

test("broker denies DNS rebinding classes, redirects, and ungranted telemetry", async () => {
  const manifest = await requestManifest({ secret: true });
  await assert.rejects(
    brokerHarness({ addresses: ["169.254.169.254"] }).broker.execute(
      manifest,
      grant(),
      request(),
      new AbortController().signal,
    ),
    (error) => error.code === "VFY_PROVIDER_DNS_DENIED",
  );
  await assert.rejects(
    brokerHarness({ responseStatus: 302 }).broker.execute(
      manifest,
      grant(),
      request(),
      new AbortController().signal,
    ),
    (error) => error.code === "VFY_PROVIDER_REDIRECT_DENIED",
  );
  await assert.rejects(
    brokerHarness().broker.execute(
      manifest,
      grant(),
      request({ destinationId: "telemetry" }),
      new AbortController().signal,
    ),
    (error) => error.code === "VFY_PROVIDER_DESTINATION_DENIED",
  );
});

test("broker fails closed on explicit-share, size, and secret response canaries", async () => {
  const manifest = await requestManifest({
    secret: true,
    maximumRequestBytes: 16,
    maximumResponseBytes: 4096,
  });
  await assert.rejects(
    brokerHarness().broker.execute(
      manifest,
      grant(),
      request({ body: { repositoryBinding: `opaque:${"x".repeat(100)}` } }),
      new AbortController().signal,
    ),
    (error) => error.code === "VFY_PROVIDER_REQUEST_OVERSIZED",
  );
  await assert.rejects(
    brokerHarness().broker.execute(
      manifest,
      grant(),
      request({ classification: "EXPLICIT_SHARE" }),
      new AbortController().signal,
    ),
    (error) => error.code === "VFY_PROVIDER_CLASSIFICATION_DENIED",
  );
  const leakManifest = await requestManifest({ secret: true });
  const secretLeak = brokerHarness({ responseBody: { token: "CANARY_PROVIDER_SECRET" } });
  await assert.rejects(
    secretLeak.broker.execute(
      leakManifest,
      grant(),
      request(),
      new AbortController().signal,
    ),
    (error) => error.code === "VFY_PROVIDER_SECRET_LEAK",
  );
  await assert.rejects(
    brokerHarness({ secretHeaderName: "host" }).broker.execute(
      leakManifest,
      grant(),
      request(),
      new AbortController().signal,
    ),
    (error) => error.code === "VFY_PROVIDER_SECRET_DENIED",
  );
});

test("broker invokes the outbound allowlist instead of trusting a declared schema ID", async () => {
  const manifest = await requestManifest({ secret: true });
  for (const candidate of [
    request({ body: { repositoryBinding: "opaque:repository", smuggled: "source" } }),
    request({ pathParameters: { path: "../../metadata" } }),
    request({ outboundSchemaId: "invented.v1" }),
  ]) {
    await assert.rejects(
      brokerHarness().broker.execute(
        manifest,
        grant(),
        candidate,
        new AbortController().signal,
      ),
      (error) =>
        error.code === "VFY_PROVIDER_REQUEST_MALFORMED"
        || error.code === "VFY_PROVIDER_DESTINATION_DENIED",
    );
  }
});
