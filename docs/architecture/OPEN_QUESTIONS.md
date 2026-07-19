# Open Questions

**Status:** Controlled decision register
**Authority:** Non-normative until resolved by the named mechanism
**Owner:** Lead Architect
**Governing reference:** [ARCHITECTURE_FREEZE.md](ARCHITECTURE_FREEZE.md)

This file contains only decisions that can remain open without making the EDD
unimplementable. Implementation questions are resolved in the EDD. Architecture
changes use ADRs. Business decisions remain founder-owned.

## Founder decisions

| ID | Decision | Why it remains open | Needed by | Default if unanswered |
|---|---|---|---|---|
| F-003 | Pricing model and included hosted allowance | Multiple credible models affect go-to-market and margins | Hosted beta | Meter usage without charging |

## Resolved founder decisions

| ID | Resolution | Resolved |
|---|---|---|
| F-001 | Publish the local CLI as `@adamrasheed/verify`; retain `verify` as the executable command | 2026-07-18 |
| F-002 | License the repository and public CLI under Apache-2.0; commercial hosted packaging remains independently founder-owned | 2026-07-18 |

## Deferred architecture selections

| ID | Decision | Frozen constraint | Reconsideration trigger |
|---|---|---|---|
| D-002 | Cloud vendor, primary region, and managed service products | Logical cloud contracts, tenant isolation, encryption, and deletion semantics do not change | Before hosted implementation |
| D-003 | Evidence attestation wire format | Evidence remains immutable and provenance-bearing; a digest is not independent truth | Before third-party attestation exchange |
| D-004 | Per-record local encryption | Local permissions and platform storage encryption are the Phase 1 baseline | Enterprise local threat model requires stronger protection |

## Resolved architecture selections

| ID | Resolution | Mechanism | Resolved |
|---|---|---|---|
| D-001 | Dynamic plugins require a signed native sandbox host: Linux namespaces+seccomp, macOS App Sandbox, or Windows AppContainer. A missing host is `unavailable`; deprecated Seatbelt and Node permissions are not treated as malicious-code isolation. Publisher trust uses digest-pinned Ed25519 manifests and revocation. Provider secrets are attached only inside the Engine egress broker. | [ADR-0011](ADR/0011-plugin-security-enforcement.md) | 2026-07-19 |

## Resolution rules

- A resolved founder decision updates the relevant product and packaging docs.
- A deferred selection that changes a frozen boundary requires an ADR.
- A selection that only chooses an implementation satisfying frozen contracts is
  recorded in the EDD or deployment runbook.
- No open item may be represented as already guaranteed.
