export type AttemptTerminalStatus =
  | "passed"
  | "failed"
  | "indeterminate"
  | "error"
  | "cancelled";

export interface DeterministicRetryPolicy {
  readonly maximumAttempts: number;
  readonly initialBackoffMs: number;
  readonly maximumBackoffMs: number;
  readonly multiplier: number;
  readonly retryableErrorCodes: readonly string[];
}

export interface RetryDecisionInput {
  readonly status: AttemptTerminalStatus;
  readonly retrySafe: boolean;
  readonly errorCode?: string;
  readonly errorRetryability?: "never" | "safe" | "policy_required";
  readonly policyGrant: boolean;
  readonly attemptOrdinal: number;
  readonly remainingDeadlineMs: number;
  readonly cancelled: boolean;
  readonly policy: DeterministicRetryPolicy;
}

export type RetryDecision =
  | { readonly retry: false; readonly reasonCode: string }
  | { readonly retry: true; readonly backoffMs: number };

export function deterministicBackoffMs(
  policy: DeterministicRetryPolicy,
  completedAttemptOrdinal: number,
): number {
  const value =
    policy.initialBackoffMs *
    policy.multiplier ** Math.max(0, completedAttemptOrdinal - 1);
  return Math.min(policy.maximumBackoffMs, Math.floor(value));
}

export function decideRetry(input: RetryDecisionInput): RetryDecision {
  if (input.status !== "error") {
    return { retry: false, reasonCode: "terminal_not_error" };
  }
  if (input.cancelled) return { retry: false, reasonCode: "cancelled" };
  if (!input.retrySafe) return { retry: false, reasonCode: "action_not_retry_safe" };
  if (input.attemptOrdinal >= input.policy.maximumAttempts) {
    return { retry: false, reasonCode: "attempt_limit" };
  }
  if (
    input.errorCode === undefined ||
    !input.policy.retryableErrorCodes.includes(input.errorCode)
  ) {
    return { retry: false, reasonCode: "error_not_allowlisted" };
  }
  if (
    input.errorRetryability !== "safe" &&
    !(input.errorRetryability === "policy_required" && input.policyGrant)
  ) {
    return { retry: false, reasonCode: "retry_not_authorized" };
  }
  const backoffMs = deterministicBackoffMs(
    input.policy,
    input.attemptOrdinal,
  );
  if (backoffMs >= input.remainingDeadlineMs) {
    return { retry: false, reasonCode: "deadline_exhausted" };
  }
  return { retry: true, backoffMs };
}
