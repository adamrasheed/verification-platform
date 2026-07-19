import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  canonicalize,
  parseCanonicalJson,
  type CanonicalValue,
  type RepairSuggestion,
  type RevisionRef,
  type Sha256Digest,
} from "@verify-internal/contracts";

export type RepairApplyConflictCode =
  | "INVALID_REPAIR_ACTION"
  | "INVALID_TARGET"
  | "INVALID_JSON_PATCH"
  | "STALE_TARGET"
  | "TARGET_NOT_REGULAR_FILE";

export class RepairApplyConflict extends Error {
  readonly code: RepairApplyConflictCode;

  constructor(code: RepairApplyConflictCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "RepairApplyConflict";
    this.code = code;
  }
}

export interface RepairPatchPreview {
  readonly schemaVersion: 1;
  readonly kind: "repairPatchPreview";
  readonly repair: RevisionRef;
  readonly target: string;
  readonly expectedContentDigest: Sha256Digest;
  readonly currentContentDigest: Sha256Digest;
  readonly patchedContentDigest: Sha256Digest;
  readonly operations: RepairSuggestion["action"] extends infer _T
    ? readonly {
        readonly operation: "add" | "remove" | "replace";
        readonly pointer: string;
        readonly value?: CanonicalValue;
      }[]
    : never;
  readonly before: CanonicalValue;
  readonly after: CanonicalValue;
}

function digest(bytes: string | Uint8Array): Sha256Digest {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function repairRef(repair: RepairSuggestion): RevisionRef {
  return {
    kind: "repair",
    id: repair.id,
    revision: repair.revision,
    schemaVersion: repair.schemaVersion,
  };
}

function decodePointer(pointer: string): readonly string[] {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) {
    throw new RepairApplyConflict(
      "INVALID_JSON_PATCH",
      `JSON Pointer must start with '/': ${pointer}`,
    );
  }
  return pointer.slice(1).split("/").map((segment) => {
    if (/~(?:[^01]|$)/.test(segment)) {
      throw new RepairApplyConflict(
        "INVALID_JSON_PATCH",
        `invalid JSON Pointer escape: ${pointer}`,
      );
    }
    return segment.replace(/~1/g, "/").replace(/~0/g, "~");
  });
}

function arrayIndex(segment: string, length: number, allowEnd: boolean): number {
  if (!/^(0|[1-9][0-9]*)$/.test(segment)) {
    throw new RepairApplyConflict("INVALID_JSON_PATCH", "invalid array index");
  }
  const index = Number(segment);
  if (!Number.isSafeInteger(index) || index > length || (!allowEnd && index === length)) {
    throw new RepairApplyConflict("INVALID_JSON_PATCH", "array index is out of range");
  }
  return index;
}

function applyOperation(
  document: CanonicalValue,
  operation: {
    readonly operation: "add" | "remove" | "replace";
    readonly pointer: string;
    readonly value?: CanonicalValue;
  },
): CanonicalValue {
  const segments = decodePointer(operation.pointer);
  if (segments.length === 0) {
    if (operation.operation === "remove" || operation.value === undefined) {
      throw new RepairApplyConflict("INVALID_JSON_PATCH", "root removal is not supported");
    }
    return structuredClone(operation.value);
  }
  const output = structuredClone(document);
  let parent: CanonicalValue = output;
  for (const segment of segments.slice(0, -1)) {
    if (Array.isArray(parent)) {
      parent = parent[arrayIndex(segment, parent.length, false)]!;
    } else if (typeof parent === "object" && parent !== null) {
      if (!(segment in parent)) {
        throw new RepairApplyConflict("INVALID_JSON_PATCH", "pointer parent does not exist");
      }
      parent = (parent as { [key: string]: CanonicalValue })[segment]!;
    } else {
      throw new RepairApplyConflict("INVALID_JSON_PATCH", "pointer crosses a scalar");
    }
  }
  const leaf = segments.at(-1)!;
  if (Array.isArray(parent)) {
    const index = arrayIndex(leaf, parent.length, operation.operation === "add");
    if (operation.operation === "remove") parent.splice(index, 1);
    else if (operation.operation === "add") {
      if (operation.value === undefined) {
        throw new RepairApplyConflict("INVALID_JSON_PATCH", "add requires a value");
      }
      parent.splice(index, 0, structuredClone(operation.value));
    } else {
      if (operation.value === undefined) {
        throw new RepairApplyConflict("INVALID_JSON_PATCH", "replace requires a value");
      }
      parent[index] = structuredClone(operation.value);
    }
    return output;
  }
  if (typeof parent !== "object" || parent === null) {
    throw new RepairApplyConflict("INVALID_JSON_PATCH", "pointer parent is not a container");
  }
  const record = parent as { [key: string]: CanonicalValue };
  if (operation.operation !== "add" && !(leaf in record)) {
    throw new RepairApplyConflict("INVALID_JSON_PATCH", "patch target does not exist");
  }
  if (operation.operation === "remove") delete record[leaf];
  else {
    if (operation.value === undefined) {
      throw new RepairApplyConflict(
        "INVALID_JSON_PATCH",
        `${operation.operation} requires a value`,
      );
    }
    record[leaf] = structuredClone(operation.value);
  }
  return output;
}

function targetPath(workspaceRoot: string, target: string): string {
  if (target === "" || path.isAbsolute(target)) {
    throw new RepairApplyConflict("INVALID_TARGET", "target must be workspace-relative");
  }
  const root = realpathSync(workspaceRoot);
  const candidate = path.resolve(root, target);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
    throw new RepairApplyConflict("INVALID_TARGET", "target escapes the workspace");
  }
  const parent = realpathSync(path.dirname(candidate));
  if (parent !== root && !parent.startsWith(`${root}${path.sep}`)) {
    throw new RepairApplyConflict("INVALID_TARGET", "target parent escapes the workspace");
  }
  const stat = lstatSync(candidate);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new RepairApplyConflict(
      "TARGET_NOT_REGULAR_FILE",
      "target must be an existing ordinary file",
    );
  }
  return candidate;
}

export function previewRepairPatch(
  repair: RepairSuggestion,
  workspaceRoot: string,
): RepairPatchPreview {
  if (repair.action.kind !== "jsonPatch") {
    throw new RepairApplyConflict(
      "INVALID_REPAIR_ACTION",
      "only deterministic JSON Patch Repairs can be applied",
    );
  }
  const target = targetPath(workspaceRoot, repair.action.target);
  const bytes = readFileSync(target);
  const currentContentDigest = digest(bytes);
  if (currentContentDigest !== repair.action.expectedContentDigest) {
    throw new RepairApplyConflict(
      "STALE_TARGET",
      `target digest ${currentContentDigest} does not match the retained Repair`,
    );
  }
  const before = parseCanonicalJson(bytes.toString("utf8"));
  const after = repair.action.operations.reduce(
    (document, operation) => applyOperation(document, operation),
    before,
  );
  const patched = `${JSON.stringify(after, null, 2)}\n`;
  return {
    schemaVersion: 1,
    kind: "repairPatchPreview",
    repair: repairRef(repair),
    target: repair.action.target,
    expectedContentDigest: repair.action.expectedContentDigest,
    currentContentDigest,
    patchedContentDigest: digest(patched),
    operations: repair.action.operations,
    before,
    after,
  };
}

export function applyRepairPatch(
  repair: RepairSuggestion,
  workspaceRoot: string,
): RepairPatchPreview {
  const preview = previewRepairPatch(repair, workspaceRoot);
  const target = targetPath(workspaceRoot, preview.target);
  const mode = lstatSync(target).mode & 0o777;
  const temporary = path.join(
    path.dirname(target),
    `.${path.basename(target)}.verify-${randomUUID()}.tmp`,
  );
  let descriptor: number | undefined;
  try {
    writeFileSync(temporary, `${JSON.stringify(preview.after, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode,
    });
    descriptor = openSync(temporary, "r");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    if (digest(readFileSync(target)) !== preview.currentContentDigest) {
      throw new RepairApplyConflict(
        "STALE_TARGET",
        "target changed after preview and before atomic replacement",
      );
    }
    targetPath(workspaceRoot, preview.target);
    renameSync(temporary, target);
    const directory = openSync(path.dirname(target), "r");
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
    return preview;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporary, { force: true });
  }
}
