import assert from "node:assert/strict";
import test from "node:test";
import {
  assertProviderPluginManifest,
  assertProviderRequest,
  decodePluginMessage,
  encodePluginMessage,
  manifestSigningBytes,
  negotiatePluginContract,
} from "../dist/public/index.js";

function manifest() {
  return {
    schemaVersion: 1,
    namespace: "verify.synthetic",
    pluginId: "synthetic-fast",
    implementationVersion: "1.0.0",
    artifactDigest: `sha256:${"a".repeat(64)}`,
    contractVersions: [{ major: 1, minor: 0 }],
    compatibleEngine: { minimum: "0.2.0", maximumExclusive: "1.0.0" },
    entryPoint: "plugin.mjs",
    platforms: [{ os: "darwin", architecture: "arm64" }],
    capabilities: ["repository.policy"],
    operations: ["observeProvider"],
    evidenceTypes: ["provider.repository-policy"],
    requiredInputs: ["repositoryBinding"],
    permissions: {
      filesystemReadRoots: [],
      filesystemWriteRoots: [],
      subprocess: false,
      destinations: [{
        id: "api",
        scheme: "https",
        host: "api.example.com",
        port: 443,
        pathTemplateIds: ["repository-policy"],
        methods: ["GET"],
        outboundSchemaIds: ["repository-policy.v1"],
        outboundClassifications: ["MINIMAL_METADATA"],
        maximumRequestBytes: 1024,
        maximumResponseBytes: 4096,
      }],
      secrets: [],
    },
    sideEffects: [],
    publisher: {
      id: "verify.synthetic",
      keyId: "key:synthetic",
      sourceRevision: "revision:fixture",
      buildUrl: "https://example.com/build/1",
    },
    signature: {
      algorithm: "Ed25519",
      keyId: "key:synthetic",
      value: "YWJj",
    },
  };
}

test("strict manifest accepts the provider-neutral signed surface", () => {
  const value = manifest();
  assert.doesNotThrow(() => assertProviderPluginManifest(value));
  const first = manifestSigningBytes(value);
  const second = manifestSigningBytes({ ...value, signature: { ...value.signature, value: "ZGVm" } });
  assert.deepEqual(first, second, "signature bytes are excluded from the signed payload");
});

test("manifest rejects undeclared fields, unsafe paths, and arbitrary destinations", () => {
  assert.throws(
    () => assertProviderPluginManifest({ ...manifest(), providerName: "special-case" }),
    /invalid plugin manifest shape/,
  );
  assert.throws(
    () => assertProviderPluginManifest({ ...manifest(), entryPoint: "../escape.mjs" }),
    /invalid plugin identity/,
  );
  const unsafe = manifest();
  unsafe.permissions.destinations[0].host = "localhost";
  assert.throws(() => assertProviderPluginManifest(unsafe), /invalid plugin surface/);
});

test("contract negotiation selects the highest mutually supported version", () => {
  assert.deepEqual(
    negotiatePluginContract(
      [{ major: 1, minor: 2 }, { major: 2, minor: 0 }],
      [{ major: 1, minor: 4 }, { major: 3, minor: 0 }],
    ),
    { major: 1, minor: 2 },
  );
  assert.throws(
    () => negotiatePluginContract([{ major: 2, minor: 0 }], [{ major: 1, minor: 9 }]),
    /VFY_PLUGIN_INCOMPATIBLE/,
  );
});

test("NDJSON framing is canonical, duplicate-safe, and bounded", () => {
  const encoded = encodePluginMessage({
    protocolVersion: "1.0",
    messageType: "complete",
    requestId: "request:1",
    payload: { ok: true },
  });
  assert.equal(encoded.endsWith("\n"), true);
  assert.deepEqual(decodePluginMessage(encoded.trim()), {
    messageType: "complete",
    payload: { ok: true },
    protocolVersion: "1.0",
    requestId: "request:1",
  });
  assert.throws(
    () => decodePluginMessage(
      '{"protocolVersion":"1.0","messageType":"complete","requestId":"a","requestId":"b","payload":{}}',
    ),
    /duplicate object key/,
  );
  assert.throws(() => decodePluginMessage("x".repeat(128), 64), /VFY_PLUGIN_MESSAGE_OVERSIZED/);
});

test("provider request boundary rejects URL and path smuggling", () => {
  const valid = {
    providerRequestId: "provider:1",
    destinationId: "api",
    method: "GET",
    pathTemplateId: "repository-policy",
    pathParameters: {},
    outboundSchemaId: "repository-policy.v1",
    classification: "MINIMAL_METADATA",
    body: { repositoryBinding: "opaque:1" },
  };
  assert.doesNotThrow(() => assertProviderRequest(valid));
  assert.throws(
    () => assertProviderRequest({ ...valid, url: "https://attacker.example" }),
    /VFY_PROVIDER_REQUEST_MALFORMED/,
  );
  assert.throws(
    () => assertProviderRequest({ ...valid, path: "/v1/secrets" }),
    /VFY_PROVIDER_REQUEST_MALFORMED/,
  );
});
