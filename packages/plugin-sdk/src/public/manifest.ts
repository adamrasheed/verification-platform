import {
  encodeCanonical,
  type CanonicalValue,
  type DataClassification,
  type Sha256Digest,
} from "@verify-internal/contracts";

export const PLUGIN_MANIFEST_SCHEMA_VERSION: 1 = 1;
export const PLUGIN_MANIFEST_MAX_BYTES: number = 256 * 1024;

export type PluginOperation =
  | "discover"
  | "describeProofs"
  | "captureEvidence"
  | "suggestRepairs"
  | "observeProvider";

export interface PluginContractVersion {
  readonly major: number;
  readonly minor: number;
}

export interface PluginPlatform {
  readonly os: "darwin" | "linux" | "win32";
  readonly architecture: string;
}

export interface PluginDestination {
  readonly id: string;
  readonly scheme: "https";
  readonly host: string;
  readonly port: 443;
  readonly pathTemplateIds: readonly string[];
  readonly methods: readonly ("GET" | "POST")[];
  readonly outboundSchemaIds: readonly string[];
  readonly outboundClassifications: readonly DataClassification[];
  readonly maximumRequestBytes: number;
  readonly maximumResponseBytes: number;
  readonly secretAudience?: string;
  readonly secretScopes?: readonly string[];
}

export interface PluginSecretPermission {
  readonly audience: string;
  readonly scopes: readonly string[];
}

export interface PluginPermissionManifest {
  readonly filesystemReadRoots: readonly string[];
  readonly filesystemWriteRoots: readonly string[];
  readonly subprocess: boolean;
  readonly destinations: readonly PluginDestination[];
  readonly secrets: readonly PluginSecretPermission[];
}

export interface PluginPublisher {
  readonly id: string;
  readonly keyId: string;
  readonly sourceRevision: string;
  readonly buildUrl: string;
}

export interface PluginManifestSignature {
  readonly algorithm: "Ed25519";
  readonly keyId: string;
  readonly value: string;
}

export interface ProviderPluginManifest {
  readonly schemaVersion: 1;
  readonly namespace: string;
  readonly pluginId: string;
  readonly implementationVersion: string;
  readonly artifactDigest: Sha256Digest;
  readonly contractVersions: readonly PluginContractVersion[];
  readonly compatibleEngine: {
    readonly minimum: string;
    readonly maximumExclusive: string;
  };
  readonly entryPoint: string;
  readonly platforms: readonly PluginPlatform[];
  readonly capabilities: readonly string[];
  readonly operations: readonly PluginOperation[];
  readonly evidenceTypes: readonly string[];
  readonly requiredInputs: readonly string[];
  readonly permissions: PluginPermissionManifest;
  readonly sideEffects: readonly string[];
  readonly publisher: PluginPublisher;
  readonly signature: PluginManifestSignature;
}

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const IDENTIFIER_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/;
const VERSION_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;
const HOST_PATTERN = /^(?=.{1,253}$)(?!-)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const OPERATION_VALUES = new Set<PluginOperation>([
  "discover",
  "describeProofs",
  "captureEvidence",
  "suggestRepairs",
  "observeProvider",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value);
  return required.every((key) => key in value)
    && keys.every((key) => required.includes(key) || optional.includes(key));
}

function isStringArray(value: unknown, maximum = 128): value is readonly string[] {
  return Array.isArray(value)
    && value.length <= maximum
    && value.every((item) => typeof item === "string" && item.length > 0 && item.length <= 512)
    && new Set(value).size === value.length;
}

function isSafeRelativePath(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 512
    && !value.startsWith("/")
    && !value.includes("\\")
    && !value.split("/").some((segment) => segment === "" || segment === "." || segment === "..");
}

function isDestination(value: unknown): value is PluginDestination {
  if (!isRecord(value) || !exactKeys(value, [
    "id",
    "scheme",
    "host",
    "port",
    "pathTemplateIds",
    "methods",
    "outboundSchemaIds",
    "outboundClassifications",
    "maximumRequestBytes",
    "maximumResponseBytes",
  ], ["secretAudience", "secretScopes"])) return false;
  if (
    typeof value.id !== "string"
    || !IDENTIFIER_PATTERN.test(value.id)
    || value.scheme !== "https"
    || typeof value.host !== "string"
    || !HOST_PATTERN.test(value.host)
    || value.port !== 443
    || !isStringArray(value.pathTemplateIds, 32)
    || !value.pathTemplateIds.every((id) => IDENTIFIER_PATTERN.test(id))
    || !Array.isArray(value.methods)
    || value.methods.length === 0
    || !value.methods.every((method) => method === "GET" || method === "POST")
    || !isStringArray(value.outboundSchemaIds, 32)
    || !Array.isArray(value.outboundClassifications)
    || value.outboundClassifications.length === 0
    || !value.outboundClassifications.every((classification) =>
      classification === "MINIMAL_METADATA" || classification === "EXPLICIT_SHARE")
    || typeof value.maximumRequestBytes !== "number"
    || !Number.isSafeInteger(value.maximumRequestBytes)
    || value.maximumRequestBytes < 0
    || value.maximumRequestBytes > 1024 * 1024
    || typeof value.maximumResponseBytes !== "number"
    || !Number.isSafeInteger(value.maximumResponseBytes)
    || value.maximumResponseBytes < 1
    || value.maximumResponseBytes > 8 * 1024 * 1024
  ) return false;
  if (value.secretAudience !== undefined && (
    typeof value.secretAudience !== "string" || value.secretAudience.length === 0
  )) return false;
  if (value.secretScopes !== undefined && !isStringArray(value.secretScopes, 64)) return false;
  return (value.secretAudience === undefined) === (value.secretScopes === undefined);
}

function isPermissionManifest(value: unknown): value is PluginPermissionManifest {
  if (!isRecord(value) || !exactKeys(value, [
    "filesystemReadRoots",
    "filesystemWriteRoots",
    "subprocess",
    "destinations",
    "secrets",
  ])) return false;
  if (
    !isStringArray(value.filesystemReadRoots, 64)
    || !value.filesystemReadRoots.every(isSafeRelativePath)
    || !isStringArray(value.filesystemWriteRoots, 64)
    || !value.filesystemWriteRoots.every(isSafeRelativePath)
    || typeof value.subprocess !== "boolean"
    || !Array.isArray(value.destinations)
    || value.destinations.length > 32
    || !value.destinations.every(isDestination)
    || new Set(value.destinations.map((destination) => destination.id)).size
      !== value.destinations.length
    || !Array.isArray(value.secrets)
    || value.secrets.length > 32
  ) return false;
  return value.secrets.every((secret) =>
    isRecord(secret)
    && exactKeys(secret, ["audience", "scopes"])
    && typeof secret.audience === "string"
    && secret.audience.length > 0
    && isStringArray(secret.scopes, 64));
}

export function assertProviderPluginManifest(value: unknown): asserts value is ProviderPluginManifest {
  if (!isRecord(value) || !exactKeys(value, [
    "schemaVersion",
    "namespace",
    "pluginId",
    "implementationVersion",
    "artifactDigest",
    "contractVersions",
    "compatibleEngine",
    "entryPoint",
    "platforms",
    "capabilities",
    "operations",
    "evidenceTypes",
    "requiredInputs",
    "permissions",
    "sideEffects",
    "publisher",
    "signature",
  ])) throw new TypeError("invalid plugin manifest shape");
  if (
    value.schemaVersion !== PLUGIN_MANIFEST_SCHEMA_VERSION
    || typeof value.namespace !== "string"
    || !IDENTIFIER_PATTERN.test(value.namespace)
    || typeof value.pluginId !== "string"
    || !IDENTIFIER_PATTERN.test(value.pluginId)
    || typeof value.implementationVersion !== "string"
    || !VERSION_PATTERN.test(value.implementationVersion)
    || typeof value.artifactDigest !== "string"
    || !SHA256_PATTERN.test(value.artifactDigest)
    || !isSafeRelativePath(value.entryPoint)
  ) throw new TypeError("invalid plugin identity");
  if (
    !Array.isArray(value.contractVersions)
    || value.contractVersions.length === 0
    || value.contractVersions.length > 16
    || !value.contractVersions.every((version) =>
      isRecord(version)
      && exactKeys(version, ["major", "minor"])
      && typeof version.major === "number"
      && Number.isSafeInteger(version.major)
      && version.major > 0
      && typeof version.minor === "number"
      && Number.isSafeInteger(version.minor)
      && version.minor >= 0)
  ) throw new TypeError("invalid plugin contract versions");
  if (
    !isRecord(value.compatibleEngine)
    || !exactKeys(value.compatibleEngine, ["minimum", "maximumExclusive"])
    || typeof value.compatibleEngine.minimum !== "string"
    || !VERSION_PATTERN.test(value.compatibleEngine.minimum)
    || typeof value.compatibleEngine.maximumExclusive !== "string"
    || !VERSION_PATTERN.test(value.compatibleEngine.maximumExclusive)
  ) throw new TypeError("invalid compatible engine range");
  if (
    !Array.isArray(value.platforms)
    || value.platforms.length === 0
    || value.platforms.length > 32
    || !value.platforms.every((platform) =>
      isRecord(platform)
      && exactKeys(platform, ["os", "architecture"])
      && (platform.os === "darwin" || platform.os === "linux" || platform.os === "win32")
      && typeof platform.architecture === "string"
      && platform.architecture.length > 0)
    || !isStringArray(value.capabilities)
    || !isStringArray(value.operations)
    || !value.operations.every((operation) => OPERATION_VALUES.has(operation as PluginOperation))
    || !isStringArray(value.evidenceTypes)
    || !isStringArray(value.requiredInputs)
    || !isPermissionManifest(value.permissions)
    || !isStringArray(value.sideEffects)
  ) throw new TypeError("invalid plugin surface");
  if (
    !isRecord(value.publisher)
    || !exactKeys(value.publisher, ["id", "keyId", "sourceRevision", "buildUrl"])
    || typeof value.publisher.id !== "string"
    || !IDENTIFIER_PATTERN.test(value.publisher.id)
    || typeof value.publisher.keyId !== "string"
    || value.publisher.keyId.length === 0
    || typeof value.publisher.sourceRevision !== "string"
    || value.publisher.sourceRevision.length === 0
    || typeof value.publisher.buildUrl !== "string"
    || !value.publisher.buildUrl.startsWith("https://")
  ) throw new TypeError("invalid plugin publisher");
  if (
    !isRecord(value.signature)
    || !exactKeys(value.signature, ["algorithm", "keyId", "value"])
    || value.signature.algorithm !== "Ed25519"
    || value.signature.keyId !== value.publisher.keyId
    || typeof value.signature.value !== "string"
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.signature.value)
  ) throw new TypeError("invalid plugin signature");
}

export function manifestSigningBytes(manifest: ProviderPluginManifest): Uint8Array {
  const { signature: _signature, ...signed } = manifest;
  return encodeCanonical(signed as unknown as CanonicalValue);
}
