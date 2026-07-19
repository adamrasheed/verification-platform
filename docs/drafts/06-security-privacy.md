# Security and Privacy Design

**Status:** Domain draft for EDD reconciliation
**Owner:** Security and Privacy
**Governing references:** [Architecture Freeze](../architecture/ARCHITECTURE_FREEZE.md),
[Glossary](../architecture/GLOSSARY.md),
[Shared Contracts](../architecture/SHARED_CONTRACTS.md), and
[Open Questions](../architecture/OPEN_QUESTIONS.md)
**Scope:** Trust boundaries, local and hosted execution security,
Authentication and authorization, secret handling, redaction, provider and
product-cloud disclosure, tenant isolation, retention and deletion, supply
chain, and security acceptance Evidence
**Normative authority:** Subordinate to the Architecture Freeze

## 1. Purpose

This section makes the frozen security and privacy posture implementable without
changing its domain semantics. It defines controls and release gates for the
Engine, adapters, plugins, provider access, local persistence, optional product
cloud, and any future hosted execution.

Security is not a separate post-processing stage. It is a constraint on every
stage of the canonical lifecycle:

```text
preflight -> discovery plan -> discover -> resolve -> seal -> plan
          -> authorize -> execute -> capture -> evaluate -> repair -> report
```

The governing posture is:

- local-first and useful without product identity;
- deny by default for network, secrets, process execution, writes, degraded
  isolation, and publication;
- least authority for one sealed operation and one invocation;
- untrusted-input handling at every repository, plugin, adapter, storage, and
  cloud boundary;
- fail closed when authorization, classification, redaction, schema,
  enforcement, or integrity cannot be established;
- no claim stronger than the effective, recorded enforcement tier;
- no security or privacy exception for first-party plugins or adapters.

This design does not claim protection from a compromised local kernel,
administrator, root user, or unrestricted same-user process. It does not select
an operating-system sandbox backend, cloud vendor, region, local storage
engine, identity provider, or attestation format. Those choices remain behind
the frozen boundaries and their required decisions.

## 2. Security objectives and non-objectives

### 2.1 Security objectives

The system MUST:

1. prevent a repository from granting authority to itself;
2. prevent an adapter or plugin from becoming an independent semantic or
   authorization authority;
3. keep `SECRET` out of domain objects, protocol fields, process metadata,
   persistence, cache keys, audit, telemetry, and cloud payloads;
4. keep `LOCAL_SOURCE` and `SENSITIVE_EVIDENCE` local unless a future
   feature-specific explicit-share ADR authorizes an exact, previewed
   disclosure;
5. ensure every dynamic action is authorized from an immutable plan before
   launch;
6. constrain path, process, environment, network, output, time, memory, disk,
   and concurrency access at the effective enforcement tier;
7. preserve the distinction between fault containment and a verified security
   sandbox;
8. ensure product-cloud and provider authorization are independent;
9. authorize every cloud action against the principal, action, tenant, and
   exact resource on the server;
10. prevent one tenant from addressing, observing, influencing, or recovering
    another tenant's data or execution;
11. make disclosure, retention, deletion, and legal-hold behavior inspectable;
12. make release artifacts and plugin artifacts attributable,
    integrity-verifiable, revocable, and reproducible to the declared degree;
13. retain machine-readable Evidence for every claimed security control.

### 2.2 Security non-objectives

Phase 1 does not:

- defend local data from a compromised kernel or administrator;
- make child-process execution a security sandbox by itself;
- permit arbitrary repository commands, shell execution, or package lifecycle
  hooks;
- provide product-hosted source execution;
- provide a plugin marketplace or automatic plugin update channel;
- store provider credentials in the product cloud;
- upload source, diffs, raw Evidence, logs, prompts, paths, commands, or
  namespaced plugin payloads;
- claim per-record local encryption beyond the selected platform-storage
  baseline;
- provide a universal data-loss-prevention classifier;
- use telemetry as a security, reliability, or product-semantic dependency.

## 3. Assets, actors, and trust assumptions

### 3.1 Protected assets

The highest-value assets are:

- provider credentials, product-cloud credentials, signing keys, local
  publication keys, cookies, and session material;
- repository source, filenames, paths, diffs, branches, remotes, commands,
  arguments, environment values, and raw tool output;
- Evidence bodies and provenance that may reveal provider resources,
  vulnerabilities, internal topology, identities, or application behavior;
- organization policy, consent grants, role assignments, tenant membership,
  and deletion authority;
- artifact identity, execution plans, manifests, Proof results, immutable
  provenance, cache entries, and audit history;
- tenant association and usage metadata;
- release and plugin signing authority;
- availability of the local Engine and any future cloud control plane.

### 3.2 Actors and adversaries

The design assumes these actors can be malicious, compromised, or mistaken:

- a repository author controlling files, names, symlinks, configuration, and
  executable content;
- a plugin publisher or compromised plugin artifact;
- a provider returning hostile, oversized, malformed, deceptive, or
  secret-reflecting content;
- a local tool invoked by an authorized Proof;
- an adapter client attempting workspace confusion or tenant confusion;
- an authenticated user exceeding their tenant or resource authority;
- a workload or integration principal with stolen, replayed, or over-scoped
  credentials;
- a dependency, package registry, build worker, release pipeline, or signing
  service compromise;
- a cloud caller attempting IDOR, cross-tenant access, schema abuse, resource
  exhaustion, or deletion bypass;
- an operator making an unsafe policy, retention, or emergency-access change.

The invoking local OS user is trusted to authorize local work for resources
that user can legitimately bind. That trust does not confer product-cloud,
provider, organization, or other-workspace authority.

### 3.3 Security invariants

The following invariants apply across all packages and applications:

- workspace files can request but never grant sensitive authority;
- installation is not authorization;
- Authentication is not authorization;
- possession of a resource ID is not authorization;
- product-cloud credentials are never provider credentials;
- a provider credential authorizes a provider operation, not arbitrary egress;
- a cache hit never elevates authority, trust, Evidence validity, or
  classification;
- plugin output is untrusted candidate data until Engine validation;
- an operational security failure never becomes a failed Promise;
- a redaction or classification failure cannot produce a persistable or
  uploadable payload;
- immutable history does not override authorized deletion or legal erasure;
- an enforcement control that cannot be verified is recorded as absent, not
  inferred from intent.

## 4. Trust boundaries

| Boundary | Untrusted input crossing it | Required control |
|---|---|---|
| Repository to discovery | Paths, names, bytes, manifests, symlinks, ignore rules, configuration | Passive bounded readers, canonical containment, ordinary-file checks, stable ordering, no execution/network/write |
| Adapter to dispatcher | Request fields, workspace binding, tenant context, deadlines, consent references | Schema validation, explicit workspace binding, principal binding, deadline/cancellation propagation, no adapter-side semantics |
| Engine to child process | Executable, arguments, roots, environment, resources, secret references, network policy | Sealed plan, exact artifact digest, authorization decisions, verified enforcement tier, process-tree ownership |
| Plugin protocol to Engine | Manifest, handshake, messages, diagnostics, Evidence and Repair candidates | Digest/signature verification, version negotiation, framing and size bounds, state machine, schema validation, classification and redaction |
| Credential broker to action | Binding reference, plugin/operation identity, audience, scopes, lifetime | Invocation-scoped least grant, non-enumerability, revocation, no process metadata or normal protocol exposure |
| Action to provider network | Destination, request bytes, redirects, DNS results, credential use | Provider egress gate, exact destination policy, outbound allowlist, immediate pre-send validation, size bound, audit |
| Engine to local storage | Evidence, run, event, cache, temporary and tombstone records | Least-privilege permissions, unpredictable names, atomic finalization, integrity checks, retention and deletion policy |
| Engine to product cloud | Publication purpose, tenant destination, disclosure manifest, serialized payload | Explicit publication, exact allowlist, preview/serialization equivalence, tenant authorization, replay protection, transport security |
| Cloud API to cloud storage | Hostile authenticated or unauthenticated request data | Server-side authorization, tenant-keyed storage and query constraints, schema/size/depth/count bounds, encryption |
| Tenant to tenant | IDs, queries, jobs, storage keys, caches, logs, exports, support tools | Tenant context on every decision, structural isolation, negative tests, operator access control and audit |
| Build/release to user | Engine, CLI, plugin, schema, SBOM, provenance and signatures | Reproducible/pinned inputs, signed provenance, artifact verification, vulnerability review, revocation |
| Future cloud control plane to hosted worker | Workload identity, plan, inputs, outputs, secrets and network grants | Blocked until source-sharing, workload isolation, tenant, retention, and identity decisions are accepted |

Boundary crossings use typed, versioned, size-bounded contracts. Unknown fields
at an upload allowlist fail closed. Unknown control-flow values at any boundary
produce an incompatible result and cannot be interpreted as success.

## 5. Threat model and abuse cases

### 5.1 Repository attacks

The repository may attempt to:

- escape the workspace with `..`, absolute paths, symlinks, junctions, hard
  links, mount points, alternate data streams, case collisions, or
  time-of-check/time-of-use replacement;
- block discovery with devices, FIFOs, sockets, sparse files, archives, deep
  nesting, huge files, decompression bombs, or unstable directory trees;
- cause command injection through filenames, manifest values, executable
  configuration, terminal control sequences, or shell metacharacters;
- place secret-shaped canaries in names or contents to test logs and reports;
- grant a plugin network, secret, execution, write, publication, or degraded
  isolation authority through workspace configuration;
- exploit parser ambiguity, duplicate JSON keys, invalid Unicode, numeric
  overflow, prototype pollution, or extension payloads.

Controls are canonical path containment, no shell, argument-vector launch,
ordinary-file-only reads, resource bounds, safe decoding, schema validation,
maps prohibited at trust boundaries, terminal neutralization, and external
authorization precedence.

### 5.2 Plugin and tool attacks

A plugin or tool may attempt to:

- disagree with its static manifest or substitute an artifact after approval;
- read the home directory, ambient environment, sibling workspaces, devices,
  credential stores, or undeclared paths;
- enumerate or reuse credential bindings;
- connect to an undeclared host, follow redirects, rebind DNS, use a proxy, or
  reach loopback, link-local, private-control, or cloud metadata services;
- combine source-read and network grants to exfiltrate data;
- emit malformed, duplicate, late, oversized, secret-bearing, or
  terminal-controlling output;
- fork, detach, persist after cancellation, fill output or disk, or exhaust
  process, CPU, memory, and file limits;
- claim validation, lower data classification, emit a verdict, forge
  provenance, poison cache identity, or verify its own Repair;
- hide provider SDK retries or side effects inside one Engine attempt.

The Engine treats each output as candidate data, controls process lifecycle
externally, grants only declared authority, and refuses execution when required
enforcement is unavailable. Provider access additionally requires an enforceable
egress path capable of validating the actual outbound disclosure.

### 5.3 Adapter and cloud attacks

An adapter or cloud caller may attempt to:

- bind a request to a different local workspace than the user intended;
- use a local path as a remotely dereferenced source reference;
- substitute tenant or resource IDs, exploit an IDOR, or act as a confused
  deputy;
- replay a publication or mutate its payload after disclosure preview;
- smuggle forbidden fields through unknown properties, nested values,
  compression, alternate media types, or namespaced payloads;
- infer source or provider resource identity from raw digests;
- recover deleted payloads from caches, exports, replicas, backups, logs, or
  analytics;
- exhaust ingestion with deep, wide, compressed, or high-cardinality payloads.

Controls are adapter-local opaque workspace bindings, server-derived tenant
context, action-level authorization, idempotency and replay protection,
tenant-scoped keyed publication identifiers, exact upload schemas, disclosure
manifest equivalence, bounded ingestion, and deletion propagation.

### 5.4 Supply-chain attacks

An attacker may compromise:

- the npm package, transitive dependency, registry account, lockfile, or
  package-manager resolution;
- a plugin registry, publisher key, plugin update, or development trust path;
- the build service, source repository, release workflow, SBOM generation, or
  provenance statement;
- a schema or compatibility artifact so the executable and reviewed contract
  disagree.

Runs resolve only installed, pinned artifacts. No install or postinstall script
is permitted for the npm package. Production artifacts require signed
provenance, SBOM, dependency and vulnerability review, and source-revision
traceability. Revocation is checked before network or secret authority is
granted when online; offline behavior follows the accepted signing and
revocation ADR and fails safely for required revoked or unverifiable artifacts.

## 6. Local discovery and execution controls

### 6.1 Enforcement profiles

Enforcement capability and operation permission are independent. A process with
network permission is not a stronger sandbox than a process without it.
Every attempt records both its verified enforcement profile and its exact
grants.

| Profile | Meaning | Permitted use |
|---|---|---|
| `passive-engine` | No repository child process. Engine-native bounded readers only. Network, secrets, writes, shell, and repository execution denied. | Default zero-configuration discovery and passive Proofs |
| `process-contained` | Child-process fault containment and resource accounting exist, but one or more required security controls are not enforceable. | Never sufficient for an ordinary dynamic action; only an exact externally authorized degraded-isolation override |
| `local-restricted` | Verified filesystem, environment, process-tree, resource, output, scratch, and network-denial controls match the sealed plan. | Dynamic local tools or plugins that require no network and no unenforced control |
| `provider-restricted` | `local-restricted` plus enforceable destination control, outbound disclosure validation, and invocation-scoped provider secret delivery. | Explicitly authorized observational provider work |
| `tenant-workload` | Strong per-workload isolation suitable for mutually untrusted tenants, with ephemeral identity, storage, network, secrets, cleanup, and independent escape testing. | Future hosted execution only after all blocking ADRs and gates |

The exact mapping from these logical profiles to each supported operating
system is unresolved by D-001. Until that decision is accepted and its controls
pass conformance, only `passive-engine` may be described as supported without a
degraded-isolation warning.

A degraded-isolation override:

- comes from a contemporaneously authenticated user or external signed policy,
  never the repository;
- binds one exact plan digest, named missing controls, artifact, workspace,
  operation, and expiry;
- is not reusable after any result-affecting change;
- is recorded in the result and audit history;
- cannot authorize product-cloud or provider disclosure by implication;
- cannot be used by unattended default execution.

### 6.2 Filesystem and path controls

Before launch, the execution service:

1. binds each logical root to an Engine-opened, canonical local object;
2. rejects an absent, ambiguous, special, or out-of-boundary target;
3. validates path encoding, normalization, case behavior, and platform-specific
   namespace rules;
4. denies symlink, junction, mount, reparse-point, and traversal escape;
5. records immutable input identity or activates worktree mutation detection;
6. gives the action only the minimum readable roots and an unpredictable,
   Engine-owned writable run directory;
7. denies home, sibling repository, credential store, device, socket, and
   unrelated temporary-directory access;
8. revalidates sensitive opens against replacement and containment.

The selected OS backend MUST define how it resists race replacement rather than
claiming safety from string canonicalization alone. A relevant worktree change
causes `indeterminate` unless an accepted immutable snapshot proves stable
inputs.

Evidence and output readers accept only ordinary bounded files explicitly named
by the plan. Archive expansion is denied during discovery. A later feature that
consumes archives requires a separately bounded format-specific reader and
cannot inherit ordinary-file trust.

### 6.3 Process and environment controls

Every dynamic action:

- launches an exact digest-verified executable with an argument vector and no
  intermediary shell;
- uses a fixed working-directory binding;
- receives a clean environment containing only explicitly safe, normalized
  bindings;
- cannot inherit product tokens, provider secrets, proxy variables, cloud SDK
  credentials, SSH agent sockets, package-manager credentials, or user startup
  configuration;
- is placed in an externally controlled process tree or equivalent containment
  group before untrusted code runs;
- is subject to process count, concurrency, CPU, memory, duration, output,
  scratch, created-file, and open-file bounds;
- has stdout and stderr bounded while streaming, before unbounded buffering;
- has terminal controls neutralized outside explicitly interactive rendering;
- is cancelled as a tree and cannot publish success, Evidence, or cache after
  cancellation.

Repository-derived values cannot select the executable, expand permission
roots, alter the environment allowlist, or become shell syntax. Shell execution
remains prohibited absent an architecture ADR.

### 6.4 Network controls

Network denial includes DNS, direct IP, IPv4 and IPv6, Unix/local sockets where
applicable, proxies, update services, analytics, registries, loopback,
link-local, private control endpoints, and cloud metadata endpoints. Offline
mode performs no hidden retries or login probes.

For an authorized provider operation:

- scheme, normalized host, port, purpose, outbound schema, maximum bytes, and
  permitted data classes are sealed before launch;
- name resolution results are checked against denied address classes at every
  connection, not only at plan time;
- redirects require full reauthorization and never inherit destination trust;
- proxy use is denied unless the proxy itself and destination-preserving
  enforcement are declared and reviewed;
- connection reuse cannot cross plugin, operation, tenant, or authorization
  scope;
- request bytes are matched to the disclosure schema immediately before send;
- response bytes are bounded before parsing and remain untrusted;
- destination, purpose, decision, byte count, and classification are audited
  without logging credentials or forbidden payload content.

An OS destination firewall alone cannot satisfy the outbound-schema requirement.
Provider-network plugins therefore require an Engine-controlled egress broker,
schema-enforcing proxy, or another reviewed mechanism that can validate the
actual serialized request. Direct unrestricted sockets are not conformant.

## 7. Plugin security review

### 7.1 Required plugin security posture

The static manifest is validated without executing plugin code. Resolution
binds exact plugin, manifest, artifact, extension schema, platform, operation,
and Plugin Contract revisions. Installation, enablement, selection,
authorization, secret binding, and execution remain separate recorded
decisions.

Handshake completes before secret or provider-network authority. Each Phase 1
operation uses a fresh process. The runtime validates framing, request identity,
sequence, state, terminal cardinality, deadlines, message and aggregate size,
schema, and compatibility. Standard error is bounded diagnostic input and is
redacted before persistence or rendering.

Plugin discovery permanently uses `passive-engine` semantics expressed through
an out-of-process `local-restricted` container: no provider access, secret,
subprocess, shell, write, or out-of-root read. A provider lookup is
observational Evidence capture, never discovery.

Plugin outputs cannot:

- grant permission or extend their plan;
- create canonical Evidence identity or lifecycle;
- lower classification;
- return a Proof or Promise verdict;
- write authoritative storage or cache directly;
- upload to product cloud;
- verify a Repair;
- cause provider-specific core branching.

### 7.2 Plugin design findings

| Severity | Finding | Required disposition |
|---|---|---|
| **Blocking** | No accepted OS-specific sandbox and enforcement-tier decision exists. Out-of-process execution supplies fault containment but does not prevent same-user file, environment, credential, or network access. | Do not ship dynamic plugin execution until D-001 / Architecture Freeze §20.1(1) selects backends and the advertised controls pass on every supported OS/runtime. |
| **Blocking** | The draft grants network destinations to a plugin process, but a destination firewall cannot prove that actual outbound bytes satisfy the approved schema and disclosure. | Select and review an Engine-controlled egress broker/proxy or equivalent under the network-enforcement ADR. Provider-network plugins remain disabled until pre-send schema validation, DNS/redirect controls, and egress canary tests pass. |
| **Blocking** | Plugin signing authority, publisher provenance, revocation, key rotation, and the local-development trust tier remain unresolved. Digest pinning identifies bytes but does not establish publisher trust or revocation behavior. | Accept Architecture Freeze §20.1(3) before first-party distribution, a registry, or automatic trust claims. Locally installed development artifacts remain explicitly unverified and receive no automatic network or secret authority. |
| **Major** | Secret delivery is described as an inherited handle or equivalent broker channel, but handle semantics, child inheritance, revocation, crash cleanup, and platforms are not selected. | The Authentication/broker design must choose per-platform delivery, prove non-enumerability and cleanup, and show secret canaries absent from environment, process metadata, protocol, output, crash artifacts, and persistence. |
| **Major** | A plugin can internally use a provider SDK that performs retries, redirects, telemetry, credential discovery, or proxy use unless those behaviors are disabled or externally contained. | Conformance must run with hostile DNS, redirects, proxies, metadata endpoints, SDK telemetry targets, and retry conditions. Undeclared internal access fails the attempt. |
| **Major** | Local path strings exposed in plugin execution context can become output, diagnostics, Evidence, or provider requests. | Treat all path values as `LOCAL_SOURCE`, prefer opaque/brokered roots where the platform allows, and require path canaries in redaction and egress gates. |
| **Major** | Namespaced extension payloads are opaque to core and therefore cannot be semantically classified from provider meaning. | Apply a conservative maximum classification and local-only rule; reject persistence or egress when size, schema, or classification cannot be established. A plugin claim may raise but never lower classification. |
| **Minor** | Fresh process per operation limits hidden cross-request state and simplifies credential revocation. | Retain for Phase 1 and record process creation plus cleanup Evidence. |
| **Minor** | First-party plugins use the public contract with no hidden permissions. | Enforce through dependency/import checks and the same opaque-process conformance suite. |
| **Deferred** | Process pooling may improve performance but introduces credential, tenant, cache, and state-reuse risk. | Require a dedicated security review and equivalence Evidence before adoption; it is not a Phase 1 optimization. |
| **Deferred** | Executable provider-side Repair actions expand the product into state-changing provider authority. | Keep representable but non-executable until a separate apply protocol defines preview, idempotency, authorization, rollback posture, Evidence, and later Proof verification. |

No Major finding may remain without an owned mitigation and acceptance gate when
the affected feature ships. Blocking findings prohibit release of the affected
capability, not passive local operation.

## 8. Authentication and authorization

### 8.1 Principal separation

The system preserves the frozen principals:

- the local principal represents the invoking OS user for local-only work;
- the user principal represents a human authenticated to product cloud;
- the workload principal represents headless automation;
- the integration principal represents a bounded adapter;
- a provider credential binding represents provider-specific authority
  available only to an exact plugin operation.

No implicit exchange exists among them. A GitHub integration principal used to
publish a check, for example, is not the provider credential binding used by a
GitHub Evidence plugin even if the deployment obtains both through one user
journey.

### 8.2 Authentication requirements

Human public-client authentication uses PKCE or device authorization and no
reusable client secret. Access tokens are short-lived, audience-restricted,
scope-restricted, and validated for issuer, audience, time, signature, and
revocation posture. Refresh material resides only in the OS credential store.

Workload credentials:

- are independently issued and revoked;
- have no human refresh token;
- bind tenant, permitted actions, audience, and expiration;
- are rotated and cannot be recovered after issuance where the mechanism
  permits;
- are never accepted as provider credentials.

Authentication errors, token expiry, authorization denial, and network
unavailability have distinct `StructuredError` categories and do not establish
a violated Promise.

### 8.3 Authorization decision

Every sensitive decision binds:

- authenticated principal and principal type;
- tenant derived from server-side membership or trusted workload claims;
- exact action;
- exact resource type and opaque resource ID;
- parent project and application scope;
- policy and consent revisions;
- execution plan or disclosure-manifest digest;
- requested and granted permissions;
- decision time, expiry, decision ID, and reason code.

The server does not trust client-supplied tenant ownership, resource parentage,
role names, or workspace paths. Roles expand to explicit actions before policy
evaluation. Default is deny.

Authorization is checked at request acceptance and again at sensitive use when
membership, token, policy, grant, or resource state may have changed. A cache,
queue, signed URL, worker claim, export, or support tool cannot bypass the same
resource decision.

Sensitive actions requiring security audit include:

- membership and role changes;
- policy creation, replacement, or override;
- publication and disclosure;
- provider credential creation, use, rotation, and revocation;
- plugin installation, authorization, and revocation;
- degraded isolation;
- tenant changes and workload identity lifecycle;
- retention, deletion, legal hold, export, and operator access.

## 9. Secret references and credential broker

Secrets are never fields of the Application Model, command request, execution
manifest, Evidence, event, cache, Repair, or cloud publication. These objects
contain only opaque Authentication binding identifiers.

The broker:

1. resolves a binding only after authorization of the exact plan;
2. verifies plugin artifact, operation, audience, scopes, invocation, attempt,
   tenant where relevant, and expiry;
3. returns only the minimum invocation-scoped value or handle;
4. prevents binding enumeration by plugins;
5. registers exact secret values with the invocation redaction registry before
   any child can emit output;
6. revokes or closes access on completion, cancellation, timeout, crash, or
   policy revocation;
7. records a sanitized grant and revocation audit event;
8. never returns the secret through ordinary plugin messages or Engine logs.

The broker may supply a non-secret, non-reversible
generation-and-scope fingerprint for cache invalidation. The fingerprint is
domain-separated and not derived from a guessable raw secret value. If safe
identity cannot be represented, the Proof is non-cacheable and not replayable.

Secret delivery MUST avoid:

- arguments and process titles;
- inherited ambient environment;
- repository or ordinary scratch files;
- stdout, stderr, exceptions, crash reports, traces, or metrics;
- semantic digests and unkeyed hashes;
- provider request logs and URL query strings;
- persistence after the attempt.

Provider response reflection is treated as a secret-leak path: exact-value
redaction applies to response and error bodies before Evidence capture,
diagnostics, or persistence.

## 10. Classification, redaction, and output safety

### 10.1 Classification

The frozen data classes control disclosure:

| Class | Default handling |
|---|---|
| `SECRET` | Never persisted in normal product records and never crosses the product Cloud Boundary |
| `LOCAL_SOURCE` | Local only; excluded from default publication and provider egress |
| `SENSITIVE_EVIDENCE` | Local only; excluded from default publication and provider egress |
| `MINIMAL_METADATA` | Eligible only for an explicitly requested, schema-allowlisted publication |
| `EXPLICIT_SHARE` | Eligible only for the exact named future feature, preview, destination, purpose, retention, and ADR-approved flow |

Classification is monotonic at trust boundaries: a producer can request a
higher classification; it cannot lower the Engine's classification. A payload
with mixed fields receives the highest class unless a schema-defined projection
separates and independently validates lower-class fields.

### 10.2 Redaction pipeline

Redaction occurs:

1. while ingesting tool, plugin, provider, adapter, and storage-recovery input;
2. before Evidence or diagnostic persistence;
3. before cache publication;
4. before human or machine rendering to an untrusted adapter;
5. before audit and telemetry event creation;
6. before provider egress;
7. before product-cloud disclosure preview and again on exact serialized bytes.

The redactor combines:

- exact values and safe encodings from the invocation secret registry;
- structured field, header, cookie, authorization, URL, and query
  classification;
- argument and path sanitization;
- key-name and known credential-format detectors;
- bounded pattern and entropy detection;
- schema-specific transformations that preserve only fields needed by the
  consumer.

Regex-only redaction is not accepted. Redaction runs on decoded structured
forms where safe and on bounded byte/text forms to catch malformed or
unexpected output. It produces a sanitized value plus a report of fields and
classes removed, never the removed values.

A parse, classify, or redact failure:

- prevents persistence, rendering to an untrusted adapter, telemetry, or
  upload of that payload;
- emits a sanitized typed reason without embedding the input;
- cannot yield a durable pass or fail dependent on the missing Evidence;
- quarantines any bounded raw temporary artifact with the strictest local
  permissions until deletion, if retaining it is necessary for crash-safe
  cleanup.

### 10.3 Output and log safety

Machine stdout is protocol-only. Human rendering neutralizes terminal controls.
Log and diagnostic cardinality, length, nesting, and byte volume are bounded.
Audit is created from classified structured events, never by scraping human
logs.

Identifiers exposed outside the local trust domain are opaque and
tenant-scoped. Raw local content digests and semantic revisions do not cross by
default because they may enable dictionary testing. Secret-derived unkeyed
hashes are prohibited.

## 11. Provider egress

Provider egress and product-cloud publication are separate decisions and
separate audit events.

For every provider request, the authorization preview names:

- exact plugin artifact and operation;
- provider destination and port;
- request purpose;
- credential binding identifier, audience, and scopes, never its value;
- outbound schema and maximum bytes;
- each data class;
- source-read, Evidence-read, process, and write authority;
- expected provider side effects;
- grant origin and expiry.

The egress mechanism validates the exact serialized request against the sealed
schema immediately before transmission. It prevents redirects, DNS rebinding,
proxy escape, alternate ports, local endpoints, metadata services, and
undeclared follow-up calls. A plugin cannot open a second unrestricted network
path.

`LOCAL_SOURCE` or `SENSITIVE_EVIDENCE` requires an ADR-approved explicit-share
feature with exact user-selected payload preview. Network permission or a
provider credential is not consent to disclose those classes. A plugin cannot
simultaneously receive source-read and network authority absent that exact
authorization.

Responses are untrusted and bounded. Provider errors, authentication failures,
rate limits, and unavailability remain operational facts. Provider-native
details can be retained only inside a sanitized, schema-bounded local
diagnostic or plugin namespace and cannot control core semantics.

## 12. Product cloud minimization

### 12.1 Phase 1 cloud posture

The first release has no required product cloud. Local discovery, execution,
Evidence, cache, retained runs, and structured output work with network denied.
Telemetry is off by default. Remote work is not queued for later transmission.

When metadata publication ships, cloud receives only the Architecture Freeze
§11.3 allowlist. The client:

1. selects a named publication purpose and tenant/project destination;
2. constructs a disclosure manifest containing exact fields,
   classifications, sizes, destination, purpose, and retention class;
3. obtains explicit authority for that manifest;
4. serializes from the approved projection;
5. revalidates serialized bytes against the same manifest and upload schema;
6. sends with authenticated transport, idempotency, replay protection, and
   audit correlation;
7. records success or a typed publication error without changing an already
   completed local verification result.

Unknown fields and forbidden classes fail closed. The client sends no file
names, paths, remotes, commits, source, diffs, logs, commands, arguments,
stacks, prompts, environments, provider resource names, raw local semantic
revisions, content digests, or namespaced plugin payloads.

### 12.2 Cloud storage and processing

Cloud ingestion:

- accepts only the exact purpose-specific schema and content type;
- bounds encoded and decoded bytes, depth, collection count, compression
  ratio, strings, identifiers, and request rate;
- derives tenant authorization server-side;
- includes tenant ID in each storage key, partition, query, cache key, event,
  and authorization decision;
- encrypts transport and storage;
- prevents cloud logs, traces, analytics, dead-letter records, or error
  reporting from becoming an unreviewed secondary data store;
- does not use published metadata to fetch local source or provider data;
- applies declared retention at ingestion.

Cloud data processing is purpose-limited. A future secondary use, model
training, cross-tenant benchmark, or product analytics feature requires a new
schema, disclosure purpose, privacy review, and authority; it cannot inherit
publication consent.

### 12.3 Tenant-scoped publication identifiers

Publication identifiers are locally keyed, tenant-scoped, object-type
domain-separated, and unavailable to product cloud as raw derivation keys.
The key lifecycle design MUST address:

- secure local creation and storage;
- separate domains for tenants and object types;
- rotation without accidental cross-tenant linkability;
- loss and recovery behavior;
- deletion and tombstone interaction;
- collision bounds and stable idempotency;
- prevention of secret or raw-content dictionary testing.

This design is required before metadata publication is considered complete.

## 13. Tenant isolation and hosted execution

### 13.1 Tenant isolation

The logical resource hierarchy is:

```text
tenant -> project -> application -> run/evidence/policy
```

Every resource has one immutable tenant owner. Tenant context is mandatory for
storage, queues, caches, search, exports, metrics with tenant dimensions,
background work, and deletion. A global resource identifier never substitutes
for the tenant predicate.

Isolation controls include:

- server-side tenant derivation and parent-child validation;
- tenant-keyed storage and query builders that cannot issue an unscoped
  tenant-data query;
- per-tenant encryption-key strategy selected before hosted beta;
- tenant-scoped idempotency, cache, rate, quota, and pagination state;
- no cross-tenant worker, temporary directory, network credential, process,
  memory snapshot, or reusable secret handle;
- sanitized operator tooling with just-in-time access, reason, expiry, and
  audit;
- export and deletion jobs that reauthorize every referenced object;
- negative tests across every API, job, cache, storage, and support path.

Whether cloud storage uses shared infrastructure with structural tenant
predicates, separate schemas/databases, or stronger enterprise partitions is an
implementation choice only if it satisfies these invariants and the accepted
threat model.

### 13.2 Hosted execution posture

Product-hosted source execution is not authorized by the current Phase 1 data
boundary. `LOCAL_SOURCE` remains local unless a future explicit-share feature
is approved by ADR. A remote adapter may operate on already-published
`MINIMAL_METADATA`, or dispatch source-dependent work to an explicitly
authorized local or customer-controlled workload Engine. It may not upload
source merely to provide interface parity.

Before any product-hosted worker receives source or `SENSITIVE_EVIDENCE`, all of
the following are required:

- an Architecture Freeze amendment or feature-specific explicit-share ADR
  defining payload, purpose, destination, preview, retention, deletion, and
  user/tenant authority;
- accepted workload identity and tenant-isolation designs;
- an accepted `tenant-workload` enforcement backend with independent escape
  review;
- immutable source snapshot and provenance strategy;
- ephemeral per-job storage, network, process, credential, and encryption-key
  isolation;
- no host, image, cache, layer, log, crash dump, or temporary artifact reuse
  that leaks tenant data;
- provider and product-cloud egress controls equivalent to or stronger than
  local controls;
- secure cleanup with retained non-sensitive Evidence;
- cloud retention, backup, region, deletion, and legal-hold policy;
- abuse prevention, quota, cancellation, orphan reconciliation, incident
  response, and supply-chain gates;
- an explicit demonstration that the service is verification execution rather
  than an unbounded CI platform.

Hosted execution remains blocked until those conditions have accepted Evidence.

### 13.3 Cloud and hosted-execution findings

| Severity | Finding | Required disposition |
|---|---|---|
| **Blocking** | Product-hosted source execution would move `LOCAL_SOURCE` across the Cloud Boundary, which Phase 1 forbids absent an explicit-share ADR. | Do not implement or market hosted source execution. Use local/customer-controlled workload execution or metadata-only cloud views until an accepted ADR amends the feature boundary. |
| **Blocking** | OS/workload isolation, immutable snapshotting, workload identity, cloud retention/deletion/region/legal hold, and tenant key strategy are unresolved. | Accept the applicable Architecture Freeze §20.1 decisions and pass multi-tenant escape, residue, and cross-tenant conformance before hosted beta. |
| **Blocking** | The current architecture specifies logical hosted boundaries but no enforceable worker lifecycle, egress point, cleanup, or source encryption design. | Produce a separate hosted-execution design and threat model before implementation. Documentation of logical permissions is insufficient release Evidence. |
| **Major** | Cloud authorization defines resource hierarchy and deny-by-default behavior, but the action catalog, role expansion, membership lifecycle, and operator-access model are not yet fixed. | Publish an action-level authorization matrix and negative fixtures before any multi-user cloud surface. |
| **Major** | Locally keyed publication identifiers minimize disclosure, but their key creation, rotation, loss, recovery, tenant separation, and deletion behavior are unspecified. | Resolve the key lifecycle before metadata publication and retain unlinkability/collision test Evidence. |
| **Major** | Tombstone semantics are frozen, while concrete propagation through indexes, caches, replicas, exports, analytics, backups, and legal holds is not designed. | Accept the cloud retention/deletion policy and verify every secondary store before accepting deletion claims. |
| **Major** | Cloud ingestion may accidentally create shadow copies in logs, traces, dead letters, WAF captures, support tools, or analytics. | Maintain a data-flow inventory and schema-filtered observability; cloud payload canaries must be absent from all unapproved secondary sinks. |
| **Minor** | Telemetry off by default and no Phase 1 offline queue materially reduce surprise disclosure and replay risk. | Preserve these defaults and test zero network activity. |
| **Minor** | Publication failure does not rewrite a completed local verification outcome. | Preserve semantic independence and emit a separate publication result. |
| **Deferred** | Evidence attestation may enable independent verification but creates issuer, key, privacy, and revocation decisions. | Resolve Architecture Freeze §20.1(8) only before third-party attestation exchange. |
| **Deferred** | Enterprise region, dedicated tenancy, customer-managed keys, and SSO options depend on hosted product commitments. | Select within frozen boundaries before the corresponding enterprise claim; do not pre-claim support. |

## 14. Retention, deletion, and local persistence

### 14.1 Local persistence

Run records, Evidence, audit, cache, and temporary storage use:

- platform-appropriate least-privilege permissions;
- unpredictable names and Engine-owned directories;
- atomic finalization and integrity verification;
- schema and classification metadata;
- bounded quotas and inspectable retention;
- incomplete markers for crash remnants;
- no success dependency on an uncommitted artifact.

Temporary artifacts are removed at normal completion and reconciled after
crash. Surviving child processes are terminated or recorded as unreconciled.
Cache clearing removes eligible cache entries, not authoritative execution or
Evidence history.

Platform storage encryption is the Phase 1 local baseline. Claims of
per-record protection, protection from another same-user process, or secure
erase require D-004 and a precise local attacker/storage threat model.

### 14.2 Retention policy requirements

Each retained object has:

- object class and sensitivity;
- storage location and tenant/local scope;
- creation and last-required time;
- retention class and expiry behavior;
- legal-hold eligibility where cloud applies;
- whether it is authoritative, cache, temporary, replica, backup, export,
  diagnostic, or tombstone;
- deletion propagation targets;
- named policy authority.

Defaults minimize collection and retention. Retention expiry is not a
verification state transition and does not rewrite historical results.
Traversal encountering deleted content returns `deleted_reference`.

### 14.3 Deletion

An authorized deletion:

1. reauthorizes principal, action, tenant, and exact object;
2. determines the protected payload and all secondary copies;
3. removes active payload, cache, index, export, search, replica, and
   unprotected diagnostic copies;
4. appends a non-sensitive tombstone with only the frozen fields;
5. removes raw digests that could identify deleted content;
6. makes graph traversal return `deleted_reference`;
7. schedules backup expiry and prevents restore into active service;
8. records completion, exceptions, legal hold, and backup-expiry state without
   retaining deleted content.

Legal hold is explicit, tenant-authorized, narrowly scoped, auditable, and
separate from ordinary retention. The interface distinguishes deletion from
access revocation, cache eviction, retention expiry, backup expiry, and
cryptographic key destruction.

No claim of immediate secure physical erasure is made unless the selected
storage design can prove it. User-facing deletion commitments must match the
accepted local and cloud policies.

## 15. Supply-chain security

### 15.1 Engine and CLI

Production release Evidence includes:

- exact source revision and clean/declared build state;
- pinned dependency graph and reviewed lockfile changes;
- build-service identity and isolated build provenance;
- signed artifact and provenance statement;
- SBOM covering shipped and runtime-loaded components;
- vulnerability, license, and malicious-package review;
- package contents manifest and verification of no install/postinstall script;
- checksum and npm registry metadata validation;
- schema, compatibility, and conformance artifact digests;
- rollback and revocation procedure.

The installed/cached package records its resolved version and integrity digest
for every run. The Engine never auto-resolves a new plugin or update inside an
invocation.

### 15.2 Plugins

Every distributable plugin provides:

- immutable artifact and manifest digests;
- publisher identity and verifiable provenance;
- signature under the accepted trust policy;
- SBOM and provider SDK dependency review;
- supported platform and Engine/Plugin Contract matrix;
- extension and Evidence schema digests;
- declared permissions and side effects;
- security contact, revocation, replacement, and deprecation procedure;
- full opaque-process conformance results.

A signature does not grant runtime permission. A revoked artifact cannot gain a
new network or secret grant. Offline revocation behavior, cached trust roots,
emergency revocation, key compromise, and local-development exceptions are
defined by the plugin-signing ADR.

### 15.3 Dependency and build policy

Core packages remain free of provider SDKs. Static checks enforce package
dependency direction and reject provider-name branches, provider credential
lookup, dynamic code loading outside the plugin runtime, and unexpected network
clients in offline packages.

Release signing keys are not available to ordinary build steps. Provenance
links reviewed source, builder identity, dependency state, test Evidence, and
artifact digest. Rebuilding or resigning does not erase an earlier failed or
revoked artifact record.

## 16. Security verification and release Evidence

Security acceptance uses committed hostile fixtures, platform matrices,
machine-readable results, artifact digests, and retained provenance. A flaky
gate is failed Evidence. Manual controls name operator, environment, procedure,
result, and retained Evidence.

### 16.1 Local and execution gates

| ID | Acceptance condition |
|---|---|
| `SP-DISC-001` | Empty, huge, deep, malformed, special-file, archive, symlink, junction, mount, case-collision, and race-replacement repositories remain bounded and cannot read or execute outside the workspace |
| `SP-DISC-002` | Installed/cached offline execution emits zero DNS, socket, registry, update, analytics, provider, login-probe, or product-cloud traffic |
| `SP-EXEC-001` | Each supported OS/runtime proves the exact controls assigned to each enforcement profile; an unavailable control refuses execution or records an exact degraded override |
| `SP-EXEC-002` | Shell metacharacters, filenames, manifest fields, terminal controls, and hostile Unicode cannot alter executable identity, arguments, roots, environment, or renderer control |
| `SP-EXEC-003` | Fork, detach, output, file, scratch, descriptor, CPU, memory, process, time, and concurrency exhaustion remain within policy and cannot leave a successful attempt |
| `SP-EXEC-004` | Cancellation revokes secrets and network authority, begins process-tree termination within one second, quarantines partial output, and cannot publish success or cache |
| `SP-PATH-001` | Canonicalization plus OS enforcement defeats traversal, symlink/junction/reparse escape, special files, and TOCTOU replacement |
| `SP-RECOVERY-001` | Crash injection at every persistence boundary identifies abandoned runs, quarantines partial artifacts, and reconciles child processes without inferring success |

### 16.2 Plugin, secret, and egress gates

| ID | Acceptance condition |
|---|---|
| `SP-PLUGIN-001` | Artifact, manifest, signature, platform, operation, schema, and handshake disagreement fails before secret or provider-network authority |
| `SP-PLUGIN-002` | Crash, hang, flood, malformed/duplicate/late output, wrong request, timeout, and cancellation do not crash or contaminate Engine state |
| `SP-PLUGIN-003` | Undeclared path, environment, process, network, secret, write, and publication access fails and produces a typed operational reason, never a violated Promise |
| `SP-PLUGIN-004` | Three synthetic providers with different Authentication, latency, retry, redirect, telemetry, proxy, and error behavior pass without core changes |
| `SP-SECRET-001` | Canary secrets never appear in arguments, process titles, environment, protocol, stdout, stderr, crash artifacts, Evidence, manifests, cache, events, errors, audit, telemetry, or cloud |
| `SP-SECRET-002` | Wrong plugin, artifact, operation, invocation, attempt, audience, scope, tenant, expiry, and revoked binding are denied; handles are non-enumerable and cleaned after every terminal path |
| `SP-EGRESS-001` | DNS rebinding, redirect, proxy, alternate IP/port, IPv6, loopback, link-local, private control, and metadata endpoint attempts fail |
| `SP-EGRESS-002` | The exact serialized provider request matches the approved outbound schema, classification, size, purpose, and destination immediately before send |
| `SP-EGRESS-003` | Source-read plus network authority fails absent exact explicit-share approval; path, source, Evidence, and secret canaries cannot cross provider egress |

### 16.3 Cloud, tenant, and privacy gates

| ID | Acceptance condition |
|---|---|
| `SP-CLOUD-001` | Snapshot tests enumerate exact bytes for every cloud operation; unknown fields, forbidden classes, preview drift, wrong purpose, wrong retention, and wrong destination fail |
| `SP-CLOUD-002` | Raw semantic revisions, raw content digests, file/path/remote/commit/source/diff/log/command/argument/stack/prompt/environment/provider-resource/plugin-payload canaries never appear in cloud payloads or secondary sinks |
| `SP-AUTHZ-001` | Cross-tenant, IDOR, client tenant substitution, role confusion, stale membership, wrong scope/audience, expiry, revocation, confused deputy, pagination, export, and signed-link tests deny access |
| `SP-TENANT-001` | Every API, store, query, cache, job, event, index, export, metric, operator tool, and deletion path has cross-tenant negative fixtures |
| `SP-PUBID-001` | Publication identifiers are tenant/object separated, unlinkable across domains, collision-tested, rotation-safe, and do not allow raw-content dictionary testing |
| `SP-REDACT-001` | Exact, encoded, structured, URL, header, key-name, format, high-entropy, path, malformed, chunk-split, and provider-reflected canaries are removed at each redaction boundary |
| `SP-REDACT-002` | Parse/classification/redaction failure prevents persistence, rendering, telemetry, egress, and upload while producing only sanitized diagnostics |
| `SP-DELETE-001` | Deletion reaches active storage, cache, index, replica, export, diagnostic, analytics, and scheduled backup expiry; restores cannot resurrect tombstoned data |
| `SP-RETENTION-001` | Expiry, deletion, cache eviction, backup expiry, access revocation, and legal hold remain distinct, inspectable states |

### 16.4 Supply-chain and hosted gates

| ID | Acceptance condition |
|---|---|
| `SP-SUPPLY-001` | Every release verifies signed provenance, source traceability, SBOM, dependency/vulnerability review, package contents, and absence of npm lifecycle scripts |
| `SP-SUPPLY-002` | Plugin key compromise, artifact substitution, revoked publisher, revoked artifact, offline trust, and development-tier fixtures follow the accepted signing policy |
| `SP-STATIC-001` | Static architecture checks reject provider SDKs or provider-specific semantics in core, forbidden dependency edges, shell launch, ambient credential lookup, and undeclared network clients |
| `SP-HOSTED-001` | No product-hosted source execution can be enabled before all hosted Blocking findings, ADRs, escape tests, residue tests, and Cloud Boundary disclosure gates are accepted |
| `SP-HOSTED-002` | Future workers prove per-job tenant, process, storage, memory, network, credential, cache, log, crash-dump, and cleanup isolation under hostile concurrent workloads |

Every normative statement in this section maps to one of these IDs, an existing
Architecture Freeze/Core/Plugin conformance ID, a static rule, or a named manual
control in the reconciled compliance matrix.

## 17. Incident response and security operations

Security response does not rewrite domain history. It appends sanitized events,
revokes future authority, quarantines affected artifacts, and preserves
reviewable non-secret Evidence.

The operational design before any networked or hosted release MUST define:

- security contact and severity taxonomy;
- plugin, Engine, credential, workload, policy, and signing-key revocation;
- tenant notification and regulatory assessment ownership;
- bounded forensic collection consistent with classification and retention;
- containment that can disable cloud publication or provider access without
  disabling valid passive local use;
- artifact advisory and compatibility behavior when the 90-day plugin window
  is shortened for security;
- correction and tombstone behavior for compromised Evidence or audit data;
- recovery tests and post-incident EDD records.

A suspected secret leak revokes the credential; redaction is not treated as a
substitute for rotation. A compromised plugin loses new authority even if its
bytes remain locally installed for forensic identity.

## 18. Unresolved decisions and ADR gates

| Decision | Existing authority | Feature blocked until resolved |
|---|---|---|
| OS-specific sandbox backends and enforcement tiers | Architecture Freeze §20.1(1), Open Question D-001 | Dynamic repository tools and plugins |
| Immutable snapshot strategy for mutable worktrees | Architecture Freeze §20.1(2) | Proofs that require stable dynamic source inputs |
| Plugin signing, provenance, revocation, key rotation, and development tier | Architecture Freeze §20.1(3) | Trusted plugin distribution and registry/built-in trust claims |
| Network allowlist, DNS, redirect, proxy, metadata endpoint, and outbound-schema enforcement | Architecture Freeze §20.1(4) | Provider-network plugins |
| Local store/cache location, retention, purge, permissions, and optional encryption threat model | Architecture Freeze §20.1(5), D-004 | Durable local-store security claims beyond test stores |
| Cloud retention, deletion, backup, region, legal hold, and tenant key strategy | Architecture Freeze §20.1(6), D-002 | Hosted multi-user beta |
| Workload identity issuance, revocation, and enterprise SSO lifecycle | Architecture Freeze §20.1(7) | Hosted workers and enterprise identity claims |
| Evidence attestation and independent verification | Architecture Freeze §20.1(8), D-003 | Third-party attestation exchange |
| Feature-specific sharing of `LOCAL_SOURCE` or `SENSITIVE_EVIDENCE` | Architecture Freeze §§11.2, 20 | Product-hosted source execution, provider source disclosure, or cloud Evidence sharing |
| Credential broker delivery and per-platform handle semantics | Required implementation security decision under Freeze §10.5; ADR if observable guarantees or boundaries change | Provider-secret use |
| Locally keyed publication-identifier lifecycle | Required implementation privacy decision under Freeze §11.3 | Metadata publication |
| Cloud action catalog, role expansion, membership, operator access, and emergency access | Required implementation authorization decision under Freeze §10.4 | Multi-user cloud operations |
| Hosted worker threat model, isolation lifecycle, cleanup, egress, and service boundary | Requires the preceding ADRs and an architecture review | Product-hosted execution |

No unresolved choice may be represented as implemented or guaranteed.
Implementation may use test doubles and ports while the choice remains open,
but the affected feature cannot pass its release gate.

## 19. Reconciliation assessment

This draft proposes no change to the frozen Application Model, result semantics,
Plugin Contract boundary, Authentication Model, Cloud Boundary, or immutable
provenance rules.

The plugin design is directionally compatible but is not releasable for dynamic
or networked execution until the three Blocking plugin findings are resolved.
The passive local MVP remains viable and should proceed independently.

The product-cloud design is compatible for future allowlisted
`MINIMAL_METADATA` publication after authorization, publication-identifier,
tenant, retention, and deletion controls are complete. Product-hosted source
execution is not within the current Phase 1 disclosure authority and remains
blocked pending an explicit Architecture Freeze ADR and the full hosted
security design.

Security acceptance is complete only when the reconciled EDD maps every
applicable control to retained Evidence and does not describe a planned,
degraded, or unverified mechanism as enforced.
