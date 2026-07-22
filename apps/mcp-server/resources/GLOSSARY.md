# Glossary

**Status:** Canonical terminology index
**Authority:** Index; the freeze controls on conflict
**Owner:** Lead Architect
**Governing reference:** [ARCHITECTURE_FREEZE.md](ARCHITECTURE_FREEZE.md)

## Core terms

**Application Model**
The sole domain model: a sealed, versioned graph of Applications, Capabilities,
Promises, Proof definitions, Evidence requirements, Provider bindings, Repair
Knowledge references, policy, configuration, and provenance.

**Capability**
A provider-neutral behavior or responsibility an Application possesses or
depends upon.

**Promise**
A declarative, testable claim an Application makes. Status is derived from the
effective executions of its required Proofs.

**Proof**
A versioned verifier definition and its immutable executions. A Proof evaluates
validated Evidence against a Promise predicate.

**Promise-Proof binding**
An immutable association revision linking one exact Promise revision to one
exact Proof revision within a sealed Application Model. Promise and Proof
payloads do not hash-reference each other.

**Evidence**
An immutable factual observation with provenance, sensitivity classification,
content identity, and chain-of-custody metadata.

**Repair**
An immutable, advisory suggestion derived from a failed or indeterminate Proof
execution and its Evidence. A later passing Proof must verify it.

**Repair Knowledge**
Versioned rules, mappings, templates, and optional prompts used to produce
Repair candidates. It is an input, not Evidence or authority.

**Provider binding**
A provider-neutral link from a Capability or Proof to an exact plugin revision
and a non-secret Authentication binding.

## Result terms

**Satisfied** — All required applicable Proofs selected by the invocation passed
against the same Application Model revision and execution context.

**Violated** — At least one required applicable Proof failed.

**Indeterminate** — Available valid Evidence cannot decide the claim.

**Not evaluated** — No required applicable Promise had effective Proof coverage.

**Operational status** — `completed`, `invalid`, `blocked`, `cancelled`, or
`internal_error`; distinct from verification outcome.

**Reproducibility class** — `hermetic`, `replayable`, or `observational`.

## Platform terms

**Engine**
The sole semantic authority for discovery orchestration, model construction,
planning, policy, execution, Evidence evaluation, aggregation, caching, audit,
and result serialization.

**Adapter**
A transport or presentation interface that invokes the canonical dispatcher
without reimplementing semantics.

**Plugin**
An out-of-process extension connected through the versioned Plugin Contract.

**Projection**
A derived view of authoritative model history.

**Cloud Boundary**
The disclosure and authorization boundary between the local engine and product
cloud.

**ADR**
The only mechanism that may amend a frozen architectural decision after Lead
Architect acceptance and incorporation into the freeze.
