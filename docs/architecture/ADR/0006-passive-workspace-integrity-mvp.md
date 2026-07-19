# ADR-0006: Passive Workspace-Integrity MVP

**Status:** accepted
**Date:** 2026-07-18
**Owner:** Lead Architect

## Context

The fastest credible release must prove the domain and Evidence model without
cloud, credentials, repository execution, or an unsafe plugin runtime.

## Decision

The first npm release is a local CLI for JavaScript and TypeScript repositories.
It passively verifies dependency and workspace declaration integrity across
recognized npm, pnpm, and Yarn manifests and lockfile ownership scopes.

It ships no dynamic plugins, provider credentials, cloud, MCP, GitHub, hosted
workers, LLM, or Repair application. Repairs are deterministic advisory
suggestions only.

## Alternatives considered

- Execute build, typecheck, and test commands.
- Ship GitHub as the first required provider.
- Build cloud history before local release.
- Support multiple language ecosystems.

## Tradeoffs

The MVP proves a narrow class of static promises rather than runtime behavior.
It substantially lowers security, reproducibility, and schedule risk.

## Consequences

The full Promise→Proof→Evidence→Repair loop can ship offline. The next external
provider pilot is read-only GitHub repository-policy configuration after the
plugin security gates.

## Domain impact

No semantic shortcut is permitted; the narrow MVP uses the complete model.

## Security and privacy impact

Default discovery remains passive, read-only, bounded, and network-free.

## Compatibility and migration

MVP schemas are production contracts and cannot be replaced by provider-specific
versions later.

## Conformance changes

Fixtures cover empty, malformed, monorepo, conflicting lockfile, symlink,
unsupported, huge, offline, deterministic, and repair-verification cases.

## Rollback strategy

Disable a faulty predicate while retaining its historical revisions and results.

## Reconsideration triggers

User research demonstrates the passive promises have insufficient value before
public release and a comparably safe deterministic alternative exists.

## Approval

Accepted by Lead Architect.
