import { createHash } from "node:crypto";
import { canonicalize } from "@verify-internal/contracts";
import type {
  CanonicalValue,
  ProducerRef,
  RevisionRef,
  Sha256Digest,
} from "@verify-internal/contracts";

export type AttemptTerminalStatus =
  | "passed"
  | "failed"
  | "indeterminate"
  | "error"
  | "cancelled";

export interface AttemptEvidenceDecision {
  readonly evidence: RevisionRef;
  readonly contentDigest: Sha256Digest;
  readonly validation: "valid" | "rejected";
}

export interface ProofAttemptRecord {
  readonly attemptId: string;
  readonly sequence: number;
  readonly authorized: boolean;
  readonly proof: RevisionRef;
  readonly model: RevisionRef;
  readonly executionContext: RevisionRef;
  readonly planKey: Sha256Digest;
  readonly evaluator: ProducerRef;
  readonly status: AttemptTerminalStatus;
  readonly reasonCodes: readonly string[];
  readonly evidence: readonly AttemptEvidenceDecision[];
  readonly observationDigest: Sha256Digest;
  readonly cacheProvenance?: CanonicalValue;
}

export interface EffectiveAttempt {
  readonly proof: RevisionRef;
  readonly attempt: ProofAttemptRecord;
}

export interface PromiseAggregation {
  readonly promise: RevisionRef;
  readonly status: "satisfied" | "violated" | "indeterminate";
  readonly effectiveAttempts: readonly EffectiveAttempt[];
  readonly evidence: readonly RevisionRef[];
  readonly reasonCodes: readonly string[];
  readonly resultDigest: Sha256Digest;
}

export interface InvocationAggregation {
  readonly outcome: "satisfied" | "violated" | "indeterminate" | "not_evaluated";
  readonly promises: readonly PromiseAggregation[];
  readonly reasonCodes: readonly string[];
  readonly resultDigest: Sha256Digest;
}

function digest(value: CanonicalValue): Sha256Digest {
  return `sha256:${createHash("sha256").update(canonicalize(value)).digest("hex")}`;
}

function refKey(ref: RevisionRef): string {
  return `${ref.kind}\0${ref.id}\0${ref.revision}\0${ref.schemaVersion}`;
}

export function selectEffectiveAttempt(
  proof: RevisionRef,
  attempts: readonly ProofAttemptRecord[],
): EffectiveAttempt | undefined {
  const candidates = attempts
    .filter((attempt) => attempt.authorized && refKey(attempt.proof) === refKey(proof))
    .sort((left, right) => left.sequence - right.sequence);
  for (let index = 1; index < candidates.length; index += 1) {
    if (candidates[index]?.sequence === candidates[index - 1]?.sequence) {
      throw new TypeError("authorized attempts for one Proof must have unique sequence numbers");
    }
  }
  const attempt = candidates.at(-1);
  return attempt ? { proof, attempt } : undefined;
}

export function aggregatePromiseAttempts(input: {
  readonly promise: RevisionRef;
  readonly requiredProofs: readonly RevisionRef[];
  readonly attempts: readonly ProofAttemptRecord[];
}): PromiseAggregation {
  const effectiveAttempts: EffectiveAttempt[] = [];
  const reasonCodes = new Set<string>();
  let hasFailure = false;
  let everyPassed = input.requiredProofs.length > 0;
  let contextKey: string | undefined;
  let contextMismatch = false;
  if (input.requiredProofs.length === 0) reasonCodes.add("NO_REQUIRED_PROOFS");

  for (const proof of input.requiredProofs) {
    const effective = selectEffectiveAttempt(proof, input.attempts);
    if (!effective) {
      everyPassed = false;
      reasonCodes.add("MISSING_EFFECTIVE_ATTEMPT");
      continue;
    }
    effectiveAttempts.push(effective);
    const candidateContext = `${refKey(effective.attempt.model)}\0${refKey(effective.attempt.executionContext)}`;
    contextKey ??= candidateContext;
    if (contextKey !== candidateContext) {
      contextMismatch = true;
      everyPassed = false;
      reasonCodes.add("EXECUTION_CONTEXT_MISMATCH");
    }
    const validEvidence = effective.attempt.evidence.filter(
      (decision) => decision.validation === "valid",
    );
    if (
      (effective.attempt.status === "passed" || effective.attempt.status === "failed")
      && validEvidence.length === 0
    ) {
      everyPassed = false;
      reasonCodes.add("VALIDATED_EVIDENCE_REQUIRED");
      continue;
    }
    for (const reason of effective.attempt.reasonCodes) reasonCodes.add(reason);
    if (effective.attempt.status === "failed") hasFailure = true;
    if (effective.attempt.status !== "passed") everyPassed = false;
  }
  const status = contextMismatch
    ? "indeterminate"
    : hasFailure
    ? "violated"
    : everyPassed
      ? "satisfied"
      : "indeterminate";
  const evidenceDecisions = effectiveAttempts.flatMap((item) =>
    item.attempt.evidence.filter((decision) => decision.validation === "valid"),
  );
  const evidence = evidenceDecisions.map((item) => item.evidence);
  const stable = {
    schemaVersion: 1,
    promise: input.promise,
    status,
    effectiveAttempts: effectiveAttempts.map(({proof, attempt}) => ({
      proof,
      model: attempt.model,
      executionContext: attempt.executionContext,
      planKey: attempt.planKey,
      evaluator: attempt.evaluator,
      status: attempt.status,
      reasonCodes: [...attempt.reasonCodes].sort(),
      observationDigest: attempt.observationDigest,
      evidenceContentDigests: attempt.evidence
        .filter((item) => item.validation === "valid")
        .map((item) => item.contentDigest)
        .sort(),
    })),
    reasonCodes: [...reasonCodes].sort(),
  } as unknown as CanonicalValue;
  return {
    promise: input.promise,
    status,
    effectiveAttempts,
    evidence,
    reasonCodes: [...reasonCodes].sort(),
    resultDigest: digest(stable),
  };
}

export function aggregateInvocation(
  promises: readonly PromiseAggregation[],
): InvocationAggregation {
  const ordered = [...promises].sort((left, right) =>
    refKey(left.promise) < refKey(right.promise) ? -1 : refKey(left.promise) > refKey(right.promise) ? 1 : 0,
  );
  const outcome = ordered.length === 0
    ? "not_evaluated"
    : ordered.some((item) => item.status === "violated")
      ? "violated"
      : ordered.every((item) => item.status === "satisfied")
        ? "satisfied"
        : "indeterminate";
  const reasonCodes = [...new Set(ordered.flatMap((item) => item.reasonCodes))].sort();
  const stable = {
    schemaVersion: 1,
    outcome,
    promises: ordered.map((item) => ({
      promise: item.promise,
      status: item.status,
      resultDigest: item.resultDigest,
    })),
    reasonCodes,
  } as unknown as CanonicalValue;
  return {
    outcome,
    promises: ordered,
    reasonCodes,
    resultDigest: digest(stable),
  };
}

export interface ReexecutionComparison {
  readonly mode: "reexecutionDeterminism";
  readonly equivalent: boolean;
  readonly leftDigest: Sha256Digest;
  readonly rightDigest: Sha256Digest;
}

export function compareReexecutionDeterminism(
  left: InvocationAggregation,
  right: InvocationAggregation,
): ReexecutionComparison {
  return {
    mode: "reexecutionDeterminism",
    equivalent: left.resultDigest === right.resultDigest,
    leftDigest: left.resultDigest,
    rightDigest: right.resultDigest,
  };
}

export interface PromiseEvidenceEdge {
  readonly promise: RevisionRef;
  readonly proof: RevisionRef;
  readonly evidence: RevisionRef;
}

export function buildPromiseEvidenceEdges(
  aggregation: PromiseAggregation,
): readonly PromiseEvidenceEdge[] {
  return aggregation.effectiveAttempts.flatMap(({proof, attempt}) =>
    attempt.evidence
      .filter((item) => item.validation === "valid")
      .map((item) => ({ promise: aggregation.promise, proof, evidence: item.evidence })),
  );
}
