import type {
  EngineLifecycleEvent,
  VerifyResult as EngineVerifyResult,
} from "@verify-internal/engine";
import type {
  AnyCommandEnvelope,
  JsonlResultRecord,
  StructuredError,
  VerifyResult,
} from "@verify-internal/protocol";
import { toJsonlEventRecord } from "./protocol-bridge.js";

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function text(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function diagnosticLine(diagnostic: StructuredError): string {
  return `  - ${diagnostic.code}: ${diagnostic.message}`;
}

export function renderHumanEnvelope(envelope: AnyCommandEnvelope): string {
  const lines = [`operational status: ${envelope.operationalStatus}`];
  const result =
    envelope.command === "verify" && envelope.result?.kind === "verify"
      ? envelope.result as VerifyResult
      : undefined;
  if (result !== undefined) {
    lines.push(`verification outcome: ${result.outcome}`);
    lines.push(
      `application model: ${result.applicationModel.id}@${result.applicationModel.revision}`,
    );
    lines.push("required promises:");
    if (result.proofExecutions.length === 0) {
      lines.push("  (none evaluated)");
    } else {
      for (const execution of result.proofExecutions) {
        const promiseId = execution.promise.id;
        const proofId = execution.proof.id;
        const status = execution.result?.status ?? execution.state;
        lines.push(`  - ${promiseId} — ${proofId}: ${status}`);
        if (
          execution.result?.status === "failed" ||
          execution.result?.status === "indeterminate"
        ) {
          for (const reason of execution.result.reasonCodes) {
            lines.push(`      reason: ${reason}`);
          }
        }
      }
    }
    lines.push("evidence references:");
    if (result.evidence.length === 0) {
      lines.push("  (none)");
    } else {
      for (const evidence of result.evidence) {
        lines.push(`  - ${evidence.id}@${evidence.revision}`);
      }
    }
    lines.push("next actions:");
    if ((result.repairRecords?.length ?? 0) > 0) {
      for (const repair of result.repairRecords ?? []) {
        const action =
          repair.action.kind === "jsonPatch"
            ? `jsonPatch ${repair.action.target}`
            : repair.action.instructionCode;
        lines.push(`  - ${repair.id}: ${action}`);
      }
    } else if (result.repairs.length === 0) {
      lines.push("  (none)");
    } else {
      for (const repair of result.repairs) {
        lines.push(`  - inspect ${repair.id}@${repair.revision}`);
      }
    }
    const cache = record(result.cacheDecisions[0]);
    if (cache !== undefined) {
      lines.push(`cache: ${text(cache.status, "unknown")}`);
    }
  }
  if (envelope.diagnostics.length > 0) {
    lines.push("diagnostics:");
    lines.push(...envelope.diagnostics.map(diagnosticLine));
  }
  lines.push(`invocation: ${envelope.invocationId}`);
  return `${lines.join("\n")}\n`;
}

export function renderJsonEnvelope(envelope: AnyCommandEnvelope): string {
  return `${JSON.stringify(envelope)}\n`;
}

export function renderJsonlTranscript(
  engineResult: EngineVerifyResult,
  envelope: AnyCommandEnvelope,
): string {
  const lines = engineResult.events.map((event) =>
    JSON.stringify(toJsonlEventRecord(event, engineResult, envelope.startedAt))
  );
  const terminal: JsonlResultRecord = {
    schemaVersion: 1,
    recordType: "result",
    envelope,
  };
  lines.push(JSON.stringify(terminal));
  return `${lines.join("\n")}\n`;
}

export function renderProgress(
  events: readonly EngineLifecycleEvent[],
): string {
  if (events.length === 0) return "";
  return `${events
    .map((event) => {
      const reason =
        event.reasonCode === undefined ? "" : ` (${event.reasonCode})`;
      return `[${event.stage}] ${event.status}${reason}`;
    })
    .join("\n")}\n`;
}
