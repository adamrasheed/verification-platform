export type CliOutputMode = "human" | "json" | "jsonl";

interface CommonOptions {
  readonly outputMode: CliOutputMode;
}

export interface VerifyCliCommand extends CommonOptions {
  readonly kind: "verify";
  readonly workspace: string;
  readonly offline: boolean;
  readonly noCache: boolean;
  readonly deadlineMs?: number;
}

export interface InspectCliCommand extends CommonOptions {
  readonly kind: "inspectRun" | "inspectEvidence";
  readonly id: string;
}

export interface CacheCliCommand extends CommonOptions {
  readonly kind: "cacheInspect" | "cacheClear";
}

export interface StaticCliCommand extends CommonOptions {
  readonly kind: "version" | "schema";
}

export type CliCommand =
  | VerifyCliCommand
  | InspectCliCommand
  | CacheCliCommand
  | StaticCliCommand;

export interface CliParseError {
  readonly code: "VFY_CLI_ARGUMENT_INVALID";
  readonly message: string;
}

export interface CanonicalVerifyRequestOptions {
  readonly invocationId: string;
  readonly platform: string;
}

export type CliParseResult =
  | { readonly ok: true; readonly command: CliCommand }
  | { readonly ok: false; readonly error: CliParseError };

function failure(message: string): CliParseResult {
  return {
    ok: false,
    error: { code: "VFY_CLI_ARGUMENT_INVALID", message },
  };
}

function outputMode(
  args: readonly string[],
): { readonly mode: CliOutputMode; readonly rest: readonly string[] } | CliParseError {
  let mode: CliOutputMode = "human";
  const rest: string[] = [];
  for (const arg of args) {
    if (arg === "--json" || arg === "--jsonl") {
      const next = arg === "--json" ? "json" : "jsonl";
      if (mode !== "human" && mode !== next) {
        return {
          code: "VFY_CLI_ARGUMENT_INVALID",
          message: "--json and --jsonl are mutually exclusive",
        };
      }
      mode = next;
    } else {
      rest.push(arg);
    }
  }
  return { mode, rest };
}

function parseVerify(
  args: readonly string[],
  mode: CliOutputMode,
  cwd: string,
): CliParseResult {
  let workspace: string | undefined;
  let offline = false;
  let noCache = false;
  let deadlineMs: number | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--offline") {
      offline = true;
    } else if (arg === "--no-cache") {
      noCache = true;
    } else if (arg === "--deadline") {
      const raw = args[index + 1];
      if (raw === undefined || !/^[1-9][0-9]*$/.test(raw)) {
        return failure("--deadline requires a positive integer millisecond value");
      }
      deadlineMs = Number(raw);
      if (!Number.isSafeInteger(deadlineMs)) {
        return failure("--deadline exceeds the supported integer range");
      }
      index += 1;
    } else if (arg?.startsWith("-")) {
      return failure(`unknown option: ${arg}`);
    } else if (arg !== undefined && workspace === undefined) {
      workspace = arg;
    } else {
      return failure("verify accepts at most one workspace");
    }
  }
  return {
    ok: true,
    command: {
      kind: "verify",
      workspace: workspace ?? cwd,
      offline,
      noCache,
      ...(deadlineMs === undefined ? {} : { deadlineMs }),
      outputMode: mode,
    },
  };
}

export function parseCli(
  argv: readonly string[],
  cwd: string,
): CliParseResult {
  const selected = outputMode(argv);
  if ("code" in selected) return { ok: false, error: selected };
  const args = selected.rest;
  const first = args[0];
  if (first === undefined || first === "verify") {
    return parseVerify(first === "verify" ? args.slice(1) : args, selected.mode, cwd);
  }
  if (first === "inspect") {
    const target = args[1];
    const id = args[2];
    if (
      (target !== "run" && target !== "evidence") ||
      id === undefined ||
      args.length !== 3
    ) {
      return failure("usage: verify inspect run|evidence <id>");
    }
    return {
      ok: true,
      command: {
        kind: target === "run" ? "inspectRun" : "inspectEvidence",
        id,
        outputMode: selected.mode,
      },
    };
  }
  if (first === "cache") {
    const action = args[1];
    if ((action !== "inspect" && action !== "clear") || args.length !== 2) {
      return failure("usage: verify cache inspect|clear");
    }
    return {
      ok: true,
      command: {
        kind: action === "inspect" ? "cacheInspect" : "cacheClear",
        outputMode: selected.mode,
      },
    };
  }
  if ((first === "version" || first === "schema") && args.length === 1) {
    return { ok: true, command: { kind: first, outputMode: selected.mode } };
  }
  return failure(`unknown command: ${first}`);
}

export function toCanonicalVerifyRequest(
  command: VerifyCliCommand,
  options: CanonicalVerifyRequestOptions,
): import("@verify-internal/protocol").VerifyRequest {
  return {
    schemaVersion: 1,
    command: "verify",
    invocationId: options.invocationId as VerifyRequestIdentity,
    arguments: {
      noCache: command.noCache,
    },
    configurationReferences: [],
    policyReferences: [],
    consentGrantReferences: [],
    // The MVP engine is unconditionally offline. The flag is accepted as an
    // idempotent UX assertion, while the canonical request records the truth.
    offline: true,
    ...(command.deadlineMs === undefined
      ? {}
      : {
          deadlineMs:
            command.deadlineMs as NonNullable<
              import("@verify-internal/protocol").VerifyRequest["deadlineMs"]
            >,
        }),
    outputMode: command.outputMode,
    environment: {
      platform: options.platform,
      allowlistedBindings: [command.workspace as VerifyRequestIdentity],
    },
    workspace: {
      rootBinding: command.workspace as VerifyRequestIdentity,
    },
  };
}

type VerifyRequestIdentity =
  import("@verify-internal/protocol").VerifyRequest["invocationId"];
