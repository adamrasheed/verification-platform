import { DatabaseSync } from "node:sqlite";
import {
  canonicalize,
  type CanonicalValue,
  type OpaqueId,
  type RevisionDocument,
  type RevisionRef,
} from "@verify-internal/contracts";
import {
  EngineUnitOfWorkConflict,
  type EngineUnitOfWork,
  type EngineUnitOfWorkCommit,
  type EngineUnitOfWorkReceipt,
  type EventEnvelope,
  type ReferenceEdge,
} from "@verify-internal/events";

export type SqliteCommitFaultPoint =
  | "after-revisions"
  | "after-events"
  | "after-reference-edges"
  | "after-current-revisions"
  | "before-commit";

export type SqliteCommitFaultInjector = (
  point: SqliteCommitFaultPoint,
) => void;

function json(value: unknown): string {
  return canonicalize(value as CanonicalValue);
}

function revisionKey(ref: RevisionRef): string {
  return json({
    kind: ref.kind,
    id: ref.id,
    revision: ref.revision,
    schemaVersion: ref.schemaVersion,
  });
}

function documentRef(document: RevisionDocument): RevisionRef {
  return {
    kind: document.kind,
    id: document.id,
    revision: document.revision,
    schemaVersion: document.schemaVersion,
  };
}

function sameRef(left: RevisionRef | null, right: RevisionRef | null): boolean {
  return left === null
    ? right === null
    : right !== null && revisionKey(left) === revisionKey(right);
}

export class SqliteEngineUnitOfWork implements EngineUnitOfWork {
  readonly #database: DatabaseSync;
  readonly #fault: SqliteCommitFaultInjector | undefined;

  constructor(path: string, fault?: SqliteCommitFaultInjector) {
    this.#database = new DatabaseSync(path);
    this.#fault = fault;
    this.#database.exec("PRAGMA journal_mode = WAL");
    this.#database.exec("PRAGMA foreign_keys = ON");
    this.#database.exec("PRAGMA busy_timeout = 5000");
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS revisions (
        revision_key TEXT PRIMARY KEY,
        document_json TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS events (
        event_id TEXT PRIMARY KEY,
        invocation_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        envelope_json TEXT NOT NULL,
        UNIQUE(invocation_id, sequence)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS reference_edges (
        source_key TEXT NOT NULL,
        relation TEXT NOT NULL,
        target_key TEXT NOT NULL,
        PRIMARY KEY(source_key, relation, target_key)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS current_revisions (
        slot TEXT PRIMARY KEY,
        ref_json TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS accepted_commits (
        idempotency_key TEXT PRIMARY KEY,
        request_json TEXT NOT NULL,
        receipt_json TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS tombstones (
        object_key TEXT PRIMARY KEY,
        tombstone_json TEXT NOT NULL
      ) STRICT;
    `);
  }

  get journalMode(): string {
    const row = this.#database.prepare("PRAGMA journal_mode").get() as
      | { journal_mode: string }
      | undefined;
    return row?.journal_mode ?? "unknown";
  }

  close(): void {
    this.#database.close();
  }

  async commit(unit: EngineUnitOfWorkCommit): Promise<EngineUnitOfWorkReceipt> {
    const requestJson = json(unit);
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const prior = this.#database
        .prepare(
          "SELECT request_json, receipt_json FROM accepted_commits WHERE idempotency_key = ?",
        )
        .get(unit.idempotencyKey) as
        | { request_json: string; receipt_json: string }
        | undefined;
      if (prior !== undefined) {
        if (prior.request_json !== requestJson) {
          throw new EngineUnitOfWorkConflict(
            "IDEMPOTENCY_CONFLICT",
            `idempotency key ${unit.idempotencyKey} was already used`,
          );
        }
        const receipt = JSON.parse(
          prior.receipt_json,
        ) as EngineUnitOfWorkReceipt;
        this.#database.exec("COMMIT");
        return receipt;
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
      const sequenceRow = this.#database
        .prepare(
          "SELECT MAX(sequence) AS maximum FROM events WHERE invocation_id = ?",
        )
        .get(unit.invocationId) as { maximum: number | null };
      const actualNext = (sequenceRow.maximum ?? 0) + 1;
      if (unit.expectedNextSequence !== actualNext) {
        throw new EngineUnitOfWorkConflict(
          "SEQUENCE_CONFLICT",
          `expected ${unit.expectedNextSequence}; actual ${actualNext}`,
        );
      }

      const insertRevision = this.#database.prepare(
        "INSERT OR IGNORE INTO revisions(revision_key, document_json) VALUES (?, ?)",
      );
      const readRevision = this.#database.prepare(
        "SELECT document_json FROM revisions WHERE revision_key = ?",
      );
      for (const document of unit.revisions) {
        const key = revisionKey(documentRef(document));
        const documentJson = json(document);
        insertRevision.run(key, documentJson);
        const stored = readRevision.get(key) as { document_json: string };
        if (stored.document_json !== documentJson) {
          throw new EngineUnitOfWorkConflict(
            "DUPLICATE_REVISION",
            `revision ${key} has conflicting content`,
          );
        }
      }
      this.#fault?.("after-revisions");

      const revisionExists = this.#database.prepare(
        "SELECT 1 AS present FROM revisions WHERE revision_key = ?",
      );
      const insertEvent = this.#database.prepare(
        "INSERT INTO events(event_id, invocation_id, sequence, envelope_json) VALUES (?, ?, ?, ?)",
      );
      for (const [index, event] of unit.events.entries()) {
        const expected = unit.expectedNextSequence + index;
        if (
          event.invocationId !== unit.invocationId ||
          event.sequence !== expected ||
          !Number.isSafeInteger(event.sequence)
        ) {
          throw new EngineUnitOfWorkConflict(
            "INVALID_EVENT_SEQUENCE",
            `event ${event.eventId} must use sequence ${expected}`,
          );
        }
        if (
          event.subject !== undefined &&
          revisionExists.get(revisionKey(event.subject)) === undefined
        ) {
          throw new EngineUnitOfWorkConflict(
            "MISSING_REVISION",
            `event ${event.eventId} subject is unavailable`,
          );
        }
        try {
          insertEvent.run(
            event.eventId,
            event.invocationId,
            event.sequence,
            json(event),
          );
        } catch {
          throw new EngineUnitOfWorkConflict(
            "DUPLICATE_EVENT_ID",
            `event ${event.eventId} or its sequence already exists`,
          );
        }
      }
      this.#fault?.("after-events");

      const insertEdge = this.#database.prepare(
        "INSERT OR IGNORE INTO reference_edges(source_key, relation, target_key) VALUES (?, ?, ?)",
      );
      for (const edge of unit.referenceEdges) {
        const source = revisionKey(edge.source);
        const target = revisionKey(edge.target);
        if (
          revisionExists.get(source) === undefined ||
          revisionExists.get(target) === undefined
        ) {
          throw new EngineUnitOfWorkConflict(
            "INVALID_REFERENCE_EDGE",
            `edge ${edge.relation} references an unavailable revision`,
          );
        }
        insertEdge.run(source, edge.relation, target);
      }
      this.#fault?.("after-reference-edges");

      const readCurrent = this.#database.prepare(
        "SELECT ref_json FROM current_revisions WHERE slot = ?",
      );
      const upsertCurrent = this.#database.prepare(
        `INSERT INTO current_revisions(slot, ref_json) VALUES (?, ?)
         ON CONFLICT(slot) DO UPDATE SET ref_json = excluded.ref_json`,
      );
      const seenSlots = new Set<string>();
      for (const mutation of unit.currentRevisionMutations) {
        if (seenSlots.has(mutation.slot)) {
          throw new EngineUnitOfWorkConflict(
            "CURRENT_REVISION_CONFLICT",
            `slot ${mutation.slot} is mutated twice`,
          );
        }
        seenSlots.add(mutation.slot);
        const row = readCurrent.get(mutation.slot) as
          | { ref_json: string }
          | undefined;
        const actual =
          row === undefined ? null : JSON.parse(row.ref_json) as RevisionRef;
        if (!sameRef(actual, mutation.expectedCurrent)) {
          throw new EngineUnitOfWorkConflict(
            "CURRENT_REVISION_CONFLICT",
            `slot ${mutation.slot} did not match expected current revision`,
          );
        }
        if (
          revisionExists.get(revisionKey(mutation.nextCurrent)) === undefined
        ) {
          throw new EngineUnitOfWorkConflict(
            "MISSING_REVISION",
            `slot ${mutation.slot} points to an unavailable revision`,
          );
        }
        upsertCurrent.run(mutation.slot, json(mutation.nextCurrent));
      }
      this.#fault?.("after-current-revisions");

      const receipt: EngineUnitOfWorkReceipt = {
        idempotencyKey: unit.idempotencyKey,
        invocationId: unit.invocationId,
        firstSequence: unit.expectedNextSequence,
        lastSequence: unit.expectedNextSequence + unit.events.length - 1,
        revisionCount: unit.revisions.length,
        eventCount: unit.events.length,
        referenceEdgeCount: unit.referenceEdges.length,
      };
      this.#database.prepare(
        "INSERT INTO accepted_commits(idempotency_key, request_json, receipt_json) VALUES (?, ?, ?)",
      ).run(unit.idempotencyKey, requestJson, json(receipt));
      this.#fault?.("before-commit");
      this.#database.exec("COMMIT");
      return receipt;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  readRevision(ref: RevisionRef): RevisionDocument | undefined {
    const row = this.#database
      .prepare("SELECT document_json FROM revisions WHERE revision_key = ?")
      .get(revisionKey(ref)) as { document_json: string } | undefined;
    return row === undefined
      ? undefined
      : JSON.parse(row.document_json) as RevisionDocument;
  }

  readInvocation(invocationId: OpaqueId): readonly EventEnvelope[] {
    const rows = this.#database
      .prepare(
        "SELECT envelope_json FROM events WHERE invocation_id = ? ORDER BY sequence",
      )
      .all(invocationId) as { envelope_json: string }[];
    return rows.map(({ envelope_json }) =>
      JSON.parse(envelope_json) as EventEnvelope
    );
  }

  listInvocationIds(): readonly OpaqueId[] {
    const rows = this.#database.prepare(
      "SELECT DISTINCT invocation_id FROM events ORDER BY invocation_id",
    ).all() as { invocation_id: OpaqueId }[];
    return rows.map(({ invocation_id }) => invocation_id);
  }

  readEvent(eventId: OpaqueId): EventEnvelope | undefined {
    const row = this.#database.prepare(
      "SELECT envelope_json FROM events WHERE event_id = ?",
    ).get(eventId) as { envelope_json: string } | undefined;
    return row === undefined
      ? undefined
      : JSON.parse(row.envelope_json) as EventEnvelope;
  }

  readCurrentRevision(slot: string): RevisionRef | null {
    const row = this.#database.prepare(
      "SELECT ref_json FROM current_revisions WHERE slot = ?",
    ).get(slot) as { ref_json: string } | undefined;
    return row === undefined
      ? null
      : JSON.parse(row.ref_json) as RevisionRef;
  }

  readAcceptedCommit(
    idempotencyKey: OpaqueId,
  ): EngineUnitOfWorkCommit | undefined {
    const row = this.#database.prepare(
      "SELECT request_json FROM accepted_commits WHERE idempotency_key = ?",
    ).get(idempotencyKey) as { request_json: string } | undefined;
    return row === undefined
      ? undefined
      : JSON.parse(row.request_json) as EngineUnitOfWorkCommit;
  }

  readReferenceEdges(): readonly ReferenceEdge[] {
    const rows = this.#database.prepare(
      "SELECT source_key, relation, target_key FROM reference_edges ORDER BY source_key, relation, target_key",
    ).all() as {
      source_key: string;
      relation: string;
      target_key: string;
    }[];
    const parseKey = (key: string): RevisionRef => {
      return JSON.parse(key) as RevisionRef;
    };
    return rows.map((row) => ({
      source: parseKey(row.source_key),
      relation: row.relation,
      target: parseKey(row.target_key),
    }));
  }
}
