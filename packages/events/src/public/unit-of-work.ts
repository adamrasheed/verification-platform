import type {
  CanonicalValue,
  OpaqueId,
  RevisionDocument,
  RevisionRef,
} from "@verify-internal/contracts";
import type { EventEnvelope } from "./event-envelope.js";

export interface ReferenceEdge {
  readonly source: RevisionRef;
  readonly relation: string;
  readonly target: RevisionRef;
}

export interface CurrentRevisionMutation {
  readonly slot: string;
  readonly expectedCurrent: RevisionRef | null;
  readonly nextCurrent: RevisionRef;
}

export interface EngineUnitOfWorkCommit {
  readonly idempotencyKey: OpaqueId;
  readonly invocationId: OpaqueId;
  readonly expectedNextSequence: number;
  readonly revisions: readonly RevisionDocument[];
  readonly events: readonly EventEnvelope<string, CanonicalValue>[];
  readonly referenceEdges: readonly ReferenceEdge[];
  readonly currentRevisionMutations: readonly CurrentRevisionMutation[];
}

export interface EngineUnitOfWorkReceipt {
  readonly idempotencyKey: OpaqueId;
  readonly invocationId: OpaqueId;
  readonly firstSequence: number;
  readonly lastSequence: number;
  readonly revisionCount: number;
  readonly eventCount: number;
  readonly referenceEdgeCount: number;
}

export type EngineUnitOfWorkConflictCode =
  | "CURRENT_REVISION_CONFLICT"
  | "DUPLICATE_EVENT_ID"
  | "DUPLICATE_REVISION"
  | "IDEMPOTENCY_CONFLICT"
  | "INVALID_EVENT_SEQUENCE"
  | "INVALID_REFERENCE_EDGE"
  | "MISSING_REVISION"
  | "SEQUENCE_CONFLICT";

export class EngineUnitOfWorkConflict extends Error {
  readonly code: EngineUnitOfWorkConflictCode;

  constructor(code: EngineUnitOfWorkConflictCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "EngineUnitOfWorkConflict";
    this.code = code;
  }
}

export interface EngineUnitOfWork {
  commit(
    unit: EngineUnitOfWorkCommit,
  ): Promise<EngineUnitOfWorkReceipt>;
}
