import type {
  PublishedVerificationResult,
} from "@verify-internal/protocol";

export const METADATA_PUBLICATION_SCHEMA_MAJOR = 1 as const;
export const DISCLOSURE_MANIFEST_SCHEMA_MAJOR = 1 as const;
export const POLICY_DISTRIBUTION_SCHEMA_MAJOR = 1 as const;

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
