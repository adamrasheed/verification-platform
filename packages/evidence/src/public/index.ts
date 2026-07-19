import { createHash } from "node:crypto";
import { canonicalize } from "@verify-internal/contracts";
import type {
  CanonicalValue,
  ProofAttemptRef,
} from "@verify-internal/contracts";

export type EvidenceClassification =
  | "LOCAL_SOURCE"
  | "SENSITIVE_EVIDENCE"
  | "MINIMAL_METADATA";

export interface EvidenceCandidate {
  readonly workspaceBinding: string;
  readonly evidenceType: "workspace.manifest-observations";
  readonly mediaType: "application/vnd.verify.workspace-observations+json";
  readonly observations: readonly {
    readonly path: string;
    readonly name?: string;
    readonly version?: string;
    readonly dependencies: Readonly<Record<string, string>>;
    readonly workspaceMember: boolean;
    readonly contentDigest: string;
  }[];
  readonly lockfiles: readonly string[];
  readonly packageManagers: readonly string[];
  readonly completion: "complete" | "bounded" | "cancelled" | "error";
  readonly diagnostics: readonly { readonly code: string; readonly path?: string }[];
}

export interface NormalizedEvidence {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly revision: `sha256:${string}`;
  readonly evidenceType: EvidenceCandidate["evidenceType"];
  readonly mediaType: EvidenceCandidate["mediaType"];
  readonly contentDigest: `sha256:${string}`;
  readonly byteSize: number;
  readonly classification: EvidenceClassification;
  readonly body: CanonicalValue;
  readonly redactions: number;
}

export interface EvidenceValidation {
  readonly schemaVersion: 1;
  readonly evidenceRevision: `sha256:${string}`;
  readonly state: "valid" | "rejected";
  readonly reasonCodes: readonly string[];
  readonly validationDigest: `sha256:${string}`;
}

export interface EvidenceCaptureUnit {
  readonly schemaVersion: 1;
  readonly evidence: NormalizedEvidence;
  readonly attempt: ProofAttemptRef;
}

/**
 * `commitCapture` must atomically expose the Evidence revision and its exact
 * attempt edge. Validation is deliberately appended separately and never
 * mutates the captured Evidence.
 */
export interface EvidenceCaptureCommitPort {
  commitCapture(unit: EvidenceCaptureUnit): Promise<void>;
  appendValidation(validation: EvidenceValidation): Promise<void>;
}

export async function captureValidateAndCommitWorkspaceEvidence(
  candidate: EvidenceCandidate,
  attempt: ProofAttemptRef,
  port: EvidenceCaptureCommitPort,
): Promise<{
  readonly evidence: NormalizedEvidence;
  readonly validation: EvidenceValidation;
}> {
  const evidence = normalizeWorkspaceEvidence(candidate);
  await port.commitCapture({ schemaVersion: 1, evidence, attempt });
  const validation = validateEvidence(evidence);
  await port.appendValidation(validation);
  return { evidence, validation };
}

const MAX_EVIDENCE_BYTES = 2 * 1024 * 1024;
const SECRET_NAME = /(?:^|[_-])(token|secret|password|passwd|api[_-]?key|private[_-]?key)(?:$|[_-])/i;
const SECRET_VALUE = /(?:bearer\s+[a-z0-9._~-]+|-----BEGIN [A-Z ]+PRIVATE KEY-----|(?:gh[opsu]_|sk-)[a-z0-9_-]{8,})/i;

function digestText(text: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

function redact(value: CanonicalValue): { value: CanonicalValue; count: number } {
  if (typeof value === "string") {
    return SECRET_VALUE.test(value)
      ? { value: "[REDACTED]", count: 1 }
      : { value, count: 0 };
  }
  if (value === null || typeof value !== "object") return { value, count: 0 };
  if (Array.isArray(value)) {
    let count = 0;
    const output = value.map((item) => {
      const result = redact(item);
      count += result.count;
      return result.value;
    });
    return { value: output, count };
  }
  let count = 0;
  const output: Record<string, CanonicalValue> = {};
  for (const [key, item] of Object.entries(value).sort(([left], [right]) => left.localeCompare(right))) {
    if (SECRET_NAME.test(key)) {
      output[key] = "[REDACTED]";
      count += 1;
    } else {
      const result = redact(item);
      output[key] = result.value;
      count += result.count;
    }
  }
  return { value: output, count };
}

function normalizeRelativePath(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\/+/, "");
  if (
    normalized.includes("\0")
    ||
    normalized.startsWith("/")
    || normalized === ".."
    || normalized.startsWith("../")
    || (
      normalized !== "."
      && normalized.split("/").some((segment) => segment === "" || segment === ".." || segment === ".")
    )
    || /^[A-Za-z]:\//.test(normalized)
  ) {
    throw new TypeError("Evidence paths must be workspace-relative");
  }
  return normalized || ".";
}

function assertDigest(value: string, field: string): asserts value is `sha256:${string}` {
  if (!/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new TypeError(`${field} must be an exact SHA-256 content identity`);
  }
}

function revisionDocument(evidence: {
  readonly id: string;
  readonly evidenceType: EvidenceCandidate["evidenceType"];
  readonly mediaType: EvidenceCandidate["mediaType"];
  readonly contentDigest: `sha256:${string}`;
  readonly byteSize: number;
  readonly classification: EvidenceClassification;
  readonly redactions: number;
  readonly workspaceBinding: string;
}): CanonicalValue {
  return {
    schemaVersion: 1,
    evidenceType: evidence.evidenceType,
    workspaceBinding: evidence.workspaceBinding,
    contentDigest: evidence.contentDigest,
    id: evidence.id,
    mediaType: evidence.mediaType,
    byteSize: evidence.byteSize,
    classification: evidence.classification,
    redactions: evidence.redactions,
  };
}

export function normalizeWorkspaceEvidence(candidate: EvidenceCandidate): NormalizedEvidence {
  if (!["complete", "bounded", "cancelled", "error"].includes(candidate.completion)) {
    throw new TypeError("Evidence completion is not a supported control-flow value");
  }
  if (
    candidate.packageManagers.some((value) => !["npm", "pnpm", "yarn"].includes(value))
    || new Set(candidate.packageManagers).size !== candidate.packageManagers.length
  ) {
    throw new TypeError("Evidence package-manager facts must be unique supported values");
  }
  if (new Set(candidate.lockfiles).size !== candidate.lockfiles.length) {
    throw new TypeError("Evidence lockfile facts must be unique");
  }
  for (const observation of candidate.observations) {
    assertDigest(observation.contentDigest, "observation contentDigest");
  }
  const normalizedObservationPaths = candidate.observations.map((item) =>
    normalizeRelativePath(item.path)
  );
  if (new Set(normalizedObservationPaths).size !== normalizedObservationPaths.length) {
    throw new TypeError("Evidence observation paths must be unique");
  }
  const body = {
    schemaVersion: 1,
    workspaceBinding: candidate.workspaceBinding,
    observations: candidate.observations
      .map((observation) => ({
        path: normalizeRelativePath(observation.path),
        ...(observation.name === undefined ? {} : { name: observation.name }),
        ...(observation.version === undefined ? {} : { version: observation.version }),
        dependencies: Object.fromEntries(
          Object.entries(observation.dependencies).sort(([left], [right]) => left.localeCompare(right)),
        ),
        workspaceMember: observation.workspaceMember,
        contentDigest: observation.contentDigest,
      }))
      .sort((left, right) => left.path.localeCompare(right.path)),
    lockfiles: [...candidate.lockfiles].map(normalizeRelativePath).sort(),
    packageManagers: [...candidate.packageManagers].sort(),
    completion: candidate.completion,
    diagnostics: candidate.diagnostics
      .map((item) => ({
        code: item.code,
        ...(item.path === undefined ? {} : { path: normalizeRelativePath(item.path) }),
      }))
      .sort((left, right) => left.code.localeCompare(right.code) || (left.path ?? "").localeCompare(right.path ?? "")),
  } as CanonicalValue;
  const redacted = redact(body);
  const canonicalBody = canonicalize(redacted.value);
  const byteSize = Buffer.byteLength(canonicalBody);
  if (byteSize > MAX_EVIDENCE_BYTES) throw new RangeError("normalized Evidence exceeds the per-object limit");
  const contentDigest = digestText(canonicalBody);
  const identity = {
    schemaVersion: 1,
    evidenceType: candidate.evidenceType,
    workspaceBinding: candidate.workspaceBinding,
    contentDigest,
  } satisfies CanonicalValue;
  const id = `evidence:${digestText(canonicalize(identity)).slice("sha256:".length)}`;
  const sealedRevisionDocument = revisionDocument({
    id,
    evidenceType: candidate.evidenceType,
    mediaType: candidate.mediaType,
    contentDigest,
    byteSize,
    classification: "SENSITIVE_EVIDENCE",
    redactions: redacted.count,
    workspaceBinding: candidate.workspaceBinding,
  });
  return {
    schemaVersion: 1,
    id,
    revision: digestText(canonicalize(sealedRevisionDocument)),
    evidenceType: candidate.evidenceType,
    mediaType: candidate.mediaType,
    contentDigest,
    byteSize,
    classification: "SENSITIVE_EVIDENCE",
    body: redacted.value,
    redactions: redacted.count,
  };
}

export function validateEvidence(evidence: NormalizedEvidence): EvidenceValidation {
  const reasons: string[] = [];
  let canonicalBody: string | undefined;
  try {
    canonicalBody = canonicalize(evidence.body);
  } catch {
    reasons.push("BODY_NOT_CANONICAL");
  }
  if (canonicalBody !== undefined) {
    if (digestText(canonicalBody) !== evidence.contentDigest) reasons.push("CONTENT_DIGEST_MISMATCH");
    if (Buffer.byteLength(canonicalBody) !== evidence.byteSize) reasons.push("BYTE_SIZE_MISMATCH");
    if (SECRET_VALUE.test(canonicalBody)) reasons.push("SECRET_CANARY_PRESENT");
  }
  const body = (
    evidence.body !== null
    && typeof evidence.body === "object"
    && !Array.isArray(evidence.body)
      ? evidence.body
      : {}
  ) as {
    readonly workspaceBinding?: unknown;
    readonly observations?: readonly { readonly contentDigest?: unknown }[];
  };
  if (!("workspaceBinding" in body)) reasons.push("BODY_SHAPE_INVALID");
  if (typeof body.workspaceBinding !== "string") reasons.push("WORKSPACE_BINDING_MISSING");
  const observations = Array.isArray(body.observations) ? body.observations : [];
  if (!Array.isArray(body.observations)) reasons.push("OBSERVATIONS_INVALID");
  for (const observation of observations) {
    if (
      typeof observation.contentDigest !== "string"
      || !/^sha256:[a-f0-9]{64}$/.test(observation.contentDigest)
    ) reasons.push("OBSERVATION_DIGEST_INVALID");
  }
  if (typeof body.workspaceBinding === "string") {
    const identity = {
      schemaVersion: 1,
      evidenceType: evidence.evidenceType,
      workspaceBinding: body.workspaceBinding,
      contentDigest: evidence.contentDigest,
    } satisfies CanonicalValue;
    const expectedId = `evidence:${digestText(canonicalize(identity)).slice("sha256:".length)}`;
    if (evidence.id !== expectedId) reasons.push("EVIDENCE_ID_MISMATCH");
    const expectedRevision = digestText(canonicalize(revisionDocument({
      id: evidence.id,
      evidenceType: evidence.evidenceType,
      mediaType: evidence.mediaType,
      contentDigest: evidence.contentDigest,
      byteSize: evidence.byteSize,
      classification: evidence.classification,
      redactions: evidence.redactions,
      workspaceBinding: body.workspaceBinding,
    })));
    if (evidence.revision !== expectedRevision) reasons.push("EVIDENCE_REVISION_MISMATCH");
  }
  reasons.sort();
  const state = reasons.length === 0 ? "valid" : "rejected";
  const stable = {
    schemaVersion: 1,
    evidenceRevision: evidence.revision,
    state,
    reasonCodes: reasons,
  } satisfies CanonicalValue;
  return {
    schemaVersion: 1,
    evidenceRevision: evidence.revision,
    state,
    reasonCodes: reasons,
    validationDigest: digestText(canonicalize(stable)),
  };
}
