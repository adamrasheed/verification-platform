import path from "node:path";

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
