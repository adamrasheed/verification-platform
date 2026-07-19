# Architecture Freeze

**Status:** FROZEN
**Owner:** Lead Architect
**Applies from:** Phase 1
**Change authority:** Accepted Architecture Decision Record (ADR) only
**Canonical path:** `docs/architecture/ARCHITECTURE_FREEZE.md`

## 1. Purpose

This document is the source of truth for the verification platform. It freezes the
product semantics, system boundaries, public contracts, security posture, and
implementation constraints that all future code must satisfy.

The company builds verification infrastructure for modern software.
Applications make promises. Proofs verify promises. Evidence supports proofs.
Repair suggestions derive from evidence.

The system orchestrates existing developer tools and providers. It does not
replace them.

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are
normative as defined by RFC 2119.

When requirements conflict, precedence is:

1. security and data-boundary requirements;
2. domain invariants in this document;
3. published machine contracts;
4. interface behavior;
5. implementation convenience.

## 2. Mission boundaries

### 2.1 Product commitments

The platform MUST:

- provide useful local output from an installed or package-manager-cached
  `npx verify` without a configuration file, account, login, or engine network
  connection;
- make the CLI the canonical public interface;
- route every interface through one semantic engine;
- discover before applying configuration;
- model capabilities rather than frameworks;
- treat Promises, Proofs, Evidence, and Repair as first-class, machine-readable
  objects;
- keep source and secrets local by default;
- isolate provider behavior behind plugins;
- distinguish facts from inference and operational failures from verification
  results;
- expose a versioned structured representation for every public operation.

### 2.2 Non-goals

The platform MUST NOT become:

- a CI platform;
- an observability, logging, or monitoring platform;
- a deployment platform;
- a testing framework;
- an AI IDE;
- an autonomous code-changing agent.

It MAY invoke, coordinate, and consume evidence from those systems. It MUST NOT
take ownership of their scheduling, execution fleets, deployment state, log
retention, or authoring workflows.

## 3. Frozen architectural decisions

The following decisions are frozen:

1. The Application Model is the only domain model.
2. The engine is the sole semantic authority. The CLI is its canonical public
   adapter and conformance oracle.
3. All other surfaces are transport and presentation adapters over the same
   versioned command dispatcher.
4. Default execution is local, offline, passive during discovery, and
   deny-by-default for network, secrets, and writes.
5. Pass or fail is produced only by deterministic evaluation of validated
   Evidence. An LLM MUST NOT decide proof status.
6. Live external checks are observational, not falsely described as hermetic or
   replayable.
7. Application Model revisions, execution records, Evidence revisions, Repair
   revisions, and audit events are immutable and append-only. Lifecycle changes
   are new revisions or events, never mutation.
8. Provider plugins run out of process and communicate through the versioned
   Plugin Contract.
9. Core code contains no provider SDK, provider name branch, provider-specific
   credential lookup, or provider-specific schema semantics.
10. Local-only use requires no product identity.
11. Cloud transfer is explicit, tenant-authorized, purpose-bound, and limited
    to an allowlisted projection.
12. Repair is advisory until a later Proof execution verifies its effect.
13. Every normative claim in this document requires a conformance test, static
    check, or documented manual control before release.

## 4. System model

### 4.1 Logical architecture

```text
CLI ───────────────┐
GitHub App ────────┤
MCP / Editors ─────┼─> Canonical command dispatcher
Cloud API ─────────┤              │
Other adapters ────┘              v
                         Verification engine
                    ┌─────────┬──────────┐
                    v         v          v
              Application   Scheduler   Policy /
                 Model                  Auth broker
                    │         │          │
                    └─────────┴──────────┘
                              │
                    Out-of-process plugins
                              │
                    Existing tools/providers
```

The engine owns discovery orchestration, model construction, planning,
scheduling, policy enforcement, evaluation, caching, audit events, aggregation,
and result serialization.

Adapters MAY perform only:

- interface authentication;
- request translation into a canonical command;
- progress rendering;
- cancellation and timeout propagation;
- presentation of the canonical result.

Adapters MUST NOT reimplement discovery, evaluation, aggregation, repair
selection, filtering, exit-code calculation, or authorization policy.

A remote adapter MUST either dispatch source-dependent work to an explicitly
authorized local or workload engine, or operate only on already-published cloud
metadata. It MUST NOT cause source to cross the Cloud Boundary to obtain
interface parity.

“Everything wraps the CLI” means every interface conforms to the CLI's canonical
command and result contracts by using the same dispatcher. It does not require
every interface to spawn a shell process. CLI JSON output is the external
conformance oracle.

### 4.2 Authoritative history and projections

The authoritative history consists of sealed Application Model revisions and
the immutable facts appended by executions, Evidence capture, and Repair
verification.

Human CLI output, dashboards, GitHub checks, editor views, MCP responses, cloud
views, summaries, and reports are projections. A projection MUST NOT become an
independent mutable source of domain truth.

## 5. Application Model

### 5.1 Aggregate

An Application Model revision is a sealed graph containing:

- Applications and their boundaries;
- Capabilities;
- Promises;
- Proof definitions and dependencies;
- Promise-Proof bindings;
- Evidence requirements;
- Provider bindings;
- Repair Knowledge references;
- policy and configuration references;
- provenance for every discovered or configured fact.

An Application Model MAY represent multiple applications in a monorepo.
Framework names MAY appear as discovery provenance or plugin-owned attributes,
but core behavior MUST be expressed through stable capabilities.

Application Model revision lifecycle is
`constructed -> sealed -> superseded`. A superseded revision remains valid for
historical traversal but cannot receive new execution plans. Each application
scope has exactly one current sealed revision; replacing it appends an atomic
supersession event.

### 5.2 Common identity

Every persisted domain object MUST contain:

- `id`: a stable, opaque logical identifier;
- `revision`: an immutable semantic revision identifier;
- `schemaVersion`: the object's schema major;
- `provenance`: who or what produced it and from which inputs;
- `createdAt`: envelope metadata outside the sealed semantic payload.

Semantic revisions MUST be domain-separated `sha256` digests of RFC 8785
canonical JSON over the object type, schema major, and every sealed object
field. Only envelope metadata that is not a field of the sealed object, such as
transport timestamps and invocation IDs, is excluded. Display labels and
provenance are semantic when sealed. References in sealed records MUST target
exact revisions; `latest`, mutable tags, and version ranges are invalid.

A sealed Application Model revision MUST NOT be mutated. A change creates a new
revision and preserves historical referential integrity.

### 5.3 Capability

A Capability is a provider-neutral behavior or responsibility an application
possesses or depends upon, such as Authentication, Billing, Storage,
Organizations, Notifications, Messaging, or Permissions.

A Capability:

- MUST have a stable type, scope, provenance, and owning application;
- MAY be discovered, explicitly declared, or supplied by a plugin;
- MUST retain discovery confidence and supporting signals;
- MUST NOT claim that a framework or provider is the capability itself;
- MAY contain namespaced plugin attributes that core stores but never
  interprets.

Discovered facts and configured facts remain separately attributable even when
configuration overrides their effective value.

### 5.4 Promise

A Promise is a declarative, testable claim an application makes.

A Promise revision MUST declare:

- subject and scope;
- capability;
- predicate and expected condition;
- criticality: `required` or `advisory`;
- provenance: `declared`, `policy`, or `discovered`;
- applicability conditions;
- owner when known.

Discovered Promises are candidates until an engine rule or explicit policy
activates them. Low-confidence inference MUST NOT silently create a required
Promise.

Promise revision lifecycle is:

```text
proposed -> active -> superseded
                   -> retired
```

Transitions are append-only events. Only an `active` revision participates in a
new execution plan.

An active Promise without at least one applicable active Promise-Proof binding
in the same Application Model revision is `indeterminate`, never satisfied.

Each invocation plan MUST select exactly one effective execution for every
Proof required by the model's active bindings. Promise status is derived from
those effective executions:

- `satisfied`: every required, applicable Proof passed against the same
  Application Model revision and execution context;
- `violated`: at least one required, applicable Proof failed;
- `indeterminate`: every other state, including missing prerequisites,
  unavailable credentials, cancellation, unsupported environments, or
  operational errors.

### 5.4.1 Promise-Proof binding

A `PromiseProofBinding` is an immutable association revision that references one
exact Promise revision and one exact Proof revision. It declares:

- owning Application Model scope;
- whether the Proof is required or advisory for that Promise;
- deterministic order;
- applicability conditions;
- provenance.

Promise and Proof revision payloads MUST NOT contain exact references to each
other. The Application Model contains exact binding revisions and derives
Promise coverage only from bindings sealed in that same model. A missing,
duplicate, cross-scope, dangling, or dependency-cyclic binding invalidates the
model.

Provider bindings use the same one-way association rule: the Application Model
selects the exact Provider binding for a Proof. A sealed Proof payload MUST NOT
contain a reverse exact reference to that Provider binding.

### 5.5 Proof

A Proof is a versioned verifier definition plus its immutable executions. A
Proof validates one or more Promises by evaluating validated Evidence.

A Proof definition MUST declare:

- inputs and Evidence requirements;
- evaluator identity and version;
- dependencies;
- permissions and resource bounds;
- reproducibility class;
- cache policy;
- deterministic evaluation logic;
- applicability conditions and expected failure semantics.

A Proof execution has a unique `attemptId`, a deterministic pre-execution
`planKey` over declared inputs, and a finalized `resultDigest` over its exact
observations and Evidence. Its terminal result is exactly one of:

- `passed`: validated Evidence satisfies the predicate;
- `failed`: validated Evidence contradicts the predicate;
- `indeterminate`: the predicate cannot be decided from available Evidence;
- `error`: the verifier or required control failed;
- `cancelled`: execution did not complete.

Missing credentials, missing Evidence, network unavailability, unsupported
environments, permission denial, malformed plugin output, and timeouts MUST NOT
be converted to `failed`.

Proof definition lifecycle is `proposed -> active -> superseded | retired`.
Proof execution lifecycle is
`queued -> running -> passed | failed | indeterminate | error | cancelled`.
Transitions are monotonic append-only events.

Retries are separate attempts. They MUST NOT overwrite an earlier attempt. The
scheduler may retry only an `error` from an operation declared retry-safe; it
MUST NOT retry `passed`, `failed`, or `indeterminate` to seek a different
verdict. The plan's effective execution is the last authorized attempt after
retry policy terminates. Earlier attempts remain linked and queryable.

### 5.6 Reproducibility classes

Every Proof MUST declare exactly one:

- `hermetic`: all inputs are sealed and no undeclared external state is read;
- `replayable`: external observations are captured sufficiently to replay the
  evaluation;
- `observational`: the Proof depends on live external state.

The engine MUST NOT describe an observational Proof as deterministic or
replayable. Observational Evidence MUST include observation time, target
identity, sanitized request parameters, response provenance, and any validity
window.

Evaluation of already-captured Evidence MUST be deterministic even when capture
was observational.

### 5.7 Evidence

Evidence is an immutable factual observation used by a Proof.

Evidence MUST contain:

- logical ID and revision;
- Evidence type and media type;
- producer identity and version;
- capture method and time;
- subject and input references;
- content digest;
- sensitivity classification;
- chain-of-custody metadata;
- zero or more superseded Evidence references.

Evidence lifecycle is represented by append-only events:

```text
captured -> validated
         -> rejected
```

An Evidence revision is immutable. Validation or rejection appends a lifecycle
event; it does not mutate Evidence. Current validation status is derived from
those events. Corrections create a new Evidence revision that references what it
supersedes.

`passed` and `failed` require validated Evidence. `indeterminate` and `error`
require diagnostic Evidence or a machine-readable reason explaining why none
could be safely captured.

Evidence MUST describe observations, not recommendations or confidence-based
opinions. A digest proves content identity, not independent truth.

### 5.8 Repair and Repair Knowledge

Repair is a concrete, immutable suggestion derived from a failed or
indeterminate Proof execution and its Evidence.

Repair Knowledge is the versioned, provider-neutral corpus of rules, mappings,
templates, and optional model prompts used to generate Repair candidates. It is
an input, not an authority and not Evidence.

A Repair MUST include:

- the motivating Promise, Proof execution, and Evidence revisions;
- generator identity and version;
- proposed action or patch;
- assumptions, permissions, and expected effect;
- confidence with its basis;
- a Proof plan that can verify the result;
- model, prompt-template digest, and generation parameters if an LLM was used.

Repair lifecycle is represented by append-only events:

```text
proposed -> rejected
         -> accepted -> applied -> verified
                                -> verification_failed
```

Repair is advisory by default. Applying Repair requires a separate, explicit
user action and permission check. `verified` MUST reference a later passing
Proof execution. A Repair revision is immutable; acceptance, application, and
verification append events. Historical failures remain unchanged.

An LLM MAY rank or generate Repairs. It MUST NOT manufacture Evidence, change a
Proof result, or claim verification.

### 5.9 Provider binding

A Provider binding connects a Capability or Proof to a plugin implementation.
Core stores:

- opaque binding ID;
- plugin identity and exact revision;
- supported capability types;
- non-secret configuration references;
- Authentication binding references;
- namespaced opaque attributes.

Provider-specific attributes MUST NOT affect core semantics except through a
validated plugin response defined by the Plugin Contract.

### 5.10 Provenance graph invariants

The system MUST preserve:

```text
Application Model revision
  -> Promise-Proof binding revision
    -> Promise revision
    -> Proof revision
      -> Proof execution
        -> Evidence revision(s)
          -> Repair revision
            -> later verifying Proof execution
```

Every edge uses exact revisions. Statuses must be derivable by traversing this
graph in either direction without heuristic matching. Orphan Evidence and
Repairs are invalid states.

## 6. Canonical lifecycle

Every `verify` invocation runs these stages:

1. **Preflight** — validate the versioned request; apply engine safety controls,
   workspace selection, offline mode, resource bounds, consent grants, and
   signed organization policy; resolve already-installed, pinned plugin
   manifests without registry access.
2. **Discovery plan** — seal and authorize narrowly restricted, passive
   discovery plans for engine-native readers and discovery plugins.
3. **Discover** — passively inspect the workspace and emit attributed facts.
4. **Resolve** — apply explicit domain configuration to discovered
   facts without deleting discovery provenance.
5. **Seal** — validate and seal an Application Model revision.
6. **Plan** — select applicable Promises and Proofs and produce immutable
   execution plans.
7. **Authorize** — evaluate execution, secret, network, filesystem, and cloud
   permissions.
8. **Execute** — schedule bounded local or explicitly authorized observational
   work.
9. **Capture** — normalize, classify, redact, and validate Evidence.
10. **Evaluate** — deterministically calculate Proof and Promise status.
11. **Repair** — optionally produce advisory Repair candidates.
12. **Report** — persist the run, emit the canonical result, and render
    projections.

A stage MUST NOT infer a successful prior stage. Failure to seal required inputs
prevents execution. Failure to persist required Evidence prevents a durable
successful result.

## 7. Zero-configuration discovery

Discovery MUST be local, read-only, deterministic, cancellable, bounded, and
useful without a recognized framework.

Discovery MAY inspect file names and bounded file content, version-control
metadata, manifests, lockfiles, static configuration, and non-sensitive
platform/runtime version facts about the engine process. It MUST NOT:

- import or evaluate project modules or executable configuration;
- run package lifecycle hooks, installs, builds, tests, or repository scripts;
- invoke a shell;
- contact a registry, provider, update service, analytics endpoint, or cloud;
- traverse symlinks outside the workspace root;
- read device files, sockets, credential stores, sibling repositories, or
  unrelated home-directory content;
- enumerate other processes, their arguments or environments, or ambient
  environment values not explicitly allowlisted in preflight.

Discovery output MUST explain:

- signals inspected;
- facts and candidates inferred;
- confidence and precedence;
- conflicts;
- skipped inputs and reasons;
- resource limits reached.

Default traversal MUST honor repository boundaries and ignore files, skip known
generated and dependency directories, reject archive expansion, cap file size
and total work, and use stable path ordering. Monorepo roots and nested
applications MUST remain distinct.

The zero-config run MAY execute only engine-native passive Proofs. Repository
commands and provider access require explicit interactive consent or a
versioned non-interactive policy grant. When no executable Proof is available,
the command MUST still return the discovered model, candidate Promises,
diagnostics, and actionable next steps.

Operational controls needed to make discovery safe are applied in preflight.
Domain configuration is applied after discovery. Workspace-controlled files may
request permissions, but MUST NOT grant network, secrets, process execution,
writes, degraded isolation, or publication authority to themselves. Such grants
must originate from a contemporaneously authenticated user, signed organization
policy, or separately protected CI policy outside the repository.

Effective precedence is:

1. non-overridable engine safety and organization policy;
2. external user or CI consent grants;
3. preflight operational flags;
4. workspace domain configuration;
5. user-level domain defaults;
6. discovered defaults.

Environment variables MAY select operational behavior and secret binding names.
They MUST NOT silently redefine domain semantics. Configuration is data, not
executable code.

## 8. Execution and isolation

### 8.1 Trust model

The local OS account and kernel are the base trust boundary. The product can
constrain malicious repositories and plugins, but MUST NOT claim protection
against root, administrator, kernel compromise, or unrestricted same-user
processes unless a stronger verified isolation layer exists.

Repository files, filenames, symlinks, configuration, tool output, plugin
output, cache entries, and uploaded Evidence are untrusted inputs.

### 8.2 Execution plan

Every dynamic action MUST be represented before launch by a sealed plan
containing:

- executable identity, artifact digest, and argument vector;
- working directory;
- readable and writable roots;
- clean environment allowlist;
- secret binding grants;
- network policy;
- resource, output, and time limits;
- plugin/tool versions;
- expected inputs, outputs, side effects, and retry safety.

Commands MUST use an argument vector without an intermediary shell. Shell
execution, if ever introduced, is a high-risk permission requiring an ADR and
MUST NOT interpolate repository-derived values.

### 8.3 Default profile

The default execution profile is:

- no network;
- read-only access to declared repository inputs;
- write access only to an unpredictable engine-owned run directory;
- no inherited environment except an explicit safe allowlist;
- no home-directory, device, credential-store, or unrelated workspace access;
- bounded process count, concurrency, CPU, memory, duration, output bytes,
  scratch bytes, and created files.

Cancellation MUST terminate the process tree and produce `cancelled`, never
success. If a platform cannot enforce a declared control, the engine MUST refuse
the action or require an explicit recorded degraded-isolation override. It MUST
NOT pretend the control was enforced.

Paths MUST be canonicalized and protected against traversal, symlink/junction
escape, and time-of-check/time-of-use replacement. Special files MUST NOT be
read as ordinary Evidence inputs.

Tool output MUST be bounded before buffering, safely encoded, terminal-control
neutralized outside interactive rendering, redacted, and schema-validated before
interpretation.

### 8.4 Execution manifest

Every attempt seals a manifest containing:

- engine version and artifact digest;
- Application Model, Promise, and Proof revisions;
- plugin/tool identities and artifact digests;
- source/input digest and repository dirty state;
- normalized configuration and policy digest;
- operating system, architecture, runtime, and toolchain versions;
- Authentication binding identifiers, never secret values;
- filesystem, network, clock, and randomness policy;
- canonical discovery output digest;
- execution plan digest.

The pre-execution `planKey` covers every declared result-affecting input known
before launch. After capture, a separate `resultDigest` covers the exact
execution, external observations, and Evidence revisions. An observational or
credential-dependent plan is reusable only when safe non-secret versions of all
relevant external inputs are represented; otherwise it is non-cacheable.

A relevant worktree mutation during execution makes the result `indeterminate`
unless an immutable snapshot proves its inputs were stable.

## 9. Plugin Contract

### 9.1 Boundary

All provider integrations MUST use the Plugin Contract. Adding a provider MUST
not require modification or recompilation of core.

Plugins run in child processes for fault containment. Out-of-process execution
alone is not a security sandbox; every manifest and result records the effective
OS enforcement tier. The transport is a versioned,
newline-delimited JSON request/response protocol over standard input/output.
Standard error is bounded, redacted diagnostic output only. Each message MUST
include a protocol version, message type, request ID, and typed payload. A
mandatory handshake negotiates one exact supported protocol major;
incompatibility fails before any permission or secret grant.

The engine MUST treat malformed, oversized, late, duplicate, or unknown plugin
messages as typed plugin errors. A plugin crash, timeout, denial, or protocol
error MUST NOT crash the coordinator.

The engine supports the current and immediately previous stable Plugin Contract
major. Within a major, handshake selects the highest mutually supported minor.
A deprecated major remains executable for at least 90 days after the succeeding
major is generally available. Security revocation MAY shorten that window with
an explicit advisory and safe failure.

### 9.2 Manifest

Before execution, a plugin MUST expose signed or digest-pinned metadata:

- namespace and plugin ID;
- implementation version and artifact digest;
- Plugin Contract versions;
- compatible engine range;
- entry point and supported platforms;
- capabilities and operations provided;
- Evidence types produced;
- required inputs;
- filesystem, process, network, and secret permissions;
- possible side effects;
- publisher and provenance information.

Installation and authorization are separate decisions. Installation grants no
runtime permission. Undeclared access fails closed.

Plugin selection, ordering, conflict resolution, shadowing, incompatibility, and
rejection MUST be deterministic and explained in structured diagnostics.

### 9.3 Extensibility surface

Plugins MAY:

- contribute attributed discovery facts;
- bind provider implementations to stable Capabilities;
- capture Evidence;
- define Proof implementations using existing core semantics;
- contribute versioned Repair Knowledge;
- normalize provider failures into contract-defined operational reason codes.

Plugins MUST NOT:

- add core result statuses or mutate sealed objects;
- bypass policy, redaction, caching, audit, or Authentication;
- return opinion as Evidence;
- decide aggregate Promise status;
- access unrelated credentials;
- upload data independently of the engine's Cloud Boundary;
- require provider-specific interpretation by core.

Namespaced extension payloads are opaque to core, schema-versioned by the
plugin, size-bounded, and local-only by default.

### 9.4 Plugin conformance

The conformance suite MUST cover handshake, discovery, permission denial,
cancellation, timeout, crash, malformed and oversized output, redaction,
determinism claims, cache identity, and every advertised operation.

At least three synthetic providers with materially different authentication,
latency, and error behavior MUST pass without core changes before the Plugin
Contract is stable.

## 10. Authentication Model

### 10.1 Principals and trust domains

The Authentication Model distinguishes:

- **local principal** — the invoking OS user; sufficient for local-only work;
- **user principal** — a human authenticated to product cloud;
- **workload principal** — a headless automation identity;
- **integration principal** — a bounded adapter identity acting for a user or
  workload;
- **provider credential binding** — local, plugin-scoped authority to an
  external provider.

Product-cloud credentials and provider credentials are separate trust domains.
One MUST NOT be exchanged for, embedded in, or used as the other.

### 10.2 Local operation

Local-only operation requires no product account or product token. Local
filesystem authority derives from the OS principal and does not imply cloud or
provider authorization.

### 10.3 Cloud authentication

Cloud access MUST use short-lived, audience-restricted access tokens. Human CLI
login MUST use an authorization flow suitable for a public client with PKCE or
device authorization; the CLI MUST NOT contain a reusable client secret.
Long-lived refresh material, if required, MUST reside in the OS credential
store, not project files, plaintext config, environment dumps, or logs.

Headless workloads MUST use separately revocable workload credentials with
least-privilege scopes and no human refresh token.

### 10.4 Authorization

Cloud resources are scoped:

```text
tenant -> project -> application -> run/evidence/policy
```

Every cloud operation MUST authorize principal, action, tenant, and exact
resource server-side. Resource IDs and client-supplied tenant claims are not
authorization. Default is deny.

Roles are named bundles of explicit actions. Policy evaluation uses the expanded
actions, not UI role names. Sensitive operations, membership changes, policy
changes, publishing, deletion, and credential lifecycle events require an
auditable principal and outcome.

Adapters MUST bind requests to an explicit workspace and MUST NOT become
confused deputies for other local roots or tenants.

### 10.5 Provider credential broker

Secrets are never Application Model fields. The model stores opaque binding IDs.
At execution time, the broker resolves a binding only after policy authorization
and grants the specific plugin an invocation-scoped secret value or handle.

The grant MUST be limited by plugin, operation, audience, scope, and duration. It
MUST NOT enter arguments, process titles, Evidence, cache keys, semantic
digests, logs, structured output, or cloud payloads. The broker MAY expose a
non-secret, non-reversible generation-and-scope fingerprint for cache
invalidation. If it cannot, the Proof is non-cacheable and not replayable.

Authentication expiry, authorization denial, and network unavailability are
distinct operational states and MUST NOT be interpreted as a failed Promise.

## 11. Cloud Boundary

### 11.1 Local-first rule

After the integrity-pinned package has been installed or cached, a default
`npx --offline verify` invocation and the engine it starts MUST make no network
request, including update checks, analytics, registry access, or cloud login
probes. On a fresh machine, package-manager download is a separate, visible
bootstrap operation and is not part of the engine. Documentation MUST NOT imply
that an uncached `npx` bootstrap can run offline.

Cloud exists for durable team history, organization policy distribution,
collaboration, explicitly requested publication, and verification attestations.
It MUST NOT be required for discovery, local execution, local Evidence storage,
structured output, or viewing retained local runs.

### 11.2 Data classes

- `SECRET`: credentials, keys, tokens, cookies, private keys.
- `LOCAL_SOURCE`: source, diffs, patches, file bodies, filenames, full paths,
  commands, arguments, raw logs, prompts, environment values.
- `SENSITIVE_EVIDENCE`: Evidence bodies, stack traces, repository remotes,
  branches, authors, provider resource names, opaque plugin payloads.
- `MINIMAL_METADATA`: approved schema/version IDs, opaque IDs, public artifact
  digests, locally keyed tenant-scoped publication identifiers, typed statuses,
  reason codes, counts, durations, and classifications.
- `EXPLICIT_SHARE`: a user-selected, previewed payload approved for a named
  cloud feature.

`SECRET` MUST never cross the product Cloud Boundary. `LOCAL_SOURCE` and
`SENSITIVE_EVIDENCE` remain local unless a future explicit-share feature is
approved by ADR. Consent to cloud login or metadata publication is not consent
to share them.

### 11.3 Default upload allowlist

An explicitly requested metadata publication MAY send only:

- cloud payload schema version and command purpose;
- tenant/project destination;
- opaque local run ID and idempotency key;
- engine, protocol, and plugin IDs, versions, and public artifact digests;
- locally keyed, tenant-scoped, domain-separated publication identifiers for
  Application Model, Promise, Proof, and Evidence revisions;
- Promise and Proof statuses and stable reason codes;
- aggregate counts and durations;
- Evidence type, byte size, locally keyed publication identifier, and
  sensitivity class;
- a user-supplied non-sensitive application alias;
- audit correlation ID and retention class.

Raw local semantic revisions and content digests MUST NOT cross by default
because they may permit dictionary testing. Publication identifiers are derived
with a local secret unavailable to cloud and include tenant and object-type
domains. It MUST NOT send names or contents of repository files, local paths,
remotes, branch or commit identifiers, source, diffs, logs, commands, arguments,
stack traces, prompts, environment data, secret-derived unkeyed hashes, provider
resource names, or namespaced plugin payloads.

Upload schemas are allowlists. Unknown fields fail closed. Before upload, the
engine MUST show or make inspectable a disclosure manifest containing exact
fields, classifications, sizes, purpose, destination, and retention. The
serialized payload MUST be validated against the same manifest to prevent
preview drift.

### 11.4 Cloud controls

Every upload MUST include authenticated transport, tenant authorization,
purpose, schema version, idempotency, replay protection, retention, and an audit
event. Cloud ingestion MUST treat payloads as hostile and enforce strict schema,
size, depth, count, compression, and content-type bounds.

Cloud storage MUST encrypt data in transit and at rest and include tenant ID in
every storage key, query, and authorization decision.

Telemetry is off by default. Telemetry failure MUST never change verification
semantics. Remote operations are not queued for later transmission in Phase 1.

### 11.5 Third-party provider egress

The product Cloud Boundary does not authorize disclosure to an external
provider. A plugin with network permission is subject to a separate provider
egress gate:

- destinations are restricted to manifest-declared hosts and ports, with
  loopback, link-local, and cloud metadata endpoints denied by default;
- purpose, destination, data class, outbound schema, and maximum size are
  authorized and audited;
- outbound data is allowlisted and revalidated immediately before send;
- `LOCAL_SOURCE` or `SENSITIVE_EVIDENCE` requires feature-specific explicit
  share consent and a disclosure preview;
- a plugin MUST NOT simultaneously receive source-read and network authority
  unless that exact disclosure is authorized.

Provider credentials authorize the provider operation, not arbitrary data
egress.

## 12. Structured command contract

### 12.1 Request contract

Every adapter submits protocol major `1` requests with:

```json
{
  "schemaVersion": 1,
  "command": "verify",
  "invocationId": "opaque",
  "workspace": {
    "rootBinding": "adapter-local-opaque-reference",
    "expectedRevision": "optional"
  },
  "arguments": {},
  "configurationReferences": [],
  "policyReferences": [],
  "consentGrantReferences": [],
  "offline": true,
  "deadlineMs": 600000,
  "outputMode": "json",
  "environment": {
    "platform": "normalized",
    "allowlistedBindings": []
  }
}
```

The workspace root is an adapter-local binding, never a remotely dereferenced
path. Requests MUST be schema-valid before preflight. Flags, defaults, policy,
consent, deadlines, cancellation, and environment normalization MUST be
representable without adapter-private semantics. Secret values are references,
not request fields. `deadlineMs` is a positive duration from dispatcher
acceptance; omission selects the policy default.

### 12.2 Output modes

Every command MUST support:

- human output, derived only from the canonical structured result;
- `--json`, one final JSON document on stdout;
- `--jsonl`, a separately versioned stream of lifecycle events followed by one
  final result event.

In machine modes stdout contains protocol bytes only. Logs, warnings, spinners,
and plugin diagnostics go to stderr and never alter the result.

### 12.3 Result envelope

Protocol major `1` uses a common envelope and command-specific typed `result`:

```json
{
  "schemaVersion": 1,
  "command": "verify",
  "invocationId": "opaque",
  "engine": {
    "version": "semver",
    "artifactDigest": "sha256:..."
  },
  "operationalStatus": "completed",
  "startedAt": "RFC3339",
  "durationMs": 0,
  "result": {
    "kind": "verify",
    "outcome": "satisfied",
    "applicationModelRevision": "sha256:...",
    "summary": {},
    "promises": [],
    "proofExecutions": [],
    "evidence": [],
    "repairs": []
  },
  "diagnostics": []
}
```

Every stable command publishes a machine-validatable result schema identified by
`result.kind`; verify-only fields MUST NOT be promoted into the common envelope.

`operationalStatus` is exactly one of:

- `completed`: the command produced its complete typed result;
- `invalid`: request, configuration, policy, or schema was invalid;
- `blocked`: a required execution, environment, plugin, authentication, or
  security control failed;
- `cancelled`: cancellation completed;
- `internal_error`: an engine invariant or unexpected internal operation failed.

For `verify`, `result.outcome` is exactly one of:

- `satisfied`: at least one required applicable Promise was evaluated and all
  were satisfied;
- `violated`: one or more required applicable Promises were violated;
- `indeterminate`: no required Promise was violated and at least one was
  indeterminate;
- `not_evaluated`: no required applicable Promise had effective Proof coverage.

`result` is required for `completed` and MAY be `null` for another operational
status. If a non-completed verify envelope includes a result, its outcome MUST
be `not_evaluated`, except that `blocked` MAY retain a partial `indeterminate`
result when some required work completed; that result is marked `partial: true`.
A plugin failure affecting only advisory work is a diagnostic and does not
change `completed`.

Volatile fields are explicitly marked in the published JSON Schema and excluded
from canonical semantic comparison. All other deterministic output uses stable
ordering and canonical encodings.

Unknown object fields MUST be ignored by readers. Unknown enum values MUST
produce a typed compatibility diagnostic, not a crash. Unknown control-flow
values for `operationalStatus`, `kind`, or `outcome` produce a local
`incompatible_result` state and MUST NOT be interpreted as success. Producers
MUST emit only schemas they fully satisfy. Removing a field, changing its type
or meaning, or changing enum semantics requires a new schema major.

Engine version, CLI contract version, JSON schema version, event protocol
version, Plugin Contract version, and domain object schema versions are
independently identifiable.

### 12.4 Exit codes

Exit codes are stable from protocol v1:

| Code | Meaning |
|---:|---|
| 0 | `completed/satisfied` |
| 1 | `completed/violated` |
| 2 | `completed/indeterminate` or `completed/not_evaluated` |
| 3 | `invalid` |
| 4 | `blocked` |
| 5 | `cancelled` |
| 6 | `internal_error` or an incompatible control-flow enum |

Precedence when multiple conditions occur is `6`, `5`, `3`, `4`, `1`, `2`, `0`.
Failures affecting only advisory Promises remain diagnostics and do not elevate
the exit code. A cloud publication failure does not alter an already completed
local verification outcome unless publication is the command's primary
operation.

Human-readable text is not a machine compatibility contract.

Transport adapters preserve the envelope rather than inventing semantics. HTTP
uses a successful transport status for any valid engine envelope and reserves
transport errors for failure to obtain one. MCP and editor adapters return the
envelope directly. A GitHub check maps `satisfied` to success, `violated` to
failure, `indeterminate` or `not_evaluated` to neutral/action-required,
`cancelled` to cancelled, and blocked/internal states to action-required/error.

## 13. Determinism, scheduling, and cache

### 13.1 Determinism

Given identical sealed inputs, engine and plugin artifacts, configuration,
policy, and declared environment, hermetic Proof evaluation MUST be semantically
identical regardless of interface, scheduling, or cache state.

Clock, randomness, network, filesystem, locale, timezone, and environment access
must be explicit inputs or denied. Collections without semantic order use a
documented stable sort.

### 13.2 Scheduler

The execution graph is a dependency DAG. The scheduler MUST:

- use bounded CPU-aware local concurrency and separate per-plugin/network
  limits;
- apply backpressure;
- execute shared prerequisites once per invocation;
- preserve stable result ordering;
- isolate temporary state between invocations;
- propagate cancellation;
- retry only declared idempotent operations, with bounded attempts and recorded
  reasons.

Parallel scheduling MUST NOT change semantics.

### 13.3 Cache

The Phase 1 cache is local only. Cache keys MUST include every result-affecting
input: engine and contract versions, plugin/tool artifact digests, Proof and
model revisions, input digests, normalized configuration and policy, relevant
environment dimensions, reproducibility class, and credential binding identity
when safe.

Raw secrets MUST NOT enter a cache key. Observational results are non-cacheable
unless the Proof declares a bounded validity window and all external observation
identity is represented safely.

Cache writes MUST be atomic, integrity-checked, schema-versioned, size-bounded,
and crash-safe. Corruption is a diagnosed miss, never a hit or fatal engine
failure. Cache hits do not elevate permissions or trust.

Concurrent processes publishing the same cache key use per-key single-flight or
atomic compare-and-publish. Locks require owner identity, bounded lease,
stale-owner recovery, and crash-safe release. Losing publishers validate and
reuse the winning complete entry or discard their temporary entry; they never
merge partial state.

Every cache hit records `cachedFromExecution` and the exact Evidence revisions
and validation events reused. Cached provenance remains traversable to its
originating execution.

Users MUST be able to bypass, inspect, and clear the local cache. Each execution
records eligibility and the hit, miss, or bypass reason.

## 14. Security and privacy

### 14.1 Redaction

Redaction occurs at ingestion and again before persistence, rendering to an
untrusted adapter, telemetry, or upload. It MUST combine:

- exact values from the invocation secret registry;
- structured field and header classification;
- URL and argument sanitization;
- key-name and format detectors;
- bounded pattern and entropy detection.

Regex-only redaction is insufficient. Failure to classify or redact a payload
fails closed for persistence or upload. Secret values MUST NOT appear in
filenames, process titles, errors, audit events, analytics, or unkeyed
guessable-domain hashes.

### 14.2 Local persistence

Run records, Evidence, audit events, cache, and temporary files use
least-privilege permissions, unpredictable names, and atomic finalization.
Partial records are marked incomplete and cannot support success.

Local retention is bounded and inspectable. Deletion behavior MUST distinguish
active storage, cache eviction, backup expiry, cloud retention, and legal hold.
Local encryption at rest MAY rely on platform storage encryption in Phase 1;
claims of per-record protection require an ADR and a defined threat model.

Immutability governs retained facts; it does not override an authorized deletion
or legal erasure obligation. Deletion removes the protected payload and appends
a non-sensitive tombstone containing object type, opaque ID, deletion time,
authority, reason class, and affected edge IDs. Raw content digests are removed
when they could identify deleted content. Graph traversal returns
`deleted_reference` at that edge instead of fabricating or silently omitting the
object. Backup copies expire under the declared retention schedule and do not
restore tombstoned data into active service.

### 14.3 Failure posture

Permission denial, unavailable sandboxing, malformed config or plugin output,
resource exhaustion, cloud outage, authentication failure, schema mismatch,
redaction failure, Evidence persistence failure, and cache corruption are
distinct machine-readable reason codes.

The system fails closed on permissions, upload classification, redaction,
authorization, schema, and integrity. It MAY degrade to valid local-only
operation when cloud is unavailable.

Crash recovery MUST identify abandoned runs, quarantine partial artifacts, and
terminate or reconcile surviving child processes where possible.

### 14.4 Supply chain

Release artifacts and plugins MUST be version-pinned and integrity-verifiable.
Production releases require source provenance, signed artifacts, an SBOM,
dependency and vulnerability review, and traceability to a source revision.

The npm package MUST NOT use install or postinstall scripts. A resolved package
version and integrity digest are recorded for every `npx verify` run. Silent
auto-execution of newly resolved plugin code inside an existing run is
prohibited.

## 15. Offline behavior

Discovery, engine-native Proofs, authorized installed local tools, local
Evidence persistence, structured output, cache access, and retained-run viewing
MUST work with network access denied.

Offline mode makes no hidden DNS requests or retries. Remote-only operations
fail fast with `indeterminate` or `error` and the typed reason code
`network_required`, while preserving valid local results. Cached remote data
other than independently verified signed policy is display-only and must show
origin, age, expiry, and staleness; it MUST NOT authorize a new remote action.

A cached organization policy MAY constrain offline execution only when it is
signed, tenant-bound, within its issue/expiry interval, and validated by a
pinned trust root. Revocation cannot be proven offline. An expired or unverifiable
policy causes controlled actions to fail closed. A local run without a valid
required organization policy is labeled `unmanaged` and cannot later be
published as organization-compliant until the server re-evaluates it.

Update checks and plugin resolution are never prerequisites for already
installed components to perform local work.

## 16. Audit and observability

Every invocation receives a unique ID propagated through adapters, engine
stages, plugin calls, cache decisions, and cloud calls. The engine emits
versioned, structured lifecycle events with parent/child correlation.

Local auditability works offline and records enough sanitized metadata to answer:

- what ran and why;
- which exact implementation ran;
- which inputs and policies influenced it;
- which permissions and external access were requested and granted;
- whether cached results were used;
- what Evidence was captured;
- what result was produced and how long it took.

Audit events are append-safe and redacted at creation. Human logs and exporters
derive from the same event data. An OpenTelemetry exporter MAY project those
events but the engine MUST NOT depend on a collector.

Security-sensitive events include permission decisions, policy override, plugin
installation/authorization, authentication lifecycle, publication, tenant
changes, and deletion.

## 17. Compatibility policy

Published stable contracts follow semantic versioning or an independent integer
major where specified.

- Additive optional fields are compatible.
- Removing fields, changing types or requiredness, reinterpreting configuration,
  or changing enum meaning is breaking.
- Deprecated behavior remains functional for at least the current and next
  minor release and for not less than 90 days after a replacement is generally
  available.
- Readers support the current and immediately previous JSON major.
- Producers emit the current major by default.
- Incompatible plugins are rejected before execution; best-effort invocation is
  prohibited.
- Experimental commands and fields are explicitly namespaced and carry no
  stability promise.

Each release publishes a compatibility matrix for engine, CLI, schemas, events,
plugins, configuration, supported operating systems, and runtimes.

## 18. Required conformance and release gates

No implementation may claim compliance until it passes:

| Area | Required gate |
|---|---|
| Model | Schema validation, graph integrity, immutable revisions, state-machine and aggregation property tests |
| Interface parity | Identical fixtures through CLI and every adapter produce canonical-equivalent operational status and outcome; CLI exit and other transport mappings are tested separately |
| Determinism | Repeated and schedule-randomized runs are identical after documented volatile fields are removed |
| Evidence | Pass/fail cannot exist without validated Evidence; provenance graph traverses in both directions |
| Repair | Every candidate cites Evidence; only a later passing execution can mark it verified |
| JSON purity | Machine stdout parses with no extra bytes while progress and diagnostics are active |
| Exit codes | Table-driven coverage for every code and mixed-condition precedence |
| Discovery | Empty repo, app, monorepo, conflicts, unknown ecosystem, huge tree, symlink escape, malformed files, and offline fixtures |
| Discovery safety | No repository execution, writes, installs, network, or out-of-root reads without authorization |
| Plugin isolation | Crash, hang, flood, malformed output, secret leak, denial, and cancellation do not crash or contaminate core |
| Provider neutrality | Static import/term boundary check plus three synthetic providers without core changes |
| Execution security | Injection, path escape, TOCTOU, fork/output/disk exhaustion, env leakage, cancellation, and crash recovery tests |
| Cache | Relevant mutation invalidates; irrelevant mutation does not; concurrent publication is safe; partial or corrupt entries safely miss; hit provenance is complete |
| Cloud Boundary | Snapshot the exact payload for every cloud operation; unknown or forbidden fields fail upload |
| Authorization | Cross-tenant, IDOR, scope, audience, expiry, revocation, adapter confused-deputy, and negative tests |
| Secret safety | Canary secrets never appear in stdout, stderr, files, cache, audit, protocol, or cloud payloads |
| Compatibility | Current/previous readers, stored artifacts, plugins, and migration fixtures |
| Resource bounds | Adversarial limits for traversal, depth, bytes, processes, time, memory, and concurrency |
| Supply chain | Signed provenance, artifact verification, SBOM, dependency scan, and no lifecycle script |

Golden fixtures MUST be checked into source control. Conformance runs on every
supported OS/runtime combination. A flaky gate is a failed gate; rerunning until
green is not acceptance. Security/privacy results accompany every release
candidate.

Every normative requirement in this document MUST map to a test ID, static rule,
or named manual control in the compliance matrix.

## 19. Performance and operability budgets

Before public beta, the reference hardware and fixture corpus MUST be published.
On that reference:

- passive discovery of a warm 100,000-file repository SHOULD complete within
  five seconds at p95;
- engine overhead excluding plugin/tool work SHOULD remain below one second at
  p95;
- idle local execution MUST use no network;
- memory, disk, file, process, and output bounds MUST be configurable by policy
  and have safe defaults;
- interruption MUST begin process-tree cancellation within one second.

Performance optimizations MUST NOT weaken determinism, Evidence quality,
isolation, redaction, or provenance.

## 20. ADR governance

Any change to a frozen decision requires an ADR that includes:

- context and problem;
- affected frozen clauses;
- options and rejected alternatives;
- domain, security, privacy, compatibility, migration, and operational impact;
- changes to schemas and conformance tests;
- rollback strategy;
- Lead Architect approval.

Provider-specific needs are not sufficient reason to change core. A proposal
must demonstrate a provider-neutral missing abstraction with at least two
independent implementations.

Implementation choices that do not alter observable semantics or boundaries MAY
proceed without an ADR, but MUST still satisfy this document.

### 20.1 Required pre-beta ADRs

These decisions are deliberately below the frozen semantic layer but must be
resolved before public beta:

1. OS-specific sandbox implementations and supported enforcement tiers.
2. Filesystem snapshot strategy for large mutable worktrees.
3. Plugin signing authority, provenance, revocation, and local-development
   trust tier.
4. Network allowlist enforcement, DNS/proxy behavior, and protection from
   loopback, link-local, and cloud metadata endpoints.
5. Local store locations, retention limits, purge behavior, and optional
   encryption threat model.
6. Cloud retention, deletion, backup, region, and legal-hold policy.
7. Workload identity issuance and enterprise SSO lifecycle.
8. Evidence attestation format and independent verification model.

None of these ADRs may weaken default-local operation, provider neutrality,
typed Proof semantics, immutable provenance, or the Cloud Boundary without
explicitly amending this freeze.

## 21. Definition of architectural acceptance

The architecture is correctly implemented only when:

- an installed or cached `npx verify` is useful, offline, and safe with zero
  configuration;
- all interfaces produce the same canonical result from the same inputs;
- every Promise status is mechanically traceable through Proof executions to
  validated Evidence;
- operational uncertainty is never disguised as pass or fail;
- providers can be added without core changes;
- secrets and source remain local under default behavior;
- any cloud payload can be enumerated before it leaves the machine;
- Repair remains advisory until independently re-verified;
- historical facts are immutable and reproducible to the limit declared by
  their reproducibility class;
- the conformance matrix proves these properties continuously.

Anything less is not the verification infrastructure described by this
specification.
