import {
  canonicalize,
  parseCanonicalJson,
  type CanonicalValue,
} from "@verify-internal/contracts";
import type { PluginContractVersion, PluginOperation } from "./manifest.js";
import type { ProviderRequest, ProviderResponse } from "./provider-request.js";

export const CURRENT_PLUGIN_CONTRACT: PluginContractVersion = Object.freeze({
  major: 1,
  minor: 0,
});
export const PLUGIN_MESSAGE_MAX_BYTES: number = 1024 * 1024;
export const PLUGIN_STDERR_MAX_BYTES: number = 64 * 1024;

export type PluginMessageType =
  | "handshake.request"
  | "handshake.response"
  | "operation.request"
  | "contribution"
  | "provider.request"
  | "provider.response"
  | "cancel.request"
  | "complete"
  | "error";

export interface PluginMessage<TPayload extends CanonicalValue = CanonicalValue> {
  readonly protocolVersion: string;
  readonly messageType: PluginMessageType;
  readonly requestId: string;
  readonly payload: TPayload;
}

export interface PluginHandshakeRequest {
  readonly supportedVersions: readonly PluginContractVersion[];
  readonly engineVersion: string;
}

export interface PluginHandshakeResponse {
  readonly selectedVersion: PluginContractVersion;
  readonly pluginId: string;
}

export interface PluginResourceLimits {
  readonly maximumMemoryBytes: number;
  readonly maximumCpuNanoseconds: number;
  readonly maximumPluginProcesses: number;
}

export type PluginOperationalErrorCode =
  | "VFY_PROVIDER_AUTHENTICATION_FAILED"
  | "VFY_PROVIDER_NOT_FOUND"
  | "VFY_PROVIDER_PERMISSION_DENIED"
  | "VFY_PROVIDER_RATE_LIMITED"
  | "VFY_PROVIDER_UNAVAILABLE";

export interface PluginOperationalError {
  readonly code: PluginOperationalErrorCode;
  readonly retryability: "never" | "safe" | "policy_required";
  readonly message: string;
}

export interface PluginOperationRequest {
  readonly operation: PluginOperation;
  readonly operationId: string;
  readonly invocationId: string;
  readonly attemptId: string;
  readonly applicationModelRevision: string;
  readonly deadline: string;
  readonly cancellationRequestId: string;
  readonly enforcementTier: string;
  readonly resourceLimits: PluginResourceLimits;
  readonly grantedDestinationIds: readonly string[];
  readonly secretReferenceIds: readonly string[];
  readonly input: CanonicalValue;
}

export type ProviderRequestPayload = ProviderRequest;
export type ProviderResponsePayload = ProviderResponse;

const MESSAGE_TYPES = new Set<PluginMessageType>([
  "handshake.request",
  "handshake.response",
  "operation.request",
  "contribution",
  "provider.request",
  "provider.response",
  "cancel.request",
  "complete",
  "error",
]);
const OPERATIONAL_ERROR_CODES = new Set<PluginOperationalErrorCode>([
  "VFY_PROVIDER_AUTHENTICATION_FAILED",
  "VFY_PROVIDER_NOT_FOUND",
  "VFY_PROVIDER_PERMISSION_DENIED",
  "VFY_PROVIDER_RATE_LIMITED",
  "VFY_PROVIDER_UNAVAILABLE",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function pluginVersionString(version: PluginContractVersion): string {
  return `${version.major}.${version.minor}`;
}

export function negotiatePluginContract(
  engineVersions: readonly PluginContractVersion[],
  pluginVersions: readonly PluginContractVersion[],
): PluginContractVersion {
  const compatible: PluginContractVersion[] = [];
  for (const engine of engineVersions) {
    for (const plugin of pluginVersions) {
      if (engine.major === plugin.major) {
        compatible.push({ major: engine.major, minor: Math.min(engine.minor, plugin.minor) });
      }
    }
  }
  compatible.sort((left, right) => right.major - left.major || right.minor - left.minor);
  const selected = compatible[0];
  if (!selected) throw new TypeError("VFY_PLUGIN_INCOMPATIBLE");
  return selected;
}

export function decodePluginMessage(
  line: string,
  maximumBytes: number = PLUGIN_MESSAGE_MAX_BYTES,
): PluginMessage {
  if (new TextEncoder().encode(line).byteLength > maximumBytes) {
    throw new TypeError("VFY_PLUGIN_MESSAGE_OVERSIZED");
  }
  const parsed = parseCanonicalJson(line);
  if (
    !isRecord(parsed)
    || Object.keys(parsed).length !== 4
    || typeof parsed.protocolVersion !== "string"
    || typeof parsed.messageType !== "string"
    || !MESSAGE_TYPES.has(parsed.messageType as PluginMessageType)
    || typeof parsed.requestId !== "string"
    || parsed.requestId.length === 0
    || !("payload" in parsed)
  ) throw new TypeError("VFY_PLUGIN_MESSAGE_MALFORMED");
  return parsed as unknown as PluginMessage;
}

export function encodePluginMessage(message: PluginMessage): string {
  const encoded = canonicalize(message as unknown as CanonicalValue);
  if (new TextEncoder().encode(encoded).byteLength > PLUGIN_MESSAGE_MAX_BYTES) {
    throw new TypeError("VFY_PLUGIN_MESSAGE_OVERSIZED");
  }
  return `${encoded}\n`;
}

export function assertPluginOperationalError(
  value: unknown,
): asserts value is PluginOperationalError {
  if (!isRecord(value) || Object.keys(value).length !== 3) {
    throw new TypeError("VFY_PLUGIN_PROTOCOL");
  }
  if (
    typeof value.code !== "string"
    || !OPERATIONAL_ERROR_CODES.has(value.code as PluginOperationalErrorCode)
    || (
      value.retryability !== "never"
      && value.retryability !== "safe"
      && value.retryability !== "policy_required"
    )
    || typeof value.message !== "string"
    || value.message.length === 0
    || value.message.length > 256
    || /[\r\n]/.test(value.message)
  ) throw new TypeError("VFY_PLUGIN_PROTOCOL");
}
