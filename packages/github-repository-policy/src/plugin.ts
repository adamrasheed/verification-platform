import readline from "node:readline";

type JsonRecord = Record<string, unknown>;
type Phase = "handshake" | "operation" | "repository" | "protection" | "rules" | "complete";

const DESTINATIONS = [
  "github-repository-metadata",
  "github-branch-protection",
  "github-effective-rules",
] as const;
const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let phase: Phase = "handshake";
let operationId = "";
let repositoryBinding = "";
let secretReferenceId = "";
let defaultBranch = "";
let branchProtection: unknown;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: JsonRecord, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => key in value);
}

function write(messageType: string, requestId: string, payload: unknown): void {
  process.stdout.write(`${JSON.stringify({
    protocolVersion: "1.0",
    messageType,
    requestId,
    payload,
  })}\n`);
}

function operationalError(error: unknown): {
  readonly code:
    | "VFY_PROVIDER_AUTHENTICATION_FAILED"
    | "VFY_PROVIDER_NOT_FOUND"
    | "VFY_PROVIDER_PERMISSION_DENIED"
    | "VFY_PROVIDER_RATE_LIMITED"
    | "VFY_PROVIDER_UNAVAILABLE";
  readonly retryability: "never" | "safe" | "policy_required";
  readonly message: string;
} {
  switch (error) {
    case "authentication":
      return {
        code: "VFY_PROVIDER_AUTHENTICATION_FAILED",
        retryability: "policy_required",
        message: "provider authentication failed",
      };
    case "permission":
      return {
        code: "VFY_PROVIDER_PERMISSION_DENIED",
        retryability: "policy_required",
        message: "provider permission was denied",
      };
    case "not-found":
      return {
        code: "VFY_PROVIDER_NOT_FOUND",
        retryability: "never",
        message: "provider resource was not found",
      };
    case "rate-limited":
      return {
        code: "VFY_PROVIDER_RATE_LIMITED",
        retryability: "safe",
        message: "provider request was rate limited",
      };
    default:
      return {
        code: "VFY_PROVIDER_UNAVAILABLE",
        retryability: "safe",
        message: "provider service is unavailable",
      };
  }
}

function failFromProvider(body: unknown): void {
  const reason = isRecord(body) ? body.error : undefined;
  write("error", operationId, operationalError(reason));
  phase = "complete";
}

function providerRequest(
  providerRequestId: string,
  destinationId: string,
  pathTemplateId: string,
  pathParameters: JsonRecord,
): void {
  write("provider.request", operationId, {
    providerRequestId,
    destinationId,
    method: "GET",
    pathTemplateId,
    pathParameters,
    outboundSchemaId: "github.repository-policy.request.v1",
    classification: "MINIMAL_METADATA",
    body: { repositoryBinding },
    secretReferenceId,
  });
}

function assertOperation(value: unknown): JsonRecord {
  const payload = isRecord(value) ? value : undefined;
  const input = payload && isRecord(payload.input) ? payload.input : undefined;
  const grantedDestinationIds = payload?.grantedDestinationIds;
  const secretReferenceIds = payload?.secretReferenceIds;
  if (
    !payload
    || payload.operation !== "observeProvider"
    || typeof payload.operationId !== "string"
    || !Array.isArray(grantedDestinationIds)
    || grantedDestinationIds.length !== DESTINATIONS.length
    || !DESTINATIONS.every((destination) => grantedDestinationIds.includes(destination))
    || !Array.isArray(secretReferenceIds)
    || secretReferenceIds.length !== 1
    || typeof secretReferenceIds[0] !== "string"
    || !input
    || !exactKeys(input, ["repositoryBinding"])
    || typeof input.repositoryBinding !== "string"
    || input.repositoryBinding.length === 0
    || input.repositoryBinding.length > 256
  ) throw new TypeError("invalid operation request");
  return payload;
}

function assertProviderResponse(value: unknown, expectedId: string): JsonRecord {
  const payload = isRecord(value) ? value : undefined;
  if (
    !payload
    || !exactKeys(payload, ["providerRequestId", "status", "body", "byteSize"])
    || payload.providerRequestId !== expectedId
    || !Number.isSafeInteger(payload.status)
    || Number(payload.status) < 100
    || Number(payload.status) > 599
    || !Number.isSafeInteger(payload.byteSize)
    || Number(payload.byteSize) < 0
  ) throw new TypeError("invalid provider response");
  return payload;
}

function handleHandshake(message: JsonRecord): void {
  if (
    phase !== "handshake"
    || message.messageType !== "handshake.request"
    || typeof message.requestId !== "string"
  ) throw new TypeError("invalid handshake");
  write("handshake.response", message.requestId, {
    selectedVersion: { major: 1, minor: 0 },
    pluginId: "github-repository-policy",
  });
  phase = "operation";
}

function handleOperation(message: JsonRecord): void {
  if (
    phase !== "operation"
    || message.messageType !== "operation.request"
    || typeof message.requestId !== "string"
  ) throw new TypeError("invalid operation framing");
  const payload = assertOperation(message.payload);
  operationId = message.requestId;
  repositoryBinding = (payload.input as JsonRecord).repositoryBinding as string;
  secretReferenceId = (payload.secretReferenceIds as unknown[])[0] as string;
  providerRequest(
    "github-policy:repository",
    "github-repository-metadata",
    "github-repository-metadata",
    {},
  );
  phase = "repository";
}

function handleRepository(message: JsonRecord): void {
  if (phase !== "repository" || message.messageType !== "provider.response") {
    throw new TypeError("unexpected repository response");
  }
  const payload = assertProviderResponse(message.payload, "github-policy:repository");
  const body = isRecord(payload.body) ? payload.body : undefined;
  if (payload.status !== 200 || !body || typeof body.defaultBranch !== "string") {
    failFromProvider(payload.body);
    return;
  }
  defaultBranch = body.defaultBranch;
  providerRequest(
    "github-policy:protection",
    "github-branch-protection",
    "github-branch-protection",
    { branch: defaultBranch },
  );
  phase = "protection";
}

function handleProtection(message: JsonRecord): void {
  if (phase !== "protection" || message.messageType !== "provider.response") {
    throw new TypeError("unexpected branch protection response");
  }
  const payload = assertProviderResponse(message.payload, "github-policy:protection");
  if ((payload.status !== 200 && payload.status !== 404) || !isRecord(payload.body)) {
    failFromProvider(payload.body);
    return;
  }
  if ("error" in payload.body) {
    failFromProvider(payload.body);
    return;
  }
  branchProtection = payload.body;
  providerRequest(
    "github-policy:rules",
    "github-effective-rules",
    "github-effective-rules",
    { branch: defaultBranch },
  );
  phase = "rules";
}

function handleRules(message: JsonRecord): void {
  if (phase !== "rules" || message.messageType !== "provider.response") {
    throw new TypeError("unexpected effective rules response");
  }
  const payload = assertProviderResponse(message.payload, "github-policy:rules");
  const body = isRecord(payload.body) ? payload.body : undefined;
  if (payload.status !== 200 || !body || !Array.isArray(body.rules)) {
    failFromProvider(payload.body);
    return;
  }
  write("contribution", operationId, {
    kind: "provider.repository-policy",
    schemaVersion: 1,
    repositoryBinding,
    defaultBranch,
    branchProtection,
    effectiveRules: body.rules,
  });
  write("complete", operationId, { contributionCount: 1 });
  phase = "complete";
}

function handleMessage(message: JsonRecord): void {
  if (message.messageType === "cancel.request") {
    phase = "complete";
    lines.close();
    return;
  }
  if (phase === "handshake") handleHandshake(message);
  else if (phase === "operation") handleOperation(message);
  else if (phase === "repository") handleRepository(message);
  else if (phase === "protection") handleProtection(message);
  else if (phase === "rules") handleRules(message);
  else throw new TypeError("message received after completion");
}

for await (const line of lines) {
  try {
    const parsed: unknown = JSON.parse(line);
    if (!isRecord(parsed)) throw new TypeError("message must be an object");
    handleMessage(parsed);
  } catch {
    process.exitCode = 2;
    lines.close();
  }
}
