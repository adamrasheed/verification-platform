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

Tasks: accept sandbox/signing/secret-delivery selections; implement manifest and
NDJSON runtime; implement Engine egress broker; pass three synthetic providers;
ship separate developer/user onboarding; then pilot read-only GitHub
repository-policy observations. Each task requires crash, cancellation, DNS,
redirect, telemetry, secret, revocation, and permission fixtures.

## Epic M7 — First Integrations

**Milestone:** local MCP and GitHub Action produce canonical-equivalent results.

Tasks: local MCP tools/resources; MCP cancellation; GitHub Action adapter;
minimal check projector; interface parity matrix. No remote dispatch dependency.

## Epic M8 — Metadata Cloud and Hosted Verification

**Milestone:** first hosted verification through a customer-controlled workload.

Tasks: cloud schemas with literal allowlist; tenant/auth matrix; PostgreSQL and
outbox; dispatch/idempotency/fenced lease; workload acknowledgement/cancellation;
publication preview/projection; deletion/retention; SLO/DR/security gates.
Product-hosted source is excluded.

## Critical Path Checkpoints

1. **First local CLI proof:** M0 → M1 → M2 → M3-T04 → M3-T08–10 → M5-T01–04.
2. **First provider plugin:** M6 sandbox/signing/broker → synthetic providers →
   GitHub policy plugin.
3. **First end-to-end result:** M3-T10.
4. **First machine-readable repair loop:** M4-T09–10 → M5.5.
5. **First npm release:** M5-T09.
6. **First GitHub integration:** M7 GitHub Action.
7. **First hosted verification:** M8 customer workload dispatch and publication.
