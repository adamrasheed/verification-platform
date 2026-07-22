import type {
  AnyCommandEnvelope,
  OperationalStatus,
  VerifyOutcome,
  VerifyResult,
} from "@verify-internal/protocol";

export type GitHubCheckConclusion =
  | "action_required"
  | "cancelled"
  | "failure"
  | "neutral"
  | "success";

export interface GitHubCheckProjection {
  readonly schemaVersion: 1;
  readonly status: "completed";
  readonly conclusion: GitHubCheckConclusion;
  readonly operationalStatus: OperationalStatus;
  readonly outcome: VerifyOutcome | null;
  readonly reasonCodes: readonly string[];
  readonly counts: {
    readonly requiredPromises: number;
    readonly advisoryPromises: number;
    readonly satisfied: number;
    readonly violated: number;
    readonly indeterminate: number;
    readonly proofs: number;
    readonly evidence: number;
  };
  readonly durationMs: number;
  readonly classifications: Readonly<Record<string, number>>;
  readonly invocationId: string;
  readonly output: {
    readonly title: string;
    readonly summary: string;
  };
}

function verifyResult(envelope: AnyCommandEnvelope): VerifyResult | undefined {
  return envelope.result?.kind === "verify" ? envelope.result : undefined;
}

function conclusionFor(
  status: OperationalStatus,
  outcome: VerifyOutcome | null,
): GitHubCheckConclusion {
  if (status === "cancelled") return "cancelled";
  if (status === "internal_error" || status === "blocked" || status === "invalid") {
    return "action_required";
  }
  if (outcome === "satisfied") return "success";
  if (outcome === "violated") return "failure";
  return "neutral";
}

function boundedReasonCodes(
  envelope: AnyCommandEnvelope,
  result: VerifyResult | undefined,
): readonly string[] {
  const codes = new Set<string>();
  for (const diagnostic of envelope.diagnostics) codes.add(diagnostic.code);
  for (const code of result?.reasonCodes ?? []) codes.add(code);
  for (const promise of result?.promises ?? []) {
    for (const code of promise.reasonCodes) codes.add(code);
  }
  return [...codes]
    .filter((code) => /^[A-Z0-9_]{1,128}$/.test(code))
    .sort()
    .slice(0, 64);
}

function evidenceClassifications(result: VerifyResult | undefined): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const evidence of result?.evidenceRecords ?? []) {
    const classification = evidence.classification;
    if (classification === "SECRET") continue;
    counts[classification] = (counts[classification] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

export function projectGitHubCheck(envelope: AnyCommandEnvelope): GitHubCheckProjection {
  const result = verifyResult(envelope);
  const outcome = result?.outcome ?? null;
  const conclusion = conclusionFor(envelope.operationalStatus, outcome);
  const summary = result?.summary;
  const counts = {
    requiredPromises: summary?.requiredPromiseCount ?? 0,
    advisoryPromises: summary?.advisoryPromiseCount ?? 0,
    satisfied: summary?.satisfiedCount ?? 0,
    violated: summary?.violatedCount ?? 0,
    indeterminate: summary?.indeterminateCount ?? 0,
    proofs: result?.proofExecutions.length ?? 0,
    evidence: result?.evidence.length ?? 0,
  };
  const reasonCodes = boundedReasonCodes(envelope, result);
  const classifications = evidenceClassifications(result);
  const classificationSummary = Object.entries(classifications)
    .map(([name, count]) => `${name}=${count}`)
    .join(",") || "none";
  const title = outcome === null
    ? `Verification ${envelope.operationalStatus}`
    : `Verification ${outcome}`;
  return {
    schemaVersion: 1,
    status: "completed",
    conclusion,
    operationalStatus: envelope.operationalStatus,
    outcome,
    reasonCodes,
    counts,
    durationMs: Number(envelope.durationMs),
    classifications,
    invocationId: String(envelope.invocationId),
    output: {
      title,
      summary:
        `Operational status: ${envelope.operationalStatus}; outcome: ${outcome ?? "none"}; `
        + `promises: ${counts.satisfied} satisfied, ${counts.violated} violated, `
        + `${counts.indeterminate} indeterminate; proofs: ${counts.proofs}; evidence: ${counts.evidence}; `
        + `duration: ${Number(envelope.durationMs)}ms; reasons: ${reasonCodes.join(",") || "none"}; `
        + `classifications: ${classificationSummary}.`,
    },
  };
}
