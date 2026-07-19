# ADR-0001: Canonical Engine and Interface Projections

**Status:** accepted
**Date:** 2026-07-18
**Owner:** Lead Architect

## Context

CLI, MCP, GitHub, REST, editors, and cloud must share semantics without forcing
every adapter to spawn the CLI binary or allowing an adapter to recompute a
verdict.

## Decision

The Engine and versioned command dispatcher are the sole semantic authority.
The CLI is the canonical public adapter and JSON conformance oracle. Other
interfaces invoke the same dispatcher or consume a pure, versioned projection
of its retained result.

## Alternatives considered

- Make every adapter shell out to the CLI.
- Let each adapter call domain services directly.
- Define separate interface-specific verification APIs.

## Tradeoffs

The dispatcher and projector schemas become critical shared infrastructure and
require strict parity fixtures. Adapters gain less presentation freedom.

## Consequences

Domain evaluation exists once. Human text is not a machine contract. Remote
privacy-reduced projections cannot call themselves full local results.

## Domain impact

None; this preserves the frozen Application Model authority.

## Security and privacy impact

All adapters pass the same policy, redaction, authorization, and audit gates.

## Compatibility and migration

Dispatcher, JSON, event, and adapter transport versions remain independently
identifiable.

## Conformance changes

Every adapter must pass canonical request/result or deterministic projection
fixtures.

## Rollback strategy

Remove a non-conforming adapter; do not fork Engine semantics.

## Reconsideration triggers

Only if a supported environment cannot host or reach the dispatcher without
violating the Cloud Boundary.

## Approval

Accepted by Lead Architect.
