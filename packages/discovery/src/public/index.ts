import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { canonicalize } from "@verify-internal/contracts";
import type { CanonicalValue } from "@verify-internal/contracts";
export { StructuredDataError, parseJsonData } from "./strict-json.js";
import { parseJsonData } from "./strict-json.js";
export {
  discoverAndSealWorkspace,
  resolveAndSealWorkspaceModel,
} from "./model-sealing.js";
export type {
  MvpWorkspacePredicate,
  SealableProofDefinition,
  SealedWorkspaceModel,
  WorkspaceModelResolution,
} from "./model-sealing.js";

export interface DiscoveryLimits {
  readonly maxFiles: number;
  readonly maxInspectedBytes: number;
  readonly maxFileBytes: number;
  readonly maxManifests: number;
  readonly maxDepth: number;
  readonly timeoutMs: number;
}

export const DEFAULT_DISCOVERY_LIMITS: DiscoveryLimits = Object.freeze({
  maxFiles: 100_000,
  maxInspectedBytes: 256 * 1024 * 1024,
  maxFileBytes: 2 * 1024 * 1024,
  maxManifests: 10_000,
  maxDepth: 64,
  timeoutMs: 30_000,
});

export interface DiscoveryPolicy {
  readonly limits?: Partial<DiscoveryLimits>;
  readonly signal?: AbortSignal;
  readonly now?: () => number;
}

export interface DiscoveryPlan {
  readonly schemaVersion: 1;
  readonly workspaceRoot: string;
  readonly limits: DiscoveryLimits;
  readonly permissions: {
    readonly network: false;
    readonly write: false;
    readonly process: false;
  };
}

export interface ManifestObservation {
  readonly path: string;
  readonly name?: string;
  readonly version?: string;
  readonly private?: boolean;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly workspaceMember: boolean;
  readonly contentDigest: `sha256:${string}`;
}

export interface DiscoveryDiagnostic {
  readonly code: string;
  readonly path?: string;
  readonly message: string;
}

export interface DiscoveryConflict {
  readonly code: string;
  readonly paths: readonly string[];
  readonly message: string;
}

export interface DiscoverySignal {
  readonly id: `sha256:${string}`;
  readonly readerId: string;
  readonly inputPath: string;
  readonly pointer: string;
  readonly kind: string;
  readonly value: CanonicalValue;
}

export interface DiscoveryFact {
  readonly id: `sha256:${string}`;
  readonly readerId: string;
  readonly inputPath: string;
  readonly pointer: string;
  readonly kind: string;
  readonly value: CanonicalValue;
}

export interface ModelCandidate {
  readonly kind: "application";
  readonly relativeRoot: string;
  readonly packageIdentity: string;
  readonly sourceFactIds: readonly `sha256:${string}`[];
}

export interface WorkspaceDiscovery {
  readonly schemaVersion: 1;
  readonly workspaceRoot: string;
  readonly workspaceBinding: `sha256:${string}`;
  readonly completion: "complete" | "bounded" | "cancelled" | "error";
  readonly packageManagers: readonly ("npm" | "pnpm" | "yarn")[];
  readonly selectedPackageManager?: "npm" | "pnpm" | "yarn";
  readonly workspacePatterns: readonly string[];
  readonly manifests: readonly ManifestObservation[];
  readonly lockfiles: readonly string[];
  readonly inspectedFiles: number;
  readonly inspectedBytes: number;
  readonly skipped: readonly { path: string; reason: string }[];
  readonly conflicts: readonly DiscoveryConflict[];
  readonly diagnostics: readonly DiscoveryDiagnostic[];
  readonly signals: readonly DiscoverySignal[];
  readonly facts: readonly DiscoveryFact[];
  readonly candidates: readonly ModelCandidate[];
  readonly modelRevision: `sha256:${string}`;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

const SKIPPED_DIRECTORIES = new Set([
  ".git",
  ".hg",
  ".svn",
  ".verify",
  "node_modules",
  "coverage",
  "dist",
  "build",
  "out",
  ".next",
]);

const INTERESTING_FILES = new Set([
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-workspace.yaml",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function resolveDiscoveryLimits(requested: Partial<DiscoveryLimits> | undefined): DiscoveryLimits {
  const output = { ...DEFAULT_DISCOVERY_LIMITS };
  if (!requested) return output;
  for (const key of Object.keys(output) as (keyof DiscoveryLimits)[]) {
    const value = requested[key];
    if (value === undefined) continue;
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(`discovery limit ${key} must be a positive integer`);
    }
    const maximum = DEFAULT_DISCOVERY_LIMITS[key] * 10;
    output[key] = Math.min(value, maximum);
  }
  return output;
}

export function createDiscoveryPlan(
  workspaceRoot: string,
  requested?: Partial<DiscoveryLimits>,
): DiscoveryPlan {
  if (typeof workspaceRoot !== "string" || workspaceRoot.length === 0) {
    throw new TypeError("workspace root is required");
  }
  return {
    schemaVersion: 1,
    workspaceRoot,
    limits: resolveDiscoveryLimits(requested),
    permissions: { network: false, write: false, process: false },
  };
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

function globToRegExp(pattern: string): RegExp {
  const normalized = pattern.replace(/^\.\//, "").replace(/\/+$/, "");
  let source = "^";
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (character === "*") {
      if (normalized[index + 1] === "*") {
        index += 1;
        source += ".*";
      } else {
        source += "[^/]*";
      }
    } else if (character === "?") {
      source += "[^/]";
    } else {
      source += character?.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    }
  }
  return new RegExp(`${source}$`);
}

function isWorkspaceMember(directory: string, patterns: readonly string[]): boolean {
  if (directory === ".") return true;
  let included = false;
  for (const rawPattern of patterns) {
    const negative = rawPattern.startsWith("!");
    const pattern = negative ? rawPattern.slice(1) : rawPattern;
    if (globToRegExp(pattern).test(directory)) included = !negative;
  }
  return included;
}

function parseWorkspacePatterns(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (value && typeof value === "object" && "packages" in value) {
    return parseWorkspacePatterns((value as { packages?: unknown }).packages);
  }
  return [];
}

function parsePnpmWorkspace(text: string): string[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const patterns: string[] = [];
  let inPackages = false;
  for (const line of lines) {
    if (/^packages\s*:\s*$/.test(line.trim())) {
      inPackages = true;
      continue;
    }
    if (inPackages && /^\S/.test(line) && !/^\s*-/.test(line)) break;
    const match = inPackages ? line.match(/^\s*-\s*(?:"([^"]+)"|'([^']+)'|([^#\s][^#]*?))\s*(?:#.*)?$/) : null;
    const value = match?.[1] ?? match?.[2] ?? match?.[3]?.trim();
    if (value) patterns.push(value);
  }
  return patterns;
}

function isSafeWorkspacePattern(value: string): boolean {
  const pattern = value.startsWith("!") ? value.slice(1) : value;
  return pattern.length > 0
    && pattern === pattern.trim()
    && !pattern.startsWith("/")
    && !pattern.includes("\\")
    && !pattern.includes("\0")
    && pattern.split("/").every((segment) => segment !== "" && segment !== "..");
}

function dependenciesFromManifest(value: Record<string, unknown>): Record<string, string> {
  const output: Record<string, string> = {};
  for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    const dependencies = value[field];
    if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) continue;
    for (const [name, range] of Object.entries(dependencies)) {
      if (typeof range === "string") output[name] = range;
    }
  }
  return Object.fromEntries(Object.entries(output).sort(([left], [right]) => compareText(left, right)));
}

function safeManifestProjection(value: unknown): {
  name?: string;
  version?: string;
  private?: boolean;
  dependencies: Record<string, string>;
  workspaces: string[];
  packageManager?: string;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("manifest root must be an object");
  }
  const manifest = value as Record<string, unknown>;
  const projected: {
    name?: string;
    version?: string;
    private?: boolean;
    dependencies: Record<string, string>;
    workspaces: string[];
    packageManager?: string;
  } = {
    dependencies: dependenciesFromManifest(manifest),
    workspaces: parseWorkspacePatterns(manifest.workspaces),
  };
  if (typeof manifest.name === "string") projected.name = manifest.name;
  if (typeof manifest.version === "string") projected.version = manifest.version;
  if (typeof manifest.private === "boolean") projected.private = manifest.private;
  if (typeof manifest.packageManager === "string") projected.packageManager = manifest.packageManager;
  return projected;
}

function checkCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException("discovery cancelled", "AbortError");
}

export async function discoverWorkspace(
  workspaceRoot: string,
  policy: DiscoveryPolicy = {},
): Promise<WorkspaceDiscovery> {
  const plan = createDiscoveryPlan(workspaceRoot, policy.limits);
  const limits = plan.limits;
  const now = policy.now ?? Date.now;
  const started = now();
  const root = await realpath(workspaceRoot);
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory()) throw new TypeError("workspace root must be a directory");

  const files: string[] = [];
  const skipped: { path: string; reason: string }[] = [];
  const diagnostics: DiscoveryDiagnostic[] = [];
  let inspectedFiles = 0;
  let inspectedBytes = 0;
  let completion: WorkspaceDiscovery["completion"] = "complete";

  async function walk(directory: string, depth: number): Promise<void> {
    checkCancelled(policy.signal);
    if (now() - started > limits.timeoutMs) {
      completion = "bounded";
      return;
    }
    if (depth > limits.maxDepth || inspectedFiles >= limits.maxFiles) {
      completion = "bounded";
      return;
    }
    const directoryRealpath = await realpath(directory);
    if (directoryRealpath !== root && !directoryRealpath.startsWith(`${root}${path.sep}`)) {
      skipped.push({ path: toPosix(path.relative(root, directory)), reason: "outside_workspace" });
      return;
    }
    const directoryStat = await lstat(directory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
      skipped.push({ path: toPosix(path.relative(root, directory)), reason: "not_ordinary_directory" });
      return;
    }
    const children = (await readdir(directory, { withFileTypes: true }))
      .sort((left, right) => compareText(left.name, right.name));
    for (const child of children) {
      checkCancelled(policy.signal);
      if (now() - started > limits.timeoutMs) {
        completion = "bounded";
        return;
      }
      const absolute = path.join(directory, child.name);
      const relative = toPosix(path.relative(root, absolute));
      if (child.isSymbolicLink()) {
        skipped.push({ path: relative, reason: "symbolic_link" });
        continue;
      }
      if (child.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(child.name)) {
          skipped.push({ path: relative, reason: "ignored_directory" });
        } else {
          await walk(absolute, depth + 1);
        }
        if (completion !== "complete") return;
        continue;
      }
      if (!child.isFile()) {
        skipped.push({ path: relative, reason: "special_file" });
        continue;
      }
      inspectedFiles += 1;
      if (inspectedFiles > limits.maxFiles) {
        completion = "bounded";
        return;
      }
      if (INTERESTING_FILES.has(child.name)) files.push(relative);
    }
  }

  try {
    await walk(root, 0);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      completion = "cancelled";
    } else {
      throw error;
    }
  }

  const textByPath = new Map<string, string>();
  for (const relative of files.sort()) {
    if (completion === "cancelled") break;
    if (policy.signal?.aborted) {
      completion = "cancelled";
      break;
    }
    if (now() - started > limits.timeoutMs) {
      completion = "bounded";
      break;
    }
    const absolute = path.resolve(root, relative);
    if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
      skipped.push({ path: relative, reason: "outside_workspace" });
      continue;
    }
    const remaining = limits.maxInspectedBytes - inspectedBytes;
    const maximum = Math.min(limits.maxFileBytes, remaining);
    if (maximum <= 0) {
      skipped.push({ path: relative, reason: "size_limit" });
      completion = "bounded";
      continue;
    }
    let handle;
    try {
      handle = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const stat = await handle.stat();
      if (!stat.isFile()) {
        skipped.push({ path: relative, reason: "not_ordinary_file" });
        continue;
      }
      if (stat.size > maximum) {
        skipped.push({ path: relative, reason: "size_limit" });
        completion = "bounded";
        continue;
      }
      const bytes = new Uint8Array(maximum + 1);
      let offset = 0;
      while (offset < bytes.length) {
        const result = await handle.read(bytes, offset, bytes.length - offset, offset);
        if (result.bytesRead === 0) break;
        offset += result.bytesRead;
      }
      const finalStat = await handle.stat();
      if (
        finalStat.dev !== stat.dev ||
        finalStat.ino !== stat.ino ||
        finalStat.size !== stat.size ||
        finalStat.mtimeMs !== stat.mtimeMs
      ) {
        skipped.push({ path: relative, reason: "mutated_during_read" });
        completion = "bounded";
        continue;
      }
      if (offset > maximum) {
        skipped.push({ path: relative, reason: "size_limit" });
        completion = "bounded";
        continue;
      }
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, offset));
      inspectedBytes += offset;
      textByPath.set(relative, text);
    } catch (error) {
      skipped.push({
        path: relative,
        reason: error instanceof TypeError ? "invalid_utf8" : "unsafe_or_unreadable",
      });
    } finally {
      await handle?.close();
    }
  }

  const rootPackageText = textByPath.get("package.json");
  let rootManifest: ReturnType<typeof safeManifestProjection> | undefined;
  if (rootPackageText !== undefined) {
    try {
      rootManifest = safeManifestProjection(parseJsonData(rootPackageText));
    } catch (error) {
      diagnostics.push({
        code: error instanceof Error && "code" in error && error.code === "DUPLICATE_KEY"
          ? "DUPLICATE_PACKAGE_JSON_KEY"
          : "INVALID_PACKAGE_JSON",
        path: "package.json",
        message: "root package.json is not valid unambiguous bounded JSON",
      });
    }
  }

  const pnpmWorkspaceText = textByPath.get("pnpm-workspace.yaml");
  const npmWorkspacePatterns = rootManifest?.workspaces ?? [];
  const pnpmWorkspacePatterns = pnpmWorkspaceText ? parsePnpmWorkspace(pnpmWorkspaceText) : [];
  const rawWorkspacePatterns = [
    ...npmWorkspacePatterns,
    ...pnpmWorkspacePatterns,
  ];
  for (const pattern of rawWorkspacePatterns) {
    if (!isSafeWorkspacePattern(pattern)) {
      diagnostics.push({
        code: "INVALID_WORKSPACE_PATTERN",
        message: "workspace patterns must be normalized repository-relative globs",
      });
    }
  }
  const workspacePatterns = rawWorkspacePatterns
    .filter(isSafeWorkspacePattern)
    .filter((value, index, values) => values.indexOf(value) === index);

  const packageManagers: ("npm" | "pnpm" | "yarn")[] = [];
  const lockfiles = [...textByPath.keys()]
    .filter((value) => /(?:^|\/)(?:package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock)$/.test(value))
    .sort(compareText);
  if (lockfiles.some((value) => /(?:^|\/)(?:package-lock\.json|npm-shrinkwrap\.json)$/.test(value))) {
    packageManagers.push("npm");
  }
  if (lockfiles.some((value) => /(?:^|\/)pnpm-lock\.yaml$/.test(value)) || textByPath.has("pnpm-workspace.yaml")) {
    packageManagers.push("pnpm");
  }
  if (lockfiles.some((value) => /(?:^|\/)yarn\.lock$/.test(value)) || rootManifest?.packageManager?.startsWith("yarn@")) {
    packageManagers.push("yarn");
  }
  if (rootManifest?.packageManager?.startsWith("npm@") && !packageManagers.includes("npm")) packageManagers.push("npm");
  if (rootManifest?.packageManager?.startsWith("pnpm@") && !packageManagers.includes("pnpm")) packageManagers.push("pnpm");
  if (packageManagers.length === 0 && rootPackageText !== undefined) packageManagers.push("npm");

  const selectedPackageManager = packageManagers.length === 1 ? packageManagers[0] : undefined;
  const conflicts: DiscoveryConflict[] = [];
  if (packageManagers.length > 1) {
    conflicts.push({
      code: "MULTIPLE_PACKAGE_MANAGERS",
      paths: lockfiles,
      message: `conflicting package-manager signals: ${packageManagers.join(", ")}`,
    });
  }

  const manifests: ManifestObservation[] = [];
  for (const relative of files.filter((file) => path.posix.basename(file) === "package.json").sort()) {
    if (manifests.length >= limits.maxManifests) {
      completion = "bounded";
      break;
    }
    const text = textByPath.get(relative);
    if (text === undefined) continue;
    try {
      const projected = safeManifestProjection(parseJsonData(text));
      const directory = path.posix.dirname(relative);
      const observation: ManifestObservation = {
        path: relative,
        dependencies: projected.dependencies,
        workspaceMember: isWorkspaceMember(directory, workspacePatterns),
        contentDigest: digest(text),
      };
      if (projected.name !== undefined) Object.assign(observation, { name: projected.name });
      if (projected.version !== undefined) Object.assign(observation, { version: projected.version });
      if (projected.private !== undefined) Object.assign(observation, { private: projected.private });
      manifests.push(observation);
    } catch (error) {
      diagnostics.push({
        code: error instanceof Error && "code" in error && error.code === "DUPLICATE_KEY"
          ? "DUPLICATE_PACKAGE_JSON_KEY"
          : "INVALID_PACKAGE_JSON",
        path: relative,
        message: "package.json is not valid unambiguous bounded JSON",
      });
      const directory = path.posix.dirname(relative);
      manifests.push({
        path: relative,
        dependencies: {},
        workspaceMember: isWorkspaceMember(directory, workspacePatterns),
        contentDigest: digest(text),
      });
    }
  }

  const rootIdentityDigest = digest(canonicalize({
    domain: "verification-platform/local-root-identity",
    schemaVersion: 1,
    packageIdentity: rootManifest?.name ?? "anonymous-workspace",
    applications: manifests.map((item) => ({
      path: item.path,
      ...(item.name === undefined ? {} : { name: item.name }),
    })),
    workspacePatterns,
  }));
  const workspaceBinding = digest(canonicalize({
    domain: "verification-platform/workspace-binding",
    schemaVersion: 1,
    source: "local-root-signals",
    rootIdentityDigest,
  }));
  const signals: DiscoverySignal[] = [];
  const signal = (
    readerId: string,
    inputPath: string,
    pointer: string,
    kind: string,
    value: CanonicalValue,
  ): void => {
    const stable = { readerId, inputPath, pointer, kind, value };
    signals.push({ id: digest(canonicalize(stable)), ...stable });
  };
  npmWorkspacePatterns.forEach((pattern, index) =>
    signal("package-json:v1", "package.json", `/workspaces/${index}`, "workspace.pattern", pattern));
  pnpmWorkspacePatterns.forEach((pattern, index) =>
    signal("pnpm-workspace:v1", "pnpm-workspace.yaml", `/packages/${index}`, "workspace.pattern", pattern));
  for (const lockfile of lockfiles) {
    const manager = lockfile.endsWith("pnpm-lock.yaml")
      ? "pnpm"
      : lockfile.endsWith("yarn.lock")
        ? "yarn"
        : "npm";
    signal(`${manager}-lockfile:v1`, lockfile, "/", "packageManager.lockfile", manager);
  }
  const facts: DiscoveryFact[] = manifests.map((manifest) => {
    const stable = {
      readerId: "package-json:v1",
      inputPath: manifest.path,
      pointer: "/",
      kind: "workspace.manifest",
      value: JSON.parse(JSON.stringify({
        path: manifest.path,
        ...(manifest.name === undefined ? {} : { name: manifest.name }),
        ...(manifest.version === undefined ? {} : { version: manifest.version }),
        dependencies: manifest.dependencies,
        workspaceMember: manifest.workspaceMember,
        contentDigest: manifest.contentDigest,
      })) as CanonicalValue,
    };
    return { id: digest(canonicalize(stable)), ...stable };
  });
  const candidates: ModelCandidate[] = manifests
    .filter((manifest): manifest is ManifestObservation & { name: string } =>
      manifest.workspaceMember && typeof manifest.name === "string")
    .map((manifest) => ({
      kind: "application",
      relativeRoot: manifest.path === "package.json"
        ? "."
        : manifest.path.slice(0, -"/package.json".length),
      packageIdentity: manifest.name,
      sourceFactIds: facts
        .filter((fact) => fact.inputPath === manifest.path)
        .map((fact) => fact.id),
    }));
  const semantic = {
    schemaVersion: 1,
    workspaceBinding,
    packageManagers,
    ...(selectedPackageManager ? { selectedPackageManager } : {}),
    workspacePatterns,
    manifests,
    lockfiles,
    conflicts,
    diagnostics,
    signals,
    facts,
    candidates,
    completion,
  };
  return {
    schemaVersion: 1,
    workspaceRoot: root,
    workspaceBinding,
    completion,
    packageManagers,
    ...(selectedPackageManager ? { selectedPackageManager } : {}),
    workspacePatterns,
    manifests,
    lockfiles,
    inspectedFiles,
    inspectedBytes,
    skipped: skipped.sort((left, right) => compareText(left.path, right.path)),
    conflicts,
    diagnostics,
    signals,
    facts,
    candidates,
    modelRevision: digest(canonicalize(
      JSON.parse(JSON.stringify(semantic)) as CanonicalValue,
    )),
  };
}
