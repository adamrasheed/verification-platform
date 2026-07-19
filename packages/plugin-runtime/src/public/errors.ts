export type PluginRuntimeErrorCode =
  | "VFY_PLUGIN_ARTIFACT_MISMATCH"
  | "VFY_PLUGIN_ARTIFACT_STAGE_FAILED"
  | "VFY_PLUGIN_CANCELLED"
  | "VFY_PLUGIN_CRASH"
  | "VFY_PLUGIN_DEADLINE"
  | "VFY_PLUGIN_DUPLICATE_MESSAGE"
  | "VFY_PLUGIN_INCOMPATIBLE"
  | "VFY_PLUGIN_MANIFEST_INVALID"
  | "VFY_PLUGIN_MESSAGE_MALFORMED"
  | "VFY_PLUGIN_MESSAGE_OVERSIZED"
  | "VFY_PLUGIN_PERMISSION_DENIED"
  | "VFY_PLUGIN_PLATFORM_UNAVAILABLE"
  | "VFY_PLUGIN_PROTOCOL"
  | "VFY_PLUGIN_RESOURCE_EXHAUSTED"
  | "VFY_PLUGIN_REVOKED"
  | "VFY_PLUGIN_STDERR_OVERSIZED"
  | "VFY_PLUGIN_TRUST_DENIED"
  | "VFY_PROVIDER_CLASSIFICATION_DENIED"
  | "VFY_PROVIDER_DESTINATION_DENIED"
  | "VFY_PROVIDER_DNS_DENIED"
  | "VFY_PROVIDER_REDIRECT_DENIED"
  | "VFY_PROVIDER_REQUEST_MALFORMED"
  | "VFY_PROVIDER_REQUEST_OVERSIZED"
  | "VFY_PROVIDER_RESPONSE_INVALID"
  | "VFY_PROVIDER_RESPONSE_OVERSIZED"
  | "VFY_PROVIDER_SECRET_DENIED"
  | "VFY_PROVIDER_SECRET_LEAK";

export class PluginRuntimeError extends Error {
  readonly code: PluginRuntimeErrorCode;

  constructor(code: PluginRuntimeErrorCode, message: string) {
    super(message);
    this.name = "PluginRuntimeError";
    this.code = code;
  }
}

export function asPluginRuntimeError(error: unknown): PluginRuntimeError {
  if (error instanceof PluginRuntimeError) return error;
  const message = error instanceof Error ? error.message : "unknown plugin runtime failure";
  const candidate = message.match(/VFY_[A-Z_]+/)?.[0] as PluginRuntimeErrorCode | undefined;
  return new PluginRuntimeError(candidate ?? "VFY_PLUGIN_PROTOCOL", message);
}
