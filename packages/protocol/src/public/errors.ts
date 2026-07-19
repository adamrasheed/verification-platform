import type {
  CanonicalValue,
  RevisionRef,
} from "@verify-internal/contracts";

export const ERROR_CATEGORIES = [
  "invalid",
  "permission",
  "authentication",
  "environment",
  "plugin",
  "network",
  "integrity",
  "compatibility",
  "resource",
  "internal",
] as const;

export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

export const ERROR_RETRYABILITIES = [
  "never",
  "safe",
  "policy_required",
] as const;

export type ErrorRetryability = (typeof ERROR_RETRYABILITIES)[number];

export type StructuredErrorCode = `VFY_${string}`;

export interface StructuredError {
  readonly code: StructuredErrorCode;
  readonly category: ErrorCategory;
  readonly retryability: ErrorRetryability;
  readonly message: string;
  readonly remediation?: string;
  readonly component: string;
  readonly operation: string;
  readonly blocksRequiredProof: boolean;
  readonly causes: readonly StructuredError[];
  readonly diagnosticRefs: readonly RevisionRef[];
  readonly details?: CanonicalValue;
}

export interface ErrorDescriptor {
  readonly code: StructuredErrorCode;
  readonly category: ErrorCategory;
  readonly retryability: ErrorRetryability;
}

export type ProtocolErrorCode =
  | "VFY_REQUEST_INVALID"
  | "VFY_COMPATIBILITY_UNSUPPORTED_SCHEMA"
  | "VFY_COMPATIBILITY_UNKNOWN_CONTROL_VALUE"
  | "VFY_PROTOCOL_JSONL_INVALID";

export const PROTOCOL_ERROR_REGISTRY: readonly ErrorDescriptor[] = [
  {
    code: "VFY_REQUEST_INVALID",
    category: "invalid",
    retryability: "never",
  },
  {
    code: "VFY_COMPATIBILITY_UNSUPPORTED_SCHEMA",
    category: "compatibility",
    retryability: "never",
  },
  {
    code: "VFY_COMPATIBILITY_UNKNOWN_CONTROL_VALUE",
    category: "compatibility",
    retryability: "never",
  },
  {
    code: "VFY_PROTOCOL_JSONL_INVALID",
    category: "invalid",
    retryability: "never",
  },
];

export type ErrorDecision =
  | {
      readonly kind: "known";
      readonly error: StructuredError;
    }
  | {
      readonly kind: "unknown_code";
      readonly error: StructuredError;
    }
  | {
      readonly kind: "incompatible";
      readonly error: StructuredError;
    }
  | {
      readonly kind: "invalid";
      readonly error: StructuredError;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCategory(value: unknown): value is ErrorCategory {
  return (
    typeof value === "string" &&
    (ERROR_CATEGORIES as readonly string[]).includes(value)
  );
}

function isRetryability(value: unknown): value is ErrorRetryability {
  return (
    typeof value === "string" &&
    (ERROR_RETRYABILITIES as readonly string[]).includes(value)
  );
}

function isErrorCode(value: unknown): value is StructuredErrorCode {
  return typeof value === "string" && /^VFY_[A-Z0-9]+(?:_[A-Z0-9]+)+$/.test(value);
}

function emptyDiagnosticRefs(): readonly RevisionRef[] {
  return [];
}

export function protocolError(
  code: ProtocolErrorCode,
  message: string,
  operation: string,
): StructuredError {
  const descriptor = PROTOCOL_ERROR_REGISTRY.find(
    (candidate) => candidate.code === code,
  );
  if (descriptor === undefined) {
    throw new TypeError(`unregistered protocol error code: ${code}`);
  }
  return {
    code,
    category: descriptor.category,
    retryability: descriptor.retryability,
    message,
    component: "@verify-internal/protocol",
    operation,
    blocksRequiredProof: false,
    causes: [],
    diagnosticRefs: emptyDiagnosticRefs(),
  };
}

function invalidError(message: string): StructuredError {
  return protocolError("VFY_REQUEST_INVALID", message, "decodeStructuredError");
}

function incompatibleError(message: string): StructuredError {
  return protocolError(
    "VFY_COMPATIBILITY_UNKNOWN_CONTROL_VALUE",
    message,
    "decodeStructuredError",
  );
}

function decodeCauseList(value: unknown): readonly StructuredError[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const decoded: StructuredError[] = [];
  for (const cause of value) {
    const decision = decodeStructuredError(cause);
    if (decision.kind === "invalid" || decision.kind === "incompatible") {
      return undefined;
    }
    decoded.push(decision.error);
  }
  return decoded;
}

export function decodeStructuredError(value: unknown): ErrorDecision {
  if (!isRecord(value)) {
    return { kind: "invalid", error: invalidError("error must be an object") };
  }
  if (!isErrorCode(value.code)) {
    return {
      kind: "invalid",
      error: invalidError("error code must match VFY_<DOMAIN>_<CONDITION>"),
    };
  }
  if (!isCategory(value.category)) {
    return {
      kind: "incompatible",
      error: incompatibleError("unknown StructuredError category"),
    };
  }
  if (!isRetryability(value.retryability)) {
    return {
      kind: "incompatible",
      error: incompatibleError("unknown StructuredError retryability"),
    };
  }
  if (
    typeof value.message !== "string" ||
    typeof value.component !== "string" ||
    typeof value.operation !== "string" ||
    typeof value.blocksRequiredProof !== "boolean"
  ) {
    return {
      kind: "invalid",
      error: invalidError("error is missing a required scalar field"),
    };
  }
  const causes = decodeCauseList(value.causes);
  if (causes === undefined || !Array.isArray(value.diagnosticRefs)) {
    return {
      kind: "invalid",
      error: invalidError("error causes and diagnosticRefs must be arrays"),
    };
  }
  const error: StructuredError = {
    code: value.code,
    category: value.category,
    retryability: value.retryability,
    message: value.message,
    ...(typeof value.remediation === "string"
      ? { remediation: value.remediation }
      : {}),
    component: value.component,
    operation: value.operation,
    blocksRequiredProof: value.blocksRequiredProof,
    causes,
    diagnosticRefs: value.diagnosticRefs as unknown as readonly RevisionRef[],
    ...(value.details !== undefined
      ? { details: value.details as CanonicalValue }
      : {}),
  };
  const descriptor = PROTOCOL_ERROR_REGISTRY.find(
    (candidate) => candidate.code === error.code,
  );
  if (descriptor !== undefined) {
    if (
      descriptor.category !== error.category ||
      descriptor.retryability !== error.retryability
    ) {
      return {
        kind: "invalid",
        error: invalidError("registered error metadata does not match registry"),
      };
    }
    return { kind: "known", error };
  }
  return { kind: "unknown_code", error };
}

export function consentDenialRetryability(
  separatelyGrantable: boolean,
): ErrorRetryability {
  return separatelyGrantable ? "policy_required" : "never";
}
