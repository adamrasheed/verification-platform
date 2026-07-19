# ADR-0010: Promise-Proof Binding and Revision Graph

**Status:** accepted
**Date:** 2026-07-18
**Owner:** Lead Architect

## Context

The original freeze required Promise revisions to hash exact Proof revisions and
Proof revisions to hash exact Promise revisions. Because each digest depended on
the other digest, the content-addressed graph could not be constructed. A
similar reverse edge was possible between Proof and Provider binding.

## Decision

Introduce immutable `PromiseProofBinding` revisions. Each binding references one
exact Promise revision and one exact Proof revision and declares requirement,
order, applicability, scope, and provenance. The Application Model seals the
binding revisions. Promise and Proof payloads contain no exact references to
each other.

Provider binding selection is also owned by the Application Model; Proof
payloads contain no reverse exact Provider-binding reference.

## Alternatives considered

- Keep only Promise → Proof references.
- Keep only Proof → Promise references.
- Exclude one side from its revision preimage.
- Use mutable `latest` references.
- Iterate hashes toward a supposed fixed point.

## Tradeoffs

The model gains one object type and validation path. It becomes constructible,
exactly traversable, and able to change associations without rewriting either
endpoint.

## Consequences

Planning derives required Proofs exclusively from bindings in the same sealed
Application Model. Missing, duplicate, dangling, cross-scope, or
dependency-cyclic bindings invalidate the model.

## Domain impact

This amends Architecture Freeze §§5.1, 5.4, 5.5, and 5.10 without changing the
meaning of Promise or Proof.

## Security and privacy impact

Bindings contain no secrets or provider-specific semantics.

## Compatibility and migration

No implementation or persisted data exists. Protocol v1 launches with the
binding object; no legacy wire migration is required.

## Conformance changes

Add construction, exact traversal, association revision, duplicate, dangling,
scope, dependency-cycle, and Provider reverse-edge fixtures.

## Rollback strategy

None after stable schemas publish; reverting would restore an unconstructible
graph.

## Reconsideration triggers

A different immutable association representation proves simpler while retaining
exact revisions and bidirectional traversal.

## Approval

Accepted by Lead Architect and incorporated into the Architecture Freeze.
