# ADR-0002: Monorepo Package Boundaries

**Status:** accepted
**Date:** 2026-07-18
**Owner:** Lead Architect

## Context

The Engine, contracts, adapters, plugins, and optional cloud need independent
release and dependency boundaries without circular ownership.

## Decision

Use a TypeScript monorepo organized under `packages/`, `apps/`, and `tooling/`.
Package responsibilities and allowed dependencies are those frozen in
`SHARED_CONTRACTS.md`. Applications depend on packages; packages never depend
on applications. Provider SDKs enter only provider plugin packages.

## Alternatives considered

- One package and one CLI application.
- Services first, each in a separate repository.
- Framework-oriented packages.

## Tradeoffs

More package metadata and boundary tooling are required before feature work.
The gain is enforceable ownership, smaller compatibility surfaces, and provider
neutrality.

## Consequences

Cycles and forbidden imports block CI. MVP creates only packages required for
passive local verification; future directories are not speculative scaffolding.

## Domain impact

No domain semantics change.

## Security and privacy impact

Network, provider, process, and adapter dependencies can be statically excluded
from offline core packages.

## Compatibility and migration

Public schemas version independently of package release versions.

## Conformance changes

Add architecture dependency tests and package export-surface fixtures.

## Rollback strategy

Packages may be merged only if public contracts and forbidden dependencies
remain unchanged.

## Reconsideration triggers

Measured package overhead prevents releases or a package lacks an independent
responsibility after two milestones.

## Approval

Accepted by Lead Architect.
