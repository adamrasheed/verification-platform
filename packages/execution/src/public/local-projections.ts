import { DatabaseSync } from "node:sqlite";
import {
  canonicalize,
  type CanonicalValue,
  type OpaqueId,
  type Rfc3339Utc,
  type Sha256Digest,
} from "@verify-internal/contracts";
import type { DeletionTombstone } from "./retention.js";
import { EvidenceBlobStore } from "./evidence-blob-store.js";

export interface LocalRunProjection {
  readonly invocationId: OpaqueId;
  readonly result: CanonicalValue;
}

export interface LocalCacheMetadata {
  readonly planKey: Sha256Digest;
  readonly originatingExecutionId: OpaqueId;
  readonly byteSize: number;
  readonly createdAt: Rfc3339Utc;
}

export interface LocalEvidenceProjectionInput {
  readonly evidenceId: OpaqueId;
  readonly metadata: CanonicalValue;
  readonly body: CanonicalValue;
}

export interface LocalEvidenceProjection extends LocalEvidenceProjectionInput {
  readonly bodyDigest: Sha256Digest;
}

export class LocalProjectionConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalProjectionConflict";
  }
}

/**
 * Read-model repository for inspect/cache commands. Reads return retained
 * canonical results and cache metadata only; they never invoke evaluators.
 */
export class LocalProjectionRepository {
  readonly #database: DatabaseSync;
  readonly #evidenceBlobs: EvidenceBlobStore | undefined;

  constructor(path: string, evidenceBlobs?: EvidenceBlobStore) {
    this.#database = new DatabaseSync(path);
    this.#evidenceBlobs = evidenceBlobs;
    this.#database.exec("PRAGMA journal_mode = WAL");
    this.#database.exec("PRAGMA busy_timeout = 5000");
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS run_projections (
        invocation_id TEXT PRIMARY KEY,
        result_json TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS cache_metadata (
        plan_key TEXT PRIMARY KEY,
        metadata_json TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS deletion_tombstones (
        revision_key TEXT PRIMARY KEY,
        tombstone_json TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS evidence_projections (
        evidence_id TEXT PRIMARY KEY,
        metadata_json TEXT NOT NULL,
        body_digest TEXT NOT NULL
      ) STRICT;
    `);
  }

  close(): void {
    this.#database.close();
  }

  appendRun(run: LocalRunProjection): void {
    const resultJson = canonicalize(run.result);
    this.#database.prepare(
      "INSERT OR IGNORE INTO run_projections(invocation_id, result_json) VALUES (?, ?)",
    ).run(run.invocationId, resultJson);
    const row = this.#database.prepare(
      "SELECT result_json FROM run_projections WHERE invocation_id = ?",
    ).get(run.invocationId) as { result_json: string };
    if (row.result_json !== resultJson) {
      throw new LocalProjectionConflict(
        `invocation ${run.invocationId} already has a different result`,
      );
    }
  }

  readRun(invocationId: OpaqueId): LocalRunProjection | undefined {
    const row = this.#database.prepare(
      "SELECT result_json FROM run_projections WHERE invocation_id = ?",
    ).get(invocationId) as { result_json: string } | undefined;
    return row === undefined
      ? undefined
      : {
          invocationId,
          result: JSON.parse(row.result_json) as CanonicalValue,
        };
  }

  putCacheMetadata(metadata: LocalCacheMetadata): void {
    const metadataJson = canonicalize(
      metadata as unknown as CanonicalValue,
    );
    this.#database.prepare(
      `INSERT INTO cache_metadata(plan_key, metadata_json) VALUES (?, ?)
       ON CONFLICT(plan_key) DO UPDATE SET metadata_json = excluded.metadata_json`,
    ).run(metadata.planKey, metadataJson);
  }

  readCacheMetadata(planKey: Sha256Digest): LocalCacheMetadata | undefined {
    const row = this.#database.prepare(
      "SELECT metadata_json FROM cache_metadata WHERE plan_key = ?",
    ).get(planKey) as { metadata_json: string } | undefined;
    return row === undefined
      ? undefined
      : JSON.parse(row.metadata_json) as LocalCacheMetadata;
  }

  listCacheMetadata(): readonly LocalCacheMetadata[] {
    const rows = this.#database.prepare(
      "SELECT metadata_json FROM cache_metadata ORDER BY plan_key",
    ).all() as { metadata_json: string }[];
    return rows.map(({ metadata_json }) =>
      JSON.parse(metadata_json) as LocalCacheMetadata
    );
  }

  clearCacheMetadata(): void {
    this.#database.exec("DELETE FROM cache_metadata");
  }

  putTombstone(tombstone: DeletionTombstone): void {
    const key = canonicalize(
      tombstone.ref as unknown as CanonicalValue,
    );
    const value = canonicalize(
      tombstone as unknown as CanonicalValue,
    );
    this.#database.prepare(
      `INSERT INTO deletion_tombstones(revision_key, tombstone_json)
       VALUES (?, ?)
       ON CONFLICT(revision_key) DO UPDATE SET tombstone_json = excluded.tombstone_json`,
    ).run(key, value);
  }

  readTombstone(
    ref: DeletionTombstone["ref"],
  ): DeletionTombstone | undefined {
    const key = canonicalize(ref as unknown as CanonicalValue);
    const row = this.#database.prepare(
      "SELECT tombstone_json FROM deletion_tombstones WHERE revision_key = ?",
    ).get(key) as { tombstone_json: string } | undefined;
    return row === undefined
      ? undefined
      : JSON.parse(row.tombstone_json) as DeletionTombstone;
  }

  async appendEvidence(
    evidence: LocalEvidenceProjectionInput,
    stagingId: string,
  ): Promise<LocalEvidenceProjection> {
    if (this.#evidenceBlobs === undefined) {
      throw new TypeError("Evidence blob store is not configured");
    }
    const metadataJson = canonicalize(evidence.metadata);
    const bodyJson = canonicalize(evidence.body);
    const staged = await this.#evidenceBlobs.stage(
      new TextEncoder().encode(bodyJson),
      stagingId,
    );
    const existing = this.#database.prepare(
      "SELECT metadata_json, body_digest FROM evidence_projections WHERE evidence_id = ?",
    ).get(evidence.evidenceId) as
      | { metadata_json: string; body_digest: Sha256Digest }
      | undefined;
    if (existing !== undefined) {
      await this.#evidenceBlobs.discard(staged);
      if (
        existing.metadata_json !== metadataJson ||
        existing.body_digest !== staged.digest
      ) {
        throw new LocalProjectionConflict(
          `Evidence ${evidence.evidenceId} already has different content`,
        );
      }
      return {
        ...evidence,
        bodyDigest: existing.body_digest,
      };
    }
    await this.#evidenceBlobs.commit(staged);
    this.#database.prepare(
      "INSERT OR IGNORE INTO evidence_projections(evidence_id, metadata_json, body_digest) VALUES (?, ?, ?)",
    ).run(evidence.evidenceId, metadataJson, staged.digest);
    const accepted = this.#database.prepare(
      "SELECT metadata_json, body_digest FROM evidence_projections WHERE evidence_id = ?",
    ).get(evidence.evidenceId) as {
      metadata_json: string;
      body_digest: Sha256Digest;
    };
    if (
      accepted.metadata_json !== metadataJson ||
      accepted.body_digest !== staged.digest
    ) {
      throw new LocalProjectionConflict(
        `Evidence ${evidence.evidenceId} already has different content`,
      );
    }
    return {
      ...evidence,
      bodyDigest: staged.digest,
    };
  }

  async readEvidence(
    evidenceId: OpaqueId,
  ): Promise<LocalEvidenceProjection | undefined> {
    if (this.#evidenceBlobs === undefined) {
      throw new TypeError("Evidence blob store is not configured");
    }
    const row = this.#database.prepare(
      "SELECT metadata_json, body_digest FROM evidence_projections WHERE evidence_id = ?",
    ).get(evidenceId) as
      | { metadata_json: string; body_digest: Sha256Digest }
      | undefined;
    if (row === undefined) return undefined;
    const bytes = await this.#evidenceBlobs.read(row.body_digest);
    return {
      evidenceId,
      metadata: JSON.parse(row.metadata_json) as CanonicalValue,
      body: JSON.parse(new TextDecoder().decode(bytes)) as CanonicalValue,
      bodyDigest: row.body_digest,
    };
  }
}
