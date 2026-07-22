import { createHash } from "node:crypto";
import {
  encodeCanonicalProtocolDocument,
} from "@verify-internal/protocol";
import {
  assertDisclosureManifest,
  verifyDisclosureBytes,
} from "./disclosure.js";
import type {
  DisclosureManifest,
  PolicyBundle,
  PublicationAuthorizationContext,
  PublicationIngestionReceipt,
  PublicationIngestionRequest,
  PublicationIngestionStore,
  PublicationIntent,
  PublicationIntentOptions,
  PublicationIntentSignatureVerifier,
  PublicationIntentSigningOperation,
  PublicationLimits,
  SignedPublicationIntent,
} from "./types.js";
import { assertPolicyBundle } from "./validation.js";

const INTENT_AUDIENCE = "verify-cloud-publication" as const;
const MAXIMUM_INTENT_LIFETIME_MS = 5 * 60 * 1_000;
const PLATFORM_LIMITS: PublicationLimits = {
  maxEncodedPayloadBytes: 1_048_576,
  maxPromiseCount: 10_000,
  maxProofCount: 50_000,
  maxEvidenceCount: 50_000,
};
const MAXIMUM_JSON_DEPTH = 32;

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: RecordValue, required: readonly string[]): boolean {
  return Object.keys(value).length === required.length
    && required.every((key) => Object.hasOwn(value, key));
}

function bounded(value: unknown, maximum = 256): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maximum
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function digest(value: unknown): value is `sha256:${string}` {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
}

function instant(value: unknown): number | undefined {
  if (typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function sha256(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function assertLimits(value: unknown): asserts value is PublicationLimits {
  if (!isRecord(value)
    || !exactKeys(value, [
      "maxEncodedPayloadBytes", "maxPromiseCount", "maxProofCount", "maxEvidenceCount",
    ])) throw new TypeError("VFY_PUBLICATION_INTENT_MALFORMED: invalid limits");
  for (const [key, platformMaximum] of Object.entries(PLATFORM_LIMITS)) {
    const limit = value[key];
    if (!Number.isSafeInteger(limit) || (limit as number) < 0 || (limit as number) > platformMaximum) {
      throw new TypeError("VFY_PUBLICATION_INTENT_MALFORMED: invalid limits");
    }
  }
}

export function assertPublicationIntent(value: unknown): asserts value is PublicationIntent {
  if (!isRecord(value)
    || !exactKeys(value, [
      "schemaVersion", "intentId", "audience", "tenantId", "projectId", "purpose",
      "manifestDigest", "payloadDigest", "idempotencyKey", "retentionClass", "limits", "policy",
      "nonce", "issuedAt", "expiresAt",
    ])
    || value.schemaVersion !== 1
    || !bounded(value.intentId)
    || value.audience !== INTENT_AUDIENCE
    || !bounded(value.tenantId)
    || !bounded(value.projectId)
    || !bounded(value.purpose, 128)
    || !digest(value.manifestDigest)
    || !digest(value.payloadDigest)
    || !bounded(value.idempotencyKey, 512)
    || !bounded(value.retentionClass, 128)
    || !bounded(value.nonce)
    || !isRecord(value.policy)
    || !exactKeys(value.policy, ["policyId", "revisionId"])
    || !bounded(value.policy.policyId)
    || !bounded(value.policy.revisionId)) {
    throw new TypeError("VFY_PUBLICATION_INTENT_MALFORMED: invalid intent");
  }
  assertLimits(value.limits);
  const issuedAt = instant(value.issuedAt);
  const expiresAt = instant(value.expiresAt);
  if (issuedAt === undefined
    || expiresAt === undefined
    || expiresAt <= issuedAt
    || expiresAt - issuedAt > MAXIMUM_INTENT_LIFETIME_MS) {
    throw new TypeError("VFY_PUBLICATION_INTENT_MALFORMED: invalid intent lifetime");
  }
}

export function assertSignedPublicationIntent(
  value: unknown,
): asserts value is SignedPublicationIntent {
  if (!isRecord(value)
    || !exactKeys(value, ["intent", "signature"])
    || !isRecord(value.signature)
    || !exactKeys(value.signature, ["algorithm", "keyId", "value"])
    || value.signature.algorithm !== "Ed25519"
    || !bounded(value.signature.keyId)
    || typeof value.signature.value !== "string"
    || !/^[A-Za-z0-9_-]{86}$/.test(value.signature.value)) {
    throw new TypeError("VFY_PUBLICATION_INTENT_MALFORMED: invalid signed intent");
  }
  assertPublicationIntent(value.intent);
}

export function publicationIntentSigningBytes(value: SignedPublicationIntent): Uint8Array {
  assertSignedPublicationIntent(value);
  return encodeCanonicalProtocolDocument(value.intent);
}

function assertPolicyAuthorizesManifest(
  policy: PolicyBundle,
  manifest: DisclosureManifest,
  retentionClass: string,
  issuedAt: number,
  expiresAt: number,
): void {
  assertPolicyBundle(policy);
  const matchingRule = policy.publicationRules.some((rule) =>
    rule.purpose === manifest.purpose
    && rule.payloadSchemaMajor === manifest.payloadSchema.major
    && rule.retentionClasses.includes(retentionClass));
  if (policy.tenantId !== manifest.destination.tenantId
    || !policy.actions.includes("run:publish")
    || !matchingRule
    || Date.parse(policy.issuedAt) > issuedAt
    || Date.parse(policy.expiresAt) < expiresAt) {
    throw new TypeError("VFY_PUBLICATION_POLICY_DENIED: policy does not authorize the exact manifest");
  }
}

export async function issuePublicationIntent(
  manifest: DisclosureManifest,
  manifestDigest: `sha256:${string}`,
  policy: PolicyBundle,
  options: PublicationIntentOptions,
  signing: PublicationIntentSigningOperation,
): Promise<SignedPublicationIntent> {
  assertDisclosureManifest(manifest);
  if (!digest(manifestDigest)
    || sha256(encodeCanonicalProtocolDocument(manifest)) !== manifestDigest) {
    throw new TypeError("VFY_PUBLICATION_INTENT_MISMATCH: manifest digest mismatch");
  }
  assertLimits(options.limits);
  const issuedAt = instant(options.issuedAt);
  const expiresAt = instant(options.expiresAt);
  if (issuedAt === undefined || expiresAt === undefined) {
    throw new TypeError("VFY_PUBLICATION_INTENT_MALFORMED: invalid intent lifetime");
  }
  if (expiresAt > Date.parse(manifest.expiresAt)
    || options.limits.maxEncodedPayloadBytes < manifest.encodedPayloadBytes) {
    throw new TypeError("VFY_PUBLICATION_INTENT_MISMATCH: intent exceeds manifest or size bounds");
  }
  assertPolicyAuthorizesManifest(
    policy,
    manifest,
    options.retentionClass,
    issuedAt,
    expiresAt,
  );
  const intent: PublicationIntent = {
    schemaVersion: 1,
    intentId: options.intentId,
    audience: INTENT_AUDIENCE,
    tenantId: manifest.destination.tenantId,
    projectId: manifest.destination.projectId,
    purpose: manifest.purpose,
    manifestDigest,
    payloadDigest: manifest.payloadDigest,
    idempotencyKey: options.idempotencyKey,
    retentionClass: options.retentionClass,
    limits: structuredClone(options.limits),
    policy: { policyId: policy.policyId, revisionId: policy.revisionId },
    nonce: options.nonce,
    issuedAt: options.issuedAt,
    expiresAt: options.expiresAt,
  };
  assertPublicationIntent(intent);
  if (!bounded(signing.keyId)) {
    throw new TypeError("VFY_PUBLICATION_INTENT_MALFORMED: invalid signing key ID");
  }
  const signature = await signing.sign(encodeCanonicalProtocolDocument(intent));
  if (!(signature instanceof Uint8Array) || signature.byteLength !== 64) {
    throw new TypeError("VFY_PUBLICATION_INTENT_MALFORMED: signer returned an invalid signature");
  }
  return {
    intent,
    signature: {
      algorithm: "Ed25519",
      keyId: signing.keyId,
      value: Buffer.from(signature).toString("base64url"),
    },
  };
}

export async function verifyPublicationIntent(
  value: unknown,
  authorization: PublicationAuthorizationContext,
  now: Date,
  verifier: PublicationIntentSignatureVerifier,
): Promise<PublicationIntent> {
  assertSignedPublicationIntent(value);
  const currentTime = now.getTime();
  if (!Number.isFinite(currentTime)) {
    throw new TypeError("VFY_PUBLICATION_INTENT_MALFORMED: invalid current time");
  }
  if (value.intent.tenantId !== authorization.tenantId
    || value.intent.projectId !== authorization.projectId) {
    throw new TypeError("VFY_PUBLICATION_NOT_AUTHORIZED: intent resource mismatch");
  }
  if (currentTime < Date.parse(value.intent.issuedAt)
    || currentTime >= Date.parse(value.intent.expiresAt)) {
    throw new TypeError("VFY_PUBLICATION_INTENT_EXPIRED: intent is not currently valid");
  }
  const signature = Buffer.from(value.signature.value, "base64url");
  if (!await verifier(
    value.signature.keyId,
    encodeCanonicalProtocolDocument(value.intent),
    signature,
  )) throw new TypeError("VFY_PUBLICATION_INTENT_SIGNATURE_INVALID: signature rejected");
  return structuredClone(value.intent);
}

function assertEnvelopeDepth(bytes: Uint8Array): void {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new TypeError("VFY_CLOUD_PAYLOAD_MALFORMED: payload is not valid UTF-8");
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (const character of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === "\"") inString = false;
      continue;
    }
    if (character === "\"") inString = true;
    else if (character === "{" || character === "[") {
      depth += 1;
      if (depth > MAXIMUM_JSON_DEPTH) {
        throw new TypeError("VFY_CLOUD_PAYLOAD_TOO_DEEP: JSON depth exceeds limit");
      }
    } else if (character === "}" || character === "]") depth -= 1;
  }
}

export class PublicationIngestionService {
  readonly #store: PublicationIngestionStore;
  readonly #verifier: PublicationIntentSignatureVerifier;

  constructor(
    store: PublicationIngestionStore,
    verifier: PublicationIntentSignatureVerifier,
  ) {
    this.#store = store;
    this.#verifier = verifier;
  }

  async ingest(
    request: PublicationIngestionRequest,
    authorization: PublicationAuthorizationContext,
    now: Date,
  ): Promise<PublicationIngestionReceipt> {
    if (request.contentType !== "application/json" || request.contentEncoding !== "identity") {
      throw new TypeError("VFY_PUBLICATION_CONTENT_TYPE_DENIED: only uncompressed JSON is accepted");
    }
    if (!(request.payloadBytes instanceof Uint8Array)) {
      throw new TypeError("VFY_CLOUD_PAYLOAD_MALFORMED: payload bytes are required");
    }
    const intent = await verifyPublicationIntent(
      request.signedIntent,
      authorization,
      now,
      this.#verifier,
    );
    if (!bounded(request.idempotencyKey, 512)
      || request.idempotencyKey !== intent.idempotencyKey
      || request.manifestDigest !== intent.manifestDigest) {
      throw new TypeError("VFY_PUBLICATION_INTENT_MISMATCH: request identity or manifest mismatch");
    }
    assertDisclosureManifest(request.manifest);
    if (sha256(encodeCanonicalProtocolDocument(request.manifest)) !== request.manifestDigest
      || request.manifest.payloadDigest !== intent.payloadDigest
      || request.manifest.destination.tenantId !== intent.tenantId
      || request.manifest.destination.projectId !== intent.projectId
      || request.manifest.purpose !== intent.purpose
      || request.payloadBytes.byteLength > intent.limits.maxEncodedPayloadBytes) {
      throw new TypeError("VFY_PUBLICATION_INTENT_MISMATCH: request exceeds its exact intent");
    }
    assertEnvelopeDepth(request.payloadBytes);
    const payload = verifyDisclosureBytes(
      request.payloadBytes,
      request.manifest,
      request.manifestDigest,
      now,
    );
    if (payload.idempotencyKey !== intent.idempotencyKey
      || payload.retentionClass !== intent.retentionClass
      || payload.promises.length > intent.limits.maxPromiseCount
      || payload.proofs.length > intent.limits.maxProofCount
      || payload.evidence.length > intent.limits.maxEvidenceCount) {
      throw new TypeError("VFY_PUBLICATION_LIMIT_EXCEEDED: payload exceeds intent limits");
    }
    const requestDigest = sha256(encodeCanonicalProtocolDocument({
      signedIntent: request.signedIntent,
      manifest: request.manifest,
      manifestDigest: request.manifestDigest,
      payloadDigest: sha256(request.payloadBytes),
      idempotencyKey: request.idempotencyKey,
      contentType: request.contentType,
      contentEncoding: request.contentEncoding,
    }));
    const publishedRunId = `published-run:${sha256(encodeCanonicalProtocolDocument({
      tenantId: intent.tenantId,
      projectId: intent.projectId,
      intentId: intent.intentId,
    })).slice("sha256:".length, "sha256:".length + 32)}`;
    const acceptedAt = now.toISOString();
    const outboxEventId = `outbox:${sha256(encodeCanonicalProtocolDocument({
      tenantId: intent.tenantId,
      publishedRunId,
      eventType: "PublishedRunAccepted",
    })).slice("sha256:".length)}`;
    const receipt: PublicationIngestionReceipt = {
      schemaVersion: 1,
      intentId: intent.intentId,
      publishedRunId,
      tenantId: intent.tenantId,
      projectId: intent.projectId,
      idempotencyKey: intent.idempotencyKey,
      payloadDigest: intent.payloadDigest,
      acceptedAt,
    };
    return this.#store.accept(
      intent.tenantId,
      intent.idempotencyKey,
      intent.nonce,
      requestDigest,
      receipt,
      {
        schemaVersion: 1,
        publishedRunId,
        sourceIntentId: intent.intentId,
        tenantId: intent.tenantId,
        projectId: intent.projectId,
        idempotencyKey: intent.idempotencyKey,
        payloadDigest: intent.payloadDigest,
        publishedAt: acceptedAt,
        projection: structuredClone(payload),
      },
      {
        schemaVersion: 1,
        eventId: outboxEventId,
        eventType: "PublishedRunAccepted",
        tenantId: intent.tenantId,
        aggregateType: "publishedRun",
        aggregateId: publishedRunId,
        occurredAt: acceptedAt,
        payload: { publishedRunId, payloadDigest: intent.payloadDigest },
      },
    );
  }
}
