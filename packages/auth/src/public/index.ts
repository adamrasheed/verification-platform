import path from "node:path";

export {
  CLOUD_ACTION_CATALOG,
  authorizeCloudAction,
} from "./cloud-authorization.js";
export type {
  CloudAction,
  CloudAuthorizationDecision,
  CloudAuthorizationGrant,
  CloudAuthorizationRequest,
  CloudPrincipal,
  CloudResourceRef,
  CloudResourceType,
} from "./cloud-authorization.js";

export type LocalPermission =
  | "workspace.read"
  | "history.read"
  | "cache.read"
  | "cache.clear"
  | "workspace.write"
  | "network"
  | "subprocess"
  | "secret.read";

export interface LocalPrincipal {
  readonly kind: "local-user" | "automation";
  readonly id: string;
  readonly authenticated: boolean;
}

export interface PermissionRequest {
  readonly operation: string;
  readonly workspaceRoot?: string;
  readonly permissions: readonly LocalPermission[];
}

export interface AuthorityPolicy {
  readonly source: "cli-boundary" | "external-policy";
  readonly principalId: string;
  readonly workspaceRoots: readonly string[];
  readonly grants: readonly LocalPermission[];
}

export interface AuthorizationDecision {
  readonly allowed: boolean;
  readonly granted: readonly LocalPermission[];
  readonly denied: readonly LocalPermission[];
  readonly reasonCode: "AUTHORIZED" | "UNAUTHENTICATED" | "NO_EXTERNAL_GRANT" | "WORKSPACE_OUT_OF_SCOPE";
}

function normalizedRoot(value: string): string {
  return path.resolve(value);
}

function inScope(root: string, allowed: readonly string[]): boolean {
  const target = normalizedRoot(root);
  return allowed.some((item) => {
    const boundary = normalizedRoot(item);
    return target === boundary || target.startsWith(`${boundary}${path.sep}`);
  });
}

export function authorize(
  principal: LocalPrincipal,
  request: PermissionRequest,
  policy: AuthorityPolicy | undefined,
): AuthorizationDecision {
  if (!principal.authenticated) {
    return {
      allowed: false,
      granted: [],
      denied: [...request.permissions],
      reasonCode: "UNAUTHENTICATED",
    };
  }
  if (!policy || policy.principalId !== principal.id) {
    return {
      allowed: false,
      granted: [],
      denied: [...request.permissions],
      reasonCode: "NO_EXTERNAL_GRANT",
    };
  }
  if (request.workspaceRoot && !inScope(request.workspaceRoot, policy.workspaceRoots)) {
    return {
      allowed: false,
      granted: [],
      denied: [...request.permissions],
      reasonCode: "WORKSPACE_OUT_OF_SCOPE",
    };
  }
  const granted = request.permissions.filter((permission) => policy.grants.includes(permission));
  const denied = request.permissions.filter((permission) => !policy.grants.includes(permission));
  return {
    allowed: denied.length === 0,
    granted,
    denied,
    reasonCode: denied.length === 0 ? "AUTHORIZED" : "NO_EXTERNAL_GRANT",
  };
}

export function passiveCliPolicy(
  principal: LocalPrincipal,
  workspaceRoot: string,
): AuthorityPolicy {
  if (!principal.authenticated) throw new TypeError("cannot bind policy to unauthenticated principal");
  return {
    source: "cli-boundary",
    principalId: principal.id,
    workspaceRoots: [normalizedRoot(workspaceRoot)],
    grants: ["workspace.read", "history.read", "cache.read", "cache.clear"],
  };
}

export function repairApplyCliPolicy(
  principal: LocalPrincipal,
  workspaceRoot: string,
): AuthorityPolicy {
  if (!principal.authenticated) {
    throw new TypeError("cannot bind policy to unauthenticated principal");
  }
  return {
    source: "cli-boundary",
    principalId: principal.id,
    workspaceRoots: [normalizedRoot(workspaceRoot)],
    grants: ["workspace.read", "history.read", "workspace.write"],
  };
}

export interface PluginOperationAuthorizationRequest {
  readonly pluginId: string;
  readonly operationId: string;
  readonly destinationIds: readonly string[];
  readonly secretReferenceIds: readonly string[];
  readonly filesystemReadRoots: readonly string[];
  readonly filesystemWriteRoots: readonly string[];
  readonly subprocess: boolean;
  readonly sideEffects: readonly string[];
  readonly enforcementTier: string;
  readonly maximumMemoryBytes: number;
  readonly maximumCpuNanoseconds: number;
  readonly maximumPluginProcesses: number;
  readonly expiresAt: string;
}

export interface PluginAuthorityPolicy {
  readonly principalId: string;
  readonly pluginIds: readonly string[];
  readonly destinationIds: readonly string[];
  readonly secretReferenceIds: readonly string[];
  readonly filesystemReadRoots: readonly string[];
  readonly allowFilesystemWrite: boolean;
  readonly allowSubprocess: boolean;
  readonly allowedSideEffects: readonly string[];
  readonly enforcementTiers: readonly string[];
  readonly maximumMemoryBytes: number;
  readonly maximumCpuNanoseconds: number;
  readonly maximumPluginProcesses: number;
  readonly maximumExpiresAt: string;
}

export type PluginAuthorizationDecision =
  | {
      readonly allowed: true;
      readonly authorizationId: string;
      readonly principalId: string;
      readonly grant: PluginOperationAuthorizationRequest;
    }
  | {
      readonly allowed: false;
      readonly reasonCode:
        | "UNAUTHENTICATED"
        | "NO_EXTERNAL_GRANT"
        | "PLUGIN_DENIED"
        | "DESTINATION_DENIED"
        | "SECRET_DENIED"
        | "FILESYSTEM_DENIED"
        | "SUBPROCESS_DENIED"
        | "SIDE_EFFECT_DENIED"
        | "ENFORCEMENT_TIER_DENIED"
        | "RESOURCE_LIMIT_DENIED"
        | "EXPIRY_DENIED";
    };

function subset(requested: readonly string[], allowed: readonly string[]): boolean {
  return requested.every((value) => allowed.includes(value));
}

export function authorizePluginOperation(
  principal: LocalPrincipal,
  request: PluginOperationAuthorizationRequest,
  policy: PluginAuthorityPolicy | undefined,
  authorizationId: string,
  now: Date,
): PluginAuthorizationDecision {
  if (!principal.authenticated) return { allowed: false, reasonCode: "UNAUTHENTICATED" };
  if (!policy || policy.principalId !== principal.id) {
    return { allowed: false, reasonCode: "NO_EXTERNAL_GRANT" };
  }
  if (!policy.pluginIds.includes(request.pluginId)) {
    return { allowed: false, reasonCode: "PLUGIN_DENIED" };
  }
  if (!subset(request.destinationIds, policy.destinationIds)) {
    return { allowed: false, reasonCode: "DESTINATION_DENIED" };
  }
  if (!subset(request.secretReferenceIds, policy.secretReferenceIds)) {
    return { allowed: false, reasonCode: "SECRET_DENIED" };
  }
  if (
    !subset(request.filesystemReadRoots.map(normalizedRoot), policy.filesystemReadRoots.map(normalizedRoot))
    || (request.filesystemWriteRoots.length > 0 && !policy.allowFilesystemWrite)
  ) return { allowed: false, reasonCode: "FILESYSTEM_DENIED" };
  if (request.subprocess && !policy.allowSubprocess) {
    return { allowed: false, reasonCode: "SUBPROCESS_DENIED" };
  }
  if (!subset(request.sideEffects, policy.allowedSideEffects)) {
    return { allowed: false, reasonCode: "SIDE_EFFECT_DENIED" };
  }
  if (!policy.enforcementTiers.includes(request.enforcementTier)) {
    return { allowed: false, reasonCode: "ENFORCEMENT_TIER_DENIED" };
  }
  if (
    !Number.isSafeInteger(request.maximumMemoryBytes)
    || request.maximumMemoryBytes < 0
    || request.maximumMemoryBytes > policy.maximumMemoryBytes
    || !Number.isSafeInteger(request.maximumCpuNanoseconds)
    || request.maximumCpuNanoseconds < 0
    || request.maximumCpuNanoseconds > policy.maximumCpuNanoseconds
    || !Number.isSafeInteger(request.maximumPluginProcesses)
    || request.maximumPluginProcesses < 0
    || request.maximumPluginProcesses > policy.maximumPluginProcesses
  ) return { allowed: false, reasonCode: "RESOURCE_LIMIT_DENIED" };
  const expiry = Date.parse(request.expiresAt);
  const maximum = Date.parse(policy.maximumExpiresAt);
  if (
    !Number.isFinite(expiry)
    || !Number.isFinite(maximum)
    || expiry <= now.getTime()
    || expiry > maximum
  ) return { allowed: false, reasonCode: "EXPIRY_DENIED" };
  if (!authorizationId) return { allowed: false, reasonCode: "NO_EXTERNAL_GRANT" };
  return {
    allowed: true,
    authorizationId,
    principalId: principal.id,
    grant: {
      ...request,
      destinationIds: [...request.destinationIds],
      secretReferenceIds: [...request.secretReferenceIds],
      filesystemReadRoots: request.filesystemReadRoots.map(normalizedRoot),
      filesystemWriteRoots: request.filesystemWriteRoots.map(normalizedRoot),
      sideEffects: [...request.sideEffects],
    },
  };
}
