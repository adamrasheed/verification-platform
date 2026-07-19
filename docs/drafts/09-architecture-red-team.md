# Architecture Red Team

**Status:** Bounded adversarial review for EDD reconciliation
**Owner:** Architecture Red Team
**Reviewed:** Architecture Freeze, Glossary, Shared Contracts, Open Questions,
Product Vision, Positioning, Roadmap, drafts 01–08, and both cross-domain reviews
**Scope:** Terminology, domain semantics, interfaces, diagrams and flows,
persistence and events, local/cloud/security boundaries, package cycles,
MVP/roadmap alignment, cost/reliability, and implementability
**Authority:** Review only; this draft does not amend frozen concepts or edit
canonical files

## 1. Disposition

The local-first product direction is coherent and the passive JavaScript/
TypeScript MVP is viable. The package decomposition is mostly acyclic, the
provider boundary is strong, operational uncertainty is consistently separated
from verification failure, and the Cloud Boundary is intentionally narrow.

The EDD is not ready to reconcile or implement unchanged. Five Blocking
findings remain:

1. the proposed Promise/Proof exact-revision graph contains an impossible
   content-addressed cycle;
2. the proposed identity and digest rules make cache-state and repeated-run
   determinism impossible as written;
3. the persistence ports cannot atomically commit the multi-record units the
   lifecycle requires;
4. remote integrations advertise a full canonical result while the Cloud
   Boundary permits only a reduced publication projection; and
5. the proposed cloud projection persists fields outside the frozen default
   upload allowlist.

The first finding is already present in the frozen clauses and requires a
freeze-amending ADR. The other Blocking findings can be resolved within the
frozen architecture unless resolution chooses to broaden a frozen boundary.

## 2. Blocking findings

### ART-B-001 — The exact-revision Promise/Proof graph is not constructible

**Affected:** Freeze §§5.2, 5.4, 5.5; Core §§4.2, 5.5, 6.1; Repository
M1-T04 and M2-T10

`PromisePayload.requiredProofs` contains exact Proof revision references while
`ProofPayload.supportedPromises` contains exact Promise revision references.
Both revisions hash every sealed field, including their exact references.
Constructing either digest therefore requires the other digest to exist first.
This is a cryptographic reference cycle, not an ordinary graph cycle that a
topological validator can reject or tolerate.

The freeze itself requires both directions to be declared and also requires all
sealed references to target exact revisions. No implementation can satisfy all
three requirements simultaneously through ordinary content addressing.

The Core draft introduces a second avoidable cycle:
`ProofPayload.providerBinding` points to an exact Provider binding revision and
`ProviderBindingPayload.target` may point back to the exact Proof revision.

**Required resolution text:**

> Promise-to-Proof applicability is represented by an immutable
> `PromiseProofBinding` revision. The binding references one exact Promise
> revision and one exact Proof revision and declares the support relationship,
> requirement order, and applicability scope. Promise and Proof revision
> payloads do not contain exact references to each other. An Application Model
> revision contains the exact binding revisions. Planning derives each
> Promise's required Proof set only from bindings sealed in that same
> Application Model revision. A missing, duplicate, cross-scope, or cyclic
> dependency binding invalidates the model.

The exact name may change, but the association must be a separately hashable
object or one direction must cease to be part of the sealed revision preimage.
Merely computing one digest later, using `latest`, using a version range, or
iterating hashes to a “fixed point” is invalid.

For Provider bindings, remove `providerBinding` from the sealed Proof payload.
The Provider binding and Application Model already provide the association.
Core can select an exact binding from the sealed model without a reverse
content-addressed edge.

**ADR need:** Required. Amend Freeze §§5.4–5.5 and the common exact-reference
rule to define the association representation while preserving exact historical
traversal. Add the new object to the domain kind registry, Application Model,
schemas, provenance invariants, compatibility policy, and conformance tests.

### ART-B-002 — Identity and result digests contradict determinism and cache parity

**Affected:** Freeze §§5.2, 8.4, 13.1; Core §§4.2, 5.2, 10.2, 14.3, 18.3–18.4;
Repository M1-T03, M2, M4-T08–T09

There are two independent contradictions.

First, semantic revision preimages contain logical IDs, provenance, and signal
references, but Core supplies those through a generic injected `IdSource`.
Discovery signals, facts, Applications, Capabilities, Promises, and Proofs can
therefore receive new opaque IDs on a repeated invocation. Because those IDs
are sealed, an otherwise identical model obtains a different revision. The text
that “revisions never depend on randomness” is not enforced by the proposed
port.

Second, Core §10.2 puts `attemptId` into `resultDigest`. Core §14.3 removes
attempt IDs as volatile but explicitly retains result digests during semantic
comparison. A cache hit creates a new attempt ID while citing prior Evidence,
so hit and miss necessarily produce different retained result digests. The
cache-independent determinism gate cannot pass.

Evidence capture adds a related comparison issue: `capturedAt` is a sealed
Evidence field. A new valid capture at another time should create a different
Evidence revision, while a cache hit reuses the older revision. Exact
byte-for-byte result equality across cache hit and miss is therefore neither
possible nor desirable. “Semantic equality” needs a precise comparator rather
than an informal volatile-field list.

**Required resolution text:**

> The platform uses separate identity sources. `SemanticIdDeriver` derives or
> retrieves stable logical IDs for sealed domain objects from documented,
> domain-separated stable identity inputs. `EphemeralIdSource` creates
> invocation, attempt, event, transport, and other envelope IDs. Ephemeral IDs
> MUST NOT enter a semantic revision preimage.
>
> `resultDigest` identifies the semantic terminal observation: exact execution
> manifest revision, terminal verdict, sanitized observations, Evidence
> content identities and validation decisions, and evaluator decision. It
> excludes invocation, attempt, event, transport, wall-clock, and storage
> locator identity. A separate `attemptRecordDigest` MAY cover the complete
> immutable attempt record including `attemptId`.
>
> Canonical semantic comparison has two named modes. Interface parity compares
> the same retained invocation and therefore requires exact references.
> Re-execution determinism compares independent invocations by stable model,
> plan, evaluator, observation content, verdict, reason, and ordering while
> preserving but not requiring equality of factual capture time, attempt
> identity, Evidence revision, cache provenance, or storage locator. The
> machine schema marks every comparison rule; adapters do not normalize it
> independently.

Specify logical identity derivation for repository scope, nested Applications,
Capabilities, activated Promises, Proof definitions, signals, and facts before
M1-T03. Tests must cover a new local store, an existing local store, a moved
checkout, dirty and clean worktrees, cache hit/miss/bypass, and fresh Evidence
capture.

**ADR need:** No freeze amendment is required if the result digest remains a
digest of exact semantic observations and the comparator preserves frozen
meaning. An ADR is required if logical IDs cease to be sealed, capture time is
removed from Evidence, or the definition of a frozen semantic revision changes.

### ART-B-003 — Required atomic lifecycle commits have no atomic persistence port

**Affected:** Freeze §§3.7, 5.1, 6, 14.2; Core §§4.3, 5.6, 9.3; Operations
§§4, 7–8; Repository M4-T06–T07

Core declares separate `RevisionRepository.append` and
`EventRepository.appendBatch` operations, then requires child revisions, the
Application Model revision, its seal event, current-revision change, and later
run records to become visible as one logical unit. The same mismatch recurs for
Evidence plus capture event, validation event plus terminal Proof result, and
final aggregation plus invocation completion.

Two successful appends are not an atomic transaction. A crash between them can
leave a sealed object with no lifecycle fact, an event referencing an invisible
revision, two current models, validated Evidence without its durable edge, or a
successful result without its required history. Startup repair cannot safely
infer which side was authoritative.

**Required resolution text:**

> The Engine persistence boundary exposes an `EngineUnitOfWork` that atomically
> validates and commits revision documents, lifecycle/audit events, invocation
> records, current-model compare-and-supersede state, and required object
> references. A commit is visible in full or not visible. It includes an
> idempotency identity and expected sequence/current-revision predicates.
> Storage backends that cannot provide one transaction implement a documented
> prepare/commit protocol with a durable commit marker; readers expose only
> committed units, and recovery never chooses a semantic result.

List the exact contents of each of the twelve stage commit units. Add
power-loss tests before and after every durable write and concurrent
supersession tests that prove exactly one current sealed revision per scope.

**ADR need:** This should be resolved by the already-required local-store ADR.
It needs a freeze-amending ADR only if atomic visibility or append-only history
is weakened.

### ART-B-004 — Remote verify, dispatch, and publication are conflated

**Affected:** Integration §§1, 3–5, 8; Cloud §§3, 6, 14; Core review B-01/B-02

The Integration draft says machine responses contain the canonical envelope,
the same MCP tool has the same result shape in local and remote profiles, and
`verification.verify` returns the exact command envelope. Its remote topology
also says only an allowlisted metadata projection crosses the Cloud Boundary.

A local `VerifyResult` contains raw local revisions, attempts, Evidence and
Repair references, manifests, diagnostics, and cache provenance. A published
projection replaces raw revisions with tenant-scoped publication IDs and omits
forbidden fields. It is not the canonical local result and cannot validate as
one. A gateway also cannot synthesize a blocked verify envelope when no Engine
accepted the command.

The diagrams reinforce the ambiguity: the remote sequence labels its input
“Canonical request” and response “published projection” without a separate
dispatch command, receipt, or workload acknowledgement state.

**Required resolution text:**

> `verify -> VerifyResult` is available only to a caller authorized to receive
> the full local/workload result. Remote routing uses
> `dispatchVerification -> DispatchVerificationResult`, whose terminal routing
> states are `accepted`, `unavailable`, `unauthorized`, `expired`,
> `cancelled`, and `transport_error`. A dispatch state is not a verify
> operational status.
>
> An accepted workload retains its exact local `VerifyResult`. Optional
> publication uses a separate explicit command and produces
> `PublishedVerificationProjection`, containing only fields allowed by its
> publication schema. Retrieval uses `getPublishedRun` and never returns the
> projection under `kind: "verify"`.
>
> Dispatch cancellation and Engine cancellation are separately acknowledged.
> Only a retained workload Engine envelope may state that the verification
> invocation was cancelled.

Update MCP/REST/GitHub diagrams to show dispatch receipt, workload acceptance,
local terminal result, disclosure authorization, publication, and projection
retrieval as distinct messages. Parity tests compare local adapters against the
same retained local result and remote adapters against the pure publication
projection derived from that result.

**ADR need:** No. These are distinct canonical commands and result kinds within
the frozen dispatcher model. An ADR is required only if remote publication is
allowed to masquerade as the local canonical result or receive broader data.

### ART-B-005 — The proposed metadata cloud exceeds the default upload allowlist

**Affected:** Freeze §11.3; Cloud §§5–8; Integration §7.4; Security §12

Cloud §6.3 and §7.2 propose retaining every attempt, an effective-attempt
marker, Proof reproducibility class, Evidence media type, and Evidence
validation state. Freeze §11.3 allows:

- publication identifiers for Application Model, Promise, Proof, and Evidence;
- Promise and Proof statuses and stable reason codes;
- aggregate counts and durations; and
- Evidence type, byte size, publication identifier, and sensitivity class.

It does not allow attempt identifiers, attempt history, effective-attempt
markers, reproducibility class, Evidence media type, or Evidence validation
state. Calling them canonical projection fields does not place them on the
closed allowlist. The GitHub draft also proposes Promise prose, exact local
model identity, annotations, and optional source locations that exceed the
default cloud and third-party egress boundary.

**Required resolution text:**

> The first metadata-cloud schema contains exactly the fields enumerated in
> Architecture Freeze §11.3. It excludes attempt identity/history,
> effective-attempt markers, reproducibility class, Evidence media type,
> Evidence validation state, Promise display text, raw model identity, file
> location, and annotation content. Database tables and object envelopes MUST
> NOT contain a field merely because a later schema might permit it.
>
> A published Promise entry contains only its tenant-scoped publication
> identifier, criticality where approved by the schema, received status, and
> stable reason codes. A published Proof entry contains only its publication
> identifier, received status, stable reason codes, approved duration, and
> approved public artifact identity. An Evidence descriptor contains only the
> four fields expressly allowlisted by the freeze.

If a required UX cannot be built from that projection, present suppressed
counts and a local inspection command. Do not widen publication through
presentation policy.

**ADR need:** No if the excess fields are removed. Any addition to the frozen
default upload allowlist requires an accepted Cloud Boundary ADR with privacy,
dictionary-testing, disclosure-preview, retention, compatibility, and
third-party egress analysis.

## 3. Major findings

### ART-M-001 — Evidence does not have an exact reverse edge to its capture attempt

**Affected:** Freeze §5.10; Core §§6.3–6.4, 9; Shared Contracts result schema

The provenance invariant requires traversal
`Proof execution -> Evidence revision(s)` in both directions without heuristic
matching. `EvidencePayload` has subject and input revision references but no
attempt reference. `ProofAttemptResult` points forward to Evidence only after
capture. A reverse database index inferred from result membership is not an
edge sealed at capture, and capture occurs before the terminal result digest
exists.

**Required resolution:** Define an immutable pre-terminal `ProofAttemptRef`
containing at least `attemptId`, exact Proof, Promise, model, execution context,
and execution manifest revision. `EvidenceCaptured` binds the exact Evidence
revision to that attempt ref in the same atomic unit. The terminal result later
binds the same attempt ref to its result digest. Bidirectional traversal uses
these authoritative association events, never query-time matching. Clarify
whether “exact revisions” in Freeze §5.10 includes immutable attempt/result
identities; use an ADR if this changes the frozen graph.

### ART-M-002 — `completed/indeterminate` versus `blocked/partial` is under-specified

**Affected:** Freeze §§5.4–5.5, 12.3, 15; Product §7; Core §§6.5, 7, 16.2;
Plugin §10

Drafts alternately map missing credentials, denied permissions, network
unavailability, unsupported environment, and missing Evidence to a Proof
`indeterminate`, a Proof `error`, a completed indeterminate invocation, or a
blocked invocation with a partial indeterminate result. All are plausible in
different circumstances, but no deterministic decision table separates them.

**Required resolution:** Add one normative matrix:

- valid capture/evaluation completed and Evidence is insufficient under a
  Proof-declared missing-Evidence rule -> Proof `indeterminate`,
  command may be `completed`;
- required action never began or a required authorization, sandbox, plugin,
  persistence, redaction, authentication, or environment control failed ->
  attempt `error` or no attempt, command `blocked`;
- if blocked after some required Promise evaluations committed -> optional
  `partial: true`, outcome `indeterminate`;
- invocation deadline/user cancellation -> `cancelled`;
- advisory-only operational failure -> `completed` plus diagnostic.

Add a table for every frozen example and exit-code precedence combination.

### ART-M-003 — MVP planning seals Proof-bearing models before Proof ownership exists

**Affected:** Repository M1-T04, M2-T09–T12, M3-T05–T09

M2 activates required Promises, validates a model containing exact Proof
revisions, and seals it. The `proofs` package's definitions, applicability, and
MVP Proof registry are not scaffolded until M3-T05. A model cannot satisfy the
graph validator or Promise coverage contract with only a TypeScript/JSON schema;
it needs exact active Proof definition revisions and evaluator identities.

**Required resolution:** Move the MVP Proof definition registry, exact static
Proof revisions, predicate IDs, evaluator IDs, applicability contract, and
Promise-Proof binding construction ahead of Promise activation and model
sealing. Evaluator implementations and Evidence capture can remain in M3.
Update the critical path accordingly.

### ART-M-004 — First-release acceptance still leaks plugin scope

**Affected:** Product §§5.3, 14.1; DX/CLI/Plugin review DX-PLG-001/002;
Repository MVP boundary

The unknown-ecosystem example recommends installing a plugin even though the
first release has no plugin command or runtime. The first-release release gate
also includes malformed plugin output. This creates a dead-end user journey and
silently makes plugin conformance an MVP dependency.

**Required resolution:** Replace the unknown-ecosystem next action with
“inspect discovered facts and the supported-ecosystem list.” Show plugin
installation only after M6. Remove malformed-plugin-output cases from the MVP
suite and place them exclusively in Plugin Contract conformance.

### ART-M-005 — Plugin platform milestone terminology and onboarding are inconsistent

**Affected:** Plugin §§3, 6, 11, 14–16; Product §§11–13; DX/CLI/Plugin review

“Phase 1” means the plugin-free public CLI in Product but the first executable
plugin platform in Plugin. Provider developer onboarding is specified, while
safe end-user onboarding, update permission deltas, revocation, removal, and
partial onboarding are split across other drafts. Permission disclosure shows
manifest maxima but does not consistently require the exact effective grant.

**Required resolution:** Reserve “first public npm release” for the plugin-free
CLI and “initial plugin-platform milestone” for M6. In the reconciled EDD,
include separate provider-developer and user-plugin onboarding flows. User
execution consent must show the exact sealed effective grant after policy
intersection: readable/writable roots, destinations, outbound classes and
bytes, secret binding/audience/scopes, side effects, duration, denied
differences, and enforcement tier. JSON/JSONL never prompt. Installation,
selection eligibility, trust, authorization, credential binding, execution,
revocation, and removal remain distinct states.

### ART-M-006 — Plugin permission-denial retryability loses a security distinction

**Affected:** Plugin §16; Shared Contracts error model; Product §7

`VFY_PLUGIN_PERMISSION_DENIED` is always `never`, but a missing external user or
CI grant is safely retryable only after a new authority decision, whereas an
Engine hard-limit or organization-policy denial must never be retried.

**Required resolution:** Use `policy_required` for missing separately grantable
authority and `never` for non-overridable denial. If one top-level code remains,
add stable subreasons and fixtures. Remediation must never imply that an
unchanged retry can create authority.

### ART-M-007 — The first GitHub provider and first GitHub projection are too broad

**Affected:** Plugin §14.1; Product §11.2; Integration §7; both cross-reviews

The product selects read-only repository-policy observations. Plugin also adds
pull-request change-review observations, increasing privacy, authorization, and
rate-limit surface. Integration proposes annotations and Promise details that
the default publication boundary cannot send.

**Required resolution:** Restrict the first provider to default branch,
required status checks, review requirements, and branch-protection/ruleset
configuration. Defer pull-request state. Freeze the first GitHub check payload
to the §11.3-compatible projection and a non-sensitive application alias.
Source locations, Promise prose, repository text, raw revisions, commands, and
logs require a future explicit-share/third-party-egress decision.

### ART-M-008 — Plugin discovery is assigned contradictory enforcement profiles

**Affected:** Security §§6.1, 7.1; Plugin §9

`passive-engine` is defined as “no repository child process,” while plugin
discovery is described as passive-engine semantics expressed through an
out-of-process `local-restricted` container. An out-of-process plugin is a
repository-reading child process and therefore cannot run under the
`passive-engine` profile as defined.

**Required resolution:** Engine-native readers use `passive-engine`. Discovery
plugins use `local-restricted` with permanently denied network, secrets,
subprocess, writes, and out-of-root access. Until the sandbox ADR proves that
profile on a supported OS, discovery plugins are unavailable; the engine-native
MVP remains unaffected. Record the profile in every discovery contribution.

### ART-M-009 — The local-store ADR is sequenced after work that depends on it

**Affected:** Freeze §20.1(5); Core §§9.3, 13; Security §14; Operations §7;
Repository M4-T06–T10

M4 implements the append store, recovery, tombstones, cache, inspection, and
clear behavior, yet the store location, format, atomicity primitive, fsync
assumptions, retention, purge, permissions, and encryption posture remain a
pre-beta ADR. These choices affect persisted compatibility, crash guarantees,
deletion, CLI behavior, and performance; they are not safely postponed until
after the store implementation.

**Required resolution:** Make the local-store ADR an entry gate to M4-T06.
It must select logical locations, ownership and permissions, transaction/commit
primitive, corruption/quarantine behavior, schema/migration support, default
run/Evidence/cache/scratch quotas and retention, cache eviction versus history
deletion, purge UX, backup assumptions, and encryption claim. Test doubles may
precede it; a production durable store may not.

### ART-M-010 — The roadmap omits or reorders committed post-MVP product work

**Affected:** Product §13.1; Repository M6–M7

Product sequences deterministic Repair inspect/apply/re-verify before plugin
runtime, then the GitHub provider before MCP and GitHub Action. Repository
planning has no Repair-application milestone and leaves the GitHub provider as
an unspecified later release after M6 while moving directly to MCP and Action.

**Required resolution:** Either:

1. add an M5.5 Repair inspection/apply/re-verify milestone and place the narrow
   GitHub provider between M6 and M7; or
2. explicitly amend the product sequencing document with owner rationale.

Repair application must remain a separate canonical command with exact write
preview, authorization, atomic patch behavior, conflict handling, immutable
lifecycle event, and later verification invocation.

### ART-M-011 — “Canonical cloud envelope” is unsafe terminology

**Affected:** Cloud §§5–8; Integration §§4–5

Cloud alternates among “canonical received envelope,” “canonical result
projection,” and “published metadata projection.” The first can be read as the
full local VerifyResult, which the cloud is prohibited from receiving.

**Required resolution:** Reserve “canonical VerifyResult” for the local/workload
Engine envelope. Use “canonical serialized publication payload” for the exact
allowlisted bytes accepted by cloud and “PublishedVerificationProjection” for
its query model. State in each storage/table section that neither is a complete
VerifyResult and neither can be used as a source execution result.

### ART-M-012 — Provider contribution semantics need an owned core predicate registry

**Affected:** Plugin §10; Core §6.1; Shared Contracts ownership

Plugins contribute a `CorePredicateExpression` identified only by free-form
language/version/expression fields. The Engine must interpret it without
provider-specific code, but no package owns the finite predicate language,
schema digest, security properties, or compatibility policy.

**Required resolution:** Put the provider-neutral predicate AST/schema and
evaluator registry under `contracts`/`proofs`. Plugins may reference only an
installed supported predicate language revision and validated expression.
Unknown operators or versions fail compatibility before permission. Adding a
primitive requires two independent provider-neutral use cases and the change
process required by the freeze.

### ART-M-013 — Cost and retention bounds are gates, not yet implementable defaults

**Affected:** Operations §§7, 9, 13; Security §14; Freeze §§14.2, 19

The drafts correctly require bounded local storage and execution but do not
select concrete safe defaults for retained runs, Evidence bytes, cache bytes,
scratch/quarantine age, file count, or concurrent invocations. “Configurable by
policy” does not provide a safe default. An MVP cannot be cost- or
disk-bounded without them.

**Required resolution:** The local-store ADR and reference-hardware record must
publish initial numeric defaults and hard maxima, plus behavior when each is
reached. Required work becomes typed operational uncertainty; the Engine never
silently drops a required Proof or authoritative fact. Hosted limits, pricing,
and service quotas remain deferred.

## 4. Minor findings

### ART-m-001 — Glossary satisfaction omits the shared context condition

Glossary says all required applicable Proofs selected by the invocation passed.
Freeze additionally requires the same Application Model revision and execution
context. Add that phrase so the terminology index cannot be read as permitting
cross-context aggregation. No ADR.

### ART-m-002 — Verify result identifies the model less precisely than other references

Core `VerifyResult.applicationModelRevision` is only a digest while exact
historical references elsewhere contain kind, logical ID, revision, and schema
version. Retain the frozen field if compatibility requires it, but also include
or make directly resolvable an exact `RevisionRef<"applicationModel">` in the
typed result. Do not let adapters guess kind or schema.

### ART-m-003 — Event subjects omit object kind and schema version

Core `EventSubject` has only ID and revision. IDs are opaque, so consumers
cannot validate a subject without out-of-band event-type knowledge. Use the
Shared Contracts exact object reference shape, including kind/schema version
where applicable, or define event-type-owned subject schemas explicitly.

### ART-m-004 — Event type is free-form despite stable control behavior

`eventType: string` is acceptable in TypeScript internals but stable producers
need an owned registry, schema, classification, compatibility status, and
event-specific payload decoder. Unknown informational events may be ignored;
unknown events needed for state reconstruction must fail incompatible.

### ART-m-005 — Cache ownership wording conflicts in the registry index

Shared Contracts calls cache an intended “Cache package” but assigns cache to
`execution` in the frozen package table. Adopt Repository finding RIP-C01:
“Execution package (cache module).” This is an index correction, not a new
package or ADR.

### ART-m-006 — Public package-scope examples can harden an unresolved founder decision

Plugin examples import `@verification/contracts` although F-001 is open.
Mark every such import as illustrative or use internal workspace identifiers
until naming is selected and migration-tested.

### ART-m-007 — Current repository README metadata drifts from the frozen package registry

Repository planning identifies that `packages/README.md` says names are not
frozen while Shared Contracts says they are. Correct the README during
reconciliation and make the registry authoritative.

### ART-m-008 — GitHub `internal_error` projection choice needs explicit transport status

The freeze permits action-required/error. Integration chooses
`action_required`. State that this is the Phase 1 GitHub transport mapping, not
new domain meaning, and cover it with compatibility fixtures.

### ART-m-009 — Remote and cloud event streams need an invocation rule for non-verify work

The common event envelope requires `invocationId`, including policy publication,
retention, deletion, and migration events. Specify that every canonical command
creates an invocation ID, and define a separate operation correlation for
long-lived jobs. Do not overload a prior verify invocation.

### ART-m-010 — First-release wording still uses “Phase 1” for multiple horizons

Use the stable labels “architecture phase,” “first public local CLI,” “initial
plugin-platform milestone,” “first metadata-cloud milestone,” and “hosted
beta.” Avoid bare “Phase 1” in the reconciled EDD.

## 5. Deferred findings and decision gates

### ART-D-001 — Dynamic execution and plugin sandboxing

Resolve the existing OS enforcement-tier and worktree-snapshot ADRs before any
production repository command or plugin child process ships. Test doubles do
not constitute support.

### ART-D-002 — Plugin trust and credential delivery

Resolve signing authority, publisher provenance, revocation, key rotation,
development tier, and per-platform secret-handle delivery before supported
plugin distribution or provider credentials. Digest pinning alone is byte
identity, not publisher trust.

### ART-D-003 — Provider network enforcement

Resolve DNS, redirect, proxy, alternate-IP, loopback/link-local/metadata
protection and serialized outbound-schema enforcement before provider-network
plugins. A destination firewall alone is insufficient.

### ART-D-004 — Metadata publication key lifecycle

Before metadata cloud, decide local publication-key generation, storage,
rotation, loss/recovery, tenant/object separation, collision handling,
deletion, and idempotency behavior.

### ART-D-005 — Cloud deployment, retention, identity, and tenancy

Cloud vendor/region, retention/deletion/backup/legal hold, action catalog,
operator access, workload identity, and tenant-key strategy remain valid
pre-hosted gates. Do not advertise the draft SLO/RPO/RTO values until measured
Evidence exists.

### ART-D-006 — Vendor-hosted source execution

Keep vendor-hosted execution unavailable. It requires a freeze-amending ADR for
the CI/execution-fleet non-goal and Cloud Boundary, plus a complete workload
threat model, explicit-share schema, isolation, egress, retention, deletion,
abuse, and cost gates.

### ART-D-007 — Evidence attestation

Issuer trust, signature format, privacy, revocation, verification, and deletion
remain deferred until third-party attestation exchange.

### ART-D-008 — Billing and pricing

The price-neutral usage-ledger design is reasonable but has no MVP consumer.
F-003, tax/payment/refund/dunning behavior, financial retention, and retry
charging remain deferred until a hosted commercial product exists.

### ART-D-009 — Open-source and package naming

Keep the monorepo private until F-001/F-002 and legal review are resolved.
Neither internal placeholder names nor the recommended open-core split are
current product promises.

### ART-D-010 — Plugin pooling, generic HTTPS, and provider mutation

Fresh-process-per-operation remains the initial plugin rule. Pooling, a generic
HTTPS observation plugin, and executable provider Repairs need separate product
need, security review, and conformance before roadmap commitment.

## 6. Cross-domain consistency summary

| Domain | Assessment | Required reconciliation |
|---|---|---|
| Terminology | Mostly consistent | Normalize release horizon labels; tighten Glossary context wording |
| Domain model | One fatal hash cycle | Accept ART-B-001 ADR and update all schemas/fixtures |
| Determinism/cache | Semantics are sound in intent, comparator is not | Separate semantic and ephemeral identity; redefine digest preimages and comparison modes |
| Persistence/events | Append-only intent is strong, transaction boundary absent | Add atomic Engine unit of work and exact capture-attempt edges |
| CLI/DX | Narrow MVP is credible | Remove plugin dead ends and malformed-plugin MVP gate |
| Plugins | Boundary is strong | Gate execution on sandbox/signing/egress; reconcile onboarding and permission retry semantics |
| Integrations | Local path is coherent | Split local verify, remote dispatch, publication, and retrieval contracts |
| Cloud/data | Logical tenancy is strong | Enforce literal §11.3 schema; remove extra projected fields |
| Security/privacy | Threat model is thorough | Correct plugin profile contradiction and retain feature gates |
| Operations/cost | Local-first posture is coherent | Select numeric local resource/retention defaults before release |
| Repository/packages | Acyclic plan is plausible | Reorder Proof ownership, gate store implementation, correct cache owner wording |
| Roadmap | MVP boundary is clear | Restore Repair apply/re-verify and exact GitHub provider ordering or amend Product |

## 7. ADR requirements

### New freeze-amending ADR

1. **Promise/Proof exact association and revision hashing** — mandatory before
   M1 domain schemas are declared stable. It must resolve ART-B-001 and define
   migrations and conformance for both-direction traversal.

### Existing required ADRs that must become explicit milestone gates

1. OS-specific sandbox backends and enforcement tiers.
2. Mutable-worktree snapshot strategy.
3. Plugin signing, provenance, revocation, and development trust.
4. Network and outbound-schema enforcement.
5. Local store, retention, purge, atomicity, and encryption posture.
6. Cloud retention, deletion, backup, region, and legal hold.
7. Workload identity and enterprise identity lifecycle.
8. Evidence attestation.

### Conditional freeze-amending ADRs

1. expansion of the default cloud upload allowlist;
2. source- or sensitive-Evidence explicit share;
3. vendor-hosted execution fleet;
4. shell execution;
5. a change to sealed semantic revision fields or immutable history.

Distinct remote dispatcher commands, predicate registry ownership, unit-of-work
ports, package README corrections, cache owner wording, task reordering, and
the narrow GitHub scope do not require a freeze amendment when resolved as
recommended.

## 8. Blocking-resolution checklist

- [ ] Accept a freeze-amending ADR that removes the Promise/Proof
      content-addressed cycle while retaining exact historical traversal.
- [ ] Remove the Proof/Provider-binding reverse sealed-reference cycle.
- [ ] Add the association object and exact package/schema/fixture ownership to
      the Application Model and contract registry.
- [ ] Separate semantic ID derivation from ephemeral invocation/attempt/event
      ID generation.
- [ ] Define stable logical identity for every MVP domain object and discovery
      signal/fact.
- [ ] Remove volatile attempt identity from `resultDigest` or introduce a
      separate complete attempt-record digest.
- [ ] Publish machine-owned interface-parity and re-execution-determinism
      comparison modes.
- [ ] Add an atomic `EngineUnitOfWork` and enumerate every lifecycle commit
      boundary.
- [ ] Bind Evidence capture to an immutable exact attempt reference in the same
      atomic commit.
- [ ] Split `verify`, remote dispatch, publication, and published-run retrieval
      into distinct canonical commands/result kinds.
- [ ] Add separate gateway and workload cancellation acknowledgements.
- [ ] Rewrite remote MCP/REST/GitHub diagrams using the split contracts.
- [ ] Reduce the first cloud schema and physical tables to the literal Freeze
      §11.3 allowlist.
- [ ] Remove Promise prose, raw revisions, locations, and source-bearing
      annotations from the first GitHub projection.
- [ ] Add the completed/blocked/partial/indeterminate decision matrix and exit
      fixtures.
- [ ] Move MVP Proof definition and binding ownership before Promise activation
      and model sealing.
- [ ] Remove plugin installation guidance and malformed-plugin tests from the
      first local release.
- [ ] Reconcile plugin-platform naming, end-user onboarding, effective-grant
      consent, update, revocation, and removal.
- [ ] Correct permission-denial retryability and narrow the first GitHub
      provider.
- [ ] Correct plugin discovery enforcement-profile wording and keep it gated on
      the sandbox ADR.
- [ ] Make the local-store ADR an entry gate to production M4 persistence and
      cache tasks.
- [ ] Select numeric MVP storage, retention, process, output, and concurrency
      defaults.
- [ ] Restore or explicitly amend the post-MVP Repair and GitHub provider
      sequence.
- [ ] Resolve every Major finding with an owner, target EDD section, test ID,
      and milestone before declaring the reconciled EDD implementation-ready.

Until every Blocking item is resolved, domain schemas and remote/cloud
contracts must remain draft. The passive-reader implementation can be explored
behind test-only interfaces, but it must not freeze an unconstructible revision
graph or publish incompatible contract artifacts.
