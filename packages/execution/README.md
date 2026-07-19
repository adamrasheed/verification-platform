# Execution Package

**Status:** internal, M4
**Owner:** execution-runtime
**Governing clauses:** EDD §§21, 29, 31; ADR-0003

This package owns the local SQLite/WAL `EngineUnitOfWork`, content-addressed
Evidence and cache files, bounded retention decisions, deterministic DAG
scheduling, hierarchical cancellation, and retry decisions. It depends only on
the provider-neutral contracts and events packages.

All time, temporary-name, cancellation, and digest inputs are explicit. Durable
metadata commits are transactional. Evidence and cache payloads are verified
before use; missing or corrupt bytes never support a successful result.
