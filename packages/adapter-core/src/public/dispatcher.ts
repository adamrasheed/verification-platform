import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { canonicalize } from "@verify-internal/contracts";
import type {
  CanonicalValue,
  OpaqueId,
  RevisionDocument,
  RevisionRef,
} from "@verify-internal/contracts";
import {
  LocalVerificationRuntime,
} from "@verify-internal/engine";
import type {
  EngineLifecycleEvent,
  VerifyRequest as EngineVerifyRequest,
  VerifyResult as EngineVerifyResult,
} from "@verify-internal/engine";
import type {
  AnyCommandEnvelope,
  VerifyRequest,
} from "@verify-internal/protocol";
import { toProtocolEnvelope } from "./protocol-bridge.js";

const MAX_DEADLINE_MS = 60 * 60 * 1_000;
const MAX_EVENTS = 256;
const MAX_PROVENANCE_OBJECTS = 128;
const MAX_READ_BYTES = 4 * 1024 * 1024;

interface RetainedEvent {
  readonly eventType: string;
  readonly occurredAt: string;
  readonly sequence: number;
  readonly payload: CanonicalValue;
  readonly dataClassification: string;
}

interface AdapterReferenceEdge {
  readonly source: RevisionRef;
  readonly relation: string;
  readonly target: RevisionRef;
}

export interface LocalDispatcherRuntime {
  verify(request: EngineVerifyRequest, disableCache?: boolean): Promise<EngineVerifyResult>;
  readRun(invocationId: string): CanonicalValue | undefined;
  readHistoryEvents(invocationId: string): readonly RetainedEvent[];
  readEvidence(evidenceId: string): Promise<CanonicalValue | undefined>;
  readCanonicalRevision(reference: RevisionRef): RevisionDocument | undefined;
  readHistoryEdges(): readonly AdapterReferenceEdge[];
  close(): void;
}

export interface LocalWorkspaceBinding {
  readonly id: string;
  readonly root: string;
}

export interface LocalVerifyArguments {
  readonly workspaceBinding: string;
  readonly offline: true;
  readonly noCache: boolean;
  readonly deadlineMs?: number;
}

export interface LocalReadArguments {
  readonly workspaceBinding: string;
  readonly invocationId: string;
}

export interface LocalEvidenceArguments extends LocalReadArguments {
  readonly evidenceId: string;
}

export interface LocalProvenanceArguments extends LocalReadArguments {
  readonly reference: RevisionRef;
}

export interface AdapterProgress {
  readonly sequence: number;
  readonly stage: EngineLifecycleEvent["stage"];
  readonly status: EngineLifecycleEvent["status"];
  readonly reasonCode?: string;
}

export interface LocalVerificationDispatch {
  readonly request: VerifyRequest;
  readonly envelope: AnyCommandEnvelope;
}

export type LocalAdapterErrorCode =
  | "VFY_ADAPTER_BINDING_DENIED"
  | "VFY_ADAPTER_INVALID_REQUEST"
  | "VFY_ADAPTER_NOT_FOUND"
  | "VFY_ADAPTER_RESPONSE_OVERSIZED";

export class LocalAdapterError extends Error {
  readonly code: LocalAdapterErrorCode;

  constructor(code: LocalAdapterErrorCode, message: string) {
    super(message);
    this.name = "LocalAdapterError";
    this.code = code;
  }
}

export interface LocalCanonicalDispatcherOptions {
  readonly workspace: LocalWorkspaceBinding;
  readonly stateRoot?: string;
  readonly platform?: string;
  readonly runtime?: LocalDispatcherRuntime;
  readonly now?: () => number;
  readonly nowIso?: () => string;
  readonly createInvocationId?: () => string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedIdentity(value: unknown, label: string): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > 256
    || /[\u0000-\u001f\u007f]/.test(value)
  ) throw new LocalAdapterError(
    "VFY_ADAPTER_INVALID_REQUEST",
    `${label} must be a bounded opaque identifier`,
  );
  return value;
}

function assertDeadline(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || Number(value) <= 0 || Number(value) > MAX_DEADLINE_MS) {
    throw new LocalAdapterError(
      "VFY_ADAPTER_INVALID_REQUEST",
      `deadlineMs must be between 1 and ${MAX_DEADLINE_MS}`,
    );
  }
  return Number(value);
}

function refKey(reference: RevisionRef): string {
  return canonicalize(reference as unknown as CanonicalValue);
}

function referenceForDocument(document: RevisionDocument): RevisionRef {
  return {
    kind: document.kind,
    id: document.id,
    revision: document.revision,
    schemaVersion: document.schemaVersion,
  };
}

function assertReference(value: unknown): RevisionRef {
  if (!isRecord(value)) {
    throw new LocalAdapterError("VFY_ADAPTER_INVALID_REQUEST", "reference must be exact");
  }
  const keys = Object.keys(value).sort();
  if (
    canonicalize(keys as unknown as CanonicalValue)
      !== canonicalize(["id", "kind", "revision", "schemaVersion"])
    || typeof value.kind !== "string"
    || typeof value.id !== "string"
    || typeof value.revision !== "string"
    || !/^sha256:[a-f0-9]{64}$/.test(value.revision)
    || !Number.isSafeInteger(value.schemaVersion)
    || Number(value.schemaVersion) <= 0
  ) throw new LocalAdapterError("VFY_ADAPTER_INVALID_REQUEST", "reference must be exact");
  boundedIdentity(value.kind, "reference kind");
  boundedIdentity(value.id, "reference id");
  return value as unknown as RevisionRef;
}

function assertRetainedResult(value: CanonicalValue): EngineVerifyResult {
  if (
    !isRecord(value)
    || value.kind !== "verify"
    || value.schemaVersion !== 1
    || typeof value.engineVersion !== "string"
    || typeof value.invocationId !== "string"
    || !Array.isArray(value.events)
  ) throw new LocalAdapterError(
    "VFY_ADAPTER_INVALID_REQUEST",
    "retained run is incompatible with the current adapter",
  );
  return value as unknown as EngineVerifyResult;
}

function assertReadSize(value: unknown): CanonicalValue {
  const normalized = JSON.parse(JSON.stringify(value)) as CanonicalValue;
  if (Buffer.byteLength(canonicalize(normalized)) > MAX_READ_BYTES) {
    throw new LocalAdapterError(
      "VFY_ADAPTER_RESPONSE_OVERSIZED",
      "retained resource exceeds the local adapter response limit",
    );
  }
  return normalized;
}

function defaultStateRoot(workspaceRoot: string): string {
  return resolve(workspaceRoot, ".verify", "state");
}

export class LocalCanonicalDispatcher {
  readonly #workspace: LocalWorkspaceBinding;
  readonly #runtime: LocalDispatcherRuntime;
  readonly #platform: string;
  readonly #now: () => number;
  readonly #nowIso: () => string;
  readonly #createInvocationId: () => string;

  constructor(options: LocalCanonicalDispatcherOptions) {
    const id = boundedIdentity(options.workspace.id, "workspace binding");
    const root = resolve(options.workspace.root);
    this.#workspace = { id, root };
    this.#runtime = options.runtime
      ?? new LocalVerificationRuntime(options.stateRoot ?? defaultStateRoot(root));
    this.#platform = options.platform ?? process.platform;
    this.#now = options.now ?? (() => Date.now());
    this.#nowIso = options.nowIso ?? (() => new Date().toISOString());
    this.#createInvocationId = options.createInvocationId
      ?? (() => `invocation:${randomUUID()}`);
  }

  #assertBinding(value: unknown): void {
    const candidate = boundedIdentity(value, "workspaceBinding");
    if (candidate !== this.#workspace.id) {
      throw new LocalAdapterError(
        "VFY_ADAPTER_BINDING_DENIED",
        "workspace binding is not authorized by this local server",
      );
    }
  }

  async verify(
    argumentsValue: LocalVerifyArguments,
    signal: AbortSignal,
    onProgress?: (progress: AdapterProgress) => void | Promise<void>,
  ): Promise<LocalVerificationDispatch> {
    this.#assertBinding(argumentsValue.workspaceBinding);
    if (argumentsValue.offline !== true || typeof argumentsValue.noCache !== "boolean") {
      throw new LocalAdapterError(
        "VFY_ADAPTER_INVALID_REQUEST",
        "local verification requires explicit offline and noCache booleans",
      );
    }
    const deadlineMs = assertDeadline(argumentsValue.deadlineMs);
    const invocationId = boundedIdentity(this.#createInvocationId(), "invocationId");
    const request: VerifyRequest = {
      schemaVersion: 1,
      command: "verify",
      invocationId: invocationId as OpaqueId,
      arguments: { noCache: argumentsValue.noCache },
      configurationReferences: [],
      policyReferences: [],
      consentGrantReferences: [],
      offline: true,
      ...(deadlineMs === undefined
        ? {}
        : { deadlineMs: deadlineMs as NonNullable<VerifyRequest["deadlineMs"]> }),
      outputMode: "json",
      environment: {
        platform: this.#platform,
        allowlistedBindings: [this.#workspace.id as OpaqueId],
      },
      workspace: { rootBinding: this.#workspace.id as OpaqueId },
    };
    const startedAt = this.#nowIso();
    const startedMs = this.#now();
    const result = await this.#runtime.verify({
      schemaVersion: 1,
      workspaceRoot: this.#workspace.root,
      invocationId,
      ...(deadlineMs === undefined ? {} : { deadlineMs }),
      signal,
    }, argumentsValue.noCache);
    if (onProgress !== undefined) {
      for (const event of result.events.slice(0, MAX_EVENTS)) {
        await onProgress({
          sequence: event.sequence,
          stage: event.stage,
          status: event.status,
          ...(event.reasonCode === undefined ? {} : { reasonCode: event.reasonCode }),
        });
      }
    }
    return {
      request,
      envelope: toProtocolEnvelope(result, {
        startedAt,
        durationMs: Math.max(0, Math.round(this.#now() - startedMs)),
        workspaceBinding: this.#workspace.id,
      }),
    };
  }

  getRun(argumentsValue: LocalReadArguments): AnyCommandEnvelope {
    this.#assertBinding(argumentsValue.workspaceBinding);
    const invocationId = boundedIdentity(argumentsValue.invocationId, "invocationId");
    const retained = this.#runtime.readRun(invocationId);
    if (retained === undefined) {
      throw new LocalAdapterError("VFY_ADAPTER_NOT_FOUND", "retained run was not found");
    }
    const result = assertRetainedResult(retained);
    const events = this.#runtime.readHistoryEvents(invocationId);
    const first = events[0]?.occurredAt;
    const last = events.at(-1)?.occurredAt;
    const startedAt = first ?? "1970-01-01T00:00:00.000Z";
    const durationMs = first === undefined || last === undefined
      ? 0
      : Math.max(0, Date.parse(last) - Date.parse(first));
    return toProtocolEnvelope(result, {
      startedAt,
      durationMs,
      workspaceBinding: this.#workspace.id,
    });
  }

  getRunEvents(argumentsValue: LocalReadArguments): CanonicalValue {
    this.getRun(argumentsValue);
    const events = this.#runtime.readHistoryEvents(argumentsValue.invocationId);
    return assertReadSize({
      schemaVersion: 1,
      invocationId: argumentsValue.invocationId,
      events: events.slice(0, MAX_EVENTS),
      truncated: events.length > MAX_EVENTS,
    });
  }

  async getEvidence(argumentsValue: LocalEvidenceArguments): Promise<CanonicalValue> {
    this.#assertBinding(argumentsValue.workspaceBinding);
    this.getRun(argumentsValue);
    const evidenceId = boundedIdentity(argumentsValue.evidenceId, "evidenceId");
    const run = assertRetainedResult(this.#runtime.readRun(argumentsValue.invocationId)!);
    if (!run.evidenceRecords.some((record) => record.id === evidenceId)) {
      throw new LocalAdapterError(
        "VFY_ADAPTER_NOT_FOUND",
        "evidence is not linked to the retained invocation",
      );
    }
    const evidence = await this.#runtime.readEvidence(evidenceId);
    if (evidence === undefined) {
      throw new LocalAdapterError("VFY_ADAPTER_NOT_FOUND", "retained evidence was not found");
    }
    return assertReadSize(evidence);
  }

  getProvenance(argumentsValue: LocalProvenanceArguments): CanonicalValue {
    this.#assertBinding(argumentsValue.workspaceBinding);
    this.getRun(argumentsValue);
    const reference = assertReference(argumentsValue.reference);
    const run = assertRetainedResult(this.#runtime.readRun(argumentsValue.invocationId)!);
    const allowed = new Map(
      run.revisionDocuments.map((document) => [
        refKey(referenceForDocument(document)),
        document,
      ]),
    );
    const rootKey = refKey(reference);
    if (!allowed.has(rootKey)) {
      throw new LocalAdapterError(
        "VFY_ADAPTER_NOT_FOUND",
        "exact revision is not linked to the retained invocation",
      );
    }
    const edges = this.#runtime.readHistoryEdges()
      .filter((edge) => allowed.has(refKey(edge.source)) && allowed.has(refKey(edge.target)))
      .sort((left, right) => canonicalize(left as unknown as CanonicalValue)
        .localeCompare(canonicalize(right as unknown as CanonicalValue)));
    const reached = new Set([rootKey]);
    const queue = [rootKey];
    while (queue.length > 0 && reached.size < MAX_PROVENANCE_OBJECTS) {
      const current = queue.shift()!;
      for (const edge of edges) {
        const source = refKey(edge.source);
        const target = refKey(edge.target);
        const next = source === current ? target : target === current ? source : undefined;
        if (next !== undefined && !reached.has(next)) {
          reached.add(next);
          queue.push(next);
          if (reached.size >= MAX_PROVENANCE_OBJECTS) break;
        }
      }
    }
    const objects = [...reached]
      .sort()
      .map((key) => {
        const document = allowed.get(key)!;
        return this.#runtime.readCanonicalRevision(referenceForDocument(document)) ?? document;
      });
    return assertReadSize({
      schemaVersion: 1,
      invocationId: argumentsValue.invocationId,
      root: reference,
      objects,
      edges: edges.filter((edge) =>
        reached.has(refKey(edge.source)) && reached.has(refKey(edge.target))
      ),
      truncated: reached.size >= MAX_PROVENANCE_OBJECTS,
    });
  }

  inspectPermissions(workspaceBinding: string): CanonicalValue {
    this.#assertBinding(workspaceBinding);
    return {
      schemaVersion: 1,
      profile: "local-workspace",
      workspaceBinding: this.#workspace.id,
      offline: true,
      tools: [
        "verification.verify",
        "verification.get_run",
        "verification.get_evidence",
        "verification.get_provenance",
        "verification.inspect_permissions",
      ],
      mutations: [],
      publication: false,
      providerCredentials: false,
    };
  }

  close(): void {
    this.#runtime.close();
  }
}
