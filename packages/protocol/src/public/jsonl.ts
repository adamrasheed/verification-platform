import type {
  CanonicalValue,
  OpaqueId,
} from "@verify-internal/contracts";
import type { EventEnvelope } from "@verify-internal/events";
import {
  decodeCommandEnvelope,
  type ProtocolReadResult,
} from "./decode.js";
import { protocolError, type StructuredError } from "./errors.js";
import {
  PROTOCOL_SCHEMA_MAJOR,
  type AnyCommandEnvelope,
} from "./types.js";

export interface JsonlEventRecord {
  readonly schemaVersion: typeof PROTOCOL_SCHEMA_MAJOR;
  readonly recordType: "event";
  readonly event: EventEnvelope<string, CanonicalValue>;
}

export interface JsonlResultRecord {
  readonly schemaVersion: typeof PROTOCOL_SCHEMA_MAJOR;
  readonly recordType: "result";
  readonly envelope: AnyCommandEnvelope;
}

export type JsonlRecord = JsonlEventRecord | JsonlResultRecord;

export interface ValidJsonlTranscript {
  readonly events: readonly EventEnvelope<string, CanonicalValue>[];
  readonly result: AnyCommandEnvelope;
}

function invalid(message: string): ProtocolReadResult<ValidJsonlTranscript> {
  return {
    kind: "invalid",
    error: protocolError(
      "VFY_PROTOCOL_JSONL_INVALID",
      message,
      "validateJsonlTranscript",
    ),
  };
}

function incompatible(
  error: StructuredError,
): ProtocolReadResult<ValidJsonlTranscript> {
  return { kind: "incompatible_result", error };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEventEnvelope(
  value: unknown,
): value is EventEnvelope<string, CanonicalValue> {
  const classifications = [
    "SECRET",
    "LOCAL_SOURCE",
    "SENSITIVE_EVIDENCE",
    "MINIMAL_METADATA",
    "EXPLICIT_SHARE",
  ];
  const producerValid =
    isRecord(value) &&
    isRecord(value.producer) &&
    typeof value.producer.id === "string" &&
    typeof value.producer.version === "string" &&
    typeof value.producer.artifactDigest === "string" &&
    /^sha256:[a-f0-9]{64}$/.test(value.producer.artifactDigest);
  const subjectValid =
    !isRecord(value) ||
    value.subject === undefined ||
    (isRecord(value.subject) &&
      typeof value.subject.kind === "string" &&
      typeof value.subject.id === "string" &&
      typeof value.subject.revision === "string" &&
      /^sha256:[a-f0-9]{64}$/.test(value.subject.revision) &&
      Number.isSafeInteger(value.subject.schemaVersion) &&
      (value.subject.schemaVersion as number) > 0);
  return (
    isRecord(value) &&
    Number.isSafeInteger(value.schemaVersion) &&
    (value.schemaVersion as number) > 0 &&
    typeof value.eventId === "string" &&
    typeof value.eventType === "string" &&
    typeof value.occurredAt === "string" &&
    typeof value.invocationId === "string" &&
    typeof value.correlationId === "string" &&
    Number.isSafeInteger(value.sequence) &&
    (value.sequence as number) >= 0 &&
    producerValid &&
    typeof value.dataClassification === "string" &&
    classifications.includes(value.dataClassification) &&
    subjectValid &&
    (value.causationId === undefined || typeof value.causationId === "string") &&
    value.payload !== undefined
  );
}

function parseLines(input: string): ProtocolReadResult<readonly unknown[]> {
  const normalized = input.endsWith("\n") ? input.slice(0, -1) : input;
  if (normalized.length === 0) {
    return {
      kind: "invalid",
      error: protocolError(
        "VFY_PROTOCOL_JSONL_INVALID",
        "JSONL transcript is empty",
        "validateJsonlTranscript",
      ),
    };
  }
  const lines = normalized.split("\n");
  const values: unknown[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined || line.length === 0) {
      return {
        kind: "invalid",
        error: protocolError(
          "VFY_PROTOCOL_JSONL_INVALID",
          `empty JSONL record at line ${index + 1}`,
          "validateJsonlTranscript",
        ),
      };
    }
    try {
      values.push(JSON.parse(line) as unknown);
    } catch {
      return {
        kind: "invalid",
        error: protocolError(
          "VFY_PROTOCOL_JSONL_INVALID",
          `invalid JSON at line ${index + 1}`,
          "validateJsonlTranscript",
        ),
      };
    }
  }
  return { kind: "ok", value: values };
}

export function validateJsonlTranscript(
  input: string,
): ProtocolReadResult<ValidJsonlTranscript> {
  const parsed = parseLines(input);
  if (parsed.kind !== "ok") return parsed;

  const events: EventEnvelope<string, CanonicalValue>[] = [];
  let terminal: AnyCommandEnvelope | undefined;
  let previousSequence = -1;
  let invocationId: OpaqueId | undefined;

  for (let index = 0; index < parsed.value.length; index += 1) {
    const record = parsed.value[index];
    if (!isRecord(record) || record.schemaVersion !== PROTOCOL_SCHEMA_MAJOR) {
      return invalid(`invalid JSONL record envelope at line ${index + 1}`);
    }
    if (record.recordType === "event") {
      if (terminal !== undefined) {
        return invalid("event appears after the terminal result");
      }
      if (!isEventEnvelope(record.event)) {
        return invalid(`invalid event at line ${index + 1}`);
      }
      if (record.event.sequence <= previousSequence) {
        return invalid("event sequence must be strictly increasing");
      }
      if (
        invocationId !== undefined &&
        record.event.invocationId !== invocationId
      ) {
        return invalid("event invocation IDs must match");
      }
      invocationId = record.event.invocationId as OpaqueId;
      previousSequence = record.event.sequence;
      events.push(record.event);
      continue;
    }
    if (record.recordType === "result") {
      if (terminal !== undefined || index !== parsed.value.length - 1) {
        return invalid("exactly one terminal result must be the final record");
      }
      const decoded = decodeCommandEnvelope(record.envelope);
      if (decoded.kind === "incompatible_result") {
        return incompatible(decoded.error);
      }
      if (decoded.kind === "invalid") {
        return invalid("terminal result envelope is invalid");
      }
      if (
        invocationId !== undefined &&
        decoded.value.invocationId !== invocationId
      ) {
        return invalid("terminal result invocation ID does not match events");
      }
      terminal = decoded.value;
      continue;
    }
    return {
      kind: "incompatible_result",
      error: protocolError(
        "VFY_COMPATIBILITY_UNKNOWN_CONTROL_VALUE",
        "unknown JSONL record type",
        "validateJsonlTranscript",
      ),
    };
  }
  if (terminal === undefined) {
    return invalid("JSONL transcript has no terminal result");
  }
  return { kind: "ok", value: { events, result: terminal } };
}
