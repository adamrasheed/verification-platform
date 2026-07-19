import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import {
  ProviderPluginRuntime,
  verifyPluginPublisher,
} from "../dist/public/index.js";
import {
  createConformanceProcessLauncher,
} from "../dist/testing/index.js";
import {
  brokerHarness,
  destination,
  invocation,
  publicKeyPem,
  runtimeHarness,
  secretPermission,
  signedManifest,
} from "./helpers.mjs";

test("verified manifest trust rejects tampering and revocation", async () => {
  const manifest = await signedManifest("fast.mjs", "synthetic-fast");
  assert.equal(
    verifyPluginPublisher(
      manifest,
      [{
        publisherId: "verify.synthetic",
        keyId: "key:synthetic",
        publicKeyPem,
        notBefore: "2026-01-01T00:00:00Z",
        notAfter: "2027-01-01T00:00:00Z",
      }],
      { publisherKeyIds: [], artifactDigests: [] },
      new Date("2026-07-19T00:00:00Z"),
    ).tier,
    "verified-publisher",
  );
  assert.throws(
    () => verifyPluginPublisher(
      { ...manifest, implementationVersion: "1.0.1" },
      [{
        publisherId: "verify.synthetic",
        keyId: "key:synthetic",
        publicKeyPem,
        notBefore: "2026-01-01T00:00:00Z",
        notAfter: "2027-01-01T00:00:00Z",
      }],
      { publisherKeyIds: [], artifactDigests: [] },
      new Date("2026-07-19T00:00:00Z"),
    ),
    (error) => error.code === "VFY_PLUGIN_TRUST_DENIED",
  );
  assert.throws(
    () => verifyPluginPublisher(
      manifest,
      [],
      { publisherKeyIds: ["key:synthetic"], artifactDigests: [] },
      new Date("2026-07-19T00:00:00Z"),
    ),
    (error) => error.code === "VFY_PLUGIN_REVOKED",
  );
});

test("three synthetic provider behaviors run without provider-specific core changes", async () => {
  const fastManifest = await signedManifest("fast.mjs", "synthetic-fast");
  const fastHarness = brokerHarness();
  const fast = await runtimeHarness(fastHarness.broker).invoke(invocation(fastManifest));
  assert.deepEqual(fast.contributions, [{
    behavior: "fast",
    enforcementTier: "conformance-process-v1",
    kind: "synthetic",
    resourceLimits: {
      maximumCpuNanoseconds: 0,
      maximumMemoryBytes: 0,
      maximumPluginProcesses: 0,
    },
  }]);
  assert.equal(fast.trustTier, "verified-publisher");
  assert.equal(fast.diagnostics.join("\n").includes("CANARY_PLUGIN_SECRET"), false);
  assert.equal(fast.diagnostics.join("\n").includes("[REDACTED]"), true);

  const brokeredManifest = await signedManifest("brokered.mjs", "synthetic-brokered", {
    destinations: [destination({ secret: true })],
    secrets: [secretPermission()],
  });
  const brokeredHarness = brokerHarness();
  const brokered = await runtimeHarness(brokeredHarness.broker).invoke(invocation(
    brokeredManifest,
    { destinationIds: ["api"], secretReferenceIds: ["secret:provider"] },
  ));
  assert.equal(brokered.contributions[0].behavior, "brokered");
  assert.equal(brokeredHarness.transports.length, 1);

  const slowManifest = await signedManifest("slow.mjs", "synthetic-slow");
  await assert.rejects(
    runtimeHarness(fastHarness.broker).invoke(invocation(slowManifest, { deadlineMs: 100 })),
    (error) => error.code === "VFY_PLUGIN_DEADLINE",
  );
});

test("crash, malformed output, stdout/stderr flood, and cancellation are typed containment failures", async () => {
  const harness = brokerHarness();
  const runtime = runtimeHarness(harness.broker);
  const crash = await signedManifest("crash.mjs", "synthetic-crash");
  await assert.rejects(
    runtime.invoke(invocation(crash)),
    (error) => error.code === "VFY_PLUGIN_CRASH",
  );
  const malformed = await signedManifest("malformed.mjs", "synthetic-malformed");
  await assert.rejects(
    runtime.invoke(invocation(malformed)),
    (error) => error.code === "VFY_PLUGIN_PROTOCOL",
  );
  const flood = await signedManifest("flood.mjs", "synthetic-flood");
  await assert.rejects(
    runtime.invoke(invocation(flood)),
    (error) => error.code === "VFY_PLUGIN_MESSAGE_OVERSIZED",
  );
  const stderrFlood = await signedManifest("stderr-flood.mjs", "synthetic-stderr-flood");
  await assert.rejects(
    runtime.invoke(invocation(stderrFlood)),
    (error) => error.code === "VFY_PLUGIN_STDERR_OVERSIZED",
  );
  const controller = new AbortController();
  const slow = await signedManifest("slow.mjs", "synthetic-slow");
  const pending = runtime.invoke(invocation(slow, {
    deadlineMs: 5000,
    signal: controller.signal,
  }));
  setTimeout(() => controller.abort(), 50);
  await assert.rejects(pending, (error) => error.code === "VFY_PLUGIN_CANCELLED");
});

test("production cannot accidentally use the conformance process launcher", async () => {
  const manifest = await signedManifest("fast.mjs", "synthetic-fast");
  const harness = brokerHarness();
  const runtime = new ProviderPluginRuntime({
    engineVersion: "0.2.0",
    publishers: [{
      publisherId: "verify.synthetic",
      keyId: "key:synthetic",
      publicKeyPem,
      notBefore: "2026-01-01T00:00:00Z",
      notAfter: "2027-01-01T00:00:00Z",
    }],
    revocations: { publisherKeyIds: [], artifactDigests: [] },
    sandbox: createConformanceProcessLauncher(),
    egress: harness.broker,
    now: () => new Date("2026-07-19T00:00:00Z"),
    redactDiagnostic: (value) => value,
    artifactStagingRoot: path.resolve(".tmp", "artifact-staging"),
  });
  await assert.rejects(
    runtime.invoke(invocation(manifest)),
    (error) => error.code === "VFY_PLUGIN_PLATFORM_UNAVAILABLE",
  );
});

test("local-development trust cannot receive egress, secrets, writes, or subprocesses", async () => {
  const manifest = await signedManifest("brokered.mjs", "synthetic-brokered", {
    destinations: [destination({ secret: true })],
    secrets: [secretPermission()],
    filesystemWriteRoots: ["scratch"],
    subprocess: true,
  });
  const harness = brokerHarness();
  const runtime = runtimeHarness(harness.broker, { publishers: [] });
  await assert.rejects(
    runtime.invoke(invocation(manifest, {
      destinationIds: ["api"],
      secretReferenceIds: ["secret:provider"],
      allowLocalDevelopment: true,
    })),
    (error) => error.code === "VFY_PLUGIN_PERMISSION_DENIED",
  );
});
