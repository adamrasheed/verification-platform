# ADR-0005: Cloud Persistence and Queue Semantics

**Status:** accepted
**Date:** 2026-07-18
**Owner:** Lead Architect

## Context

Optional cloud history, policy, publication, and remote workload coordination
need durable tenant-isolated state and recoverable asynchronous processing.

## Decision

Use a PostgreSQL-compatible logical database for tenant metadata, immutable
events, idempotency, usage ledger, and transactional outbox. Use object storage
only for explicitly authorized payloads. Async work is at-least-once with
transactional admission, fenced leases, heartbeat, bounded attempts, and
idempotent finalization. A queue delivery is not a Proof execution.

## Alternatives considered

- Event streaming system as primary database.
- Exactly-once queue claims.
- Object-store-only persistence.
- One database per tenant by default.

## Tradeoffs

The outbox and lease reconciler add operational complexity. They avoid
distributed transactions and false exactly-once guarantees.

## Consequences

All tenant queries include tenant scope. Workers cannot finalize with stale
fences. Dead letters retain sanitized metadata only. Publication and local
verification remain separate outcomes.

## Domain impact

Cloud rows project immutable domain history; they do not become a second model.

## Security and privacy impact

Default storage receives allowlisted minimal metadata only. Source-bearing
hosted execution remains prohibited by ADR-0008.

## Compatibility and migration

Expand/migrate/contract database changes support rolling deployment. Events are
upcast only through explicit versioned migrations.

## Conformance changes

Duplicate delivery, stale lease, cancellation race, outbox recovery,
cross-tenant, deletion propagation, backup restore, and idempotency tests are
required.

## Rollback strategy

Roll back application readers while leaving additive schema in place; destructive
contract steps require completion Evidence first.

## Reconsideration triggers

Measured scale exceeds PostgreSQL or the queue abstraction while preserving the
same logical contracts.

## Approval

Accepted by Lead Architect.
