export const TENANT_ISOLATION_SURFACES = [
  "api", "store", "cache", "queue", "backup", "migration",
] as const;

export type TenantIsolationSurface = typeof TENANT_ISOLATION_SURFACES[number];

export interface TenantIsolationAdapter {
  readonly surface: TenantIsolationSurface;
  resolve(
    callerTenantId: string,
    resourceTenantId: string | undefined,
  ): "authorized" | "not_authorized" | Promise<"authorized" | "not_authorized">;
}

export interface TenantIsolationMatrixResult {
  readonly schemaVersion: 1;
  readonly surfaces: readonly {
    readonly surface: TenantIsolationSurface;
    readonly sameTenant: "authorized";
    readonly crossTenant: "not_authorized";
    readonly missingResource: "not_authorized";
  }[];
}

export const CLOUD_SECONDARY_SINKS = [
  "applicationLog",
  "auditLog",
  "metric",
  "trace",
  "deadLetter",
  "cache",
  "searchIndex",
  "export",
  "backup",
  "migration",
] as const;

export type CloudSecondarySink = typeof CLOUD_SECONDARY_SINKS[number];
export type CloudSinkDataClass = "MINIMAL_METADATA" | "TOMBSTONE";

export interface CloudSecondarySinkInventoryEntry {
  readonly sink: CloudSecondarySink;
  readonly owner: string;
  readonly tenantScoped: boolean;
  readonly allowedDataClasses: readonly CloudSinkDataClass[];
  readonly deletionControl: "purge" | "tombstone_filter" | "scheduled_expiry";
  readonly canaryScanRequired: true;
}

export interface CloudSecondarySinkInventory {
  readonly schemaVersion: 1;
  readonly sinks: readonly CloudSecondarySinkInventoryEntry[];
}

export interface CloudSinkSnapshot {
  readonly sink: CloudSecondarySink;
  readonly tenantId?: string;
  readonly encodedBytes: Uint8Array;
}

export type CloudCanary =
  | { readonly kind: "source" | "secret"; readonly value: string }
  | { readonly kind: "tenant"; readonly value: string; readonly tenantId: string };

const MAXIMUM_SNAPSHOT_BYTES = 1_048_576;
const MAXIMUM_CANARIES = 100;

function bounded(value: unknown, maximum = 256): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maximum
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function containsBytes(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.byteLength === 0 || needle.byteLength > haystack.byteLength) return false;
  outer: for (let offset = 0; offset <= haystack.byteLength - needle.byteLength; offset += 1) {
    for (let index = 0; index < needle.byteLength; index += 1) {
      if (haystack[offset + index] !== needle[index]) continue outer;
    }
    return true;
  }
  return false;
}

export async function runTenantIsolationMatrix(
  adapters: readonly TenantIsolationAdapter[],
): Promise<TenantIsolationMatrixResult> {
  if (adapters.length !== TENANT_ISOLATION_SURFACES.length
    || new Set(adapters.map((adapter) => adapter.surface)).size !== adapters.length
    || TENANT_ISOLATION_SURFACES.some(
      (surface) => !adapters.some((adapter) => adapter.surface === surface),
    )) {
    throw new TypeError("VFY_TENANT_MATRIX_INCOMPLETE: every isolation surface is required once");
  }
  const surfaces = [];
  for (const surface of TENANT_ISOLATION_SURFACES) {
    const adapter = adapters.find((candidate) => candidate.surface === surface) as TenantIsolationAdapter;
    const sameTenant = await adapter.resolve("tenant:matrix-one", "tenant:matrix-one");
    const crossTenant = await adapter.resolve("tenant:matrix-one", "tenant:matrix-two");
    const missingResource = await adapter.resolve("tenant:matrix-one", undefined);
    if (sameTenant !== "authorized"
      || crossTenant !== "not_authorized"
      || missingResource !== "not_authorized") {
      throw new TypeError(`VFY_TENANT_ISOLATION_FAILED: ${surface} did not fail closed`);
    }
    surfaces.push({ surface, sameTenant, crossTenant, missingResource });
  }
  return { schemaVersion: 1, surfaces };
}

export function assertCloudSecondarySinkInventory(
  inventory: CloudSecondarySinkInventory,
): void {
  if (inventory.schemaVersion !== 1
    || inventory.sinks.length !== CLOUD_SECONDARY_SINKS.length
    || new Set(inventory.sinks.map((entry) => entry.sink)).size !== inventory.sinks.length
    || CLOUD_SECONDARY_SINKS.some(
      (sink) => !inventory.sinks.some((entry) => entry.sink === sink),
    )) {
    throw new TypeError("VFY_CLOUD_SINK_INVENTORY_INCOMPLETE: exact secondary sinks are required");
  }
  for (const entry of inventory.sinks) {
    if (!bounded(entry.owner)
      || entry.canaryScanRequired !== true
      || typeof entry.tenantScoped !== "boolean"
      || entry.allowedDataClasses.length === 0
      || entry.allowedDataClasses.length > 2
      || new Set(entry.allowedDataClasses).size !== entry.allowedDataClasses.length
      || entry.allowedDataClasses.some(
        (value) => value !== "MINIMAL_METADATA" && value !== "TOMBSTONE",
      )
      || !["purge", "tombstone_filter", "scheduled_expiry"].includes(entry.deletionControl)) {
      throw new TypeError("VFY_CLOUD_SINK_INVENTORY_INVALID: sink control is malformed");
    }
  }
}

export function assertCloudCanariesAbsent(
  inventory: CloudSecondarySinkInventory,
  snapshots: readonly CloudSinkSnapshot[],
  canaries: readonly CloudCanary[],
): void {
  assertCloudSecondarySinkInventory(inventory);
  if (snapshots.length !== CLOUD_SECONDARY_SINKS.length
    || new Set(snapshots.map((snapshot) => snapshot.sink)).size !== snapshots.length
    || canaries.length === 0
    || canaries.length > MAXIMUM_CANARIES) {
    throw new TypeError("VFY_CLOUD_CANARY_SCAN_INCOMPLETE: exact bounded scan inputs are required");
  }
  for (const canary of canaries) {
    if (!bounded(canary.value, 1_024)
      || (canary.kind === "tenant" && !bounded(canary.tenantId))) {
      throw new TypeError("VFY_CLOUD_CANARY_INVALID: canary is malformed");
    }
  }
  for (const entry of inventory.sinks) {
    const snapshot = snapshots.find((candidate) => candidate.sink === entry.sink);
    if (snapshot === undefined
      || !(snapshot.encodedBytes instanceof Uint8Array)
      || snapshot.encodedBytes.byteLength > MAXIMUM_SNAPSHOT_BYTES
      || (entry.tenantScoped && !bounded(snapshot.tenantId))) {
      throw new TypeError("VFY_CLOUD_CANARY_SCAN_INCOMPLETE: sink snapshot is missing or invalid");
    }
    for (const canary of canaries) {
      const authorizedTenantMarker = canary.kind === "tenant"
        && entry.tenantScoped
        && snapshot.tenantId === canary.tenantId;
      if (!authorizedTenantMarker
        && containsBytes(snapshot.encodedBytes, new TextEncoder().encode(canary.value))) {
        throw new TypeError(`VFY_CLOUD_CANARY_LEAK: ${entry.sink} contains a forbidden canary`);
      }
    }
  }
}
