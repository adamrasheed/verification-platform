import { randomUUID } from "node:crypto";
import {
  ENGINE_ARTIFACT_DIGEST,
  ENGINE_VERSION,
} from "@verify-internal/engine";
import {
  PROTOCOL_SCHEMA_MAJOR,
  RESULT_KIND_FOR_COMMAND,
  cliExitCodeForEnvelope,
} from "@verify-internal/protocol";
import type {
  CliExitCode,
  StructuredError,
} from "@verify-internal/protocol";
import {
  CurrentEngineAdapter,
  PersistenceNotFoundError,
  PersistenceUnavailableError,
  UnavailablePersistenceAdapter,
} from "./adapters.js";
import type {
  CliEngineAdapter,
  CliPersistenceAdapter,
  PersistenceProjection,
} from "./adapters.js";
import {
  parseCli,
  toCanonicalVerifyRequest,
} from "./parser.js";
import type {
  CliCommand,
  CliOutputMode,
} from "./parser.js";
import { toProtocolEnvelope } from "./protocol-bridge.js";
import {
  renderHumanEnvelope,
  renderJsonEnvelope,
  renderJsonlTranscript,
  renderProgress,
} from "./renderers.js";

export const CLI_VERSION = "0.1.0";

export interface CliIo {
  readonly cwd: string;
  readonly platform: string;
  readonly stdout: (chunk: string) => void;
  readonly stderr: (chunk: string) => void;
  readonly now: () => number;
  readonly nowIso: () => string;
}

export interface CliDependencies {
  readonly engine?: CliEngineAdapter;
  readonly persistence?: CliPersistenceAdapter;
  readonly signal?: AbortSignal;
  readonly createInvocationId?: () => string;
}

interface CliErrorDocument {
  readonly schemaVersion: 1;
  readonly operationalStatus: "invalid" | "blocked" | "internal_error";
  readonly diagnostics: readonly StructuredError[];
}

function cliError(
  code: `VFY_CLI_${string}`,
  message: string,
  status: CliErrorDocument["operationalStatus"],
): CliErrorDocument {
  return {
    schemaVersion: 1,
    operationalStatus: status,
    diagnostics: [{
      code,
      category:
        status === "invalid"
          ? "invalid"
          : status === "blocked"
            ? "environment"
            : "internal",
      retryability: "never",
      message,
      component: "@verify-internal/cli",
      operation: "run",
      blocksRequiredProof: true,
      causes: [],
      diagnosticRefs: [],
    }],
  };
}

function outputError(
  document: CliErrorDocument,
  mode: CliOutputMode,
  io: CliIo,
): void {
  if (mode === "human") {
    io.stderr(
      `${document.operationalStatus}: ${document.diagnostics[0]?.code ?? "VFY_CLI_ERROR"}: ${document.diagnostics[0]?.message ?? "CLI error"}\n`,
    );
  } else {
    io.stdout(`${JSON.stringify(document)}\n`);
  }
}

function outputStatic(
  command: "version" | "schema",
  mode: CliOutputMode,
  io: CliIo,
): void {
  const document =
    command === "version"
      ? {
          cliVersion: CLI_VERSION,
          engine: {
            version: ENGINE_VERSION,
            artifactDigest: ENGINE_ARTIFACT_DIGEST,
          },
          protocolSchemaMajor: PROTOCOL_SCHEMA_MAJOR,
        }
      : {
          protocolSchemaMajor: PROTOCOL_SCHEMA_MAJOR,
          resultKinds: RESULT_KIND_FOR_COMMAND,
        };
  if (mode === "human") {
    if (command === "version") {
      io.stdout(
        `verify ${CLI_VERSION}\nengine ${ENGINE_VERSION} (${ENGINE_ARTIFACT_DIGEST})\nprotocol schema ${PROTOCOL_SCHEMA_MAJOR}\n`,
      );
    } else {
      io.stdout(
        `protocol schema ${PROTOCOL_SCHEMA_MAJOR}\nresult kinds: ${Object.values(RESULT_KIND_FOR_COMMAND).join(", ")}\n`,
      );
    }
    return;
  }
  io.stdout(`${JSON.stringify(document)}\n`);
}

function outputPersistence(
  projection: PersistenceProjection,
  mode: CliOutputMode,
  io: CliIo,
): void {
  if (mode === "human") {
    io.stdout(
      projection.humanLines.length === 0
        ? ""
        : `${projection.humanLines.join("\n")}\n`,
    );
    return;
  }
  io.stdout(`${JSON.stringify(projection.document)}\n`);
}

async function runPersistence(
  command: Exclude<CliCommand, { readonly kind: "verify" | "version" | "schema" }>,
  adapter: CliPersistenceAdapter,
  invocationId: string,
  signal: AbortSignal,
): Promise<PersistenceProjection> {
  switch (command.kind) {
    case "inspectRun":
      return adapter.inspectRun(command.id);
    case "inspectEvidence":
      return adapter.inspectEvidence(command.id);
    case "cacheInspect":
      return adapter.inspectCache();
    case "cacheClear":
      return adapter.clearCache();
    case "repairPreview":
      return adapter.previewRepair(
        command.sourceInvocationId,
        command.repairId,
        command.workspace,
      );
    case "repairApply":
      return adapter.applyRepair(
        invocationId,
        command.sourceInvocationId,
        command.repairId,
        command.workspace,
        command.writeGranted,
        signal,
      );
  }
}

function exitForError(status: CliErrorDocument["operationalStatus"]): CliExitCode {
  if (status === "invalid") return 3;
  if (status === "blocked") return 4;
  return 6;
}

export async function runCli(
  argv: readonly string[],
  io: CliIo,
  dependencies: CliDependencies = {},
): Promise<CliExitCode> {
  const parsed = parseCli(argv, io.cwd);
  if (!parsed.ok) {
    const error = cliError(parsed.error.code, parsed.error.message, "invalid");
    const requestedMode = argv.includes("--jsonl")
      ? "jsonl"
      : argv.includes("--json")
        ? "json"
        : "human";
    outputError(error, requestedMode, io);
    return 3;
  }
  const command = parsed.command;
  if (command.kind === "version" || command.kind === "schema") {
    outputStatic(command.kind, command.outputMode, io);
    return 0;
  }
  if (command.kind !== "verify") {
    const invocationId =
      dependencies.createInvocationId?.() ?? `invocation:${randomUUID()}`;
    try {
      const projection = await runPersistence(
        command as Exclude<
          CliCommand,
          { readonly kind: "verify" | "version" | "schema" }
        >,
        dependencies.persistence ?? new UnavailablePersistenceAdapter(),
        invocationId,
        dependencies.signal ?? new AbortController().signal,
      );
      outputPersistence(projection, command.outputMode, io);
      return projection.exitCode;
    } catch (error) {
      const status =
        error instanceof PersistenceUnavailableError
          ? "blocked"
          : error instanceof PersistenceNotFoundError
            ? "invalid"
            : error instanceof Error && error.name === "RepairApplyConflict"
              ? "invalid"
          : "internal_error";
      const message =
        error instanceof Error ? error.message : "unexpected persistence error";
      outputError(
        cliError(
          status === "blocked"
            ? "VFY_CLI_PERSISTENCE_UNAVAILABLE"
            : status === "invalid"
              ? "VFY_CLI_PERSISTENCE_NOT_FOUND"
            : "VFY_CLI_INTERNAL_ERROR",
          message,
          status,
        ),
        command.outputMode,
        io,
      );
      return exitForError(status);
    }
  }

  const startedAt = io.nowIso();
  const startedMs = io.now();
  const invocationId =
    dependencies.createInvocationId?.() ?? `invocation:${randomUUID()}`;
  const request = toCanonicalVerifyRequest(command, {
    invocationId,
    platform: io.platform,
  });
  try {
    // Progress is observable before Engine work begins. Keep it on stderr so
    // JSON and JSONL stdout remain pure machine protocols.
    io.stderr("[preflight] started\n");
    const engineResult = await (
      dependencies.engine ?? new CurrentEngineAdapter()
    ).verify(request, dependencies.signal ?? new AbortController().signal);
    const envelope = toProtocolEnvelope(engineResult, {
      startedAt,
      durationMs: Math.max(0, Math.round(io.now() - startedMs)),
    });
    if (command.outputMode === "human") {
      io.stdout(renderHumanEnvelope(envelope));
    } else if (command.outputMode === "json") {
      io.stdout(renderJsonEnvelope(envelope));
    } else {
      io.stdout(renderJsonlTranscript(engineResult, envelope));
    }
    let removedEagerPreflight = false;
    io.stderr(renderProgress(engineResult.events.filter((event) => {
      if (
        !removedEagerPreflight &&
        event.stage === "preflight" &&
        event.status === "started"
      ) {
        removedEagerPreflight = true;
        return false;
      }
      return true;
    })));
    return cliExitCodeForEnvelope(envelope);
  } catch (error) {
    const document = cliError(
      "VFY_CLI_INTERNAL_ERROR",
      error instanceof Error ? error.message : "unexpected CLI failure",
      "internal_error",
    );
    outputError(document, command.outputMode, io);
    return 6;
  }
}
