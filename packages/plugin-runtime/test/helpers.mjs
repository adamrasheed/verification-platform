import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  manifestSigningBytes,
} from "@verify-internal/plugin-sdk";
import {
  authorizePluginOperation,
} from "@verify-internal/auth";
import {
  ProviderEgressBroker,
  ProviderPluginRuntime,
} from "../dist/public/index.js";
import {
  createConformanceProcessLauncher,
} from "../dist/testing/index.js";

export const fixtureRoot = path.resolve("test/fixtures");
export const keyPair = generateKeyPairSync("ed25519");
export const publicKeyPem = keyPair.publicKey.export({ type: "spki", format: "pem" });

export async function signedManifest(
  fixtureName,
  pluginId,
  {
    destinations = [],
    secrets = [],
    filesystemWriteRoots = [],
    subprocess = false,
  } = {},
) {
  const entryPoint = ["test", "fixtures", fixtureName].join("/");
  const artifact = await readFile(path.resolve(entryPoint));
  const manifest = {
    schemaVersion: 1,
    namespace: "verify.synthetic",
    pluginId,
    implementationVersion: "1.0.0",
    artifactDigest: `sha256:${createHash("sha256").update(artifact).digest("hex")}`,
    contractVersions: [{ major: 1, minor: 0 }],
    compatibleEngine: { minimum: "0.2.0", maximumExclusive: "1.0.0" },
    entryPoint,
    platforms: [{ os: process.platform, architecture: process.arch }],
    capabilities: ["repository.policy"],
    operations: ["observeProvider"],
    evidenceTypes: ["provider.repository-policy"],
    requiredInputs: ["repositoryBinding"],
    permissions: {
      filesystemReadRoots: [],
      filesystemWriteRoots,
      subprocess,
      destinations,
      secrets,
    },
    sideEffects: [],
    publisher: {
      id: "verify.synthetic",
      keyId: "key:synthetic",
      sourceRevision: "revision:synthetic-fixtures",
      buildUrl: "https://example.com/build/synthetic",
    },
    signature: {
      algorithm: "Ed25519",
      keyId: "key:synthetic",
      value: "AA==",
    },
  };
  manifest.signature.value = sign(null, manifestSigningBytes(manifest), keyPair.privateKey)
    .toString("base64");
  return manifest;
}

export function destination({
  secret = false,
  maximumRequestBytes = 4096,
  maximumResponseBytes = 4096,
} = {}) {
  return {
    id: "api",
    scheme: "https",
    host: "api.example.com",
    port: 443,
    pathTemplateIds: ["repository-policy"],
    methods: ["GET"],
    outboundSchemaIds: ["repository-policy.v1"],
    outboundClassifications: ["MINIMAL_METADATA"],
    maximumRequestBytes,
    maximumResponseBytes,
    ...(secret ? { secretAudience: "provider-api", secretScopes: ["policy:read"] } : {}),
  };
}

export function secretPermission() {
  return { audience: "provider-api", scopes: ["policy:read"] };
}

export function brokerHarness({
  addresses = ["8.8.8.8"],
  responseStatus = 200,
  responseBody = { protected: true },
  responseContentType = "application/json",
  secretValue = "CANARY_PROVIDER_SECRET",
} = {}) {
  const audits = [];
  const transports = [];
  const broker = new ProviderEgressBroker({
    resolver: {
      async resolve() {
        return addresses;
      },
    },
    transport: {
      async send(request) {
        transports.push(request);
        return {
          status: responseStatus,
          contentType: responseContentType,
          body: new TextEncoder().encode(JSON.stringify(responseBody)),
        };
      },
    },
    secrets: {
      async resolve(referenceId) {
        return {
          referenceId,
          pluginId: "synthetic-brokered",
          operationId: "operation:1",
          audience: "provider-api",
          scopes: ["policy:read"],
          expiresAt: "2026-07-20T00:00:00Z",
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
    payloads: {
      validateOutbound(destinationId, pathTemplateId, schemaId, classification, parameters, value) {
        if (
          destinationId !== "api"
          || pathTemplateId !== "repository-policy"
          || schemaId !== "repository-policy.v1"
          || classification !== "MINIMAL_METADATA"
          || typeof parameters !== "object"
          || parameters === null
          || Array.isArray(parameters)
          || Object.keys(parameters).length !== 0
          || typeof value !== "object"
          || value === null
          || Array.isArray(value)
          || Object.keys(value).length !== 1
          || typeof value.repositoryBinding !== "string"
        ) throw new TypeError("outbound payload denied");
        return {
          path: "/v1/policy",
          body: { repositoryBinding: value.repositoryBinding },
        };
      },
      validateResponse(destinationId, value) {
        if (destinationId !== "api" || typeof value !== "object" || value === null) {
          throw new TypeError("provider response denied");
        }
        return value;
      },
    },
    now: () => new Date("2026-07-19T00:00:00Z"),
  });
  return { broker, audits, transports };
}

export function runtimeHarness(broker, overrides = {}) {
  return new ProviderPluginRuntime({
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
    egress: broker,
    now: () => new Date("2026-07-19T00:00:00Z"),
    redactDiagnostic: (value) => value.replaceAll("CANARY_PLUGIN_SECRET", "[REDACTED]"),
    artifactStagingRoot: path.resolve(".tmp", "artifact-staging"),
    conformanceMode: true,
    ...overrides,
  });
}

export function invocation(manifest, {
  deadlineMs = 3000,
  destinationIds = [],
  secretReferenceIds = [],
  allowLocalDevelopment = false,
  signal = new AbortController().signal,
  enforcementTier = "conformance-process-v1",
  resourceLimits = {
    maximumMemoryBytes: 0,
    maximumCpuNanoseconds: 0,
    maximumPluginProcesses: 0,
  },
} = {}) {
  const expiresAt = new Date(Date.now() + deadlineMs + 1000).toISOString();
  const authorization = authorizePluginOperation(
    { kind: "local-user", id: "local:plugin-test", authenticated: true },
    {
      pluginId: manifest.pluginId,
      operationId: "operation:1",
      destinationIds,
      secretReferenceIds,
      filesystemReadRoots: [],
      filesystemWriteRoots: [],
      subprocess: false,
      sideEffects: [],
      enforcementTier,
      ...resourceLimits,
      expiresAt,
    },
    {
      principalId: "local:plugin-test",
      pluginIds: [manifest.pluginId],
      destinationIds,
      secretReferenceIds,
      filesystemReadRoots: [],
      allowFilesystemWrite: false,
      allowSubprocess: false,
      allowedSideEffects: [],
      enforcementTiers: [enforcementTier],
      ...resourceLimits,
      maximumExpiresAt: expiresAt,
    },
    "authorization:plugin-test",
    new Date(),
  );
  return {
    manifest,
    pluginRoot: process.cwd(),
    operation: {
      operation: "observeProvider",
      operationId: "operation:1",
      invocationId: "invocation:1",
      attemptId: "attempt:1",
      applicationModelRevision: `sha256:${"1".repeat(64)}`,
      deadline: new Date(Date.now() + deadlineMs).toISOString(),
      cancellationRequestId: "cancellation:1",
      enforcementTier: "caller-value-must-not-win",
      resourceLimits: {
        maximumMemoryBytes: 0,
        maximumCpuNanoseconds: 0,
        maximumPluginProcesses: 0,
      },
      grantedDestinationIds: destinationIds,
      secretReferenceIds,
      input: { repositoryBinding: "opaque:repository" },
    },
    authorization,
    egressGrant: {
      pluginId: manifest.pluginId,
      operationId: "operation:1",
      destinationIds,
      secretReferenceIds,
      explicitShare: false,
    },
    scratchRoot: path.resolve(".tmp", manifest.pluginId),
    allowLocalDevelopment,
    signal,
  };
}
