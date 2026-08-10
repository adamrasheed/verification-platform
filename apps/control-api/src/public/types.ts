import type {
  CloudAction,
  CloudAuthorizationGrant,
  CloudAuthorizationRequest,
  CloudPrincipal,
} from "@verify-internal/auth";
import type {
  CustomerWorkloadDispatchAdmission,
  CustomerWorkloadDispatchReceipt,
  CustomerWorkloadDispatchRecord,
  DisclosureManifest,
  PublicationAuthorizationContext,
  PublicationIngestionReceipt,
  PublicationIngestionRequest,
  PublicationLimits,
  PublishedRunListPage,
  PublishedRunResolution,
  SignedPublicationIntent,
} from "@verify-internal/cloud-client";

export interface ControlApiAuthenticator {
  authenticate(
    token: string,
    now: Date,
  ): CloudPrincipal | undefined | Promise<CloudPrincipal | undefined>;
}

export interface ControlApiGrantResolver {
  resolve(
    principal: CloudPrincipal,
    request: CloudAuthorizationRequest,
    now: Date,
  ): readonly CloudAuthorizationGrant[] | Promise<readonly CloudAuthorizationGrant[]>;
}

export interface ControlApiPublicationIntentInput {
  readonly principalId: string;
  readonly authorization: PublicationAuthorizationContext;
  readonly authorizationGrantId: string;
  readonly authorizationPolicyRevision: string;
  readonly idempotencyKey: string;
  readonly manifest: DisclosureManifest;
  readonly manifestDigest: `sha256:${string}`;
  readonly retentionClass: string;
  readonly limits: PublicationLimits;
  readonly nonce: string;
  readonly expiresAt: string;
  readonly now: Date;
}

export interface ControlApiPublicationIntentService {
  issue(
    input: ControlApiPublicationIntentInput,
  ): SignedPublicationIntent | Promise<SignedPublicationIntent>;
}

export interface ControlApiPublicationService {
  ingest(
    request: PublicationIngestionRequest,
    authorization: PublicationAuthorizationContext,
    now: Date,
  ): PublicationIngestionReceipt | Promise<PublicationIngestionReceipt>;
}

export interface ControlApiPublishedRunStore {
  resolvePublishedRun(
    authorization: PublicationAuthorizationContext,
    publishedRunId: string,
  ): PublishedRunResolution | undefined | Promise<PublishedRunResolution | undefined>;
  listPublishedRuns(
    authorization: PublicationAuthorizationContext,
    options: { readonly limit: number; readonly cursor?: string },
  ): PublishedRunListPage | Promise<PublishedRunListPage>;
}

export interface ControlApiDispatchStore {
  admit(
    admission: CustomerWorkloadDispatchAdmission,
  ): CustomerWorkloadDispatchReceipt | Promise<CustomerWorkloadDispatchReceipt>;
  resolve(
    authorization: PublicationAuthorizationContext,
    dispatchId: string,
  ): CustomerWorkloadDispatchRecord | undefined
    | Promise<CustomerWorkloadDispatchRecord | undefined>;
  requestCancellation(
    authorization: PublicationAuthorizationContext,
    dispatchId: string,
    cancellationId: string,
    now: Date,
  ): CustomerWorkloadDispatchRecord | undefined
    | Promise<CustomerWorkloadDispatchRecord | undefined>;
}

export interface ControlApiAuditEvent {
  readonly schemaVersion: 1;
  readonly occurredAt: string;
  readonly correlationId: string;
  readonly principalId: string;
  readonly principalKind: CloudPrincipal["kind"] | "anonymous";
  readonly action: CloudAction;
  readonly tenantId: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly phase: "authorization" | "operation";
  readonly outcome: "allowed" | "denied" | "succeeded" | "failed";
  readonly reasonCode: string;
  readonly grantId?: string;
  readonly policyRevision?: string;
}

export interface ControlApiAuditSink {
  record(event: ControlApiAuditEvent): void | Promise<void>;
}

export interface ControlApiOptions {
  readonly expectedAudience: string;
  readonly authenticator: ControlApiAuthenticator;
  readonly grants: ControlApiGrantResolver;
  readonly intents: ControlApiPublicationIntentService;
  readonly publications: ControlApiPublicationService;
  readonly publishedRuns: ControlApiPublishedRunStore;
  readonly dispatches: ControlApiDispatchStore;
  readonly audit: ControlApiAuditSink;
  readonly now?: () => Date;
  readonly correlationId?: () => string;
}

export type ControlApiHandler = (request: Request) => Promise<Response>;
