# Architecture Documentation

**Status:** Active index
**Authority:** Navigation and governance
**Owner:** Lead Architect
**Governing reference:** [ARCHITECTURE_FREEZE.md](ARCHITECTURE_FREEZE.md)

## Authority map

1. [Architecture Freeze](ARCHITECTURE_FREEZE.md) — sole normative source for
   frozen architecture, domain semantics, security boundaries, and compatibility
   commitments.
2. [Engineering Design Document](EDD.md) — reconciled implementation design
   subordinate to the freeze.
3. [Shared Contracts](SHARED_CONTRACTS.md) — registry for machine encodings of
   semantics already established by the freeze.
4. [Accepted ADRs](ADR/README.md) — decision history; an ADR changes current
   architecture only after its decision is incorporated into the freeze.
5. [Glossary](GLOSSARY.md) — terminology index.
6. [Open Questions](OPEN_QUESTIONS.md) — controlled deferred decisions.
7. [Diagrams](diagrams/README.md) — non-normative projections.

Product and research documents are non-normative with respect to architecture.
Code does not become architectural authority merely because it ships.

## Document rule

Architecture documents must identify status, authority, owner, and governing
references. Duplicated contract schemas are prohibited; generated types and
examples must trace to one versioned contract source.
