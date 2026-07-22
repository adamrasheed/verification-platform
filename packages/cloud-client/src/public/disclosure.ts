import { createHash } from "node:crypto";
import {
  encodeCanonicalProtocolDocument,
  parseCanonicalProtocolDocument,
} from "@verify-internal/protocol";
import type {
  DisclosureField,
  DisclosureManifest,
  DisclosureOptions,
  MetadataPublicationPayload,
  PreparedDisclosure,
} from "./types.js";
import { assertMetadataPublicationPayload } from "./validation.js";

const MAXIMUM_PAYLOAD_BYTES = 1_048_576;

function lexicalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

function pointerToken(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function disclosureFields(value: unknown): DisclosureField[] {
  const fields: DisclosureField[] = [];
  const visit = (current: unknown, path: string): void => {
    if (Array.isArray(current)) {
      if (current.length === 0) {
        fields.push({
          path,
          classification: "MINIMAL_METADATA",
          encodedBytes: encodeCanonicalProtocolDocument(current).byteLength,
        });
      } else {
        current.forEach((item, index) => visit(item, `${path}/${index}`));
      }
      return;
    }
    if (typeof current === "object" && current !== null) {
      const entries = Object.entries(current).sort(([left], [right]) => lexicalCompare(left, right));
      if (entries.length === 0) {
        fields.push({
          path,
          classification: "MINIMAL_METADATA",
          encodedBytes: encodeCanonicalProtocolDocument(current).byteLength,
        });
      } else {
        for (const [key, child] of entries) visit(child, `${path}/${pointerToken(key)}`);
      }
      return;
    }
    fields.push({
      path,
      classification: "MINIMAL_METADATA",
      encodedBytes: encodeCanonicalProtocolDocument(current).byteLength,
    });
  };
  visit(value, "");
  return fields.sort((left, right) => lexicalCompare(left.path, right.path));
}

function assertUtc(value: string, name: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)
    || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`VFY_DISCLOSURE_MALFORMED: invalid ${name}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function boundedManifestString(value: unknown, maximum = 256): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maximum
    && !/[\u0000-\u001f\u007f]/.test(value);
}

export function assertDisclosureManifest(
  value: unknown,
): asserts value is DisclosureManifest {
  if (!isRecord(value)) {
    throw new TypeError("VFY_DISCLOSURE_MALFORMED: invalid disclosure manifest");
  }
  const keys = Object.keys(value).sort();
  const expected = [
    "destination", "encodedPayloadBytes", "expiresAt", "fields", "payloadDigest",
    "payloadSchema", "purpose", "retentionPolicy", "schemaVersion",
  ].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expected)
    || value.schemaVersion !== 1
    || !isRecord(value.destination)
    || Object.keys(value.destination).sort().join(",") !== "projectId,tenantId"
    || !boundedManifestString(value.destination.tenantId)
    || !boundedManifestString(value.destination.projectId)
    || !boundedManifestString(value.purpose, 128)
    || !isRecord(value.payloadSchema)
    || Object.keys(value.payloadSchema).sort().join(",") !== "id,major,minor"
    || value.payloadSchema.id !== "verify.metadata-publication"
    || value.payloadSchema.major !== 1
    || !Number.isSafeInteger(value.payloadSchema.minor)
    || (value.payloadSchema.minor as number) < 0
    || !isRecord(value.retentionPolicy)
    || Object.keys(value.retentionPolicy).sort().join(",") !== "id,revision"
    || !boundedManifestString(value.retentionPolicy.id)
    || !boundedManifestString(value.retentionPolicy.revision)
    || typeof value.payloadDigest !== "string"
    || !/^sha256:[a-f0-9]{64}$/.test(value.payloadDigest)
    || !Number.isSafeInteger(value.encodedPayloadBytes)
    || (value.encodedPayloadBytes as number) < 0
    || (value.encodedPayloadBytes as number) > MAXIMUM_PAYLOAD_BYTES
    || !Array.isArray(value.fields)
    || value.fields.length > 100_000
    || typeof value.expiresAt !== "string") {
    throw new TypeError("VFY_DISCLOSURE_MALFORMED: invalid disclosure manifest");
  }
  assertUtc(value.expiresAt, "manifest expiry");
  let previous = "";
  for (const field of value.fields) {
    if (!isRecord(field)
      || Object.keys(field).sort().join(",") !== "classification,encodedBytes,path"
      || typeof field.path !== "string"
      || field.path.length > 2_048
      || field.classification !== "MINIMAL_METADATA"
      || !Number.isSafeInteger(field.encodedBytes)
      || (field.encodedBytes as number) < 0
      || (field.encodedBytes as number) > MAXIMUM_PAYLOAD_BYTES
      || field.path <= previous) {
      throw new TypeError("VFY_DISCLOSURE_MALFORMED: invalid disclosure field inventory");
    }
    previous = field.path;
  }
}

export function prepareDisclosure(
  payload: MetadataPublicationPayload,
  options: DisclosureOptions,
): PreparedDisclosure {
  assertMetadataPublicationPayload(payload);
  if (!Number.isSafeInteger(options.payloadSchemaMinor) || options.payloadSchemaMinor < 0) {
    throw new TypeError("VFY_DISCLOSURE_MALFORMED: invalid payload schema minor");
  }
  if (!options.retentionPolicy.id || !options.retentionPolicy.revision) {
    throw new TypeError("VFY_DISCLOSURE_MALFORMED: invalid retention policy reference");
  }
  assertUtc(options.expiresAt, "manifest expiry");

  const payloadBytes = encodeCanonicalProtocolDocument(payload);
  if (payloadBytes.byteLength > MAXIMUM_PAYLOAD_BYTES) {
    throw new TypeError("VFY_CLOUD_PAYLOAD_OVERSIZED: encoded payload exceeds one MiB");
  }
  const manifest: DisclosureManifest = {
    schemaVersion: 1,
    destination: {
      tenantId: payload.tenantId,
      projectId: payload.projectId,
    },
    purpose: payload.purpose,
    payloadSchema: {
      id: "verify.metadata-publication",
      major: 1,
      minor: options.payloadSchemaMinor,
    },
    retentionPolicy: structuredClone(options.retentionPolicy),
    expiresAt: options.expiresAt,
    payloadDigest: sha256(payloadBytes),
    encodedPayloadBytes: payloadBytes.byteLength,
    fields: disclosureFields(payload),
  };
  const manifestBytes = encodeCanonicalProtocolDocument(manifest);
  return {
    payload: structuredClone(payload),
    payloadBytes,
    manifest,
    manifestBytes,
    manifestDigest: sha256(manifestBytes),
  };
}

/**
 * Revalidates the exact transmitted bytes against the previously authorized
 * manifest digest. Non-canonical, duplicate-key, drifted, or expired payloads
 * fail before transport.
 */
export function verifyDisclosureBytes(
  payloadBytes: Uint8Array,
  approvedManifest: unknown,
  approvedManifestDigest: `sha256:${string}`,
  now: Date,
): MetadataPublicationPayload {
  if (!(payloadBytes instanceof Uint8Array) || payloadBytes.byteLength > MAXIMUM_PAYLOAD_BYTES) {
    throw new TypeError("VFY_CLOUD_PAYLOAD_OVERSIZED: invalid encoded payload size");
  }
  assertDisclosureManifest(approvedManifest);
  if (!/^sha256:[a-f0-9]{64}$/.test(approvedManifestDigest)) {
    throw new TypeError("VFY_DISCLOSURE_MALFORMED: invalid approved manifest digest");
  }
  if (!Number.isFinite(now.getTime()) || now.getTime() >= Date.parse(approvedManifest.expiresAt)) {
    throw new TypeError("VFY_DISCLOSURE_EXPIRED: disclosure authorization has expired");
  }
  const approvedManifestBytes = encodeCanonicalProtocolDocument(approvedManifest);
  if (sha256(approvedManifestBytes) !== approvedManifestDigest) {
    throw new TypeError("VFY_DISCLOSURE_DRIFT: approved manifest digest mismatch");
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(payloadBytes);
  } catch {
    throw new TypeError("VFY_CLOUD_PAYLOAD_MALFORMED: payload is not valid UTF-8");
  }
  const parsed = parseCanonicalProtocolDocument(text);
  assertMetadataPublicationPayload(parsed);
  const canonicalPayloadBytes = encodeCanonicalProtocolDocument(parsed);
  if (!bytesEqual(payloadBytes, canonicalPayloadBytes)) {
    throw new TypeError("VFY_DISCLOSURE_DRIFT: transmitted payload bytes are not canonical preview bytes");
  }
  const rebuilt = prepareDisclosure(parsed, {
    payloadSchemaMinor: approvedManifest.payloadSchema.minor,
    retentionPolicy: approvedManifest.retentionPolicy,
    expiresAt: approvedManifest.expiresAt,
  });
  if (!bytesEqual(rebuilt.manifestBytes, approvedManifestBytes)) {
    throw new TypeError("VFY_DISCLOSURE_DRIFT: payload fields or bytes differ from approved preview");
  }
  return parsed;
}
