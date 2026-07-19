import type {
  CanonicalValue,
} from "@verify-internal/contracts";

export interface ProviderRequest {
  readonly providerRequestId: string;
  readonly destinationId: string;
  readonly method: "GET" | "POST";
  readonly pathTemplateId: string;
  readonly pathParameters: CanonicalValue;
  readonly outboundSchemaId: string;
  readonly classification: "MINIMAL_METADATA" | "EXPLICIT_SHARE";
  readonly body: CanonicalValue;
  readonly secretReferenceId?: string;
}

export interface ProviderResponse {
  readonly providerRequestId: string;
  readonly status: number;
  readonly body: CanonicalValue;
  readonly byteSize: number;
}

export function assertProviderRequest(value: unknown): asserts value is ProviderRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("VFY_PROVIDER_REQUEST_MALFORMED");
  }
  const request = value as Record<string, unknown>;
  const allowed = new Set([
    "providerRequestId",
    "destinationId",
    "method",
    "pathTemplateId",
    "pathParameters",
    "outboundSchemaId",
    "classification",
    "body",
    "secretReferenceId",
  ]);
  if (
    Object.keys(request).some((key) => !allowed.has(key))
    || typeof request.providerRequestId !== "string"
    || request.providerRequestId.length === 0
    || typeof request.destinationId !== "string"
    || request.destinationId.length === 0
    || (request.method !== "GET" && request.method !== "POST")
    || typeof request.pathTemplateId !== "string"
    || request.pathTemplateId.length === 0
    || !("pathParameters" in request)
    || typeof request.outboundSchemaId !== "string"
    || request.outboundSchemaId.length === 0
    || (
      request.classification !== "MINIMAL_METADATA"
      && request.classification !== "EXPLICIT_SHARE"
    )
    || !("body" in request)
    || (
      request.secretReferenceId !== undefined
      && (typeof request.secretReferenceId !== "string" || request.secretReferenceId.length === 0)
    )
  ) throw new TypeError("VFY_PROVIDER_REQUEST_MALFORMED");
}
