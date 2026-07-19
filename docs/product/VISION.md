# Product Vision

**Status:** Active product direction
**Authority:** Product intent; not architecture
**Owner:** Founding Team
**Governing reference:** [ARCHITECTURE_FREEZE.md](../architecture/ARCHITECTURE_FREEZE.md)

## Mission

Build the verification infrastructure for modern software.

As software creation becomes increasingly automated, developers need
deterministic proof that applications fulfill their promises. The platform
turns application claims into machine-readable Promises, evaluates them through
Proofs, retains the Evidence, and derives verifiable Repair suggestions.

## Long-term position

The product becomes shared infrastructure across local development, agents,
code review, and organizational policy. The CLI remains the canonical public
interface, while every other surface uses the same engine and contracts.

The platform earns trust by being:

- local-first and useful with zero configuration;
- deterministic where determinism is possible;
- explicit about observational uncertainty;
- provider-neutral and extensible;
- machine-readable for humans, tools, and models;
- secure by default, with source and secrets remaining local.

## Product boundary

The platform orchestrates and proves. It does not replace CI, observability,
deployment, testing, monitoring, logging, or development environments.
