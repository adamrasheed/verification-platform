# Architecture Consistency Report

**Status:** PASS for first public local CLI implementation
**Date:** 2026-07-18
**Owner:** Lead Architect
**Reviewed artifacts:** Architecture Freeze, EDD, Glossary, Shared Contracts,
Open Questions, ADR-0001 through ADR-0010, Product docs, drafts 01–09, and
cross-reviews

## Audit Method

Nine bounded domain drafts were cross-reviewed by Security, Core Engine,
Developer Experience, Operations, and the Architecture Red Team. Findings were
classified Blocking, Major, Minor, or Deferred. Canonical documents were then
reconciled rather than concatenated.

## Blocking Findings and Resolution

| Finding | Resolution | Canonical location |
|---|---|---|
| Promise and Proof exact hashes formed a construction cycle | Added immutable `PromiseProofBinding`; removed endpoint reverse references | Freeze §5.4.1, ADR-0010, EDD §§6/9/10 |
| Semantic/random identity and attempt digests broke determinism | Split semantic/ephemeral ID sources, result/attempt digests, and comparison modes | Shared Contracts, EDD §§6/11 |
| Separate persistence ports could expose half lifecycle commits | Added atomic `EngineUnitOfWork` and twelve commit units | Shared Contracts, ADR-0003, EDD §§21/22 |
| Remote verify conflated dispatch and publication | Split five result kinds and separate cancellation acknowledgements | Shared Contracts, ADR-0007, EDD §§16–18/23 |
| Cloud draft stored fields outside upload allowlist | Restricted schemas and physical tables to literal Freeze §11.3 fields | EDD §§19/21/26 |
| Dynamic plugin isolation/egress/signing unresolved | Plugin-free MVP; plugin milestone gated; Engine egress broker selected | ADR-0004, EDD §§13/27/37 |
| Product-hosted source crossed Cloud Boundary | Customer-controlled workload first; product-hosted source prohibited | ADR-0008, EDD §§19/20/37 |

All blocking findings are resolved for the first public local CLI. Deferred
features are unavailable until their named gates pass; documentation does not
claim otherwise.

## Required Consistency Checks

| Check | Result | Evidence |
|---|---|---|
| Terminology consistent | Pass | Glossary mirrors freeze; binding term added |
| Interfaces match diagrams | Pass | Local/remote/GitHub sequences use distinct result kinds |
| Interfaces match schemas | Pass | Shared Contracts owns request/result/event conventions |
| Database entities match event payloads | Pass | EDD ERD uses publication and dispatch resources; local uses UoW |
| CLI/MCP/GitHub/REST concepts compatible | Pass | All consume canonical result or pure published projection |
| Package dependencies acyclic | Pass by design | EDD §32 and Shared Contracts; static gate M0-T02 required |
| Local/cloud boundaries unambiguous | Pass | Literal publication allowlist and customer-workload topology |
| Security guarantees enforceable | Pass for MVP | No dynamic code/network/secrets; later features gated |
| MVP matches roadmap | Pass | ADR-0006, EDD §36, Roadmap M0–M5 |
| Every EDD component defined | Pass | Forty required chapters and owned contracts present |
| Unresolved implementation markers absent | Pass | Open items are explicit in OPEN_QUESTIONS |

## Contract Coverage

The EDD defines implementable TypeScript contracts for `ApplicationModel`,
`Capability`, `PromiseDefinition`, `ProofDefinition`, `ProofExecution`,
`ProofResult`, `Evidence`, `RepairSuggestion`, `ProviderPlugin`,
`DiscoveryResult`, `EventEnvelope`, `StructuredError`, `ExecutionContext`, and
`SecretReference`.

It also defines lifecycle states, error categories/codes, confidence semantics,
Evidence integrity, plugin compatibility, schema versioning, cancellation,
retry, timeout, redaction, publication, and deletion behavior.

## Major Finding Dispositions

- Proof registry and bindings moved before Promise activation/model sealing.
- MVP plugin dead ends and malformed-plugin gates removed.
- Provider developer onboarding and user authorization are separate.
- Effective permission consent shows post-policy grants, not manifest maxima.
- Permission retry distinguishes `policy_required` from hard denial.
- Initial GitHub provider narrowed to repository-policy configuration.
- Plugin discovery uses `local-restricted`, not `passive-engine`.
- ADR-0003 is an entry gate for production local persistence.
- Numeric local limits and retention defaults are selected in EDD §31.
- Repair apply/re-verify restored before plugin work in the roadmap.
- Cache ownership is `execution`; package README now matches the registry.

## Deferred Decisions

Founder input remains necessary only for product/npm naming, public license and
commercial packaging, and pricing/hosted allowance. Cloud vendor/region and
optional local encryption remain feature gates documented in
`OPEN_QUESTIONS.md`; the OS sandbox and publication-key lifecycle selections
have since been resolved by ADR-0011 and ADR-0012.

None blocks M0–M5.

## Conclusion

The architecture is internally consistent and implementation-ready for the
first public local CLI. Later plugin, cloud, and hosted capabilities are
architecturally described but must not ship until their explicit security and
business gates are closed with retained Evidence.
