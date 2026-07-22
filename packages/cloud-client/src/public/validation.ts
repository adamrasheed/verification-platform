import type {
  MetadataPublicationPayload,
  PolicyBundle,
  SignedPolicyDistribution,
} from "./types.js";

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(
  value: RecordValue,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => allowed.has(key));
}

function boundedString(value: unknown, maximum = 256): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maximum
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function digest(value: unknown): value is `sha256:${string}` {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
}

function utc(value: unknown): value is string {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function stringArray(value: unknown, maximumItems = 10_000): value is string[] {
  return Array.isArray(value)
    && value.length <= maximumItems
    && value.every((item) => boundedString(item, 128));
}

function publishedRef(value: unknown, objectType: string, tenantId: string): boolean {
  return isRecord(value)
    && exactKeys(value, ["objectType", "publicationId", "tenantBinding"])
    && value.objectType === objectType
    && typeof value.publicationId === "string"
    && /^pub_v1_[A-Za-z0-9_-]{43}$/.test(value.publicationId)
    && value.tenantBinding === tenantId;
}

function artifact(value: unknown): boolean {
  return isRecord(value)
    && exactKeys(value, ["id", "version", "artifactDigest"])
    && boundedString(value.id)
    && boundedString(value.version)
    && digest(value.artifactDigest);
}

const operationalStatuses = new Set([
  "completed", "invalid", "blocked", "cancelled", "internal_error",
]);
const outcomes = new Set([
  "satisfied", "violated", "indeterminate", "not_evaluated",
]);
const promiseStatuses = new Set(["satisfied", "violated", "indeterminate"]);
const proofStatuses = new Set([
  "passed", "failed", "indeterminate", "error", "cancelled",
]);
const sensitivityClasses = new Set([
  "LOCAL_SOURCE", "SENSITIVE_EVIDENCE", "MINIMAL_METADATA", "EXPLICIT_SHARE",
]);

export function assertMetadataPublicationPayload(
  value: unknown,
): asserts value is MetadataPublicationPayload {
  const required = [
    "schemaVersion", "kind", "purpose", "tenantId", "projectId", "runId",
    "idempotencyKey", "applicationModel", "operationalStatus", "outcome",
    "engine", "protocolVersion", "plugins", "promises", "proofs", "evidence",
    "summary", "auditCorrelationId", "retentionClass",
  ];
  if (!isRecord(value) || !exactKeys(value, required, ["applicationAlias"])) {
    throw new TypeError("VFY_CLOUD_PAYLOAD_MALFORMED: payload has unknown or missing fields");
  }
  if (
    value.schemaVersion !== 1
    || value.kind !== "publishedVerification"
    || !boundedString(value.purpose, 128)
    || !boundedString(value.tenantId)
    || !boundedString(value.projectId)
    || !boundedString(value.runId)
    || !boundedString(value.idempotencyKey)
    || !publishedRef(value.applicationModel, "applicationModel", value.tenantId)
    || !operationalStatuses.has(String(value.operationalStatus))
    || !outcomes.has(String(value.outcome))
    || !artifact(value.engine)
    || !nonNegativeInteger(value.protocolVersion)
    || value.protocolVersion === 0
    || !Array.isArray(value.plugins)
    || value.plugins.length > 1_000
    || !value.plugins.every(artifact)
    || !boundedString(value.auditCorrelationId)
    || !boundedString(value.retentionClass, 128)
    || (value.applicationAlias !== undefined && !boundedString(value.applicationAlias, 200))
  ) throw new TypeError("VFY_CLOUD_PAYLOAD_MALFORMED: invalid publication metadata");

  if (!Array.isArray(value.promises) || value.promises.length > 10_000) {
    throw new TypeError("VFY_CLOUD_PAYLOAD_MALFORMED: invalid Promise projections");
  }
  for (const item of value.promises) {
    if (!isRecord(item)
      || !exactKeys(item, ["promise", "status", "reasonCodes"])
      || !publishedRef(item.promise, "promise", value.tenantId)
      || !promiseStatuses.has(String(item.status))
      || !stringArray(item.reasonCodes)) {
      throw new TypeError("VFY_CLOUD_PAYLOAD_MALFORMED: invalid Promise projection");
    }
  }

  if (!Array.isArray(value.proofs) || value.proofs.length > 50_000) {
    throw new TypeError("VFY_CLOUD_PAYLOAD_MALFORMED: invalid Proof projections");
  }
  for (const item of value.proofs) {
    if (!isRecord(item)
      || !exactKeys(item, ["proof", "status", "reasonCodes"], ["durationMs"])
      || !publishedRef(item.proof, "proof", value.tenantId)
      || !proofStatuses.has(String(item.status))
      || !stringArray(item.reasonCodes)
      || (item.durationMs !== undefined && !nonNegativeInteger(item.durationMs))) {
      throw new TypeError("VFY_CLOUD_PAYLOAD_MALFORMED: invalid Proof projection");
    }
  }

  if (!Array.isArray(value.evidence) || value.evidence.length > 50_000) {
    throw new TypeError("VFY_CLOUD_PAYLOAD_MALFORMED: invalid Evidence descriptors");
  }
  for (const item of value.evidence) {
    if (!isRecord(item)
      || !exactKeys(item, ["evidence", "evidenceType", "byteSize", "sensitivityClass"])
      || !publishedRef(item.evidence, "evidence", value.tenantId)
      || !boundedString(item.evidenceType, 128)
      || !nonNegativeInteger(item.byteSize)
      || !sensitivityClasses.has(String(item.sensitivityClass))) {
      throw new TypeError("VFY_CLOUD_PAYLOAD_MALFORMED: invalid Evidence descriptor");
    }
  }

  if (!isRecord(value.summary)
    || !exactKeys(value.summary, ["promiseCount", "proofCount", "evidenceCount", "durationMs"])
    || !nonNegativeInteger(value.summary.promiseCount)
    || !nonNegativeInteger(value.summary.proofCount)
    || !nonNegativeInteger(value.summary.evidenceCount)
    || !nonNegativeInteger(value.summary.durationMs)
    || value.summary.promiseCount !== value.promises.length
    || value.summary.proofCount !== value.proofs.length
    || value.summary.evidenceCount !== value.evidence.length) {
    throw new TypeError("VFY_CLOUD_PAYLOAD_MALFORMED: invalid publication summary");
  }
}

export function assertPolicyBundle(value: unknown): asserts value is PolicyBundle {
  if (!isRecord(value)
    || !exactKeys(value, [
      "schemaVersion", "tenantId", "policyId", "revisionId", "issuedAt",
      "expiresAt", "actions", "publicationRules",
    ])
    || value.schemaVersion !== 1
    || !boundedString(value.tenantId)
    || !boundedString(value.policyId)
    || !boundedString(value.revisionId)
    || !utc(value.issuedAt)
    || !utc(value.expiresAt)
    || Date.parse(value.expiresAt) <= Date.parse(value.issuedAt)
    || !stringArray(value.actions, 1_000)
    || new Set(value.actions).size !== value.actions.length
    || !Array.isArray(value.publicationRules)
    || value.publicationRules.length > 1_000) {
    throw new TypeError("VFY_POLICY_MALFORMED: invalid policy bundle");
  }
  for (const rule of value.publicationRules) {
    if (!isRecord(rule)
      || !exactKeys(rule, ["purpose", "payloadSchemaMajor", "retentionClasses"])
      || !boundedString(rule.purpose, 128)
      || !nonNegativeInteger(rule.payloadSchemaMajor)
      || rule.payloadSchemaMajor === 0
      || !stringArray(rule.retentionClasses, 100)
      || new Set(rule.retentionClasses).size !== rule.retentionClasses.length) {
      throw new TypeError("VFY_POLICY_MALFORMED: invalid publication rule");
    }
  }
}

export function assertSignedPolicyDistribution(
  value: unknown,
): asserts value is SignedPolicyDistribution {
  if (!isRecord(value)
    || !exactKeys(value, ["bundle", "signature"])
    || !isRecord(value.signature)
    || !exactKeys(value.signature, ["algorithm", "keyId", "value"])
    || value.signature.algorithm !== "Ed25519"
    || !boundedString(value.signature.keyId)
    || typeof value.signature.value !== "string"
    || !/^[A-Za-z0-9_-]{86}$/.test(value.signature.value)) {
    throw new TypeError("VFY_POLICY_MALFORMED: invalid signed policy envelope");
  }
  assertPolicyBundle(value.bundle);
}
