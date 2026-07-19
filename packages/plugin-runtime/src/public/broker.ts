import { isIP } from "node:net";
import {
  canonicalize,
  parseCanonicalJson,
  type CanonicalValue,
} from "@verify-internal/contracts";
import {
  assertProviderPluginManifest,
  assertProviderRequest,
  type PluginDestination,
  type ProviderRequest,
  type ProviderResponse,
  type ProviderPluginManifest,
} from "@verify-internal/plugin-sdk";
import { PluginRuntimeError } from "./errors.js";

export interface ProviderAddressResolver {
  resolve(host: string, signal: AbortSignal): Promise<readonly string[]>;
}

export interface ProviderTransportRequest {
  readonly url: string;
  readonly host: string;
  readonly resolvedAddresses: readonly string[];
  readonly method: "GET" | "POST";
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
  readonly maximumResponseBytes: number;
  readonly signal: AbortSignal;
}

export interface ProviderTransportResponse {
  readonly status: number;
  readonly contentType: string;
  readonly body: Uint8Array;
}

export interface ProviderTransport {
  send(request: ProviderTransportRequest): Promise<ProviderTransportResponse>;
}

export interface InvocationSecret {
  readonly referenceId: string;
  readonly pluginId: string;
  readonly operationId: string;
  readonly audience: string;
  readonly scopes: readonly string[];
  readonly expiresAt: string;
  readonly headerName: string;
  readonly value: string;
}

export interface ProviderSecretBroker {
  resolve(referenceId: string, signal: AbortSignal): Promise<InvocationSecret>;
}

export interface ProviderEgressGrant {
  readonly pluginId: string;
  readonly operationId: string;
  readonly destinationIds: readonly string[];
  readonly secretReferenceIds: readonly string[];
  readonly explicitShare: boolean;
}

export interface ProviderAuditEvent {
  readonly eventType: "ProviderRequestDenied" | "ProviderRequestCompleted";
  readonly pluginId: string;
  readonly operationId: string;
  readonly destinationId: string;
  readonly reasonCode?: string;
  readonly status?: number;
  readonly requestBytes: number;
  readonly responseBytes: number;
}

export interface ProviderAuditSink {
  append(event: ProviderAuditEvent): Promise<void>;
}

export interface ProviderPayloadValidator {
  validateOutbound(
    destinationId: string,
    pathTemplateId: string,
    schemaId: string,
    classification: "MINIMAL_METADATA" | "EXPLICIT_SHARE",
    pathParameters: CanonicalValue,
    value: CanonicalValue,
  ): {
    readonly path: string;
    readonly body: CanonicalValue;
  };
  validateResponse(destinationId: string, value: CanonicalValue): CanonicalValue;
}

export interface ProviderEgressBrokerOptions {
  readonly resolver: ProviderAddressResolver;
  readonly transport: ProviderTransport;
  readonly secrets: ProviderSecretBroker;
  readonly audit: ProviderAuditSink;
  readonly payloads: ProviderPayloadValidator;
  readonly now: () => Date;
}

function ipv4Parts(address: string): readonly number[] {
  return address.split(".").map((part) => Number(part));
}

export function isPublicProviderAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [a = -1, b = -1] = ipv4Parts(address);
    if (
      a <= 0
      || a === 10
      || a === 127
      || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 0 || b === 168))
      || (a === 198 && (b === 18 || b === 19 || b === 51))
      || (a === 203 && b === 0)
    ) return false;
    return true;
  }
  if (family === 6) {
    const normalized = address.toLowerCase();
    return !(
      normalized === "::"
      || normalized === "::1"
      || normalized.startsWith("fc")
      || normalized.startsWith("fd")
      || /^fe[89ab]/.test(normalized)
      || normalized.startsWith("ff")
      || normalized.startsWith("::ffff:")
      || normalized.startsWith("2001:db8:")
      || normalized.startsWith("2001:10:")
      || normalized.startsWith("2001:2:")
      || normalized.startsWith("100:")
    );
  }
  return false;
}

function destinationFor(
  manifest: ProviderPluginManifest,
  request: ProviderRequest,
  grant: ProviderEgressGrant,
): PluginDestination {
  if (!grant.destinationIds.includes(request.destinationId)) {
    throw new PluginRuntimeError("VFY_PROVIDER_DESTINATION_DENIED", "destination was not granted");
  }
  const destination = manifest.permissions.destinations.find(
    (candidate) => candidate.id === request.destinationId,
  );
  if (!destination) {
    throw new PluginRuntimeError("VFY_PROVIDER_DESTINATION_DENIED", "destination was not declared");
  }
  if (
    !destination.methods.includes(request.method)
    || !destination.pathTemplateIds.includes(request.pathTemplateId)
    || !destination.outboundSchemaIds.includes(request.outboundSchemaId)
  ) {
    throw new PluginRuntimeError("VFY_PROVIDER_DESTINATION_DENIED", "provider request exceeds destination declaration");
  }
  if (!destination.outboundClassifications.includes(request.classification)) {
    throw new PluginRuntimeError("VFY_PROVIDER_CLASSIFICATION_DENIED", "outbound classification was not declared");
  }
  if (request.classification === "EXPLICIT_SHARE" && !grant.explicitShare) {
    throw new PluginRuntimeError("VFY_PROVIDER_CLASSIFICATION_DENIED", "explicit-share consent is absent");
  }
  return destination;
}

function assertSecretScope(
  secret: InvocationSecret,
  manifest: ProviderPluginManifest,
  destination: PluginDestination,
  grant: ProviderEgressGrant,
  now: Date,
): void {
  if (
    !grant.secretReferenceIds.includes(secret.referenceId)
    || secret.pluginId !== grant.pluginId
    || secret.operationId !== grant.operationId
    || !destination.secretAudience
    || secret.audience !== destination.secretAudience
    || !Number.isFinite(Date.parse(secret.expiresAt))
    || Date.parse(secret.expiresAt) <= now.getTime()
    || secret.scopes.length !== (destination.secretScopes ?? []).length
    || !(destination.secretScopes ?? []).every((scope) => secret.scopes.includes(scope))
    || !manifest.permissions.secrets.some((permission) =>
      permission.audience === secret.audience
      && permission.scopes.every((scope) => secret.scopes.includes(scope)))
  ) {
    throw new PluginRuntimeError("VFY_PROVIDER_SECRET_DENIED", "secret binding is outside the invocation grant");
  }
  if (!/^[A-Za-z0-9-]{1,64}$/.test(secret.headerName) || /[\r\n]/.test(secret.value)) {
    throw new PluginRuntimeError("VFY_PROVIDER_SECRET_DENIED", "secret attachment is unsafe");
  }
}

function containsSecret(body: Uint8Array, secret: InvocationSecret | undefined): boolean {
  if (!secret || secret.value.length === 0) return false;
  return new TextDecoder().decode(body).includes(secret.value);
}

export class ProviderEgressBroker {
  readonly #options: ProviderEgressBrokerOptions;

  constructor(options: ProviderEgressBrokerOptions) {
    this.#options = options;
  }

  async execute(
    manifest: ProviderPluginManifest,
    grant: ProviderEgressGrant,
    value: unknown,
    signal: AbortSignal,
  ): Promise<ProviderResponse> {
    let request: ProviderRequest;
    let effectiveManifest: ProviderPluginManifest;
    let effectiveGrant: ProviderEgressGrant;
    try {
      const copiedRequest = parseCanonicalJson(canonicalize(value as CanonicalValue));
      assertProviderRequest(copiedRequest);
      request = copiedRequest;
      effectiveManifest = structuredClone(manifest);
      assertProviderPluginManifest(effectiveManifest);
      effectiveGrant = structuredClone(grant);
    } catch {
      throw new PluginRuntimeError("VFY_PROVIDER_REQUEST_MALFORMED", "provider request is malformed");
    }
    let requestBytes = 0;
    try {
      const destination: PluginDestination = destinationFor(
        effectiveManifest,
        request,
        effectiveGrant,
      );
      let outbound: { readonly path: string; readonly body: CanonicalValue };
      try {
        outbound = this.#options.payloads.validateOutbound(
          request.destinationId,
          request.pathTemplateId,
          request.outboundSchemaId,
          request.classification,
          request.pathParameters,
          request.body,
        );
      } catch {
        throw new PluginRuntimeError(
          "VFY_PROVIDER_REQUEST_MALFORMED",
          "provider request failed its outbound schema allowlist",
        );
      }
      if (
        !outbound.path.startsWith("/")
        || outbound.path.startsWith("//")
        || outbound.path.includes("\\")
        || outbound.path.includes("?")
        || outbound.path.includes("#")
        || outbound.path.includes("%")
        || outbound.path.split("/").some((segment) => segment === "." || segment === "..")
      ) throw new PluginRuntimeError("VFY_PROVIDER_REQUEST_MALFORMED", "validated provider path is unsafe");
      const body = new TextEncoder().encode(canonicalize(outbound.body));
      requestBytes = body.byteLength;
      if (body.byteLength > destination.maximumRequestBytes) {
        throw new PluginRuntimeError("VFY_PROVIDER_REQUEST_OVERSIZED", "provider request exceeds byte limit");
      }
      const addresses = await this.#options.resolver.resolve(destination.host, signal);
      if (addresses.length === 0 || addresses.some((address) => !isPublicProviderAddress(address))) {
        throw new PluginRuntimeError("VFY_PROVIDER_DNS_DENIED", "provider DNS resolved to a denied address");
      }
      let secret: InvocationSecret | undefined;
      const headers: Record<string, string> = {
        "accept": "application/json",
        "content-type": "application/json",
      };
      if (request.secretReferenceId) {
        secret = await this.#options.secrets.resolve(request.secretReferenceId, signal);
        assertSecretScope(
          secret,
          effectiveManifest,
          destination,
          effectiveGrant,
          this.#options.now(),
        );
        headers[secret.headerName.toLowerCase()] = secret.value;
      } else if (destination.secretAudience) {
        throw new PluginRuntimeError("VFY_PROVIDER_SECRET_DENIED", "provider destination requires a credential");
      }
      const response = await this.#options.transport.send({
        url: `https://${destination.host}${outbound.path}`,
        host: destination.host,
        resolvedAddresses: addresses,
        method: request.method,
        headers,
        body,
        maximumResponseBytes: destination.maximumResponseBytes,
        signal,
      });
      if (response.status >= 300 && response.status < 400) {
        throw new PluginRuntimeError("VFY_PROVIDER_REDIRECT_DENIED", "provider redirects are denied");
      }
      if (response.body.byteLength > destination.maximumResponseBytes) {
        throw new PluginRuntimeError("VFY_PROVIDER_RESPONSE_OVERSIZED", "provider response exceeds byte limit");
      }
      if (!/^application\/(?:[a-z0-9.+-]*\+)?json(?:;|$)/i.test(response.contentType)) {
        throw new PluginRuntimeError("VFY_PROVIDER_RESPONSE_INVALID", "provider response is not JSON");
      }
      if (containsSecret(response.body, secret)) {
        throw new PluginRuntimeError("VFY_PROVIDER_SECRET_LEAK", "provider response contained a credential canary");
      }
      let parsed: CanonicalValue;
      try {
        parsed = parseCanonicalJson(new TextDecoder().decode(response.body));
      } catch {
        throw new PluginRuntimeError("VFY_PROVIDER_RESPONSE_INVALID", "provider response is invalid canonical JSON");
      }
      let sanitized: CanonicalValue;
      try {
        sanitized = this.#options.payloads.validateResponse(request.destinationId, parsed);
      } catch {
        throw new PluginRuntimeError("VFY_PROVIDER_RESPONSE_INVALID", "provider response failed its schema");
      }
      await this.#options.audit.append({
        eventType: "ProviderRequestCompleted",
        pluginId: effectiveGrant.pluginId,
        operationId: effectiveGrant.operationId,
        destinationId: request.destinationId,
        status: response.status,
        requestBytes: body.byteLength,
        responseBytes: response.body.byteLength,
      });
      return {
        providerRequestId: request.providerRequestId,
        status: response.status,
        body: sanitized,
        byteSize: response.body.byteLength,
      };
    } catch (error) {
      const runtimeError = error instanceof PluginRuntimeError
        ? error
        : new PluginRuntimeError("VFY_PROVIDER_RESPONSE_INVALID", "provider broker failed closed");
      await this.#options.audit.append({
        eventType: "ProviderRequestDenied",
        pluginId: effectiveGrant.pluginId,
        operationId: effectiveGrant.operationId,
        destinationId: request.destinationId,
        reasonCode: runtimeError.code,
        requestBytes,
        responseBytes: 0,
      });
      throw runtimeError;
    }
  }
}
