import type {
  OpaqueId,
  RevisionDocument,
  RevisionRef,
} from "@verify-internal/contracts";
import {
  EngineUnitOfWorkConflict,
  type EngineUnitOfWork,
  type EngineUnitOfWorkCommit,
  type EngineUnitOfWorkReceipt,
  type EventEnvelope,
  type ReferenceEdge,
} from "../public/index.js";

interface AcceptedCommit {
  readonly unit: EngineUnitOfWorkCommit;
  readonly receipt: EngineUnitOfWorkReceipt;
}

export interface InMemoryEngineSnapshot {
  readonly revisions: readonly RevisionDocument[];
  readonly events: readonly EventEnvelope[];
  readonly referenceEdges: readonly ReferenceEdge[];
  readonly currentRevisions: Readonly<Record<string, RevisionRef>>;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function structurallyEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== typeof right || left === null || right === null) {
    return false;
  }
  if (typeof left !== "object") return false;

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    if (left.length !== right.length) return false;
    return left.every((entry, index) =>
      structurallyEqual(entry, right[index]),
    );
  }

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  if (!structurallyEqual(leftKeys, rightKeys)) return false;
  return leftKeys.every((key) =>
    structurallyEqual(leftRecord[key], rightRecord[key]),
  );
}

function revisionKey(ref: RevisionRef): string {
  return `${ref.kind}\u0000${ref.id}\u0000${ref.revision}\u0000${ref.schemaVersion}`;
}

function eventIdKey(id: OpaqueId): string {
  return id;
}

function refFromDocument(document: RevisionDocument): RevisionRef {
  return {
    kind: document.kind,
    id: document.id,
    revision: document.revision,
    schemaVersion: document.schemaVersion,
  };
}

function sameRevision(
  left: RevisionRef | null | undefined,
  right: RevisionRef | null | undefined,
): boolean {
  if (left === null || left === undefined) {
    return right === null || right === undefined;
  }
  return right !== null &&
    right !== undefined &&
    revisionKey(left) === revisionKey(right);
}

/**
 * A deterministic contract-test backend. Validation occurs against cloned
 * candidate maps, and live state is replaced only after every predicate and
 * reference check succeeds.
 */
export class InMemoryEngineUnitOfWork implements EngineUnitOfWork {
  private revisions = new Map<string, RevisionDocument>();
  private eventsById = new Map<string, EventEnvelope>();
  private eventsByInvocation = new Map<string, EventEnvelope[]>();
  private referenceEdges: ReferenceEdge[] = [];
  private currentRevisions = new Map<string, RevisionRef>();
  private acceptedCommits = new Map<string, AcceptedCommit>();

  async commit(
    suppliedUnit: EngineUnitOfWorkCommit,
  ): Promise<EngineUnitOfWorkReceipt> {
    const unit = clone(suppliedUnit);
    const prior = this.acceptedCommits.get(unit.idempotencyKey);
    if (prior !== undefined) {
      if (!structurallyEqual(prior.unit, unit)) {
        throw new EngineUnitOfWorkConflict(
          "IDEMPOTENCY_CONFLICT",
          `idempotency key ${unit.idempotencyKey} was already used`,
        );
      }
      return clone(prior.receipt);
    }

    if (
      !Number.isSafeInteger(unit.expectedNextSequence) ||
      unit.expectedNextSequence < 1
    ) {
      throw new EngineUnitOfWorkConflict(
        "INVALID_EVENT_SEQUENCE",
        "expectedNextSequence must be a positive safe integer",
      );
    }

    const invocationEvents =
      this.eventsByInvocation.get(unit.invocationId) ?? [];
    const actualNextSequence =
      invocationEvents.length === 0
        ? 1
        : invocationEvents[invocationEvents.length - 1]!.sequence + 1;
    if (unit.expectedNextSequence !== actualNextSequence) {
      throw new EngineUnitOfWorkConflict(
        "SEQUENCE_CONFLICT",
        `expected ${unit.expectedNextSequence}; actual ${actualNextSequence}`,
      );
    }

    const nextRevisions = new Map(this.revisions);
    for (const document of unit.revisions) {
      const key = revisionKey(refFromDocument(document));
      const existing = nextRevisions.get(key);
      if (existing !== undefined && !structurallyEqual(existing, document)) {
        throw new EngineUnitOfWorkConflict(
          "DUPLICATE_REVISION",
          `revision ${key} already has different content`,
        );
      }
      nextRevisions.set(key, clone(document));
    }

    const nextEventsById = new Map(this.eventsById);
    const nextInvocationEvents = [...invocationEvents];
    for (const [index, event] of unit.events.entries()) {
      const expectedSequence = unit.expectedNextSequence + index;
      if (
        event.invocationId !== unit.invocationId ||
        event.sequence !== expectedSequence ||
        !Number.isSafeInteger(event.sequence)
      ) {
        throw new EngineUnitOfWorkConflict(
          "INVALID_EVENT_SEQUENCE",
          `event ${event.eventId} must be invocation ${unit.invocationId} sequence ${expectedSequence}`,
        );
      }
      const eventKey = eventIdKey(event.eventId);
      if (nextEventsById.has(eventKey)) {
        throw new EngineUnitOfWorkConflict(
          "DUPLICATE_EVENT_ID",
          `event ID ${event.eventId} already exists`,
        );
      }
      if (
        event.subject !== undefined &&
        !nextRevisions.has(revisionKey(event.subject))
      ) {
        throw new EngineUnitOfWorkConflict(
          "MISSING_REVISION",
          `event ${event.eventId} subject is not visible`,
        );
      }
      nextEventsById.set(eventKey, clone(event));
      nextInvocationEvents.push(clone(event));
    }

    const nextEdges = [...this.referenceEdges];
    for (const edge of unit.referenceEdges) {
      if (
        !nextRevisions.has(revisionKey(edge.source)) ||
        !nextRevisions.has(revisionKey(edge.target))
      ) {
        throw new EngineUnitOfWorkConflict(
          "INVALID_REFERENCE_EDGE",
          `edge ${edge.relation} must reference visible revisions`,
        );
      }
      if (
        !nextEdges.some((existing) => structurallyEqual(existing, edge))
      ) {
        nextEdges.push(clone(edge));
      }
    }

    const nextCurrentRevisions = new Map(this.currentRevisions);
    const mutatedSlots = new Set<string>();
    for (const mutation of unit.currentRevisionMutations) {
      if (mutatedSlots.has(mutation.slot)) {
        throw new EngineUnitOfWorkConflict(
          "CURRENT_REVISION_CONFLICT",
          `slot ${mutation.slot} occurs more than once`,
        );
      }
      mutatedSlots.add(mutation.slot);
      const actual = nextCurrentRevisions.get(mutation.slot);
      if (!sameRevision(actual, mutation.expectedCurrent)) {
        throw new EngineUnitOfWorkConflict(
          "CURRENT_REVISION_CONFLICT",
          `slot ${mutation.slot} did not match its expected revision`,
        );
      }
      if (!nextRevisions.has(revisionKey(mutation.nextCurrent))) {
        throw new EngineUnitOfWorkConflict(
          "MISSING_REVISION",
          `slot ${mutation.slot} points to a revision that is not visible`,
        );
      }
      nextCurrentRevisions.set(mutation.slot, clone(mutation.nextCurrent));
    }

    const receipt: EngineUnitOfWorkReceipt = {
      idempotencyKey: unit.idempotencyKey,
      invocationId: unit.invocationId,
      firstSequence: unit.expectedNextSequence,
      lastSequence: unit.expectedNextSequence + unit.events.length - 1,
      revisionCount: unit.revisions.length,
      eventCount: unit.events.length,
      referenceEdgeCount: unit.referenceEdges.length,
    };

    this.revisions = nextRevisions;
    this.eventsById = nextEventsById;
    this.eventsByInvocation.set(unit.invocationId, nextInvocationEvents);
    this.referenceEdges = nextEdges;
    this.currentRevisions = nextCurrentRevisions;
    this.acceptedCommits.set(unit.idempotencyKey, {
      unit,
      receipt: clone(receipt),
    });
    return clone(receipt);
  }

  readRevision(ref: RevisionRef): RevisionDocument | undefined {
    const document = this.revisions.get(revisionKey(ref));
    return document === undefined ? undefined : clone(document);
  }

  readInvocation(invocationId: OpaqueId): readonly EventEnvelope[] {
    return clone(this.eventsByInvocation.get(invocationId) ?? []);
  }

  readCurrent(slot: string): RevisionRef | undefined {
    const ref = this.currentRevisions.get(slot);
    return ref === undefined ? undefined : clone(ref);
  }

  snapshot(): InMemoryEngineSnapshot {
    return {
      revisions: clone([...this.revisions.values()]),
      events: clone([...this.eventsById.values()]),
      referenceEdges: clone(this.referenceEdges),
      currentRevisions: Object.fromEntries(
        [...this.currentRevisions.entries()].map(([slot, ref]) => [
          slot,
          clone(ref),
        ]),
      ),
    };
  }
}
