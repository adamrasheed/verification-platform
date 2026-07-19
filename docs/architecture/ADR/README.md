# Architecture Decision Records

**Status:** Active process
**Authority:** Amendment workflow
**Owner:** Lead Architect
**Governing reference:** [ARCHITECTURE_FREEZE.md](../ARCHITECTURE_FREEZE.md)

ADRs are the only mechanism for changing a frozen architectural decision.

## Statuses

`proposed` → `accepted` → `superseded` or `rejected`

Only accepted ADRs may authorize a freeze update. The freeze must be updated in
the same change; readers are never required to merge conflicting authorities.

## Naming

Use `NNNN-short-kebab-case-title.md`. Numbers increase monotonically and are
never reused.

## Required template

```markdown
# ADR-NNNN: Title

**Status:** proposed
**Date:** YYYY-MM-DD
**Owner:** Name or role

## Context
## Frozen clauses affected
## Decision
## Alternatives considered
## Tradeoffs
## Consequences
## Domain impact
## Security and privacy impact
## Compatibility and migration
## Conformance changes
## Rollback strategy
## Reconsideration triggers
## Approval
```

Provider-specific needs must demonstrate a provider-neutral missing abstraction
with at least two independent implementations before changing core.
