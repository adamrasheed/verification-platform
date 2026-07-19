import type {
  OpaqueId,
  RevisionRef,
  Rfc3339Utc,
  Sha256Digest,
} from "@verify-internal/contracts";

export interface LocalRetentionPolicy {
  readonly maximumRuns: number;
  readonly maximumAgeMs: number;
  readonly maximumEvidenceBytes: number;
  readonly hardEvidenceBytes: number;
}

export interface RetainedRun {
  readonly runId: OpaqueId;
  readonly completedAtEpochMs: number;
  readonly evidence: readonly {
    readonly ref: RevisionRef;
    readonly digest: Sha256Digest;
    readonly byteSize: number;
  }[];
}

export interface DeletionTombstone {
  readonly ref: RevisionRef;
  readonly deletedAt: Rfc3339Utc;
  readonly reason: "age" | "count" | "evidence-quota" | "explicit";
}

export interface RetentionPlan {
  readonly deleteRuns: readonly OpaqueId[];
  readonly deleteEvidence: readonly Sha256Digest[];
  readonly tombstones: readonly DeletionTombstone[];
}

export class DurableStorageLimitError extends Error {
  readonly currentBytes: number;
  readonly requestedBytes: number;
  readonly hardLimitBytes: number;

  constructor(currentBytes: number, requestedBytes: number, hardLimitBytes: number) {
    super("durable Evidence hard limit would be exceeded");
    this.name = "DurableStorageLimitError";
    this.currentBytes = currentBytes;
    this.requestedBytes = requestedBytes;
    this.hardLimitBytes = hardLimitBytes;
  }
}

function assertBound(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer`);
  }
}

export function assertDurableEvidenceAdmission(
  currentBytes: number,
  requestedBytes: number,
  hardLimitBytes: number,
): void {
  assertBound("currentBytes", currentBytes);
  assertBound("requestedBytes", requestedBytes);
  assertBound("hardLimitBytes", hardLimitBytes);
  if (currentBytes + requestedBytes > hardLimitBytes) {
    throw new DurableStorageLimitError(
      currentBytes,
      requestedBytes,
      hardLimitBytes,
    );
  }
}

export function planRetention(
  runs: readonly RetainedRun[],
  policy: LocalRetentionPolicy,
  nowEpochMs: number,
  deletedAt: Rfc3339Utc,
): RetentionPlan {
  assertBound("maximumRuns", policy.maximumRuns);
  assertBound("maximumAgeMs", policy.maximumAgeMs);
  assertBound("maximumEvidenceBytes", policy.maximumEvidenceBytes);
  assertBound("hardEvidenceBytes", policy.hardEvidenceBytes);
  const ordered = [...runs].sort(
    (left, right) =>
      left.completedAtEpochMs - right.completedAtEpochMs ||
      left.runId.localeCompare(right.runId),
  );
  const reasonByRun = new Map<OpaqueId, DeletionTombstone["reason"]>();
  for (const run of ordered) {
    if (nowEpochMs - run.completedAtEpochMs > policy.maximumAgeMs) {
      reasonByRun.set(run.runId, "age");
    }
  }
  const survivorsAfterAge = ordered.filter(
    ({ runId }) => !reasonByRun.has(runId),
  );
  const excessRuns = Math.max(0, survivorsAfterAge.length - policy.maximumRuns);
  for (const run of survivorsAfterAge.slice(0, excessRuns)) {
    reasonByRun.set(run.runId, "count");
  }

  const retainedByteCount = (): number => {
    const bytesByDigest = new Map<Sha256Digest, number>();
    for (const run of ordered) {
      if (reasonByRun.has(run.runId)) continue;
      for (const item of run.evidence) {
        bytesByDigest.set(item.digest, item.byteSize);
      }
    }
    return [...bytesByDigest.values()].reduce((sum, value) => sum + value, 0);
  };
  let retainedBytes = retainedByteCount();
  for (const run of ordered) {
    if (retainedBytes <= policy.maximumEvidenceBytes) break;
    if (reasonByRun.has(run.runId)) continue;
    reasonByRun.set(run.runId, "evidence-quota");
    retainedBytes = retainedByteCount();
  }

  const deletedRuns = ordered.filter(({ runId }) => reasonByRun.has(runId));
  const survivingDigests = new Set(
    ordered
      .filter(({ runId }) => !reasonByRun.has(runId))
      .flatMap(({ evidence }) => evidence.map(({ digest }) => digest)),
  );
  const deleteEvidence = [
    ...new Set(
      deletedRuns.flatMap(({ evidence }) =>
        evidence
          .map(({ digest }) => digest)
          .filter((digest) => !survivingDigests.has(digest)),
      ),
    ),
  ].sort();
  const tombstones = deletedRuns.flatMap((run) =>
    run.evidence
      .filter(({ digest }) => !survivingDigests.has(digest))
      .map(({ ref }) => ({
        ref,
        deletedAt,
        reason: reasonByRun.get(run.runId)!,
      })),
  );
  return {
    deleteRuns: deletedRuns.map(({ runId }) => runId),
    deleteEvidence,
    tombstones,
  };
}
