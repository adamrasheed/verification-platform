import type { CanonicalValue } from "@verify-internal/contracts";
import type { ProviderPayloadValidator } from "@verify-internal/plugin-runtime";
import type {
  GitHubBranchProtectionObservation,
  GitHubEffectiveRuleObservation,
  GitHubRequiredStatusCheck,
  GitHubReviewRequirements,
} from "./policy.js";

export interface GitHubRepositoryBinding {
  readonly owner: string;
  readonly repository: string;
}

export interface GitHubRepositoryPolicyPayloadValidatorOptions {
  readonly resolveRepositoryBinding: (
    binding: string,
  ) => GitHubRepositoryBinding | undefined;
}

const REQUEST_SCHEMA_ID = "github.repository-policy.request.v1";
const API_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  accept: "application/vnd.github+json",
  "x-github-api-version": "2026-03-10",
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => key in value);
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object`);
  return value;
}

function boundedString(value: unknown, label: string, maximum = 256): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > maximum
    || /[\u0000-\u001f\u007f]/.test(value)
  ) throw new TypeError(`${label} must be a bounded string`);
  return value;
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new TypeError(`${label} must be boolean`);
  return value;
}

function safeInteger(value: unknown, label: string, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > maximum) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
  return Number(value);
}

function optionalEnabled(value: unknown, label: string): boolean {
  if (value === undefined || value === null) return false;
  const record = requiredRecord(value, label);
  return booleanValue(record.enabled, `${label}.enabled`);
}

function checkKey(value: GitHubRequiredStatusCheck): string {
  return `${value.context}\u0000${value.integrationId ?? -1}`;
}

function normalizeChecks(
  value: unknown,
  label: string,
  integrationKey: "app_id" | "integration_id" = "app_id",
): readonly GitHubRequiredStatusCheck[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 128) {
    throw new TypeError(`${label} must be a bounded array`);
  }
  const byKey = new Map<string, GitHubRequiredStatusCheck>();
  for (const candidate of value) {
    const record = requiredRecord(candidate, `${label} entry`);
    const context = boundedString(record.context, `${label}.context`);
    let check: GitHubRequiredStatusCheck;
    if (record[integrationKey] === undefined || record[integrationKey] === null) {
      check = { context };
    } else {
      check = {
        context,
        integrationId: safeInteger(record[integrationKey], `${label}.${integrationKey}`),
      };
    }
    byKey.set(checkKey(check), check);
  }
  return [...byKey.values()].sort((left, right) => checkKey(left).localeCompare(checkKey(right)));
}

function normalizeContexts(value: unknown, label: string): readonly GitHubRequiredStatusCheck[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 128) {
    throw new TypeError(`${label} must be a bounded array`);
  }
  return [...new Set(value.map((candidate) => boundedString(candidate, `${label} entry`)))]
    .sort()
    .map((context) => ({ context }));
}

function normalizeReviews(
  value: unknown,
  names: {
    readonly dismissStale: string;
    readonly codeOwners: string;
    readonly lastPush: string;
    readonly approvalCount: string;
    readonly threadResolution: string;
  },
): GitHubReviewRequirements {
  if (value === undefined || value === null) {
    return {
      dismissStaleReviews: false,
      requireCodeOwnerReviews: false,
      requireLastPushApproval: false,
      requiredApprovingReviewCount: 0,
      requiredReviewThreadResolution: false,
    };
  }
  const record = requiredRecord(value, "review requirements");
  const optionalBoolean = (key: string): boolean => record[key] === undefined
    ? false
    : booleanValue(record[key], key);
  return {
    dismissStaleReviews: optionalBoolean(names.dismissStale),
    requireCodeOwnerReviews: optionalBoolean(names.codeOwners),
    requireLastPushApproval: optionalBoolean(names.lastPush),
    requiredApprovingReviewCount: record[names.approvalCount] === undefined
      ? 0
      : safeInteger(record[names.approvalCount], names.approvalCount, 100),
    requiredReviewThreadResolution: optionalBoolean(names.threadResolution),
  };
}

function emptyProtection(): GitHubBranchProtectionObservation {
  return {
    enabled: false,
    enforceAdmins: false,
    requiredLinearHistory: false,
    allowForcePushes: false,
    allowDeletions: false,
    strictStatusChecks: false,
    requiredStatusChecks: [],
    reviews: normalizeReviews(undefined, {
      dismissStale: "dismiss_stale_reviews",
      codeOwners: "require_code_owner_reviews",
      lastPush: "require_last_push_approval",
      approvalCount: "required_approving_review_count",
      threadResolution: "required_review_thread_resolution",
    }),
  };
}

function providerError(status: number, value: CanonicalValue): CanonicalValue {
  const message = isRecord(value) && typeof value.message === "string"
    ? value.message.toLowerCase()
    : "";
  let error: string;
  if (status === 401) error = "authentication";
  else if (status === 429 || (status === 403 && message.includes("rate limit"))) {
    error = "rate-limited";
  } else if (status === 403) error = "permission";
  else if (status === 404) error = "not-found";
  else error = "unavailable";
  return { error };
}

function normalizeRepositoryResponse(status: number, value: CanonicalValue): CanonicalValue {
  if (status !== 200) return providerError(status, value);
  const record = requiredRecord(value, "repository response");
  return { defaultBranch: boundedString(record.default_branch, "default_branch", 255) };
}

function normalizeProtectionResponse(status: number, value: CanonicalValue): CanonicalValue {
  if (
    status === 404
    && isRecord(value)
    && value.message === "Branch not protected"
  ) return emptyProtection() as unknown as CanonicalValue;
  if (status !== 200) return providerError(status, value);
  const record = requiredRecord(value, "branch protection response");
  const statusChecks = record.required_status_checks === undefined
    || record.required_status_checks === null
    ? undefined
    : requiredRecord(record.required_status_checks, "required_status_checks");
  const checks = normalizeChecks(statusChecks?.checks, "required_status_checks.checks");
  const fallbackContexts = normalizeContexts(
    statusChecks?.contexts,
    "required_status_checks.contexts",
  );
  const normalizedReviews = normalizeReviews(record.required_pull_request_reviews, {
    dismissStale: "dismiss_stale_reviews",
    codeOwners: "require_code_owner_reviews",
    lastPush: "require_last_push_approval",
    approvalCount: "required_approving_review_count",
    threadResolution: "required_review_thread_resolution",
  });
  const reviews: GitHubReviewRequirements = {
    ...normalizedReviews,
    requiredReviewThreadResolution: optionalEnabled(
      record.required_conversation_resolution,
      "required_conversation_resolution",
    ),
  };
  const normalized: GitHubBranchProtectionObservation = {
    enabled: true,
    enforceAdmins: optionalEnabled(record.enforce_admins, "enforce_admins"),
    requiredLinearHistory: optionalEnabled(
      record.required_linear_history,
      "required_linear_history",
    ),
    allowForcePushes: optionalEnabled(record.allow_force_pushes, "allow_force_pushes"),
    allowDeletions: optionalEnabled(record.allow_deletions, "allow_deletions"),
    strictStatusChecks: statusChecks?.strict === undefined
      ? false
      : booleanValue(statusChecks.strict, "required_status_checks.strict"),
    requiredStatusChecks: checks.length > 0 ? checks : fallbackContexts,
    reviews,
  };
  return normalized as unknown as CanonicalValue;
}

function sourceType(value: unknown): "Enterprise" | "Organization" | "Repository" {
  if (value === "Enterprise" || value === "Organization" || value === "Repository") {
    return value;
  }
  throw new TypeError("ruleset_source_type is invalid");
}

function normalizeRule(value: unknown): GitHubEffectiveRuleObservation | undefined {
  const record = requiredRecord(value, "effective rule");
  const type = boundedString(record.type, "effective rule type", 128);
  if (type !== "required_status_checks" && type !== "pull_request") return undefined;
  const rulesetId = safeInteger(record.ruleset_id, "ruleset_id");
  if (rulesetId === 0) throw new TypeError("ruleset_id must be positive");
  const effectiveSourceType = sourceType(record.ruleset_source_type);
  const parameters = requiredRecord(record.parameters, "effective rule parameters");
  if (type === "required_status_checks") {
    const requiredChecks = normalizeChecks(
      parameters.required_status_checks,
      "required_status_checks",
      "integration_id",
    );
    return {
      type,
      rulesetId,
      sourceType: effectiveSourceType,
      strictStatusChecks: parameters.strict_required_status_checks_policy === undefined
        ? false
        : booleanValue(
          parameters.strict_required_status_checks_policy,
          "strict_required_status_checks_policy",
        ),
      requiredStatusChecks: requiredChecks,
    };
  }
  return {
    type,
    rulesetId,
    sourceType: effectiveSourceType,
    reviews: normalizeReviews(parameters, {
      dismissStale: "dismiss_stale_reviews_on_push",
      codeOwners: "require_code_owner_review",
      lastPush: "require_last_push_approval",
      approvalCount: "required_approving_review_count",
      threadResolution: "required_review_thread_resolution",
    }),
  };
}

function normalizeRulesResponse(status: number, value: CanonicalValue): CanonicalValue {
  if (status !== 200) return providerError(status, value);
  if (!Array.isArray(value) || value.length > 100) {
    throw new TypeError("effective rules response must be a bounded array");
  }
  const rules = value
    .map(normalizeRule)
    .filter((rule): rule is GitHubEffectiveRuleObservation => rule !== undefined)
    .sort((left, right) => left.rulesetId - right.rulesetId || left.type.localeCompare(right.type));
  return { rules } as unknown as CanonicalValue;
}

function safeRepositoryBinding(value: GitHubRepositoryBinding): GitHubRepositoryBinding {
  if (
    !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(value.owner)
    || !/^[A-Za-z0-9._-]{1,100}$/.test(value.repository)
    || value.repository === "."
    || value.repository === ".."
  ) throw new TypeError("repository binding is invalid");
  return value;
}

function safeBranch(value: unknown): string {
  const branch = boundedString(value, "branch", 255);
  if (
    branch.startsWith("/")
    || branch.endsWith("/")
    || branch.endsWith(".")
    || branch.endsWith(".lock")
    || branch.includes("..")
    || branch.includes("//")
    || branch.includes("@{")
    || /[~^:?*[\\]/.test(branch)
    || branch.split("/").some((segment) => segment === "." || segment === "..")
  ) throw new TypeError("branch is invalid");
  return branch;
}

function requestParts(
  parameters: CanonicalValue,
  value: CanonicalValue,
  resolveRepositoryBinding: GitHubRepositoryPolicyPayloadValidatorOptions["resolveRepositoryBinding"],
): { readonly repository: GitHubRepositoryBinding; readonly branch?: string } {
  const body = requiredRecord(value, "provider request body");
  if (!exactKeys(body, ["repositoryBinding"])) {
    throw new TypeError("provider request body has unknown fields");
  }
  const repositoryBinding = boundedString(
    body.repositoryBinding,
    "repositoryBinding",
  );
  const resolved = resolveRepositoryBinding(repositoryBinding);
  if (!resolved) throw new TypeError("repository binding is unavailable");
  const repository = safeRepositoryBinding(resolved);
  const pathParameters = requiredRecord(parameters, "path parameters");
  if (Object.keys(pathParameters).length === 0) return { repository };
  if (!exactKeys(pathParameters, ["branch"])) {
    throw new TypeError("path parameters have unknown fields");
  }
  return { repository, branch: safeBranch(pathParameters.branch) };
}

function encodedRepositoryPath(repository: GitHubRepositoryBinding): string {
  return `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repository)}`;
}

export function createGitHubRepositoryPolicyPayloadValidator(
  options: GitHubRepositoryPolicyPayloadValidatorOptions,
): ProviderPayloadValidator {
  return {
    validateOutbound(
      destinationId,
      pathTemplateId,
      schemaId,
      classification,
      parameters,
      value,
    ) {
      if (schemaId !== REQUEST_SCHEMA_ID || classification !== "MINIMAL_METADATA") {
        throw new TypeError("GitHub repository-policy request is outside its schema grant");
      }
      const parts = requestParts(parameters, value, options.resolveRepositoryBinding);
      const base = encodedRepositoryPath(parts.repository);
      if (
        destinationId === "github-repository-metadata"
        && pathTemplateId === "github-repository-metadata"
        && parts.branch === undefined
      ) return { path: base, headers: API_HEADERS };
      if (
        destinationId === "github-branch-protection"
        && pathTemplateId === "github-branch-protection"
        && parts.branch !== undefined
      ) return {
        path: `${base}/branches/${encodeURIComponent(parts.branch)}/protection`,
        headers: API_HEADERS,
      };
      if (
        destinationId === "github-effective-rules"
        && pathTemplateId === "github-effective-rules"
        && parts.branch !== undefined
      ) return {
        path: `${base}/rules/branches/${encodeURIComponent(parts.branch)}`,
        headers: API_HEADERS,
      };
      throw new TypeError("GitHub repository-policy destination is denied");
    },
    validateResponse(destinationId, pathTemplateId, status, value) {
      if (
        destinationId === "github-repository-metadata"
        && pathTemplateId === "github-repository-metadata"
      ) return normalizeRepositoryResponse(status, value);
      if (
        destinationId === "github-branch-protection"
        && pathTemplateId === "github-branch-protection"
      ) return normalizeProtectionResponse(status, value);
      if (
        destinationId === "github-effective-rules"
        && pathTemplateId === "github-effective-rules"
      ) return normalizeRulesResponse(status, value);
      throw new TypeError("GitHub repository-policy response destination is denied");
    },
  };
}
