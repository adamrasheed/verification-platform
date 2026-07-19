# Events Package

**Status:** internal, M1
**Owner:** domain-events
**Governing clauses:** EDD §§21–22; Shared Contracts Event Envelope and
Atomic Persistence Boundary

## Responsibility

Owns the provider-neutral lifecycle event envelope, event registry contract,
and the atomic `EngineUnitOfWork` persistence port. The package does not own a
durable backend. `@verify-internal/events/testing` supplies a deterministic
in-memory implementation for contract and domain-service tests.

## Public entry points

- `@verify-internal/events` — envelope, registry, reference-edge, commit, and
  unit-of-work contracts.
- `@verify-internal/events/testing` — atomic in-memory test store.

## Commit invariants

One commit makes its revision documents, events, and exact reference edges
visible together. Event sequences are consecutive within an invocation.
Repeating the same idempotency identity with the same request returns the
original receipt; reusing it for different content is rejected. Expected
sequence and current-revision predicates are checked before any state changes.

## Dependencies and side effects

The sole production dependency is `@verify-internal/contracts`. Provider SDKs,
frameworks, filesystem access, network access, and ambient clock or randomness
are prohibited. IDs and timestamps enter through commit values.
