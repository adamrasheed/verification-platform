import type {
  PublishedVerificationResult,
} from "@verify-internal/protocol";

export const METADATA_PUBLICATION_SCHEMA_MAJOR = 1 as const;
export const DISCLOSURE_MANIFEST_SCHEMA_MAJOR = 1 as const;
export const POLICY_DISTRIBUTION_SCHEMA_MAJOR = 1 as const;
export const PUBLICATION_INTENT_SCHEMA_MAJOR = 1 as const;

export type MetadataPublicationPayload = PublishedVerificationResult & {
  readonly schemaVersion: typeof METADATA_PUBLICATION_SCHEMA_MAJOR;
};

export interface PayloadSchemaRef {
  readonly id: "verify.metadata-publication";
  readonly major: typeof METADATA_PUBLICATION_SCHEMA_MAJOR;
  readonly minor: number;
}

export interface RetentionPolicyRef {
  readonly id: string;
  readonly revision: string;
}

export interface DisclosureField {
  readonly path: string;
  readonly classification: "MINIMAL_METADATA";
  readonly encodedBytes: number;
}

export interface DisclosureManifest {
  readonly schemaVersion: typeof DISCLOSURE_MANIFEST_SCHEMA_MAJOR;
  readonly destination: {
    readonly tenantId: string;
    readonly projectId: string;
  };
  readonly purpose: string;
  readonly payloadSchema: PayloadSchemaRef;
  readonly retentionPolicy: RetentionPolicyRef;
  readonly expiresAt: string;
  readonly payloadDigest: `sha256:${string}`;
  readonly encodedPayloadBytes: number;
  readonly fields: readonly DisclosureField[];
}

export interface PreparedDisclosure {
  readonly payload: MetadataPublicationPayload;
  readonly payloadBytes: Uint8Array;
  readonly manifest: DisclosureManifest;
  readonly manifestBytes: Uint8Array;
  readonly manifestDigest: `sha256:${string}`;
}

export interface DisclosureOptions {
  readonly payloadSchemaMinor: number;
  readonly retentionPolicy: RetentionPolicyRef;
  readonly expiresAt: string;
}

export interface PolicyPublicationRule {
  readonly purpose: string;
  readonly payloadSchemaMajor: number;
  readonly retentionClasses: readonly string[];
}

export interface PolicyBundle {
  readonly schemaVersion: typeof POLICY_DISTRIBUTION_SCHEMA_MAJOR;
  readonly tenantId: string;
  readonly policyId: string;
  readonly revisionId: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly actions: readonly string[];
  readonly publicationRules: readonly PolicyPublicationRule[];
}

export interface SignedPolicyDistribution {
  readonly bundle: PolicyBundle;
  readonly signature: {
    readonly algorithm: "Ed25519";
    readonly keyId: string;
    readonly value: string;
  };
}

export type PolicySignatureVerifier = (
  keyId: string,
  bytes: Uint8Array,
  signature: Uint8Array,
) => boolean | Promise<boolean>;

export interface PublicationLimits {
  readonly maxEncodedPayloadBytes: number;
  readonly maxPromiseCount: number;
  readonly maxProofCount: number;
  readonly maxEvidenceCount: number;
}

export interface PublicationIntent {
  readonly schemaVersion: typeof PUBLICATION_INTENT_SCHEMA_MAJOR;
  readonly intentId: string;
  readonly audience: "verify-cloud-publication";
  readonly tenantId: string;
  readonly projectId: string;
  readonly purpose: string;
  readonly manifestDigest: `sha256:${string}`;
  readonly payloadDigest: `sha256:${string}`;
  readonly idempotencyKey: string;
  readonly retentionClass: string;
  readonly limits: PublicationLimits;
  readonly policy: {
    readonly policyId: string;
    readonly revisionId: string;
  };
  readonly nonce: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export interface SignedPublicationIntent {
  readonly intent: PublicationIntent;
  readonly signature: {
    readonly algorithm: "Ed25519";
    readonly keyId: string;
    readonly value: string;
  };
}

export interface PublicationIntentSigningOperation {
  readonly keyId: string;
  sign(bytes: Uint8Array): Uint8Array | Promise<Uint8Array>;
}

export type PublicationIntentSignatureVerifier = (
  keyId: string,
  bytes: Uint8Array,
  signature: Uint8Array,
) => boolean | Promise<boolean>;

export interface PublicationIntentOptions {
  readonly intentId: string;
  readonly nonce: string;
  readonly idempotencyKey: string;
  readonly retentionClass: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly limits: PublicationLimits;
}

export interface PublicationAuthorizationContext {
  readonly tenantId: string;
  readonly projectId: string;
}

export interface PublicationIngestionRequest {
  readonly signedIntent: SignedPublicationIntent;
  readonly manifest: DisclosureManifest;
  readonly manifestDigest: `sha256:${string}`;
  readonly payloadBytes: Uint8Array;
  readonly idempotencyKey: string;
  readonly contentType: "application/json";
  readonly contentEncoding: "identity";
}

export interface PublicationIngestionReceipt {
  readonly schemaVersion: 1;
  readonly intentId: string;
  readonly publishedRunId: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly idempotencyKey: string;
  readonly payloadDigest: `sha256:${string}`;
  readonly acceptedAt: string;
}

export interface PublishedRunRecord {
  readonly schemaVersion: 1;
  readonly publishedRunId: string;
  readonly sourceIntentId: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly idempotencyKey: string;
  readonly payloadDigest: `sha256:${string}`;
  readonly publishedAt: string;
  readonly projection: MetadataPublicationPayload;
}

export interface PublishedRunTombstone {
  readonly schemaVersion: 1;
  readonly objectType: "publishedRun";
  readonly opaqueId: string;
  readonly deletedAt: string;
  readonly authority: string;
  readonly reasonClass: string;
  readonly affectedEdgeIds: readonly string[];
}

export interface PublishedRunDeletionOptions {
  readonly deletedAt: string;
  readonly authority: string;
  readonly reasonClass: string;
  readonly affectedEdgeIds: readonly string[];
}

export type PublishedRunResolution =
  | {
    readonly state: "active";
    readonly publishedAt: string;
    readonly publishedRunId: string;
    readonly projection: MetadataPublicationPayload;
  }
  | {
    readonly state: "deleted_reference";
    readonly publishedAt: string;
    readonly publishedRunId: string;
    readonly tombstone: PublishedRunTombstone;
  };

export interface PublishedRunListPage {
  readonly schemaVersion: 1;
  readonly items: readonly PublishedRunResolution[];
  readonly nextCursor?: string;
}

export interface PublishedRunAcceptedOutboxEvent {
  readonly schemaVersion: 1;
  readonly eventId: string;
  readonly eventType: "PublishedRunAccepted";
  readonly tenantId: string;
  readonly aggregateType: "publishedRun";
  readonly aggregateId: string;
  readonly occurredAt: string;
  readonly payload: {
    readonly publishedRunId: string;
    readonly payloadDigest: `sha256:${string}`;
  };
}

export interface PublishedRunDeletedOutboxEvent {
  readonly schemaVersion: 1;
  readonly eventId: string;
  readonly eventType: "PublishedRunDeleted";
  readonly tenantId: string;
  readonly aggregateType: "publishedRun";
  readonly aggregateId: string;
  readonly occurredAt: string;
  readonly payload: {
    readonly publishedRunId: string;
    readonly authority: string;
    readonly reasonClass: string;
  };
}

export type PublicationOutboxEvent =
  | PublishedRunAcceptedOutboxEvent
  | PublishedRunDeletedOutboxEvent;

export interface PublicationOutboxClaim {
  readonly event: PublicationOutboxEvent;
  readonly workerId: string;
  readonly fence: number;
  readonly attempt: number;
  readonly leaseExpiresAt: string;
}

export type PublicationOutboxDelivery = (
  event: PublicationOutboxEvent,
) => void | Promise<void>;

export interface PublicationIngestionStore {
  accept(
    tenantId: string,
    idempotencyKey: string,
    nonce: string,
    requestDigest: `sha256:${string}`,
    receipt: PublicationIngestionReceipt,
    publishedRun: PublishedRunRecord,
    outboxEvent: PublicationOutboxEvent,
  ): PublicationIngestionReceipt;
}
