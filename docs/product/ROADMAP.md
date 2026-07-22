# Product and Implementation Roadmap

**Status:** Canonical implementation sequence
**Authority:** Planning; architecture is governed by the freeze and EDD
**Owner:** Founding Engineering
**Governing references:** [EDD](../architecture/EDD.md),
[Architecture Freeze](../architecture/ARCHITECTURE_FREEZE.md)

Each task is sized for one focused coding-agent session. A task is complete only
when its expected artifact and acceptance Evidence are committed.

## Epic M0 — Repository Guardrails

**Milestone:** architecture-enforcing workspace ready for package work.

| Task | Work | Dependencies | Expected artifact | Acceptance/test requirement |
|---|---|---|---|---|
| M0-T01 | Create workspace package ownership inventory | EDD | Machine-readable owner/boundary registry | Matches EDD §32; no future package enabled |
| M0-T02 | Add import-boundary and cycle rules | T01 | Valid/invalid dependency fixtures | Reject app reverse edges, cycles, deep imports, provider SDKs in core |
| M0-T03 | Establish schema source/generation convention | T01 | Canary schema and provenance header | Clean generation is byte-identical; hand edits detected |
| M0-T04 | Establish conformance Evidence layout | T01 | Fixture metadata and Evidence index | Missing clause, owner, test ID, or artifact digest fails |
| M0-T05 | Add package-content/release policy | T02 | Synthetic bad-package fixtures | Lifecycle scripts and undeclared files fail |
| M0-T06 | Build frozen-clause compliance skeleton | T04 | Requirement-owner-control matrix | Every MVP `MUST` has a planned control |

## Epic M1 — Contracts and Protocols

**Milestone:** stable constructible domain and command schemas.

| Task | Work | Dependencies | Expected artifact | Acceptance/test requirement |
|---|---|---|---|---|
| M1-T01 | Define bounded primitive/canonical JSON schemas | M0 | `contracts` public schema set | Invalid numbers, Unicode, duplicate keys, unknown keys rejected |
| M1-T02 | Implement canonical codec/digest vectors | T01 | RFC 8785 golden vectors | Cross-runtime bytes and digests match |
| M1-T03 | Define SemanticIdDeriver and ephemeral IDs | T02 | Identity schemas/vectors | Fresh-store, moved-checkout, repeat runs stable |
| M1-T04 | Define revision documents and exact references | T02–03 | Revision schemas | Any sealed change changes revision; envelope metadata does not |
| M1-T05 | Define Application, Capability, Promise, Proof and binding | T04 | Graph schemas and fixtures | No Promise/Proof hash cycle; invalid bindings rejected |
| M1-T06 | Define Evidence, Repair, plan and manifest | T04 | Domain schemas | Secrets/mutable aliases rejected |
| M1-T07 | Define event registry and atomic unit-of-work port | T04 | Event/UoW schemas | Event/object references commit atomically in test store |
| M1-T08 | Define StructuredError registry | T01 | Error codes and retry matrix | Unknown control categories fail incompatible |
| M1-T09 | Define common request/result protocols | T05–08 | Verify/dispatch/publication schemas | Result kinds cannot masquerade as each other |
| M1-T10 | Define JSONL and exit mapping | T09 | Transcript and exit fixtures | One terminal result; stdout purity |
| M1-T11 | Build current/previous compatibility harness | T09–10 | Compatibility matrix | Additive fields work; breaking fixtures fail |

## Epic M2 — Passive Discovery and Model Sealing

**Milestone:** supported repositories produce a sealed Application Model.

| Task | Work | Dependencies | Expected artifact | Acceptance/test requirement |
|---|---|---|---|---|
| M2-T01 | Define discovery plan/budget service | M1 | Plan API and properties | Network/write/process always denied |
| M2-T02 | Build workspace-safe ordinary-file walker | T01 | Walker and hostile fixtures | Stable order; no escape/special file |
| M2-T03 | Add ignore/generated/dependency policy | T02 | Policy fixtures | Repository scope retained |
| M2-T04 | Add bounded structured-data readers | T02 | Parser fixtures | No code/config evaluation |
| M2-T05 | Add npm workspace reader | T04 | Attributed npm signals | Unique in-boundary facts |
| M2-T06 | Add pnpm workspace/lockfile reader | T04 | Attributed pnpm signals | Static deterministic parsing |
| M2-T07 | Add Yarn workspace/lockfile reader | T04 | Attributed Yarn signals | Conflicts retained |
| M2-T08 | Define MVP Proof registry and predicate AST | M1 | Exact Proof revisions | Proof ownership exists before model sealing |
| M2-T09 | Resolve Applications/Capabilities/Promises/bindings | T05–08 | Model candidates | Low-confidence inference never silently required |
| M2-T10 | Validate and seal model atomically | T09 | Golden model revisions | One current revision; exact history traversable |
| M2-T11 | Assemble discovery-to-seal Engine slice | T10 | End-to-end model results | Empty/unknown/supported outcomes exact |

## Epic M3 — First Evidence-Backed Proof

**Milestone:** first end-to-end deterministic Promise result.

| Task | Work | Dependencies | Expected artifact | Acceptance/test requirement |
|---|---|---|---|---|
| M3-T01 | Normalize/classify/redact Evidence candidates | M2 | Evidence pipeline | Secret/path canaries absent |
| M3-T02 | Commit Evidence and capture-attempt edge | T01 | Evidence/UoW integration | Power-loss cannot expose half edge |
| M3-T03 | Add Evidence validation events | T02 | Validator/state tests | Validation never mutates Evidence |
| M3-T04 | Implement manifest structural evaluator | T03 | First pure evaluator | Pass/fail always cites validated Evidence |
| M3-T05 | Implement workspace uniqueness evaluator | T03 | Evaluator fixtures | Ambiguity is deterministic |
| M3-T06 | Implement local dependency evaluator | T03 | Evaluator fixtures | Scope and ordering exact |
| M3-T07 | Implement lockfile ownership evaluator | T03 | Evaluator fixtures | No package-manager execution |
| M3-T08 | Implement effective attempt and Promise aggregation | T04–07 | Property/table tests | Error never becomes violation |
| M3-T09 | Implement invocation aggregation/result digest | T08 | VerifyResult fixtures | Cache-independent comparator passes |
| M3-T10 | Integrate capture/evaluate/report slice | T09 | End-to-end golden runs | Bidirectional Promise→Evidence traversal |

## Epic M4 — Persistence, Cache, and Advisory Repair

**Milestone:** durable local Engine result and machine-readable repair loop.

| Task | Work | Dependencies | Expected artifact | Acceptance/test requirement |
|---|---|---|---|---|
| M4-T01 | Implement local principal/deny-default authorization | M1 | Auth decisions | Workspace cannot self-grant |
| M4-T02 | Implement SQLite EngineUnitOfWork | M3, ADR-0003 | Transactional local store | Fault injection around every write |
| M4-T03 | Implement Evidence blob stage/commit/recovery | T02 | Blob store | Corruption/partial blobs cannot support success |
| M4-T04 | Implement retention/tombstone policy | T02–03 | Retention service | Limits and deleted-reference traversal exact |
| M4-T05 | Implement deterministic DAG/cancellation ports | M1 | Fake-runner scheduler | Random schedules stable; cancellation final |
| M4-T06 | Implement retry state machine | T05 | Attempt history | Only safe `error` retries |
| M4-T07 | Implement cache key/eligibility | T02 | Cache key matrix | Every relevant mutation misses |
| M4-T08 | Implement atomic concurrent cache publication | T07 | Cache store | One winner; corruption safely misses |
| M4-T09 | Implement deterministic Repair generators | M3 | Repair candidates | Exact citations and later Proof plan |
| M4-T10 | Implement Repair lifecycle/verification linking | T09 | Lifecycle events | Only later matching pass verifies |
| M4-T11 | Integrate full 12-stage Engine lifecycle | T01–10 | Canonical Engine result | Every stage and commit boundary observable |

## Epic M5 — CLI and First npm Release

**Milestone:** first credible local CLI release.

| Task | Work | Dependencies | Expected artifact | Acceptance/test requirement |
|---|---|---|---|---|
| M5-T01 | Bind CLI parser to canonical requests | M4 | CLI request adapter | No private semantics |
| M5-T02 | Add JSON and JSONL renderers | T01 | Protocol output | No extra stdout byte |
| M5-T03 | Add human/stderr renderer | T01 | Golden human views | Status/outcome distinct; terminal safe |
| M5-T04 | Add exit/cancellation mapping | T02–03 | Process integration | Exact codes; termination starts ≤1 s |
| M5-T05 | Add inspect/cache commands | T01 | Read-only commands | No reevaluation; cache clear preserves history |
| M5-T06 | Run repository/usefulness corpus | T05 | Golden Evidence bundle | Every MVP Promise and unknown repo covered |
| M5-T07 | Run offline/secret/security gates | T05 | Security Evidence | Zero network and canary leakage |
| M5-T08 | Publish reference performance report | T06 | Benchmark Evidence | EDD §34 budgets pass |
| M5-T09 | Produce release candidate/SBOM/provenance | T06–08 | Exact npm artifact | No lifecycle script; tested bytes promoted |

## Epic M5.5 — Repair Apply and Re-verify

**Milestone:** first machine-readable repair loop.

| Task | Work | Dependencies | Expected artifact | Acceptance/test requirement |
|---|---|---|---|---|
| M55-T01 | **Complete** — define preview/apply canonical command | M5 | Command schemas | Write authority separate from suggestion |
| M55-T02 | **Complete** — implement atomic patch/conflict handling | T01 | Local apply service | No partial write; stale input rejected |
| M55-T03 | **Complete** — link apply event to later verification | T02 | Lifecycle/result integration | Only later pass marks verified |

## Epic M6 — Plugin Platform and First Provider

**Milestone:** first provider plugin after security gates.

| Task | Status | Work | Acceptance/test requirement |
|---|---|---|---|
| M6-T01 | **Complete** | Resolve sandbox, signing/revocation, secret-delivery, and egress selections in ADR-0011 | Missing production controls are explicitly `unavailable`; no degraded claim |
| M6-T02 | **Complete** | Implement signed manifest and Plugin Contract v1 SDK | Strict schema, canonical signature payload, compatibility negotiation |
| M6-T03 | **Complete** | Implement bounded NDJSON runtime coordinator | Handshake, crash, malformed output, flood, deadline, and cancellation fixtures |
| M6-T04 | **Complete** | Implement publisher trust, artifact integrity, and revocation | Tampering and revoked key/artifact fail before launch |
| M6-T05 | **Complete** | Implement Engine-owned typed provider egress broker | DNS, redirect, telemetry, size, schema, secret, response, and audit gates |
| M6-T06 | **In progress** — Linux and macOS production are complete; Windows AppContainer development passes all canaries; Windows signed production is on hold | Implement signed native sandbox hosts | Linux namespaces+seccomp, macOS App Sandbox, Windows AppContainer canaries |
| M6-T07 | **Linux and macOS complete; Windows development complete; Windows signed production is on hold** | Pass three synthetic providers with different auth, latency, and error behavior | Same plugins must pass again through each production native host |
| M6-T08 | **Complete** | Separate plugin developer and user-authorization onboarding | Installation, trust, authorization, and unavailable state are distinct |
| M6-T09 | **Implemented, unreleased** — strict read-only GitHub policy observation passes offline and Linux/macOS native conformance; publication remains gated on M6-T06 and T07 | Pilot read-only repository-policy provider | No provider release before M6-T06 and T07 pass |

## Epic M7 — First Integrations

**Milestone:** local MCP and GitHub Action produce canonical-equivalent results.

| Task | Status | Work | Acceptance/test requirement |
|---|---|---|---|
| M7-T01 | **Complete** | Create shared adapter parity harness from CLI golden fixtures | CLI, MCP, and Action preserve the same Engine semantic result |
| M7-T02 | **Complete** | Bind local MCP to one explicit workspace | Cross-root and malformed requests fail closed without path disclosure |
| M7-T03 | **Complete** | Implement canonical verification and retained reads | Verify, run, event, Evidence, and exact-provenance responses remain canonical and bounded |
| M7-T04 | **Complete** | Propagate MCP deadline, progress, and cancellation | Standard MCP cancellation reaches the Engine and cannot yield a verdict |
| M7-T05 | **Complete** | Implement GitHub Action adapter | Canonical offline Engine runs inside the existing workflow checkout |
| M7-T06 | **Complete** | Implement minimal GitHub check projector | Exact conclusion mapping and metadata allowlist; no source annotations |
| M7-T07 | **Complete** | Run integration security fixtures | Hostile text, workspace confusion, missing/read-only token, and fixed egress pass |
| M7-T08 | **Complete** | Publish adapter compatibility matrix | Version selections, parity fields, volatile differences, and deferred surfaces documented |

There is no remote dispatch, GitHub App, cloud, Repair mutation, or Windows
production dependency in M7.

## Epic M8 — Metadata Cloud and Hosted Verification

**Milestone:** first hosted verification through a customer-controlled workload.

| Task | Status | Work | Acceptance/test requirement |
|---|---|---|---|
| M8-T01 | **Complete** | Add `cloud-client` publication, disclosure, and policy schemas | Closed schemas reject unknown fields and tenant-mismatched references |
| M8-T02 | **Complete** | Resolve and implement publication-identifier lifecycle and durable Engine mapping | ADR-0012; keyed tenant/object separation, restart persistence, atomic rollback, and collision failure |
| M8-T03 | **Complete** | Implement disclosure manifest and exact-byte comparison | Canonical bytes, field inventory, destination, retention, expiry, and approved digest remain bound |
| M8-T04 | **Contract foundation complete** — closed service deployment remains pending D-002 | Define cloud identity, exact action, tenant, and resource boundaries | Canonical ten-action catalog; cross-tenant/IDOR resources remain indistinguishable and deny-default |
| M8-T05 | **Contract foundation complete** — service deployment remains pending D-002 | Implement short-lived publication intents | Five-minute signed audience; exact tenant, project, purpose, manifest, limits, policy, nonce, and expiry bound |
| M8-T06 | **Contract foundation complete** — durable cloud store remains pending D-002 | Implement allowlist ingestion and idempotency | Hostile input bounded; same key/different bytes and nonce replay conflict atomically |
| M8-T07 | **Contract foundation complete** — PostgreSQL adapter remains pending D-002 | Persist immutable run projections | Exact validated projection retained; no verdict recalculation or raw local revision disclosure |
| M8-T08 | **Contract foundation complete** | Distribute signed tenant policies | Exact canonical bytes, tenant, signature, issue, and expiry validated |
| M8-T09 | **Contract foundation complete** — queue adapter remains pending D-002 | Implement transactional outbox/projection workers | Source fact and outbox commit together; stable event identity, fenced lease, and idempotent acknowledgement |
| M8-T10 | **Contract foundation complete** — production retention/backup propagation remains pending D-002 | Implement retention, deletion, and tombstones | Atomic active deletion, digest-free tombstone, deletion event, and restore-time gate pass |
| M8-T11 | **Contract foundation complete** — service deployment remains pending D-002 | Implement bounded read APIs and pagination | Stable ordering, opaque expiring cursors, bounded limits, and exact tenant/project scope pass |
| M8-T12 | Pending | Run cross-tenant negative matrix | API, store, cache, queue, backup, and migration isolation pass |
| M8-T13 | Pending | Run cloud canary and secondary-sink inventory | Source, secret, and tenant canaries absent from every unauthorized sink |
| M8-T14 | Pending | Publish metadata-cloud release Evidence | SLO, DR, security, supply-chain, and exact artifact evidence retained |

Product-hosted source remains excluded. Provider-specific deployment does not
begin until D-002 and the remaining hosted entry decisions are recorded.

## Critical Path Checkpoints

1. **First local CLI proof:** M0 → M1 → M2 → M3-T04 → M3-T08–10 → M5-T01–04.
2. **First provider plugin:** M6 sandbox/signing/broker → synthetic providers →
   GitHub policy plugin.
3. **First end-to-end result:** M3-T10.
4. **First machine-readable repair loop:** M4-T09–10 → M5.5.
5. **First npm release:** M5-T09.
6. **First GitHub integration:** M7 GitHub Action.
7. **First hosted verification:** M8 customer workload dispatch and publication.
