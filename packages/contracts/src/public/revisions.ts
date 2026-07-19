import {
  canonicalSha256,
  type Sha256Function,
} from "./canonical-json.js";
import type {
  CanonicalValue,
  OpaqueId,
  Rfc3339Utc,
  Sha256Digest,
} from "./primitives.js";

export type DomainObjectKind =
  | "applicationModel"
  | "application"
  | "capability"
  | "promise"
  | "proof"
  | "promiseProofBinding"
  | "providerBinding"
  | "repairKnowledge"
  | "policy"
  | "configuration"
  | "executionContext"
  | "executionPlan"
  | "executionManifest"
  | "evidence"
  | "repair"
  | "discoverySignal"
  | "discoveryFact";

export interface RevisionRef {
  readonly kind: DomainObjectKind;
  readonly id: OpaqueId;
  readonly revision: Sha256Digest;
  readonly schemaVersion: number;
}

/**
 * Cloud publication identities are not local revision identities and are
 * intentionally structurally incompatible with RevisionRef.
 */
export interface PublishedObjectRef {
  readonly objectType: string;
  readonly publicationId: OpaqueId;
  readonly tenantBinding: OpaqueId;
}

export interface RevisionDocument<TPayload = unknown> extends RevisionRef {
  readonly payload: TPayload;
}

/**
 * Metadata outside `document` is not part of the semantic revision preimage.
 */
export interface RevisionEnvelope<TPayload = unknown> {
  readonly document: RevisionDocument<TPayload>;
  readonly createdAt: Rfc3339Utc;
}

export interface RevisionRequest {
  readonly kind: DomainObjectKind;
  readonly id: OpaqueId;
  readonly schemaVersion: number;
  readonly payload: CanonicalValue;
}

export interface RevisionDeriver {
  derive(request: RevisionRequest): Promise<Sha256Digest>;
}

const domainObjectKinds: ReadonlySet<string> = new Set<DomainObjectKind>([
  "applicationModel",
  "application",
  "capability",
  "promise",
  "proof",
  "promiseProofBinding",
  "providerBinding",
  "repairKnowledge",
  "policy",
  "configuration",
  "executionContext",
  "executionPlan",
  "executionManifest",
  "evidence",
  "repair",
  "discoverySignal",
  "discoveryFact",
]);

export function assertExactRevisionRef(value: unknown): asserts value is RevisionRef {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("exact revision reference must be an object");
  }
  const ref = value as Partial<Record<keyof RevisionRef, unknown>>;
  if (
    typeof ref.kind !== "string"
    || !domainObjectKinds.has(ref.kind)
    || typeof ref.id !== "string"
    || ref.id.length < 1
    || ref.id.length > 512
    || typeof ref.revision !== "string"
    || !/^sha256:[a-f0-9]{64}$/.test(ref.revision)
    || !Number.isSafeInteger(ref.schemaVersion)
    || (ref.schemaVersion as number) < 1
    || Object.keys(value).some(
      (key) => !["kind", "id", "revision", "schemaVersion"].includes(key),
    )
  ) {
    throw new TypeError("value is not an exact immutable revision reference");
  }
}

export class CanonicalRevisionDeriver implements RevisionDeriver {
  readonly #sha256: Sha256Function;

  constructor(sha256: Sha256Function) {
    this.#sha256 = sha256;
  }

  async derive(request: RevisionRequest): Promise<Sha256Digest> {
    if (!Number.isSafeInteger(request.schemaVersion) || request.schemaVersion < 1) {
      throw new TypeError("revision schemaVersion must be a positive safe integer");
    }
    if (!domainObjectKinds.has(request.kind)) {
      throw new TypeError("revision kind is not a supported domain object kind");
    }
    return canonicalSha256(
      {
        domain: "verification-platform/revision",
        id: request.id,
        kind: request.kind,
        payload: request.payload,
        schemaVersion: request.schemaVersion,
      },
      this.#sha256,
    );
  }
}

export async function createRevisionDocument<TPayload extends CanonicalValue>(
  request: RevisionRequest & { readonly payload: TPayload },
  deriver: RevisionDeriver,
): Promise<RevisionDocument<TPayload>> {
  return {
    kind: request.kind,
    id: request.id,
    revision: await deriver.derive(request),
    schemaVersion: request.schemaVersion,
    payload: request.payload,
  };
}

export function toRevisionRef(document: RevisionDocument): RevisionRef {
  return {
    kind: document.kind,
    id: document.id,
    revision: document.revision,
    schemaVersion: document.schemaVersion,
  };
}
