# Contracts Package

**Status:** internal, M1
**Owner:** domain-contracts
**Governing clauses:** Architecture Freeze §5; Shared Contracts

## Responsibility

Owns provider-neutral domain types, source schemas, exact identity primitives,
canonical encoding contracts, and generated public bindings.

## Public entry point

`@verify-internal/contracts`

The entry point exports runtime-neutral semantic identity and revision
derivation, exact local and published references, Application Model graph
objects and validation, immutable Evidence and advisory Repair, and immutable
execution plan and manifest contracts.

## Dependencies

Permitted production dependencies: none. Prohibited: filesystem, network,
process globals, provider SDKs, framework types, and all other workspace
packages.

## Data and side effects

Types cover every classification. Runtime modules are deterministic and perform
no I/O or ambient clock/randomness access.
Hashing and ephemeral-ID factories are injected by callers. Ephemeral
invocation, attempt, event, transport, and storage IDs never enter semantic
identity or revision derivation inputs.

## Compatibility and acceptance

Schema owner: domain-contracts. Applicable gates begin with M1-T01,
MVP-MODEL-001, and MVP-MODEL-002. Generated artifacts are never hand-edited.
