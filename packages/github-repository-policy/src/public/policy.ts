export interface GitHubRequiredStatusCheck {
  readonly context: string;
  readonly integrationId?: number;
}

export interface GitHubReviewRequirements {
  readonly dismissStaleReviews: boolean;
  readonly requireCodeOwnerReviews: boolean;
  readonly requireLastPushApproval: boolean;
  readonly requiredApprovingReviewCount: number;
  readonly requiredReviewThreadResolution: boolean;
}

export interface GitHubBranchProtectionObservation {
  readonly enabled: boolean;
  readonly enforceAdmins: boolean;
  readonly requiredLinearHistory: boolean;
  readonly allowForcePushes: boolean;
  readonly allowDeletions: boolean;
  readonly strictStatusChecks: boolean;
  readonly requiredStatusChecks: readonly GitHubRequiredStatusCheck[];
  readonly reviews: GitHubReviewRequirements;
}

export type GitHubEffectiveRuleObservation =
  | {
      readonly type: "required_status_checks";
      readonly rulesetId: number;
      readonly sourceType: "Enterprise" | "Organization" | "Repository";
      readonly strictStatusChecks: boolean;
      readonly requiredStatusChecks: readonly GitHubRequiredStatusCheck[];
    }
  | {
      readonly type: "pull_request";
      readonly rulesetId: number;
      readonly sourceType: "Enterprise" | "Organization" | "Repository";
      readonly reviews: GitHubReviewRequirements;
    };

export interface GitHubRepositoryPolicyContribution {
  readonly kind: "provider.repository-policy";
  readonly schemaVersion: 1;
  readonly repositoryBinding: string;
  readonly defaultBranch: string;
  readonly branchProtection: GitHubBranchProtectionObservation;
  readonly effectiveRules: readonly GitHubEffectiveRuleObservation[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => key in value);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isRequiredStatusCheck(value: unknown): value is GitHubRequiredStatusCheck {
  if (!isRecord(value)) return false;
  const keys = value.integrationId === undefined
    ? ["context"]
    : ["context", "integrationId"];
  return hasExactKeys(value, keys)
    && typeof value.context === "string"
    && value.context.length > 0
    && value.context.length <= 256
    && (
      value.integrationId === undefined
      || (Number.isSafeInteger(value.integrationId) && Number(value.integrationId) >= 0)
    );
}

function isChecks(value: unknown): value is readonly GitHubRequiredStatusCheck[] {
  return Array.isArray(value)
    && value.length <= 128
    && value.every(isRequiredStatusCheck);
}

function isReviews(value: unknown): value is GitHubReviewRequirements {
  return isRecord(value)
    && hasExactKeys(value, [
      "dismissStaleReviews",
      "requireCodeOwnerReviews",
      "requireLastPushApproval",
      "requiredApprovingReviewCount",
      "requiredReviewThreadResolution",
    ])
    && isBoolean(value.dismissStaleReviews)
    && isBoolean(value.requireCodeOwnerReviews)
    && isBoolean(value.requireLastPushApproval)
    && Number.isSafeInteger(value.requiredApprovingReviewCount)
    && Number(value.requiredApprovingReviewCount) >= 0
    && Number(value.requiredApprovingReviewCount) <= 100
    && isBoolean(value.requiredReviewThreadResolution);
}

function isProtection(value: unknown): value is GitHubBranchProtectionObservation {
  return isRecord(value)
    && hasExactKeys(value, [
      "enabled",
      "enforceAdmins",
      "requiredLinearHistory",
      "allowForcePushes",
      "allowDeletions",
      "strictStatusChecks",
      "requiredStatusChecks",
      "reviews",
    ])
    && isBoolean(value.enabled)
    && isBoolean(value.enforceAdmins)
    && isBoolean(value.requiredLinearHistory)
    && isBoolean(value.allowForcePushes)
    && isBoolean(value.allowDeletions)
    && isBoolean(value.strictStatusChecks)
    && isChecks(value.requiredStatusChecks)
    && isReviews(value.reviews);
}

function isEffectiveRule(value: unknown): value is GitHubEffectiveRuleObservation {
  if (!isRecord(value) || !Number.isSafeInteger(value.rulesetId) || Number(value.rulesetId) <= 0) {
    return false;
  }
  if (![
    "Enterprise",
    "Organization",
    "Repository",
  ].includes(String(value.sourceType))) return false;
  if (value.type === "required_status_checks") {
    return hasExactKeys(value, [
      "type",
      "rulesetId",
      "sourceType",
      "strictStatusChecks",
      "requiredStatusChecks",
    ])
      && isBoolean(value.strictStatusChecks)
      && isChecks(value.requiredStatusChecks);
  }
  if (value.type === "pull_request") {
    return hasExactKeys(value, ["type", "rulesetId", "sourceType", "reviews"])
      && isReviews(value.reviews);
  }
  return false;
}

export function assertGitHubRepositoryPolicyContribution(
  value: unknown,
): asserts value is GitHubRepositoryPolicyContribution {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      "kind",
      "schemaVersion",
      "repositoryBinding",
      "defaultBranch",
      "branchProtection",
      "effectiveRules",
    ])
    || value.kind !== "provider.repository-policy"
    || value.schemaVersion !== 1
    || typeof value.repositoryBinding !== "string"
    || value.repositoryBinding.length === 0
    || value.repositoryBinding.length > 256
    || typeof value.defaultBranch !== "string"
    || value.defaultBranch.length === 0
    || value.defaultBranch.length > 255
    || !isProtection(value.branchProtection)
    || !Array.isArray(value.effectiveRules)
    || value.effectiveRules.length > 100
    || !value.effectiveRules.every(isEffectiveRule)
  ) throw new TypeError("invalid GitHub repository-policy contribution");
}
