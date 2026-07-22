import {
  encodeCanonicalProtocolDocument,
} from "@verify-internal/protocol";

export const PUBLICATION_IDENTIFIER_OBJECT_TYPES = [
  "applicationModel",
  "promise",
  "proof",
  "evidence",
] as const;

export type PublicationIdentifierObjectType =
  (typeof PUBLICATION_IDENTIFIER_OBJECT_TYPES)[number];

export interface LocalPublicationSubject {
  readonly kind: string;
  readonly id: string;
  readonly revision: `sha256:${string}`;
  readonly schemaVersion: number;
}

export interface CloudPublishedObjectRef {
  readonly objectType: PublicationIdentifierObjectType;
  readonly publicationId: string;
  readonly tenantBinding: string;
}

export interface PublicationKeyOperation {
  readonly keyId: string;
  readonly createdAt: string;
  mac(bytes: Uint8Array): Uint8Array | Promise<Uint8Array>;
}

/** Key bytes and persistence remain inside the caller's local secret store. */
export interface PublicationKeyStore {
  activeKey(): PublicationKeyOperation | Promise<PublicationKeyOperation>;
}

export interface PublicationMapping {
  readonly tenantId: string;
  readonly objectType: PublicationIdentifierObjectType;
  readonly localSubject: LocalPublicationSubject;
  readonly publishedObject: CloudPublishedObjectRef;
  readonly localKeyId: string;
  readonly createdAt: string;
}

export interface PublicationMappingStore {
  find(
    tenantId: string,
    objectType: PublicationIdentifierObjectType,
    localSubject: LocalPublicationSubject,
  ): PublicationMapping | undefined | Promise<PublicationMapping | undefined>;
  reserve(
    candidate: PublicationMapping,
  ): PublicationMapping | Promise<PublicationMapping>;
}

function assertOpaque(value: string, name: string): void {
  if (!value || value.length > 256 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new TypeError(`VFY_PUBLICATION_ID_INVALID: invalid ${name}`);
  }
}

function assertSubject(value: LocalPublicationSubject): void {
  assertOpaque(value.kind, "subject kind");
  assertOpaque(value.id, "subject ID");
  if (!/^sha256:[a-f0-9]{64}$/.test(value.revision)) {
    throw new TypeError("VFY_PUBLICATION_ID_INVALID: invalid subject revision");
  }
  if (!Number.isSafeInteger(value.schemaVersion) || value.schemaVersion < 1) {
    throw new TypeError("VFY_PUBLICATION_ID_INVALID: invalid subject schema version");
  }
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function mappingIdentity(
  tenantId: string,
  objectType: PublicationIdentifierObjectType,
  subject: LocalPublicationSubject,
): string {
  return new TextDecoder().decode(encodeCanonicalProtocolDocument({
    tenantId,
    objectType,
    subject,
  }));
}

function sameMapping(left: PublicationMapping, right: PublicationMapping): boolean {
  return mappingIdentity(left.tenantId, left.objectType, left.localSubject)
    === mappingIdentity(right.tenantId, right.objectType, right.localSubject);
}

/**
 * Minimal deterministic mapping store for local composition and conformance.
 * Production callers may replace it with the Engine's atomic local store.
 */
export class InMemoryPublicationMappingStore implements PublicationMappingStore {
  readonly #bySubject = new Map<string, PublicationMapping>();
  readonly #byPublicationId = new Map<string, PublicationMapping>();

  find(
    tenantId: string,
    objectType: PublicationIdentifierObjectType,
    localSubject: LocalPublicationSubject,
  ): PublicationMapping | undefined {
    const existing = this.#bySubject.get(mappingIdentity(tenantId, objectType, localSubject));
    return existing ? structuredClone(existing) : undefined;
  }

  reserve(candidate: PublicationMapping): PublicationMapping {
    const subjectKey = mappingIdentity(
      candidate.tenantId,
      candidate.objectType,
      candidate.localSubject,
    );
    const existing = this.#bySubject.get(subjectKey);
    if (existing) return structuredClone(existing);
    const collision = this.#byPublicationId.get(candidate.publishedObject.publicationId);
    if (collision && !sameMapping(collision, candidate)) {
      throw new Error("VFY_PUBLICATION_ID_COLLISION: publication ID already maps to another subject");
    }
    const retained: PublicationMapping = structuredClone(candidate);
    this.#bySubject.set(subjectKey, retained);
    this.#byPublicationId.set(retained.publishedObject.publicationId, retained);
    return structuredClone(retained);
  }
}

export class PublicationIdentifierService {
  readonly #keys: PublicationKeyStore;
  readonly #mappings: PublicationMappingStore;

  constructor(keys: PublicationKeyStore, mappings: PublicationMappingStore) {
    this.#keys = keys;
    this.#mappings = mappings;
  }

  async derive(
    tenantId: string,
    objectType: PublicationIdentifierObjectType,
    localSubject: LocalPublicationSubject,
    createdAt: string,
  ): Promise<PublicationMapping> {
    assertOpaque(tenantId, "tenant ID");
    if (!PUBLICATION_IDENTIFIER_OBJECT_TYPES.includes(objectType)) {
      throw new TypeError("VFY_PUBLICATION_ID_INVALID: unsupported object type");
    }
    assertSubject(localSubject);
    if (localSubject.kind !== objectType) {
      throw new TypeError("VFY_PUBLICATION_ID_INVALID: subject kind does not match object type");
    }
    if (!Number.isFinite(Date.parse(createdAt)) || !createdAt.endsWith("Z")) {
      throw new TypeError("VFY_PUBLICATION_ID_INVALID: invalid creation time");
    }

    const existing = await this.#mappings.find(tenantId, objectType, localSubject);
    if (existing) return existing;

    const key = await this.#keys.activeKey();
    assertOpaque(key.keyId, "local key ID");
    if (!Number.isFinite(Date.parse(key.createdAt)) || !key.createdAt.endsWith("Z")) {
      throw new TypeError("VFY_PUBLICATION_KEY_INVALID: invalid key creation time");
    }
    const preimage = encodeCanonicalProtocolDocument({
      schemaVersion: 1,
      domain: "verify.publication-identifier",
      tenantId,
      objectType,
      localSubject,
    });
    const mac = await key.mac(preimage);
    if (!(mac instanceof Uint8Array) || mac.byteLength !== 32) {
      throw new TypeError("VFY_PUBLICATION_KEY_INVALID: MAC must be 32 bytes");
    }
    const publishedObject: CloudPublishedObjectRef = {
      objectType,
      publicationId: `pub_v1_${base64Url(mac)}`,
      tenantBinding: tenantId,
    };
    return this.#mappings.reserve({
      tenantId,
      objectType,
      localSubject: structuredClone(localSubject),
      publishedObject,
      localKeyId: key.keyId,
      createdAt,
    });
  }
}
