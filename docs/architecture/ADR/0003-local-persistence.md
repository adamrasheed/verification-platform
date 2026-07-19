# ADR-0003: Local Persistence

**Status:** accepted
**Date:** 2026-07-18
**Owner:** Lead Architect

## Context

Runs, lifecycle events, Evidence metadata, publication mappings, and cache
provenance need crash-safe local retention without requiring cloud.

## Decision

Use an Engine-owned SQLite database in WAL mode for authoritative local metadata
and append events. Store permitted Evidence bodies as content-addressed files
beside it with atomic rename and integrity verification. Keep cache entries in a
separate bounded directory owned by `execution`. Raw source is not retained as
Evidence by default.

## Alternatives considered

- JSON files only.
- Embedded key-value database.
- Cloud-only persistence.
- Store all Evidence in SQLite blobs.

## Tradeoffs

SQLite adds native distribution and migration work. Separate blob storage
requires transactional staging and orphan reconciliation.

## Consequences

Metadata append and event sequencing are transactional. Blob commits use
stage-digest-commit; missing or corrupt blobs cannot support success. Cache
clear does not delete authoritative run history.

## Domain impact

Persisted schemas remain contract-owned; SQLite is not domain authority.

## Security and privacy impact

Least-privilege filesystem permissions and platform storage encryption are the
MVP baseline. Stronger per-record encryption remains D-004.

## Compatibility and migration

Forward-only schema migrations are transactional, backed up, and tested against
the previous supported format.

## Conformance changes

Crash, corruption, concurrent writer, migration, retention, tombstone, and
orphan-blob fixtures are required.

## Rollback strategy

Restore the pre-migration backup with the prior Engine; never downgrade in
place.

## Reconsideration triggers

SQLite cannot meet supported-platform packaging or measured concurrency needs.

## Approval

Accepted by Lead Architect.
