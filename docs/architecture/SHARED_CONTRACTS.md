# Shared Contracts

**Status:** Contract registry
**Authority:** Index of freeze-derived machine contracts
**Owner:** Founding Engineering
**Governing reference:** [ARCHITECTURE_FREEZE.md](ARCHITECTURE_FREEZE.md)

This document identifies contracts shared by packages and applications. It does
not duplicate their full schemas.

| Contract | Frozen authority | Intended owner |
|---|---|---|
| Application Model objects and revisions | Freeze §5 | Domain package |
| Promise-Proof binding revisions | Freeze §5.4.1 | Domain package |
| Promise aggregation and Proof results | Freeze §§5.4–5.6 | Evaluation package |
| Evidence and provenance graph | Freeze §§5.7, 5.10 | Evidence package |
| Repair and Repair Knowledge | Freeze §5.8 | Repair package |
| Canonical lifecycle | Freeze §6 | Engine package |
| Execution plan and manifest | Freeze §8 | Execution package |
| Plugin protocol and manifest | Freeze §9 | Plugin SDK/runtime packages |
| Authentication and authorization | Freeze §10 | Authentication package |
| Cloud publication and provider egress | Freeze §11 | Boundary packages |
| Command request/result/event protocols | Freeze §12 | Protocol package |
| Cache identity and provenance | Freeze §13 | Execution package |
| Audit event protocol | Freeze §16 | Audit package |
| Compatibility guarantees | Freeze §17 | Release tooling |

## Frozen package boundaries

The initial monorepo package boundaries are:

| Package responsibility | May depend on |
|---|---|
| `contracts` — domain types, schemas, canonical encoding | no runtime package |
| `events` — event envelope and audit event schemas | `contracts` |
| `discovery` — passive repository fact discovery | `contracts`, `events` |
| `proofs` — planning, evaluation, aggregation | `contracts`, `events` |
| `evidence` — capture normalization, integrity, provenance | `contracts`, `events` |
| `repair` — deterministic and advisory repair generation | `contracts`, `events` |
| `execution` — plans, scheduler, process controls, cache | `contracts`, `events` |
| `auth` — principals, grants, secret references and broker ports | `contracts`, `events` |
| `plugin-sdk` — provider-facing contract bindings | `contracts` |
| `plugin-runtime` — plugin discovery, protocol and containment | `contracts`, `events`, `execution`, `auth` |
| `engine` — canonical lifecycle orchestration | all domain services through public ports |
| `protocol` — command request/result/event encodings | `contracts`, `events` |
| `cloud-client` — optional publication and policy client | `protocol`, `auth`, `events` |

Applications depend on package APIs. Packages MUST NOT depend on applications.
`contracts` MUST remain free of I/O, provider SDKs, process globals, filesystem
access, network access, and framework types. Cycles are prohibited.

## Event envelope

Every lifecycle and audit event uses this semantic envelope:

| Field | Requirement |
|---|---|
| `schemaVersion` | Independent positive integer major |
| `eventId` | Globally unique opaque ID |
| `eventType` | Stable past-tense domain event name |
| `occurredAt` | RFC 3339 UTC metadata timestamp |
| `invocationId` | Required correlation ID |
| `subject` | Exact object ID and revision when applicable |
| `causationId` | Event or command that directly caused this event |
| `correlationId` | End-to-end workflow correlation |
| `sequence` | Monotonic within an invocation stream |
| `producer` | Component ID, version, and artifact digest |
| `dataClassification` | Highest classification in payload |
| `payload` | Event-type-specific, schema-validated object |

Events are facts in past tense. Commands and desired state MUST NOT be encoded
as events. Event payloads use exact revisions, not mutable aliases. Redaction
occurs before envelope creation.

## Error model

All machine errors use `StructuredError` and a stable code shaped as
`VFY_<DOMAIN>_<CONDITION>`, for example `VFY_PLUGIN_TIMEOUT`. Codes do not embed
provider names.

Each error declares:

- category: `invalid`, `permission`, `authentication`, `environment`, `plugin`,
  `network`, `integrity`, `compatibility`, `resource`, or `internal`;
- retryability: `never`, `safe`, or `policy_required`;
- whether it blocks a required Proof;
- sanitized human message and optional remediation;
- causal chain using other structured errors;
- exact component and operation;
- Evidence or diagnostic references when available.

Errors are operational facts. They MUST NOT be used as `failed` Proof results.
Unknown error codes are treated according to their category; an unknown category
is an incompatible control-flow value and fails safely.

## Identity and semantic comparison

`SemanticIdDeriver` produces sealed logical IDs from versioned,
domain-separated stable natural keys; it never uses a random source.
`EphemeralIdSource` produces invocation, attempt, event, transport, and storage
IDs, which MUST NOT enter semantic revision preimages.

MVP natural keys are:

- workspace: explicit repository ID, otherwise a versioned local-only digest of
  stable VCS/root identity signals;
- Application: workspace ID plus normalized repository-relative root and
  declared package identity;
- Capability: Application ID plus capability type and scope;
- Promise: subject ID plus predicate ID and declared scope;
- Proof: evaluator ID, evaluator version, predicate language revision, and
  Evidence requirement identity;
- discovery signal/fact: reader ID, normalized relative input, structured
  pointer, and signal kind.

Ambiguous or unavailable natural identity produces a typed model-construction
diagnostic; it MUST NOT fall back to randomness.

`resultDigest` covers the exact execution manifest revision, terminal verdict,
sanitized observation content identities, Evidence content identities and
validation decisions, evaluator identity, reason codes, and stable ordering. It
excludes invocation, attempt, event, transport, wall-clock, cache provenance,
and storage-locator identity. `attemptRecordDigest` separately covers the full
immutable attempt record.

There are two protocol-owned comparison modes:

- `interfaceParity`: compares projections of the same retained invocation and
  requires every field authorized for that projection to match;
- `reexecutionDeterminism`: compares independent executions by stable model,
  plan, evaluator, observation content, verdict, reason, and order while
  preserving but not requiring equality of attempt ID, capture time, Evidence
  revision, cache provenance, or storage location.

Adapters MUST NOT implement private normalization rules.

## Atomic persistence boundary

The Engine writes through `EngineUnitOfWork`. One commit atomically validates
and makes visible revision documents, lifecycle/audit events, invocation and
attempt records, current-model compare-and-supersede state, publication
mappings, and exact reference edges. Each commit carries an idempotency identity
and expected sequence/current-revision predicates.

The required atomic units are:

1. discovery plan plus authorization events;
2. discovered facts/signals plus completion event;
3. sealed model children, Promise-Proof bindings, model revision, seal event,
   and current-model supersession;
4. execution plan plus authorization decision;
5. attempt start plus immutable attempt reference;
6. Evidence revision plus capture event and attempt edge;
7. validation event plus Evidence validation decision;
8. terminal Proof result plus effective-attempt selection;
9. Promise aggregation plus provenance edges;
10. Repair revision plus proposal event;
11. invocation terminal result plus completion event;
12. publication mapping/result or deletion tombstone and all affected edges.

Readers expose either the complete committed unit or none of it. A backend
without native transactions requires a durable prepare/commit marker protocol;
recovery never guesses a semantic result.

## Result schema

The canonical command result is the Freeze §12 common envelope plus a
command-specific `result` selected by `result.kind`. Verification results
contain:

- exact Application Model revision;
- selected Promise and Proof revisions;
- every attempt and one explicit effective attempt per required Proof;
- derived Promise statuses;
- exact Evidence and validation-event references;
- Repair suggestions and verification links;
- diagnostics, cache provenance, and execution manifest references;
- `operationalStatus`, verification `outcome`, and their deterministic CLI exit
  mapping.

Human output, MCP responses, GitHub checks, REST resources, and cloud views are
projections of this result and MUST NOT calculate an independent verdict.

Local verification, remote dispatch, and publication are distinct contracts:

| `result.kind` | Meaning |
|---|---|
| `verify` | Full canonical result retained in the authorized Engine boundary |
| `dispatchVerification` | Routing receipt with `accepted`, `unavailable`, `unauthorized`, `expired`, `cancelled`, or `transport_error` |
| `publishedVerification` | Allowlisted Cloud Boundary projection; never a substitute for `verify` |
| `getRun` | Authorized local retained-run retrieval |
| `getPublishedRun` | Authorized retrieval of an allowlisted published projection |

Routing outcomes MUST NOT be encoded as Proof results or as a fabricated verify
`operationalStatus` when no Engine invocation occurred.

An exact local reference uses `RevisionRef`. A cloud-safe reference uses a
separate `PublishedObjectRef` containing object type, opaque publication ID, and
tenant binding. It MUST NOT be parsed as or compared to a local semantic
revision. The local publication record retains the mapping.

Remote parity compares a published projection with the pure projection derived
from the same local result. It does not compare privacy-reduced remote output to
the full CLI document.

## Cloud authorization

The initial cloud action catalog is exactly `project:read`, `dispatch:create`,
`dispatch:cancel`, `run:publish`, `run:readPublished`, `policy:read`,
`policy:admin`, `membership:admin`, `deletion:request`, and `usage:read`.
Authorization evaluates an authenticated audience-bound principal, one action,
one tenant, and one exact server-resolved resource. Role and membership names
are expanded server-side into expiring policy-revision grants and never enter
the enforcement decision. User, workload, and operator identities receive no
ambient tenant authority.

Wrong-tenant IDs, wrong parent resources, missing resources, absent membership,
and IDOR attempts return the same `NOT_AUTHORIZED` decision. Authentication,
audience, validity, revocation, and malformed-request failures remain distinct
because they are resolved before any resource-existence lookup.

## Publication intent and ingestion

A metadata upload requires a signed `verify-cloud-publication` intent valid for
at most five minutes. The intent binds the exact tenant, project, purpose,
disclosure-manifest and payload digests, idempotency key, retention class,
policy ID and revision, nonce, and count/byte limits. It expires no later than
the disclosure manifest or authorizing policy.

Ingestion accepts only identity-encoded `application/json`, checks the encoded
byte limit before parsing, rejects excessive JSON depth, and reruns the closed
metadata schema and disclosure byte comparison. The tenant-scoped idempotency
key and nonce are admitted atomically: an exact request retry returns the
original receipt, while changed request bytes or nonce reuse fail without
partial admission. A production store must implement the same atomic operation;
the in-memory store is a conformance backend only.

Successful admission creates an immutable published-run record and one
`PublishedRunAccepted` outbox event in the same transaction as idempotency and
nonce consumption. The record retains the exact validated allowlisted
`PublishedVerificationResult`; reads return it as stored and never recalculate
an outcome. Its published references must use the ADR-0012 `pub_v1_` format, so
a raw local revision cannot masquerade as a cloud identifier.

Outbox delivery is at-least-once. Each event has one stable identity; claims use
bounded expiring leases and monotonically increasing fences. Only the current
unexpired fence may acknowledge or release a delivery, retries reuse the same
event, and exhausted attempts retain sanitized metadata only.

## Provider request boundary

The initial network-capable Plugin Contract grants no raw socket authority.
Plugins submit schema-validated `ProviderRequest` values to an Engine-controlled
egress broker. The broker owns DNS resolution, redirect policy, destination
allowlists, provider credential attachment, request-size limits, redaction,
response bounds, audit, cancellation, and disclosure enforcement.

Direct plugin network access is a future permission mode requiring an accepted
ADR and security equivalence Evidence. A provider SDK that requires ambient
network, proxy, telemetry, or credential discovery is incompatible with the
initial runtime.

## API conventions

- JSON field names use `camelCase`; TypeScript type names use `PascalCase`.
- IDs are opaque strings. Exact historical references include `id` and
  `revision`.
- Timestamps are RFC 3339 UTC; durations are integer milliseconds.
- Byte counts are non-negative integers. Ratios and confidence are decimal
  numbers from `0` through `1`.
- Optional means absent; `null` is used only when the schema assigns it a
  distinct meaning.
- Collections have an explicit stable order. Maps with untrusted keys are
  prohibited at trust boundaries.
- REST paths are plural nouns under `/v1`; actions that do not map to resource
  creation use explicit subresources.
- List APIs use opaque cursor pagination and bounded `limit`.
- Mutating and publication requests require idempotency keys.
- Deadlines and cancellation propagate end to end.
- Unknown additive fields are ignored. Unknown control-flow values fail as
  incompatible.
- Protocol schemas, engine packages, and plugin protocols version
  independently under Freeze §17.

## Contract artifact requirements

Each stable contract MUST provide:

- a machine-readable schema with an independent version;
- canonical serialization rules;
- producer and consumer conformance fixtures;
- golden valid and invalid examples;
- compatibility and migration tests;
- ownership and deprecation metadata;
- security and data-class annotations.

## Dependency direction

```text
domain contracts
      ↑
engine services
      ↑
command dispatcher
      ↑
interface adapters
```

Provider plugins depend on the Plugin Contract, not engine internals. Core
packages MUST NOT depend on an interface adapter or provider SDK.

Changing frozen meaning, boundaries, statuses, permissions, schema guarantees,
or compatibility promises requires an accepted ADR and updated conformance
Evidence.
