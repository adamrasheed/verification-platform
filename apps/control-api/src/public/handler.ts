import { randomUUID } from "node:crypto";
import {
  authorizeCloudAction,
} from "@verify-internal/auth";
import type {
  CloudAction,
  CloudAuthorizationDecision,
  CloudAuthorizationRequest,
  CloudPrincipal,
  CloudResourceType,
} from "@verify-internal/auth";
import type {
  DisclosureManifest,
  PublicationLimits,
  SignedPublicationIntent,
} from "@verify-internal/cloud-client";
import { dispatchAdmission } from "@verify-internal/cloud-client";
import {
  decodeCommandRequest,
  encodeCanonicalProtocolDocument,
  parseCanonicalProtocolDocument,
} from "@verify-internal/protocol";
import type {
  ControlApiAuditEvent,
  ControlApiHandler,
  ControlApiOptions,
} from "./types.js";

const MAXIMUM_REQUEST_BYTES = 1_048_576;
const MAXIMUM_LIST_LIMIT = 100;

type RecordValue = Record<string, unknown>;

interface Route {
  readonly operation:
    | "issuePublicationIntent"
    | "publishRun"
    | "listPublishedRuns"
    | "getPublishedRun"
    | "createDispatch"
    | "getDispatch"
    | "cancelDispatch";
  readonly action: CloudAction;
  readonly tenantId: string;
  readonly projectId: string;
  readonly resourceType: CloudResourceType;
  readonly resourceId: string;
  readonly publishedRunId?: string;
  readonly dispatchId?: string;
}

interface IntentBody {
  readonly schemaVersion: 1;
  readonly manifest: DisclosureManifest;
  readonly manifestDigest: `sha256:${string}`;
  readonly retentionClass: string;
  readonly limits: PublicationLimits;
  readonly nonce: string;
  readonly expiresAt: string;
}

interface PublicationBody {
  readonly schemaVersion: 1;
  readonly signedIntent: SignedPublicationIntent;
  readonly manifest: DisclosureManifest;
  readonly manifestDigest: `sha256:${string}`;
  readonly payload: unknown;
}

function record(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: RecordValue, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}

function exactKeysWithOptional(
  value: RecordValue,
  required: readonly string[],
  optional: readonly string[],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => allowed.has(key));
}

function bounded(value: unknown, maximum = 256): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maximum
    && !/[\u0000-\u001f\u007f/\\]/.test(value);
}

function digest(value: unknown): value is `sha256:${string}` {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
}

function decodeSegment(value: string): string | undefined {
  try {
    const decoded = decodeURIComponent(value);
    return bounded(decoded) && decoded !== "." && decoded !== ".." ? decoded : undefined;
  } catch {
    return undefined;
  }
}

function routeFor(request: Request): Route | undefined {
  const url = new URL(request.url);
  const raw = url.pathname.split("/").slice(1);
  if (raw.at(-1) === "") return undefined;
  const segments = raw.map(decodeSegment);
  if (segments.some((segment) => segment === undefined)) return undefined;
  const [version, tenants, tenantId, projects, projectId, resource, resourceId, subresource] =
    segments as string[];
  if (version !== "v1" || tenants !== "tenants" || projects !== "projects"
    || !tenantId || !projectId) return undefined;
  if (request.method === "POST"
    && segments.length === 6
    && resource === "dispatches"
    && url.search === "") {
    return {
      operation: "createDispatch",
      action: "dispatch:create",
      tenantId,
      projectId,
      resourceType: "project",
      resourceId: projectId,
    };
  }
  if (request.method === "GET"
    && segments.length === 7
    && resource === "dispatches"
    && resourceId
    && url.search === "") {
    return {
      operation: "getDispatch",
      action: "project:read",
      tenantId,
      projectId,
      resourceType: "project",
      resourceId: projectId,
      dispatchId: resourceId,
    };
  }
  if (request.method === "POST"
    && segments.length === 8
    && resource === "dispatches"
    && resourceId
    && subresource === "cancellations"
    && url.search === "") {
    return {
      operation: "cancelDispatch",
      action: "dispatch:cancel",
      tenantId,
      projectId,
      resourceType: "dispatch",
      resourceId,
      dispatchId: resourceId,
    };
  }
  if (request.method === "POST"
    && segments.length === 6
    && resource === "publication-intents"
    && url.search === "") {
    return {
      operation: "issuePublicationIntent",
      action: "run:publish",
      tenantId,
      projectId,
      resourceType: "project",
      resourceId: projectId,
    };
  }
  if (request.method === "POST"
    && segments.length === 6
    && resource === "publications"
    && url.search === "") {
    return {
      operation: "publishRun",
      action: "run:publish",
      tenantId,
      projectId,
      resourceType: "project",
      resourceId: projectId,
    };
  }
  if (request.method === "GET"
    && segments.length === 6
    && resource === "runs") {
    return {
      operation: "listPublishedRuns",
      action: "project:read",
      tenantId,
      projectId,
      resourceType: "project",
      resourceId: projectId,
    };
  }
  if (request.method === "GET"
    && segments.length === 7
    && resource === "runs"
    && resourceId) {
    return {
      operation: "getPublishedRun",
      action: "run:readPublished",
      tenantId,
      projectId,
      resourceType: "publishedRun",
      resourceId,
      publishedRunId: resourceId,
    };
  }
  return undefined;
}

function responseHeaders(correlationId: string): Headers {
  return new Headers({
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    "x-correlation-id": correlationId,
  });
}

function jsonResponse(
  status: number,
  value: unknown,
  correlationId: string,
): Response {
  return new Response(new TextDecoder().decode(encodeCanonicalProtocolDocument(value)), {
    status,
    headers: responseHeaders(correlationId),
  });
}

function errorResponse(
  status: number,
  code: `VFY_CONTROL_API_${string}`,
  category: "invalid" | "authentication" | "permission" | "resource" | "internal",
  retryability: "never" | "safe",
  operation: string,
  correlationId: string,
): Response {
  return jsonResponse(status, {
    error: {
      code,
      category,
      retryability,
      message: status >= 500 ? "control API request failed" : "control API request was rejected",
      component: "@verify-internal/control-api",
      operation,
      blocksRequiredProof: false,
      causes: [],
      diagnosticRefs: [],
      details: { correlationId },
    },
  }, correlationId);
}

async function requestBytes(request: Request): Promise<Uint8Array> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length < 0 || length > MAXIMUM_REQUEST_BYTES) {
      throw new TypeError("VFY_CONTROL_API_REQUEST_TOO_LARGE");
    }
  }
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAXIMUM_REQUEST_BYTES) {
        await reader.cancel();
        throw new TypeError("VFY_CONTROL_API_REQUEST_TOO_LARGE");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function jsonBody(request: Request): Promise<unknown> {
  if (request.headers.get("content-type") !== "application/json"
    || ![null, "identity"].includes(request.headers.get("content-encoding"))) {
    throw new TypeError("VFY_CONTROL_API_CONTENT_TYPE_DENIED");
  }
  const bytes = await requestBytes(request);
  if (bytes.byteLength === 0) throw new TypeError("VFY_CONTROL_API_REQUEST_INVALID");
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return parseCanonicalProtocolDocument(text);
  } catch {
    throw new TypeError("VFY_CONTROL_API_REQUEST_INVALID");
  }
}

function idempotencyKey(request: Request): string {
  const key = request.headers.get("idempotency-key");
  if (!bounded(key, 512)) throw new TypeError("VFY_CONTROL_API_IDEMPOTENCY_REQUIRED");
  return key;
}

function intentBody(value: unknown): IntentBody {
  if (!record(value)
    || !exactKeys(value, [
      "schemaVersion", "manifest", "manifestDigest", "retentionClass", "limits", "nonce", "expiresAt",
    ])
    || value.schemaVersion !== 1
    || !record(value.manifest)
    || !digest(value.manifestDigest)
    || !bounded(value.retentionClass, 128)
    || !record(value.limits)
    || !exactKeys(value.limits, [
      "maxEncodedPayloadBytes", "maxPromiseCount", "maxProofCount", "maxEvidenceCount",
    ])
    || !bounded(value.nonce)
    || typeof value.expiresAt !== "string") {
    throw new TypeError("VFY_CONTROL_API_REQUEST_INVALID");
  }
  return value as unknown as IntentBody;
}

function publicationBody(value: unknown): PublicationBody {
  if (!record(value)
    || !exactKeys(value, [
      "schemaVersion", "signedIntent", "manifest", "manifestDigest", "payload",
    ])
    || value.schemaVersion !== 1
    || !record(value.signedIntent)
    || !record(value.manifest)
    || !digest(value.manifestDigest)
    || !record(value.payload)) {
    throw new TypeError("VFY_CONTROL_API_REQUEST_INVALID");
  }
  return value as unknown as PublicationBody;
}

function dispatchBody(value: unknown) {
  const requestKeys = [
    "schemaVersion", "command", "invocationId", "arguments",
    "configurationReferences", "policyReferences", "consentGrantReferences",
    "offline", "outputMode", "environment",
  ];
  if (!record(value)
    || !exactKeysWithOptional(value, requestKeys, ["deadlineMs"])
    || !record(value.arguments)
    || !exactKeys(value.arguments, ["workloadBinding", "verifyRequest", "idempotencyKey"])
    || !record(value.environment)
    || !exactKeys(value.environment, ["platform", "allowlistedBindings"])
    || !record(value.arguments.verifyRequest)
    || !exactKeysWithOptional(
      value.arguments.verifyRequest,
      [...requestKeys, "workspace"],
      ["deadlineMs"],
    )
    || !record(value.arguments.verifyRequest.environment)
    || !exactKeys(value.arguments.verifyRequest.environment, ["platform", "allowlistedBindings"])
    || !record(value.arguments.verifyRequest.workspace)
    || !exactKeysWithOptional(value.arguments.verifyRequest.workspace, ["rootBinding"], ["expectedRevision"])) {
    throw new TypeError("VFY_CONTROL_API_REQUEST_INVALID");
  }
  const decoded = decodeCommandRequest(value);
  if (decoded.kind !== "ok" || decoded.value.command !== "dispatchVerification") {
    throw new TypeError("VFY_CONTROL_API_REQUEST_INVALID");
  }
  return decoded.value;
}

function cancellationBody(value: unknown): void {
  if (!record(value) || !exactKeys(value, ["schemaVersion"]) || value.schemaVersion !== 1) {
    throw new TypeError("VFY_CONTROL_API_REQUEST_INVALID");
  }
}

function bearerToken(request: Request): string | undefined {
  const authorization = request.headers.get("authorization");
  if (!authorization || !authorization.startsWith("Bearer ")) return undefined;
  const token = authorization.slice("Bearer ".length);
  return bounded(token, 16_384) ? token : undefined;
}

function authorizationRequest(route: Route): CloudAuthorizationRequest {
  return {
    action: route.action,
    resource: {
      tenantId: route.tenantId,
      resourceType: route.resourceType,
      resourceId: route.resourceId,
    },
  };
}

async function audit(
  options: ControlApiOptions,
  route: Route,
  principal: CloudPrincipal | undefined,
  decision: CloudAuthorizationDecision | undefined,
  correlationId: string,
  now: Date,
): Promise<void> {
  const allowed = decision?.allowed === true;
  const event: ControlApiAuditEvent = {
    schemaVersion: 1,
    occurredAt: now.toISOString(),
    correlationId,
    principalId: principal?.id ?? "anonymous",
    principalKind: principal?.kind ?? "anonymous",
    action: route.action,
    tenantId: route.tenantId,
    resourceType: route.resourceType,
    resourceId: route.resourceId,
    phase: "authorization",
    outcome: allowed ? "allowed" : "denied",
    reasonCode: allowed ? "AUTHORIZED" : decision?.reasonCode ?? "UNAUTHENTICATED",
    ...(allowed ? {
      grantId: decision.grantId,
      policyRevision: decision.policyRevision,
    } : {}),
  };
  await options.audit.record(event);
}

async function auditOperation(
  options: ControlApiOptions,
  route: Route,
  principal: CloudPrincipal,
  decision: Extract<CloudAuthorizationDecision, { readonly allowed: true }>,
  correlationId: string,
  now: Date,
  succeeded: boolean,
): Promise<void> {
  await options.audit.record({
    schemaVersion: 1,
    occurredAt: now.toISOString(),
    correlationId,
    principalId: principal.id,
    principalKind: principal.kind,
    action: route.action,
    tenantId: route.tenantId,
    resourceType: route.resourceType,
    resourceId: route.resourceId,
    phase: "operation",
    outcome: succeeded ? "succeeded" : "failed",
    reasonCode: succeeded ? "SUCCEEDED" : "FAILED",
    grantId: decision.grantId,
    policyRevision: decision.policyRevision,
  });
}

function safeFailure(error: unknown, operation: string, correlationId: string): Response {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("IDEMPOTENCY_CONFLICT")
    || message.includes("REPLAY_DETECTED")
    || message.includes("ADMISSION_CONFLICT")) {
    return errorResponse(409, "VFY_CONTROL_API_IDEMPOTENCY_CONFLICT", "invalid", "never", operation, correlationId);
  }
  if (message.includes("TOO_LARGE") || message.includes("LIMIT_EXCEEDED")) {
    return errorResponse(413, "VFY_CONTROL_API_REQUEST_TOO_LARGE", "resource", "never", operation, correlationId);
  }
  if (message.startsWith("VFY_") && !message.includes("STORE_INCONSISTENT")) {
    return errorResponse(400, "VFY_CONTROL_API_REQUEST_INVALID", "invalid", "never", operation, correlationId);
  }
  return errorResponse(500, "VFY_CONTROL_API_INTERNAL", "internal", "safe", operation, correlationId);
}

export function createControlApiHandler(options: ControlApiOptions): ControlApiHandler {
  if (!bounded(options.expectedAudience)) {
    throw new TypeError("control API audience is invalid");
  }
  const nowSource = options.now ?? (() => new Date());
  const correlationSource = options.correlationId ?? randomUUID;
  return async (request): Promise<Response> => {
    const correlationId = correlationSource();
    const now = nowSource();
    const route = routeFor(request);
    if (!route) {
      return errorResponse(404, "VFY_CONTROL_API_ROUTE_NOT_FOUND", "invalid", "never", "route", correlationId);
    }
    const token = bearerToken(request);
    const principal = token ? await options.authenticator.authenticate(token, now) : undefined;
    if (!principal) {
      await audit(options, route, undefined, undefined, correlationId, now);
      return errorResponse(401, "VFY_CONTROL_API_UNAUTHENTICATED", "authentication", "never", route.operation, correlationId);
    }
    const requestAuthorization = authorizationRequest(route);
    const grants = await options.grants.resolve(principal, requestAuthorization, now);
    const decision = authorizeCloudAction(
      principal,
      requestAuthorization,
      grants,
      options.expectedAudience,
      now,
    );
    await audit(options, route, principal, decision, correlationId, now);
    if (!decision.allowed) {
      return errorResponse(404, "VFY_CONTROL_API_NOT_AUTHORIZED", "permission", "never", route.operation, correlationId);
    }

    try {
      const authorization = { tenantId: route.tenantId, projectId: route.projectId };
      if (route.operation === "issuePublicationIntent") {
        const key = idempotencyKey(request);
        const body = intentBody(await jsonBody(request));
        const signedIntent = await options.intents.issue({
          principalId: principal.id,
          authorization,
          authorizationGrantId: decision.grantId,
          authorizationPolicyRevision: decision.policyRevision,
          idempotencyKey: key,
          manifest: body.manifest,
          manifestDigest: body.manifestDigest,
          retentionClass: body.retentionClass,
          limits: body.limits,
          nonce: body.nonce,
          expiresAt: body.expiresAt,
          now,
        });
        await auditOperation(options, route, principal, decision, correlationId, now, true);
        return jsonResponse(201, signedIntent, correlationId);
      }
      if (route.operation === "publishRun") {
        const key = idempotencyKey(request);
        const body = publicationBody(await jsonBody(request));
        const receipt = await options.publications.ingest({
          signedIntent: body.signedIntent,
          manifest: body.manifest,
          manifestDigest: body.manifestDigest,
          payloadBytes: encodeCanonicalProtocolDocument(body.payload),
          idempotencyKey: key,
          contentType: "application/json",
          contentEncoding: "identity",
        }, authorization, now);
        await auditOperation(options, route, principal, decision, correlationId, now, true);
        return jsonResponse(201, receipt, correlationId);
      }
      if (route.operation === "createDispatch") {
        const key = idempotencyKey(request);
        const body = dispatchBody(await jsonBody(request));
        if (body.arguments.idempotencyKey !== key) {
          throw new TypeError("VFY_DISPATCH_IDEMPOTENCY_CONFLICT");
        }
        const receipt = await options.dispatches.admit(dispatchAdmission(
          authorization,
          body,
          now,
        ));
        await auditOperation(options, route, principal, decision, correlationId, now, true);
        return jsonResponse(202, receipt.result, correlationId);
      }
      if (route.operation === "cancelDispatch") {
        const cancellationId = idempotencyKey(request);
        cancellationBody(await jsonBody(request));
        const dispatch = await options.dispatches.requestCancellation(
          authorization,
          route.dispatchId as string,
          cancellationId,
          now,
        );
        if (!dispatch) {
          await auditOperation(options, route, principal, decision, correlationId, now, false);
          return errorResponse(404, "VFY_CONTROL_API_NOT_AUTHORIZED", "permission", "never", route.operation, correlationId);
        }
        await auditOperation(options, route, principal, decision, correlationId, now, true);
        return jsonResponse(202, dispatch, correlationId);
      }
      if (route.operation === "getDispatch") {
        const dispatch = await options.dispatches.resolve(
          authorization,
          route.dispatchId as string,
        );
        if (!dispatch) {
          await auditOperation(options, route, principal, decision, correlationId, now, false);
          return errorResponse(404, "VFY_CONTROL_API_NOT_AUTHORIZED", "permission", "never", route.operation, correlationId);
        }
        await auditOperation(options, route, principal, decision, correlationId, now, true);
        return jsonResponse(200, dispatch, correlationId);
      }
      if (route.operation === "listPublishedRuns") {
        const url = new URL(request.url);
        const allowedParameters = new Set(["limit", "cursor"]);
        if ([...url.searchParams.keys()].some((key) => !allowedParameters.has(key))
          || [...allowedParameters].some((key) => url.searchParams.getAll(key).length > 1)) {
          throw new TypeError("VFY_CONTROL_API_REQUEST_INVALID");
        }
        const rawLimit = url.searchParams.get("limit") ?? "50";
        const limit = Number(rawLimit);
        const cursor = url.searchParams.get("cursor") ?? undefined;
        if (!Number.isSafeInteger(limit) || limit <= 0 || limit > MAXIMUM_LIST_LIMIT
          || (cursor !== undefined && !bounded(cursor, 512))) {
          throw new TypeError("VFY_CONTROL_API_REQUEST_INVALID");
        }
        const page = await options.publishedRuns.listPublishedRuns(
          authorization,
          { limit, ...(cursor === undefined ? {} : { cursor }) },
        );
        await auditOperation(options, route, principal, decision, correlationId, now, true);
        return jsonResponse(200, page, correlationId);
      }
      const resolution = await options.publishedRuns.resolvePublishedRun(
        authorization,
        route.publishedRunId as string,
      );
      if (!resolution) {
        await auditOperation(options, route, principal, decision, correlationId, now, false);
        return errorResponse(404, "VFY_CONTROL_API_NOT_AUTHORIZED", "permission", "never", route.operation, correlationId);
      }
      await auditOperation(options, route, principal, decision, correlationId, now, true);
      return jsonResponse(200, resolution, correlationId);
    } catch (error) {
      await auditOperation(options, route, principal, decision, correlationId, now, false);
      return safeFailure(error, route.operation, correlationId);
    }
  };
}
