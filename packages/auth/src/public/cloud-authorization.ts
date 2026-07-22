export const CLOUD_ACTION_CATALOG = [
  { action: "project:read", resourceType: "project" },
  { action: "dispatch:create", resourceType: "project" },
  { action: "dispatch:cancel", resourceType: "dispatch" },
  { action: "run:publish", resourceType: "project" },
  { action: "run:readPublished", resourceType: "publishedRun" },
  { action: "policy:read", resourceType: "policy" },
  { action: "policy:admin", resourceType: "policy" },
  { action: "membership:admin", resourceType: "tenant" },
  { action: "deletion:request", resourceType: "tenant" },
  { action: "usage:read", resourceType: "tenant" },
] as const;

export type CloudAction = (typeof CLOUD_ACTION_CATALOG)[number]["action"];
export type CloudResourceType =
  (typeof CLOUD_ACTION_CATALOG)[number]["resourceType"];

export interface CloudPrincipal {
  readonly kind: "user" | "workload" | "operator";
  readonly id: string;
  readonly authenticated: boolean;
  readonly audience: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly revoked: boolean;
}

export interface CloudResourceRef {
  readonly tenantId: string;
  readonly resourceType: CloudResourceType;
  readonly resourceId: string;
}

export interface CloudAuthorizationRequest {
  readonly action: CloudAction;
  readonly resource: CloudResourceRef;
}

/** Roles and memberships are expanded server-side into exact grants. */
export interface CloudAuthorizationGrant {
  readonly grantId: string;
  readonly principalId: string;
  readonly action: CloudAction;
  readonly resource: CloudResourceRef;
  readonly policyRevision: string;
  readonly expiresAt: string;
  readonly revoked: boolean;
}

export type CloudAuthorizationDecision =
  | {
      readonly allowed: true;
      readonly grantId: string;
      readonly policyRevision: string;
    }
  | {
      readonly allowed: false;
      readonly reasonCode:
        | "UNAUTHENTICATED"
        | "INVALID_AUDIENCE"
        | "TOKEN_EXPIRED"
        | "TOKEN_REVOKED"
        | "INVALID_REQUEST"
        | "NOT_AUTHORIZED";
    };

function bounded(value: unknown, maximum = 256): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maximum
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function instant(value: unknown): number | undefined {
  if (typeof value !== "string" || !value.endsWith("Z")) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function expectedResourceType(action: unknown): CloudResourceType | undefined {
  return CLOUD_ACTION_CATALOG.find((entry) => entry.action === action)?.resourceType;
}

function knownResourceType(value: unknown): value is CloudResourceType {
  return CLOUD_ACTION_CATALOG.some((entry) => entry.resourceType === value);
}

function validResource(value: CloudResourceRef): boolean {
  return bounded(value.tenantId)
    && bounded(value.resourceId)
    && knownResourceType(value.resourceType);
}

function sameResource(left: CloudResourceRef, right: CloudResourceRef): boolean {
  return left.tenantId === right.tenantId
    && left.resourceType === right.resourceType
    && left.resourceId === right.resourceId;
}

/**
 * Authorizes one exact server-resolved resource. A missing resource, wrong
 * tenant, wrong parent, absent membership, or IDOR attempt all collapse to the
 * same public denial.
 */
export function authorizeCloudAction(
  principal: CloudPrincipal,
  request: CloudAuthorizationRequest,
  grants: readonly CloudAuthorizationGrant[],
  expectedAudience: string,
  now: Date,
): CloudAuthorizationDecision {
  if (!principal.authenticated || !bounded(principal.id)) {
    return { allowed: false, reasonCode: "UNAUTHENTICATED" };
  }
  if (!bounded(expectedAudience) || principal.audience !== expectedAudience) {
    return { allowed: false, reasonCode: "INVALID_AUDIENCE" };
  }
  if (principal.revoked) return { allowed: false, reasonCode: "TOKEN_REVOKED" };
  const currentTime = now.getTime();
  const issuedAt = instant(principal.issuedAt);
  const expiresAt = instant(principal.expiresAt);
  if (
    !Number.isFinite(currentTime)
    || issuedAt === undefined
    || expiresAt === undefined
    || expiresAt <= issuedAt
    || currentTime < issuedAt
    || currentTime >= expiresAt
  ) return { allowed: false, reasonCode: "TOKEN_EXPIRED" };

  const resourceType = expectedResourceType(request.action);
  if (
    resourceType === undefined
    || resourceType !== request.resource.resourceType
    || !validResource(request.resource)
  ) return { allowed: false, reasonCode: "INVALID_REQUEST" };

  for (const grant of grants) {
    if (
      grant.principalId !== principal.id
      || grant.action !== request.action
      || !validResource(grant.resource)
      || !sameResource(grant.resource, request.resource)
      || grant.revoked
      || !bounded(grant.grantId)
      || !bounded(grant.policyRevision)
    ) continue;
    const grantExpiry = instant(grant.expiresAt);
    if (grantExpiry === undefined || currentTime >= grantExpiry) continue;
    return {
      allowed: true,
      grantId: grant.grantId,
      policyRevision: grant.policyRevision,
    };
  }
  return { allowed: false, reasonCode: "NOT_AUTHORIZED" };
}
