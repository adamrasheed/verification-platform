# Operations, Reliability, and Billing

**Status:** Domain draft for reconciliation
**Owner:** Operations, Reliability, and Billing
**Governing references:** `docs/architecture/ARCHITECTURE_FREEZE.md`,
`docs/architecture/GLOSSARY.md`, and
`docs/architecture/SHARED_CONTRACTS.md`
**MVP boundary:** Local execution only; no hosted service, durable broker,
product identity, usage upload, metering, invoice, or billing

## 1. Purpose and constraints

This draft defines how the verification platform is operated, recovered,
measured, scaled, and, only after the MVP, metered. It does not redefine the
Application Model, Promise aggregation, Proof results, Evidence, Repair,
Plugin Contract, Authentication Model, Cloud Boundary, canonical result, or
error model.

The design follows these constraints:

- The engine remains the sole semantic authority.
- A queue, worker, database, metric, log, trace, invoice, or dashboard is never
  an independent source of verification truth.
- Operational failure remains distinct from Proof failure.
- Local use works offline without product identity or a hosted dependency.
- The platform does not become a CI, deployment, observability, or general job
  orchestration platform.
- Provider-specific scheduling, cost, rate-limit, and credential behavior stays
  behind the Plugin Contract.
- Retained domain facts are append-only while retained; authorized deletion
  follows the frozen tombstone semantics.
- Source, secrets, raw logs, diffs, prompts, local paths, and Evidence bodies do
  not cross the Cloud Boundary by default.
- No implementation may claim a control, service level, recovery objective, or
  billing property until conformance Evidence proves it.

There are three operational profiles:

| Profile | Execution location | Durable service queue | Product billing |
|---|---|---:|---:|
| Phase 1 local | User's machine or CI runner | No | No |
| Authorized workload | Customer- or integration-owned workload engine | Post-MVP control messages only | Optional, not selected |
| Hosted verification | Product-managed verification workers | Deferred until hosted readiness gates pass | Optional, not selected |

An authorized workload or hosted worker executes only verification actions
described by sealed plans. It does not schedule arbitrary user workflows,
deploy applications, or become the owner of an external CI system's fleet.

## 2. Responsibility boundaries

| Component | Operational responsibility | Explicit exclusion |
|---|---|---|
| Canonical dispatcher | Validate request, create invocation identity, propagate deadline and cancellation | No Proof semantics |
| Engine coordinator | Own stage progression, durable commit boundaries, recovery state, and final canonical result | No adapter-specific status |
| Local scheduler | Run one bounded invocation DAG with backpressure and stable result ordering | No cross-machine durable queue |
| Plugin runtime | Contain plugin processes and enforce externally visible limits | No hidden retry or billing authority |
| Local store | Retain local run history, events, Evidence, cache, and tombstones under local policy | No cloud synchronization by default |
| Hosted control plane | Post-MVP admission, authorization, workload routing, metadata publication, and retrieval | No source-dependent execution |
| Dispatch queue | Post-MVP transport of references to authorized work | No domain truth or verdict calculation |
| Workload engine | Reauthorize and execute sealed verification work in its bound workspace | No authority inherited from router alone |
| Usage ledger | Post-MVP append-only accounting facts and adjustments | No Proof evaluation and no pricing decision |
| Telemetry pipeline | Operational projection of redacted events and metrics | No audit, usage, or billing authority |

The queue, cache, telemetry store, and search index are disposable projections.
The retained canonical run history and exact provenance references are the
authority for recovery and result retrieval.

## 3. Phase boundaries

### 3.1 Phase 1 local MVP

The first public npm release operates with:

- one local engine process per invocation;
- one bounded in-memory DAG scheduler per invocation;
- child processes only for authorized tools and plugins;
- append-safe local run and audit records;
- a separate, bounded local cache;
- no product network call, account, tenant, cloud queue, hosted worker, remote
  telemetry export, usage meter, quota, price, invoice, or payment dependency;
- local inspection, purge, cache bypass, cache inspection, and cache clear
  behavior;
- structured local events from which human logs may be projected.

Phase 1 MUST NOT silently retain a task for later cloud publication or execution.
An unavailable remote-only operation fails fast with the frozen typed
operational semantics while valid local work remains usable.

### 3.2 Post-MVP authorized workloads

An authorized workload profile may add:

- registered opaque workload bindings;
- authenticated control-plane dispatch;
- a durable queue for dispatch references;
- workload heartbeats and capacity signals;
- retrieval of allowlisted published metadata;
- tenant-scoped quotas and non-chargeable or chargeable usage accounting.

The workload engine independently authorizes every sealed action. A cloud
router can never grant local filesystem, provider credential, network, write,
or degraded-isolation authority.

### 3.3 Hosted verification

Product-managed workers remain deferred until the security, sandboxing,
workload identity, retention, region, deletion, backup, and legal-hold
decisions required by the freeze are resolved and tested. Hosted execution
uses the same command, plan, event, Evidence, result, cancellation, retry, and
plugin contracts as local execution.

Hosted operation does not imply source upload is generally allowed. Source
execution requires an explicit workload contract and a separately authorized
source transfer or customer-controlled checkout mechanism. Metadata-only cloud
publication cannot be widened into hosted source execution.

## 4. Local execution operations

### 4.1 Invocation lifecycle

The local engine uses the frozen canonical lifecycle. Operationally, an
invocation is admitted only after:

1. the request and workspace binding validate;
2. a unique invocation ID and cancellation root exist;
3. local storage can create an append-safe invocation record;
4. configured resource limits are valid and enforceable;
5. installed component revisions are resolved without a registry lookup.

The scheduler admits only nodes from the sealed invocation DAG. It bounds:

- total queued nodes;
- runnable concurrency and CPU weight;
- per-plugin concurrency;
- network concurrency for explicitly authorized network actions;
- process count, memory, duration, output, scratch bytes, created files, and
  open files where the selected enforcement tier supports them.

Backpressure stops plan producers and plugin stream readers before a memory,
disk, process, or output boundary is exceeded. Exceeding a bound emits a
specific `StructuredError`, ends the affected attempt as `error` or
`indeterminate` as required by the frozen semantics, and never becomes a failed
Promise merely because capacity was unavailable.

### 4.2 Process ownership and shutdown

Every child process is owned by exactly one attempt and process group or
platform-equivalent containment unit. The parent records the ownership edge
before launch. Normal shutdown:

1. stops admission;
2. propagates cancellation;
3. begins process-tree termination within one second;
4. drains only bounded diagnostic protocol data;
5. finalizes terminal attempt events;
6. marks incomplete storage and cache publications unusable;
7. releases local locks and scratch space.

If clean finalization is impossible, the next startup recovery pass treats the
invocation as abandoned. It does not infer success from a child exit code,
temporary file, or last log line.

### 4.3 Multiple local invocations

Separate CLI processes may run concurrently. They share no mutable invocation
state. Shared local-store and cache operations use bounded leases or atomic
compare-and-publish, never unbounded global locks.

Cross-process contention may delay admission or cause a diagnosed cache miss.
It must not change the execution graph, result ordering, Proof verdict, or
provenance. A local lock is an operational coordination mechanism, not a Proof
lease.

## 5. Hosted queue and worker semantics

This section is a post-MVP contract. Phase 1 has no broker.

### 5.1 Queue role

The durable queue carries a bounded dispatch reference, not a command shell,
source archive, secret, Evidence body, canonical result, or mutable domain
object. The referenced dispatch record contains:

- invocation and correlation identifiers;
- tenant, project, and opaque workload binding;
- canonical command digest and compatible protocol major;
- absolute admission and execution deadlines;
- required worker capability and enforcement tier;
- authorization reference and expiry;
- priority class and enqueue time;
- idempotency scope;
- disclosure class;
- reference to the immutable request record.

The database record is authoritative. A broker message is an at-least-once
wake-up hint that may be duplicated, reordered, or delayed.

### 5.2 Admission and idempotency

Admission is transactional:

1. authenticate and authorize principal, tenant, project, workload, and action;
2. validate deadline, quota, payload classification, and protocol compatibility;
3. bind the client idempotency key to principal, tenant, operation,
   destination, and canonical request digest;
4. create or return exactly one invocation record;
5. append the admission event and queue outbox record;
6. acknowledge only after the authoritative commit.

Reuse of an idempotency key with a different normalized request fails closed.
Redelivery returns or reprojects the same invocation. It does not create a
second invocation, Proof attempt, usage charge, or canonical history.

An outbox or equivalent transactional publication mechanism ensures that a
committed invocation is eventually offered even if broker publication fails
after the database commit. Reconciliation detects a committed, non-terminal
dispatch with no live queue offer.

### 5.3 Claims, leases, and fencing

Workers claim dispatch records with a compare-and-append operation. A claim
contains:

- unique claim ID;
- worker identity, artifact digest, supported protocol, and enforcement tier;
- lease issue and expiry times from the control-plane clock;
- monotonically increasing fencing token;
- heartbeat interval;
- dispatch revision.

Only the current fencing token may append worker-owned state. Renewals are
bounded and rejected after cancellation, authorization expiry, deadline expiry,
worker revocation, or superseding claim. A stale worker cannot publish an
attempt terminal event, Evidence, result, cache entry, or usage finalization.

Lease expiry makes the claim abandoned; it does not by itself declare a Proof
failed. Recovery determines whether:

- no action began, allowing claim redelivery without a new Proof attempt;
- an action began and has a durable attempt identity, requiring that attempt to
  end `error` or `cancelled` with a recovery reason;
- an external effect may have occurred, prohibiting automatic retry unless the
  sealed action and downstream operation are independently idempotent.

Claims and Proof attempts are deliberately distinct. Queue delivery and lease
renewal are transport operations. A Proof attempt begins only when its queued
event and execution manifest have durably committed.

### 5.4 Delivery, ordering, and fairness

The broker provides at-least-once delivery. The application layer provides
idempotent admission, fenced claims, and append-only attempt history. The
architecture does not claim exactly-once execution.

Ordering is required only within the authoritative event stream for an
invocation. Global broker ordering is unnecessary. Priority classes are
bounded and use aging or weighted fairness so low-priority tenants cannot
starve. Tenant and workload concurrency limits apply before expensive work is
claimed.

The service maintains:

- a bounded ready queue;
- a delayed retry queue for transport offers;
- a quarantine queue for incompatible, malformed, or repeatedly
  unrecoverable dispatch references;
- no dead-letter path that silently abandons a canonical invocation.

A quarantined dispatch receives a durable operational state and alert. An
operator may re-offer the same invocation after correcting an operational
condition; the operator cannot edit its request or existing attempt history.

### 5.5 Backpressure and overload

Admission is rejected or delayed before capacity exhaustion. The platform
applies, in order:

1. per-principal request limits;
2. per-tenant concurrent-invocation and queued-work limits;
3. workload-specific capacity;
4. global worker and broker saturation limits;
5. explicit maintenance or incident controls.

Overload returns a retryable transport or resource condition with a bounded
retry hint when safe. It is not a violated Promise. Accepted invocations remain
retrievable even when dispatch is delayed.

## 6. Retry semantics

Four retry domains are separate:

| Retry domain | Authority | Creates a new Proof attempt? | May change verdict? |
|---|---|---:|---:|
| Adapter delivery or API request | Adapter/control plane | No | No |
| Queue offer or worker claim | Hosted control plane | No, unless prior work started and recovery authorizes a new attempt | No |
| Proof action | Engine scheduler | Yes | Only through the frozen effective-attempt rule |
| Provider SDK internal retry | Prohibited by default; otherwise bounded and declared by plugin contract | No, but fully observable within attempt metadata | No hidden behavior |

The engine is the only Proof retry authority. It retries only when all frozen
conditions hold: the prior terminal state is `error`, the action is
`retry_safe`, the structured error permits it, policy and error-code allowlists
authorize it, attempts and deadline remain, and cancellation is inactive.

`passed`, `failed`, `indeterminate`, and `cancelled` are never retried to seek a
different result. Authorization denial, schema mismatch, integrity failure,
redaction failure, and unknown control-flow values are not automatic retries.

Every Proof retry:

- receives a new attempt ID and fresh execution manifest;
- preserves and links the prior attempt and diagnostic Evidence;
- reauthorizes permissions, secret handles, and network access;
- launches a fresh plugin process and handshake where a plugin is involved;
- uses bounded deterministic backoff without random jitter in Phase 1;
- records the reason, policy, delay, and eventual effective attempt.

Hosted transport may use randomized broker backoff only as non-semantic
delivery behavior. That randomness never enters Proof evaluation, and actual
offer times remain operational metadata. Once an action attempt exists, its
retry policy follows the engine contract.

Unknown external side effects are treated conservatively. If a worker or
provider connection fails after a possibly mutating operation, the action is
not automatically retried unless a destination-scoped idempotency key or an
independent read-after-write reconciliation proves safety. Phase 1 Repairs are
advisory and do not execute provider mutations.

## 7. Storage model and retention

### 7.1 Storage classes

| Class | Authority | Typical contents | Retention behavior |
|---|---|---|---|
| Run history | Authoritative while retained | Requests, plans, manifests, attempts, results, exact revision refs | Append-only; policy deletion with tombstone |
| Domain objects | Authoritative while retained | Sealed models, Promise/Proof revisions, Evidence metadata and allowed bodies, Repairs | Append-only; exact referential integrity |
| Audit events | Authoritative audit facts | Redacted lifecycle and security-sensitive events | Append-safe; policy retention |
| Cache | Disposable projection | Validated reusable entries and provenance refs | Size/age eviction; corruption is a miss |
| Scratch | Non-authoritative | Process outputs awaiting validation and commit | Invocation-bound; quarantine on crash, then bounded purge |
| Telemetry | Disposable projection | Redacted metrics, logs, and traces | Short, purpose-bound operational retention |
| Usage ledger | Post-MVP accounting authority | Meter facts, reservations, finalizations, adjustments | Append-only under financial retention policy |
| Queue/search/index | Disposable projection | Dispatch offers and query projections | Rebuildable from authoritative records |

### 7.2 Local store

The local store must support:

- atomic append batches at the durable boundaries named by the Core Engine;
- integrity checks for every sealed object and cache entry;
- exact revision references and bidirectional provenance traversal;
- exclusive or fenced publication without indefinite stale locks;
- explicit incomplete and quarantined states;
- bounded reads, pagination, and graph traversal;
- least-privilege permissions and unpredictable temporary names;
- inspection of usage by class and policy-driven purge;
- migration from the current and immediately previous supported artifact major.

Run history and cache are separate. Clearing cache never deletes authoritative
run history or Evidence. Deleting a retained run never masquerades as cache
eviction.

The exact local store location, format, durability primitive, default limits,
purge schedule, and optional encryption threat model require the pre-beta local
store ADR mandated by Architecture Freeze §20.1(5).

### 7.3 Hosted persistence

The hosted control plane stores only the allowlisted cloud projection unless a
separate hosted-execution disclosure contract authorizes more. Queue payloads
hold references; large permitted blobs use integrity-checked object storage
rather than the broker or relational event rows.

Tenant-scoped transactional storage is required for:

- admission and idempotency records;
- invocation and claim state;
- event/outbox sequencing;
- publication manifests;
- policy, authorization, and deletion records;
- usage reservations and ledger entries.

Indexes and analytics stores consume redacted projections and are rebuildable.
They do not determine authorization, verification results, deletion completion,
or invoices.

Every tenant-bearing row, object, queue reference, cache entry, and telemetry
projection has an explicit tenant partition key. Cross-tenant access is denied
at the service and storage policy layers and tested with negative fixtures.

### 7.4 Retention and deletion

Retention is purpose-specific and never expressed as one global TTL:

- active run history;
- Evidence bodies and metadata;
- audit events;
- local cache;
- scratch and quarantine;
- telemetry;
- usage and financial records;
- backups;
- legal hold.

Phase 1 defaults must be finite, inspectable, configurable within safe policy,
and documented before beta. Cloud defaults require the separate pre-hosted ADR
mandated by Architecture Freeze §20.1(6).

Deletion removes protected payload and appends the frozen non-sensitive
tombstone. Traversal returns `deleted_reference`; it does not silently omit or
fabricate a node. Raw content digests are removed when they could identify
deleted content. Cache, indexes, replicas, exports, and backups expire or are
purged according to their named schedules and cannot restore tombstoned data to
active storage.

Financial retention or legal hold may require a purpose-limited accounting
record after product data deletion. That record contains no source, Evidence
body, secret-derived value, raw path, or unnecessary domain payload. Any such
exception is visible in the deletion policy and response.

## 8. Crash and failure recovery

### 8.1 Local startup recovery

On startup or explicit repair inspection, the local engine:

1. validates store version and integrity before writes;
2. finds accepted or running invocations without a terminal coordinator event;
3. identifies owned child processes when the platform permits;
4. terminates or reconciles surviving children;
5. marks begun attempts `error` or `cancelled` with exact recovery reasons;
6. quarantines partial Evidence, protocol output, cache entries, and scratch;
7. completes or rolls back atomic publication records;
8. releases expired locks using owner identity and lease checks;
9. emits a recovery event and bounded diagnostic summary.

Recovery never converts partial output to validated Evidence or a pass. A
quarantined artifact may be retained for bounded diagnosis only after
classification and redaction; it cannot enter evaluation or cache.

### 8.2 Hosted reconciliation

Hosted reconcilers detect:

- committed invocations missing queue offers;
- expired claims and silent workers;
- stale workers holding invalid fencing tokens;
- terminal invocations missing retrievable canonical projections;
- outbox records not acknowledged by a projection;
- usage reservations without finalization or release;
- deletion requests with incomplete active-store or backup stages;
- ledger and invoice aggregate mismatches.

Reconcilers append corrective operational events. They never overwrite an
attempt, fabricate Evidence, re-evaluate a Promise, or edit an invoice line.

### 8.3 Failure matrix

| Failure | Required posture |
|---|---|
| Cache corruption | Quarantine entry, record diagnosed miss, continue uncached |
| Local history persistence failure | Fail closed for any result requiring the missing record; no success |
| Scratch exhaustion | Terminate affected action, record resource error, preserve bounded diagnostics |
| Plugin crash/hang/flood | Contain to attempt, terminate process tree, apply retry rules |
| Provider outage/rate limit | Operational network/plugin reason; optional bounded retry; never Proof failure |
| Control-plane outage | Local operation continues; remote admission/retrieval exposes service failure |
| Broker outage | Keep committed outbox; stop or bound admission; recover offers later |
| Worker loss | Fence stale worker, reconcile begun attempt, redeliver only when safe |
| Database unavailability | Stop state-changing admission and claim progression; serve only safe stale reads explicitly labeled |
| Object-store unavailability | No success requiring an uncommitted object; retain or quarantine bounded local staging |
| Redaction/classification failure | Fail closed for persistence, telemetry, or upload |
| Region loss | Invoke documented disaster recovery; do not route around tenant region policy |
| Suspected secret disclosure | Stop affected export path, revoke handles, preserve sanitized audit Evidence, follow incident process |
| Usage anomaly | Stop invoice finalization for affected scope; preserve service where safe under conservative quota policy |

## 9. Service objectives and recovery objectives

### 9.1 Phase 1 local objectives

Phase 1 has no service availability SLO because it has no required service.
Release objectives are conformance and performance budgets:

- warm passive discovery of the reference 100,000-file repository within five
  seconds at p95;
- engine overhead excluding tool/plugin work below one second at p95;
- zero DNS, socket, registry, update, analytics, or cloud activity during idle
  local operation;
- process-tree termination begins within one second after interruption;
- configured memory, disk, file, process, output, scratch, duration, and
  concurrency limits hold under adversarial fixtures;
- crash injection at every durable boundary exposes no uncommitted pass,
  partial Evidence hit, or corrupted authoritative record.

Local durability depends on the selected store and host filesystem. The
pre-beta local-store ADR must publish the fsync/atomicity assumptions and the
recovery guarantee. The product must not promise an RPO stronger than the
underlying selected primitive.

### 9.2 Initial hosted service targets

These are readiness targets for a future hosted beta, not current product
claims:

| Surface | Service level indicator | Initial objective |
|---|---|---|
| Control API | Authorized valid requests receiving a valid transport response | 99.9% monthly |
| Result retrieval | Existing retained result returned within latency target | 99.9% monthly; p95 under 1 second |
| Dispatch admission | Accepted invocation durably committed and offered or present in outbox | 99.9% monthly; p95 under 2 seconds |
| Worker claim latency | Eligible queued work claimed while compatible capacity exists | 99% under 30 seconds |
| Cancellation | Accepted cancellation reaches active workload and begins local process-tree termination | 99% under 5 seconds end-to-end; worker-local one-second budget still applies |
| Publication | Allowlisted completed projection durably retrievable after acceptance | 99.9% monthly; p95 under 10 seconds |
| Deletion active-store stage | Eligible deletion removes active payload and installs tombstone | 99.9% within 24 hours |

The SLI denominator excludes invalid or unauthorized requests, client-abandoned
requests before admission, provider outages, customer workload downtime, and
Proof action duration. Exclusions are explicit, bounded, and reported; they do
not erase platform-caused failures.

Verification outcome never appears in an availability SLI. A valid
`violated`, `indeterminate`, `blocked`, or `cancelled` envelope can be a
successful service operation.

### 9.3 RPO and RTO

Before hosted beta, disaster-recovery Evidence must demonstrate:

| Data or capability | Target RPO | Target RTO |
|---|---:|---:|
| Canonical hosted metadata, audit, authorization, deletion, and usage ledger | 5 minutes | 4 hours |
| Queue offers and search indexes | Rebuildable from committed records | 1 hour after authority is available |
| Telemetry | 24 hours | 24 hours |
| Control-plane read path | Not applicable beyond authoritative data RPO | 4 hours |
| New dispatch admission | Not applicable beyond authoritative data RPO | 4 hours |

These targets do not override tenant region, deletion, or legal-hold policy.
No multi-region claim is made until failover tests prove identity, authorization,
fencing, encryption, queue, object, and database behavior together.

## 10. Telemetry and audit operations

### 10.1 Local observability

The local engine emits the frozen versioned event stream. Human logs,
diagnostic bundles, and optional OpenTelemetry output are projections.

Default local operation:

- writes no telemetry to the network;
- does not require a collector;
- keeps machine stdout pure in JSON and JSONL modes;
- sends human progress and diagnostics only to the designated channel;
- redacts at event creation and again before rendering or export;
- records invocation, stage, scheduler, plugin, cache, authorization, and
  persistence timing with explicit volatile-field annotation.

### 10.2 Hosted operational telemetry

Hosted telemetry may include:

- API request rate, valid response rate, and latency;
- admission, queue age, claim age, lease expiry, retry, and quarantine counts;
- worker capacity, saturation, process termination, and enforcement tier;
- database, broker, object-store, and outbox health;
- redaction and classification failures;
- cache eligibility, hit, miss, bypass, corruption, and eviction;
- storage bytes and retention backlog by data class;
- provider-neutral error category and stable code;
- usage reservation, finalization, adjustment, and reconciliation counts;
- deployment version, compatibility, and rollback signals.

Telemetry dimensions are allowlisted and cardinality-bounded. Tenant IDs are
opaque and restricted; invocation IDs are sampled or purpose-bound; object
revisions, repository names, paths, arguments, URLs, source, Evidence content,
secret handles, plugin output, and raw error text are excluded.

Metrics and traces are not audit or billing records. Sampling may apply to
telemetry but never to required domain, security audit, deletion, or usage
events.

### 10.3 Alerting

Alerts are tied to user impact or integrity risk, including:

- SLO burn rate;
- queue age or claim-expiry growth;
- reconciliation backlog;
- persistence or outbox failure;
- worker crash and quarantine rate;
- cancellation-budget violation;
- redaction, integrity, authorization, or cross-tenant control failure;
- deletion or backup-expiry breach;
- usage reconciliation or invoice-finalization mismatch;
- capacity exhaustion and cost anomaly.

Each production alert has an owner, severity, runbook, safe mitigation, and
test signal. Alert volume itself is reviewed to prevent ignored integrity
failures.

## 11. Incident management

Production incidents are categorized by:

- confidentiality or tenant isolation;
- authorization or credential exposure;
- provenance or verification integrity;
- availability and queue delay;
- data durability, retention, or deletion;
- billing or quota correctness;
- supply chain or release integrity.

For every incident:

1. contain the affected path without rewriting domain history;
2. preserve sanitized, access-controlled incident Evidence;
3. revoke credentials, workers, artifacts, or releases when applicable;
4. stop publication, execution, or invoice finalization when integrity is
   uncertain;
5. communicate user impact using operational language, not false verification
   claims;
6. recover from authoritative records and validate invariants;
7. append corrections, tombstones, or ledger adjustments rather than editing
   facts;
8. produce a blameless review with conformance Repairs and owners.

An operator may cancel, quarantine, re-offer, revoke, or roll back infrastructure.
An operator may not mark a Proof passed, choose a different effective attempt,
manufacture Evidence, erase a failed attempt, or mark a Repair verified.

## 12. Usage ledger

This section defines a future capability that can exist without selecting a
pricing model. Phase 1 emits no product usage records.

### 12.1 Metering boundary

Only a trusted engine, worker supervisor, control-plane admission service, or
storage accounting service may originate usage facts. Repository content,
plugins, adapters, provider responses, client-supplied metrics, and telemetry
collectors cannot originate billable quantities.

Provider-neutral measurable dimensions may include:

- accepted invocation count;
- worker CPU and memory allocation duration;
- action execution duration;
- network egress bytes by approved destination class;
- retained storage byte-time by data class;
- Evidence processing bytes;
- explicitly authorized provider call count when independently observable.

These are accounting primitives, not prices. Founder decision F-003 selects
which dimensions, if any, are chargeable and how allowances or prices apply.

### 12.2 Ledger record invariants

Each future usage fact contains:

- globally unique usage event ID;
- tenant and billing-account scope;
- service, meter, and meter-schema revisions;
- source invocation, claim, attempt, storage object, or admission reference;
- event interval and trusted measurement source;
- non-negative quantity and unit;
- billability state under an exact policy revision;
- region and data classification;
- producer identity and artifact digest;
- idempotency identity;
- append time and causal event.

The ledger is append-only. Corrections use signed adjustment records that cite
the original entry and reason. A quantity is never silently edited or deleted.
Pricing produces separately versioned rated lines; rerating never changes raw
usage.

The uniqueness key includes tenant, meter revision, source reference, measured
interval, and measurement class. Duplicate API delivery, queue redelivery,
worker retry, outbox replay, telemetry replay, or invoice rerun cannot add a
second charge for the same usage fact.

### 12.3 Reservation and finalization

Quota or spend enforcement uses a reservation ledger:

1. admission estimates the maximum bounded usage under the sealed plan;
2. an idempotent tenant-scoped reservation is committed;
3. worker execution records trusted actual consumption;
4. terminal reconciliation finalizes actual quantity and releases the unused
   reservation;
5. an abandoned reservation expires only through a reconciler that proves no
   live fenced claim remains.

Reservation prevents concurrent work from oversubscribing a tenant limit. It
does not determine Proof applicability or verdict. If quota prevents required
work, the result is operationally blocked or indeterminate with a typed resource
reason; the Promise is not failed.

### 12.4 Billing invariants

- Local offline execution is never billable by the product.
- No account, tenant, or usage upload is required for local operation.
- Verification outcome does not determine whether infrastructure was consumed.
- A failed Promise is not a surcharge; a passed Promise is not proof of a
  valid charge.
- Automatic Proof retries cannot create duplicate fixed-unit charges.
  Consumption-based retry treatment must be explicit in the price policy and
  disclosed before execution.
- Queue delivery and lease renewal are never separately customer-billable.
- Provider charges are not product charges unless a contract explicitly says
  so; provider credentials and invoices remain separate.
- Quota rejection occurs before expensive work where possible and is
  operational, not semantic.
- Usage records contain no source, secret, path, raw Evidence, prompt, or
  plugin diagnostic content.
- Tenant isolation applies to usage ingestion, aggregation, export, adjustment,
  invoice, and support tooling.
- Invoice finalization stops when reconciliation, completeness, uniqueness, or
  pricing-version checks fail.
- Customer-visible usage can be traced to sanitized source references and an
  exact meter and price policy without exposing protected execution data.

## 13. Scalability and cost controls

### 13.1 Local controls

Local scale is bounded by policy and reference hardware, not by unbounded
parallelism. Cost controls are:

- passive discovery pruning and hard traversal limits;
- shared prerequisite execution once per invocation;
- stable CPU-aware concurrency;
- per-plugin and network concurrency;
- bounded output and scratch storage;
- safe local cache reuse with complete provenance;
- early cancellation and deadline propagation;
- no hidden update, registry, analytics, or cloud call.

An optimization is invalid if it weakens determinism, Evidence quality,
redaction, provenance, isolation, or cancellation.

### 13.2 Hosted controls

Future hosted controls include:

- admission quotas and maximum plan cost;
- tenant, workload, plugin, network-class, and global concurrency;
- worker pool minimum/maximum and scale rate;
- maximum queue age and bounded priority;
- hard process, CPU, memory, duration, output, scratch, file, and egress limits;
- storage quotas and class-specific retention;
- broker payload and API body limits;
- idempotent request and publication deduplication;
- safe cache and shared-prerequisite reuse;
- provider-neutral circuit breakers for repeated operational errors;
- budget alerts and anomaly detection;
- explicit suspension of expensive optional work before admission, never
  silent omission of an applicable required Proof.

Capacity or cost exhaustion produces a typed operational condition. The engine
must not change `failed` to `passed`, drop required Proofs, substitute stale
Evidence, or claim completed verification to meet a budget.

### 13.3 Capacity model

Capacity planning measures:

- admitted and concurrent invocations;
- DAG nodes and CPU weight per invocation;
- worker seconds by enforcement tier;
- memory allocation duration;
- queue age and service time distributions;
- plugin and provider latency/rate-limit distributions;
- scratch, Evidence, run-history, audit, telemetry, and backup storage;
- database transaction and outbox rates;
- broker offers, claims, renewals, and redeliveries;
- allowed egress bytes and provider call rates.

The model separates user Proof time from engine overhead and separates external
provider latency from platform saturation. Forecasts include peak tenant
concentration, retry amplification, regional failover headroom, deployment
drain capacity, retention growth, and deletion backlog.

## 14. Deployment operations

### 14.1 Phase 1 release

The MVP deployment is an npm artifact, not a service rollout. Release requires:

- version-pinned, integrity-verifiable artifacts;
- source provenance, signed release artifacts, SBOM, dependency and
  vulnerability review;
- no install or postinstall scripts;
- current/previous schema and stored-artifact compatibility Evidence;
- conformance across every supported OS and runtime;
- deterministic golden fixtures and zero-network offline tests;
- rollback by pinning a previously supported artifact, without mutating stored
  history.

The resolved package version and digest are recorded in each execution
manifest. A running invocation never auto-upgrades the engine, plugin, schema,
or policy.

### 14.2 Future hosted deployment

Hosted releases separate:

- control-plane API and authorization;
- queue/outbox and reconciliation;
- workload or hosted worker data plane;
- storage and migration jobs;
- telemetry and usage processing;
- customer-facing projections.

Deployment uses immutable artifacts and exact digests. A dispatch binds a
compatible worker range and the claim records the selected worker digest.
In-flight invocations remain on the selected compatible revision or are
cancelled and retried only under normal recovery rules; rollout does not
silently move an attempt to new semantics.

Database and event changes use expand, migrate, verify, and contract phases.
Readers support current and immediately previous majors. Unknown control-flow
values fail closed. Destructive migration waits until rollback, old-reader,
backup, retention, and deletion implications are proven.

Canarying compares operational metrics and canonical-equivalent fixtures.
Feature flags may gate availability or routing but cannot reinterpret a
Promise, Proof status, result, permission, schema, or billing policy without
the required versioned contract and ADR.

Rollback:

- stops new admission to the affected artifact;
- drains or fences incompatible claims;
- restores the last compatible immutable release;
- does not reverse append-only domain or ledger facts;
- runs integrity and reconciliation checks before normal admission resumes.

### 14.3 Operational readiness gate

Before any hosted beta:

- required freeze ADRs are accepted;
- workload identity, region, retention, deletion, backup, and legal-hold
  controls are implemented;
- queue claim, lease, fencing, idempotency, and reconciliation tests pass;
- SLOs, RPO, and RTO have measured Evidence;
- security reviews hosted execution and every cloud payload;
- capacity and cost load tests cover retry storms and tenant concentration;
- incident, rollback, restore, deletion, and billing-anomaly drills pass;
- dashboards, alerts, runbooks, and ownership exist;
- no hosted dependency has entered the local default path.

## 15. Acceptance tests

### 15.1 Local proof execution

| ID | Acceptance condition |
|---|---|
| `ORB-LOCAL-001` | Default local invocation performs no DNS, socket, registry, update, analytics, usage, or cloud activity |
| `ORB-LOCAL-002` | Scheduler bounds queued work, CPU weight, plugin/network concurrency, processes, memory, duration, output, scratch, and files |
| `ORB-LOCAL-003` | Schedule randomization produces canonical-equivalent results and stable result ordering |
| `ORB-LOCAL-004` | Cancellation stops admission and begins full process-tree termination within one second |
| `ORB-LOCAL-005` | Resource exhaustion is a typed operational reason and never a failed Proof |
| `ORB-LOCAL-006` | Two concurrent invocations share no mutable attempt state and cannot corrupt run or cache publication |

### 15.2 Queues, leases, and idempotency

| ID | Acceptance condition |
|---|---|
| `ORB-QUEUE-001` | Duplicate admission with the same scoped key and request returns one invocation; a changed request is rejected |
| `ORB-QUEUE-002` | Broker loss after authoritative commit is recovered from the outbox without a second invocation |
| `ORB-QUEUE-003` | Duplicate, delayed, and reordered offers create no duplicate claim-owned transition or usage event |
| `ORB-QUEUE-004` | Expired or revoked claim fencing prevents stale result, Evidence, cache, and usage publication |
| `ORB-QUEUE-005` | Lease loss before action start redelivers without a new Proof attempt; loss after start preserves an error/cancelled attempt |
| `ORB-QUEUE-006` | Queue overload applies bounded backpressure and fairness without changing canonical semantics |
| `ORB-QUEUE-007` | Quarantine creates a retrievable operational state and alert; no invocation silently disappears |
| `ORB-QUEUE-008` | Cross-tenant or substituted workload bindings fail authorization at router and workload |

### 15.3 Retries and recovery

| ID | Acceptance condition |
|---|---|
| `ORB-RETRY-001` | Only retry-safe `error` attempts with allowlisted codes and remaining deadline create a new attempt |
| `ORB-RETRY-002` | `passed`, `failed`, `indeterminate`, and `cancelled` never retry to seek another verdict |
| `ORB-RETRY-003` | Every retry preserves prior attempt, manifest, error, delay, policy, and causal links |
| `ORB-RETRY-004` | Provider internal retry is disabled or bounded, declared, observable, and included in attempt metadata |
| `ORB-RETRY-005` | Uncertain external side effects prevent retry without destination idempotency or reconciliation Evidence |
| `ORB-RECOVERY-001` | Crash injection at every durable boundary never exposes partial Evidence, a fabricated pass, or a cache hit |
| `ORB-RECOVERY-002` | Abandoned local runs terminate/reconcile children, quarantine partials, and append recovery events |
| `ORB-RECOVERY-003` | Hosted reconciler repairs missing offers, expired claims, projections, usage reservations, and deletion stages idempotently |

### 15.4 Storage, retention, and disaster recovery

| ID | Acceptance condition |
|---|---|
| `ORB-STORE-001` | Atomic append batches either fully exist or are invisible after power-loss simulation |
| `ORB-STORE-002` | Cache clear cannot delete authoritative run/Evidence history; run deletion cannot be reported as cache eviction |
| `ORB-STORE-003` | Corrupt, partial, incompatible, or orphaned cache entries are diagnosed misses |
| `ORB-STORE-004` | Authorized deletion removes protected payload, appends tombstone, returns `deleted_reference`, and does not restore from backup |
| `ORB-STORE-005` | Tenant isolation tests cover rows, objects, queue refs, indexes, backups, telemetry, usage, and support paths |
| `ORB-STORE-006` | Current and previous artifact majors migrate or remain readable without changing semantic digests |
| `ORB-DR-001` | Restore and regional failover drills meet published RPO/RTO while preserving fencing, identity, authorization, and deletion |
| `ORB-DR-002` | Queue and search projections rebuild from authoritative records without changing canonical results |

### 15.5 Telemetry, SLOs, and incidents

| ID | Acceptance condition |
|---|---|
| `ORB-OBS-001` | Canary source, paths, arguments, URLs, secret values, Evidence bodies, and raw plugin output never enter telemetry |
| `ORB-OBS-002` | Metrics, traces, and logs can be deleted without losing audit, usage, or canonical domain history |
| `ORB-OBS-003` | SLI fixtures count valid violated/indeterminate envelopes as service successes and platform transport failures as failures |
| `ORB-OBS-004` | Alert tests cover SLO burn, queue delay, worker loss, redaction, persistence, deletion, and usage mismatch |
| `ORB-INC-001` | Operators can quarantine, cancel, revoke, and roll back but cannot alter Proof verdicts or provenance |
| `ORB-INC-002` | Secret, integrity, deletion, regional, and billing game days produce retained sanitized Evidence and Repairs |

### 15.6 Usage and billing

| ID | Acceptance condition |
|---|---|
| `ORB-USAGE-001` | Phase 1 creates and uploads no product usage or billing record |
| `ORB-USAGE-002` | Only trusted producers can append usage; plugin/client/telemetry attempts are rejected |
| `ORB-USAGE-003` | Duplicate delivery, queue redelivery, retry, outbox replay, and invoice rerun cannot duplicate a usage fact |
| `ORB-USAGE-004` | Adjustments preserve original entries and reference authority, reason, meter, and price policy |
| `ORB-USAGE-005` | Reservation, finalization, release, and abandoned-reservation reconciliation are tenant-safe and idempotent |
| `ORB-USAGE-006` | Quota exhaustion blocks or makes required work indeterminate without changing a Promise to failed |
| `ORB-USAGE-007` | Invoice finalization fails closed on missing, duplicate, unreconciled, or incompatible usage |
| `ORB-USAGE-008` | Usage export contains no source, secret, raw Evidence, path, prompt, or plugin diagnostics |

### 15.7 Deployment, scale, and cost

| ID | Acceptance condition |
|---|---|
| `ORB-REL-001` | MVP artifacts have signed provenance, SBOM, vulnerability review, integrity verification, and no npm lifecycle script |
| `ORB-REL-002` | Rollback to the previous supported artifact reads retained history without revision mutation |
| `ORB-DEPLOY-001` | Mixed current/previous workers reject incompatible work before permission or secret grant |
| `ORB-DEPLOY-002` | Canary and rollback do not reassign an in-flight attempt to a different artifact |
| `ORB-SCALE-001` | Load tests cover tenant concentration, retry amplification, provider latency, worker loss, failover, and retention backlog |
| `ORB-COST-001` | Hard cost bounds yield typed operational conditions without omitting required Proofs or weakening Evidence |
| `ORB-COST-002` | Capacity report separates engine, Proof/tool, provider, storage, egress, queue, and retry costs |

Flaky operational, recovery, deletion, tenant-isolation, or billing tests are
failed gates. Re-running until green is not acceptance.

## 16. Cross-domain operational review

The review explicitly covered Proof execution, queues, retries, storage, and
infrastructure cost. Severity describes impact before the named resolution or
gate is complete.

| Area | Severity | Finding | Resolution or required gate |
|---|---|---|---|
| Proof execution | Major | The frozen profile requires resource and sandbox controls, but exact OS backends and enforcement tiers are not selected | Preserve fail-closed/degraded-override semantics; resolve required pre-beta sandbox ADR before dynamic commands ship |
| Proof execution | Minor | A child-process boundary provides fault containment but is easy to overstate as security isolation | Record and expose effective enforcement tier; conformance wording must not claim unsupported sandboxing |
| Queues | Major | At-least-once delivery can otherwise create duplicate invocations, stale writes, or hidden attempts | This draft separates durable admission, broker offers, fenced claims, and Proof attempts; hosted beta requires `ORB-QUEUE-*` Evidence |
| Queues | Deferred | No broker, database, region, or managed service is selected | Keep logical contracts vendor-neutral; select under D-002 before hosted implementation |
| Retries | Major | Adapter, broker, engine, and provider SDK retries can compound and violate attempt semantics | Engine is sole Proof retry authority; provider retries are disabled or bounded/observable; all other retries are idempotent transport behavior |
| Retries | Minor | Random hosted delivery backoff could be mistaken for semantic Proof retry jitter | Keep broker backoff outside attempt semantics; Phase 1 Proof retry backoff remains deterministic |
| Storage | Major | Local path, format, fsync guarantees, retention, purge, and encryption posture remain unresolved | Required local-store ADR under Freeze §20.1(5) is a public-beta gate |
| Storage | Major | Cloud retention, deletion, backup, region, and legal-hold policy are unresolved | Required cloud data ADR under Freeze §20.1(6) is a hosted-beta gate |
| Storage | Minor | Treating cache as history would make eviction destroy provenance | Run history and cache remain separate; cache clear cannot delete authority |
| Infrastructure cost | Major | Unbounded queueing, retries, outputs, retention, and provider calls can create runaway cost | Admission, plan bounds, concurrency, retry caps, quotas, retention, and anomaly gates are required before hosted beta |
| Infrastructure cost | Deferred | Chargeable meters, included allowance, currency, and price are founder decisions | Keep usage primitives price-neutral; F-003 remains open and MVP has no billing |
| Billing | Major | Telemetry-based billing would be lossy, sampleable, and replay-prone | Use a separate trusted append-only usage ledger, idempotent reservations, finalization, and reconciliation |
| Billing | Deferred | Refunds, credits, taxes, payment processor, dunning, and invoice presentation have no MVP use case | Exclude from EDD implementation roadmap until pricing and hosted product exist |
| Reliability | Major | SLO claims without denominator and disaster-recovery Evidence could hide customer-impacting failure | Use explicit SLIs and measured game-day gates; hosted targets are not current claims |
| Deployment | Minor | Auto-upgrade or mixed workers could change in-flight semantics | Pin exact artifacts per attempt and reject incompatibility before grants |

**Blocking findings:** None in the frozen architecture or local MVP after this
review. The unresolved Major items are explicit release gates: the local-store
and sandbox selections block public beta features that depend on them; cloud
data, queue, identity, and recovery selections block hosted beta.

No frozen decision was found untenable, so this draft submits no architecture
change proposal. In particular, a future product-managed verification worker
does not turn the platform into a general CI or deployment fleet: it executes
only sealed verification plans through the canonical engine.

## 17. MVP, post-MVP, and long-term recommendation

### MVP

- Local bounded scheduler and process ownership.
- Append-safe local history, Evidence, audit, scratch, and cache separation.
- Crash recovery and cache corruption handling.
- Local structured events and human diagnostics.
- Reference performance and resource-bound Evidence.
- Release provenance, SBOM, compatibility, and rollback.
- No cloud queue, hosted worker, service SLO, remote telemetry, usage ledger,
  quota, pricing, invoice, or payment.

### Post-MVP

- Local MCP and GitHub Action profiles remain execution-local.
- Metadata publication and authorized workload routing.
- Durable admission, outbox, queue, fenced claims, and reconciliation.
- Cloud retention/deletion and disaster recovery.
- Hosted service SLIs and operational telemetry.
- Price-neutral usage ledger and quotas only when a concrete hosted need exists.

### Long-term

- Product-managed hosted verification workers after sandbox and data gates.
- Regional placement and enterprise workload identity.
- Attested Evidence exchange.
- Charging, allowances, and invoices only after founder pricing decision and
  billing conformance.

The fastest credible release remains the useful local CLI. Hosted reliability
and billing architecture must not delay it or introduce a network dependency
into its default path.
