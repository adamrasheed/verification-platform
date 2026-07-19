# Core Engine Design

**Status:** EDD draft
**Scope owner:** Core Engine
**Governing references:** [Architecture Freeze](../architecture/ARCHITECTURE_FREEZE.md), [Shared Contracts](../architecture/SHARED_CONTRACTS.md), [Glossary](../architecture/GLOSSARY.md), [Open Questions](../architecture/OPEN_QUESTIONS.md)
**Normative authority:** Subordinate to the Architecture Freeze
**Implementation language:** TypeScript

## 1. Purpose

This section makes the frozen Core Engine semantics implementable. It specifies
the internal boundaries, state machines, contracts, deterministic algorithms,
failure behavior, and acceptance Evidence for:

- passive discovery and Application Model construction;
- Capability and Promise resolution;
- Proof planning, Evidence validation, and deterministic evaluation;
- advisory Repair generation and later verification;
- execution DAG scheduling, retries, cancellation, timeouts, and caching;
- lifecycle and audit event integration;
- canonical errors and command results.

The Engine is the sole semantic authority. Adapters translate requests and
render results; plugins provide provider behavior through validated contracts.
Neither may calculate an independent verdict.

This design does not select an OS sandbox backend, a mutable-worktree snapshot
implementation, a database product, a cloud vendor, or an Evidence attestation
format. Those choices are either already deferred by the freeze or can remain
behind ports without changing domain behavior.

## 2. Goals and non-goals

### 2.1 Goals

The Core Engine MUST:

1. produce one canonical result for identical sealed inputs regardless of
   adapter, execution order, or cache state;
2. preserve exact-revision provenance from model construction through Repair
   verification;
3. keep operational uncertainty separate from Promise satisfaction;
4. make every state change append-only and reconstructable;
5. execute zero-configuration discovery passively and offline;
6. authorize every dynamic action from its sealed plan before launch;
7. bound all repository, plugin, tool, memory, output, time, and concurrency
   work;
8. remain provider-neutral in types, control flow, and dependencies;
9. expose all public operations through the canonical command and event
   contracts;
10. permit storage, sandbox, process, clock, and identifier implementations to
    vary behind explicit ports.

### 2.2 Non-goals

The Core Engine does not:

- own CI scheduling, deployments, test authoring, monitoring, or provider
  fleets;
- import provider SDKs or interpret namespaced provider payloads;
- execute repository code during discovery;
- use an LLM to determine a Proof or Promise status;
- apply Repair automatically;
- infer cloud or provider authorization from local filesystem authority;
- promise hermetic behavior for observational Proofs;
- use cache presence as Evidence of trust or permission.

## 3. Package boundaries and dependency direction

The package graph defined by `SHARED_CONTRACTS.md` is binding. Core Engine work
is divided as follows:

| Package | Core Engine responsibility |
|---|---|
| `contracts` | Pure domain documents, exact revision references, schemas, canonical encodings, state and reason enums |
| `events` | Lifecycle/audit envelopes, event payload schemas, append ports |
| `discovery` | Bounded traversal planning, passive readers, attributed fact production |
| `proofs` | Applicability, proof-plan selection, deterministic Evidence evaluation, Promise aggregation |
| `evidence` | Capture normalization, content integrity, classification, validation, chain of custody |
| `repair` | Repair eligibility, deterministic candidate generation, advisory generator port, verification linking |
| `execution` | Sealed action plans, DAG scheduler, process runner port, execution manifest, local cache |
| `auth` | Permission and consent decision ports, opaque secret-binding references |
| `plugin-runtime` | Validated plugin manifest and protocol operations exposed as Engine ports |
| `engine` | Canonical lifecycle coordinator and unit-of-work boundaries |
| `protocol` | Command request, event stream, final result, compatibility and exit-code projections |

`contracts` has no runtime dependencies. Domain packages consume only
`contracts` and `events`. The `engine` package composes domain services through
public ports and does not reach into their storage or implementation internals.
No package imports an application, adapter, provider SDK, or framework type.

Dependency cycles fail a static architecture test.

## 4. Contract conventions

The following declarations are contract proposals, not implementation code.
Their JSON representations follow the API conventions in
`SHARED_CONTRACTS.md`: `camelCase` fields, absent optional values, no untrusted
key maps at boundaries, exact revision references, RFC 3339 UTC timestamps, and
integer millisecond durations.

### 4.1 Primitive and canonical JSON types

```ts
type OpaqueId = string;
type Sha256Digest = `sha256:${string}`;
type Rfc3339Utc = string;
type DurationMs = number;
type ByteCount = number;
type Ratio = number;

type CanonicalScalar = null | boolean | number | string;
type CanonicalValue =
  | CanonicalScalar
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };

type DataClassification =
  | "SECRET"
  | "LOCAL_SOURCE"
  | "SENSITIVE_EVIDENCE"
  | "MINIMAL_METADATA"
  | "EXPLICIT_SHARE";
```

Schemas constrain `DurationMs`, `ByteCount`, and counters to safe non-negative
integers and `Ratio` to the inclusive interval `[0, 1]`. Although
`CanonicalValue` describes JSON objects in TypeScript, boundary decoders reject
prototype-bearing values, duplicate keys, invalid Unicode, non-finite numbers,
unsafe integers, and keys outside the owning schema. Extensible attributes are
represented as ordered entries, not untrusted JavaScript maps.

```ts
interface ExtensionEntry {
  readonly namespace: string;
  readonly schemaVersion: number;
  readonly value: CanonicalValue;
}
```

### 4.2 Exact identity and revisions

```ts
type DomainObjectKind =
  | "application"
  | "applicationModel"
  | "capability"
  | "promise"
  | "proof"
  | "evidence"
  | "repair"
  | "repairKnowledge"
  | "providerBinding"
  | "executionPlan"
  | "executionManifest";

interface RevisionRef<K extends DomainObjectKind = DomainObjectKind> {
  readonly kind: K;
  readonly id: OpaqueId;
  readonly revision: Sha256Digest;
  readonly schemaVersion: number;
}

interface ProducerRef {
  readonly componentId: string;
  readonly version: string;
  readonly artifactDigest: Sha256Digest;
}

type ProvenanceSource =
  | "engine"
  | "discovery"
  | "configuration"
  | "policy"
  | "plugin"
  | "user"
  | "migration";

interface ProvenanceRecord {
  readonly source: ProvenanceSource;
  readonly producer: ProducerRef;
  readonly inputRefs: readonly RevisionRef[];
  readonly signalRefs: readonly OpaqueId[];
  readonly method: string;
}

interface RevisionDocument<K extends DomainObjectKind, P> {
  readonly kind: K;
  readonly id: OpaqueId;
  readonly revision: Sha256Digest;
  readonly schemaVersion: number;
  readonly provenance: readonly ProvenanceRecord[];
  readonly payload: P;
  readonly createdAt: Rfc3339Utc;
}
```

The revision preimage is the RFC 8785 canonical JSON encoding of:

```ts
interface RevisionPreimage<K extends DomainObjectKind, P> {
  readonly domain: "verification-platform/domain-revision";
  readonly kind: K;
  readonly schemaVersion: number;
  readonly id: OpaqueId;
  readonly provenance: readonly ProvenanceRecord[];
  readonly payload: P;
}
```

`revision` and `createdAt` are excluded from their own revision preimage.
`createdAt` is envelope metadata and MUST NOT affect semantic equality.
Provenance is sealed and therefore does affect the revision. All arrays use the
stable order assigned by their schema before hashing. A decoder recomputes and
verifies the revision before admitting a document to authoritative storage.

Logical IDs are generated by an injected `IdSource`; revisions never depend on
randomness. A retry that constructs the same semantic object for the same
logical ID produces the same revision.

### 4.3 Core ports

```ts
interface CanonicalCodec {
  encode(value: CanonicalValue): Uint8Array;
  digest<K extends DomainObjectKind, P>(
    value: RevisionPreimage<K, P>
  ): Sha256Digest;
}

interface Clock {
  now(): Rfc3339Utc;
}

interface IdSource {
  next(namespace: string): OpaqueId;
}

interface RevisionRepository {
  get(ref: RevisionRef): Promise<RevisionDocument<DomainObjectKind, unknown>>;
  append(
    documents: readonly RevisionDocument<DomainObjectKind, unknown>[]
  ): Promise<void>;
}

interface EventRepository {
  appendBatch(
    invocationId: OpaqueId,
    expectedNextSequence: number,
    events: readonly DomainEvent[]
  ): Promise<void>;
  readInvocation(invocationId: OpaqueId): AsyncIterable<DomainEvent>;
}
```

The persistence implementation MUST provide atomic visibility for each append
batch. An identical document or event append is idempotent; a conflicting value
for an existing identity or sequence is an integrity error. Domain services
receive `Clock` and `IdSource` explicitly and MUST NOT read process-global clock
or randomness.

## 5. Application Model construction

### 5.1 Construction phases

Application Model construction has five explicit phases:

1. **Discovery planning** creates a sealed, authorized plan from the workspace
   binding and non-overridable operational controls.
2. **Passive discovery** executes only approved readers and discovery-plugin
   operations, emitting attributed signals and candidate facts.
3. **Resolution** applies the frozen precedence rules while retaining every
   discovered and configured candidate.
4. **Graph validation** verifies identities, exact references, scope,
   applicability, ownership, and provenance invariants.
5. **Sealing** canonicalizes the complete graph manifest, appends all new
   revisions, and emits `ApplicationModelSealed`.

Domain configuration is not an input to passive discovery. Preflight
operational controls, ignore rules required for safe bounded traversal, and
externally granted permissions may shape the discovery plan; they do not
silently change Capability or Promise meaning.

### 5.2 Discovery contracts

```ts
interface WorkspaceBinding {
  readonly rootBinding: OpaqueId;
  readonly expectedRevision?: Sha256Digest;
}

interface TraversalBudget {
  readonly maxFiles: number;
  readonly maxFileBytes: ByteCount;
  readonly maxTotalBytes: ByteCount;
  readonly maxDepth: number;
  readonly deadlineMs: DurationMs;
}

interface DiscoveryPlan {
  readonly planId: OpaqueId;
  readonly workspace: WorkspaceBinding;
  readonly engineReaders: readonly string[];
  readonly pluginOperations: readonly PluginOperationRef[];
  readonly readableRoots: readonly OpaqueId[];
  readonly ignorePolicyDigest: Sha256Digest;
  readonly environmentBindings: readonly OpaqueId[];
  readonly budget: TraversalBudget;
  readonly network: "denied";
  readonly writes: "denied";
  readonly processExecution: "denied";
  readonly planDigest: Sha256Digest;
}

interface DiscoverySignal {
  readonly signalId: OpaqueId;
  readonly signalType: string;
  readonly subjectBinding: OpaqueId;
  readonly producer: ProducerRef;
  readonly method: string;
  readonly contentDigest: Sha256Digest;
  readonly classification: Exclude<DataClassification, "SECRET">;
  readonly inspectedPathRef?: OpaqueId;
}

type FactOrigin = "discovered" | "configured" | "policy";

interface FactCandidate {
  readonly factId: OpaqueId;
  readonly factType: string;
  readonly subjectId: OpaqueId;
  readonly origin: FactOrigin;
  readonly value: CanonicalValue;
  readonly confidence: Ratio;
  readonly precedence: number;
  readonly signalRefs: readonly OpaqueId[];
  readonly provenance: readonly ProvenanceRecord[];
}

interface DiscoveryDiagnostic {
  readonly code: string;
  readonly severity: "info" | "warning" | "error";
  readonly subjectRef?: OpaqueId;
  readonly reason: string;
  readonly limit?: {
    readonly name: string;
    readonly configured: number;
    readonly observed: number;
  };
}

interface DiscoveryOutput {
  readonly planDigest: Sha256Digest;
  readonly signals: readonly DiscoverySignal[];
  readonly candidates: readonly FactCandidate[];
  readonly skippedInputs: readonly DiscoveryDiagnostic[];
  readonly conflicts: readonly DiscoveryDiagnostic[];
  readonly outputDigest: Sha256Digest;
}
```

Paths in public or persistable structures are opaque local references unless a
local, appropriately classified Evidence object explicitly requires a path.
Discovery readers inspect files in canonical relative-path byte order after
normalization. They do not follow an entry until canonicalization proves it is
inside the bound workspace and is an allowed ordinary file.

Malformed files, unsupported ecosystems, archive files, symlink escapes,
special files, budget exhaustion, and unreadable inputs yield diagnostics.
They do not trigger repository execution or network fallback.

### 5.3 Fact resolution

Resolution does not delete losing facts. It emits a record connecting all
candidates to the selected effective value and explains the choice.

```ts
interface ResolvedFact {
  readonly factType: string;
  readonly subjectId: OpaqueId;
  readonly effectiveCandidateId: OpaqueId;
  readonly candidateIds: readonly OpaqueId[];
  readonly resolutionRule: string;
  readonly conflict: boolean;
}
```

The resolver applies, in order:

1. non-overridable Engine safety and organization policy;
2. external user or CI consent grants;
3. preflight operational flags;
4. workspace domain configuration;
5. user-level domain defaults;
6. discovered defaults.

Operational grants and domain facts occupy separate namespaces. A higher
precedence domain value cannot grant network, secret, write, process, degraded
isolation, or publication authority. Equal-precedence incompatible domain facts
produce a structured conflict. Required ambiguity blocks sealing; advisory
ambiguity is retained with a diagnostic and no invented effective value.

### 5.4 Application, Capability, and Provider binding

```ts
interface ApplicationPayload {
  readonly scopeBinding: OpaqueId;
  readonly parentApplication?: RevisionRef<"application">;
  readonly boundaryRefs: readonly OpaqueId[];
  readonly attributes: readonly ExtensionEntry[];
}

interface CapabilityPayload {
  readonly application: RevisionRef<"application">;
  readonly capabilityType: string;
  readonly scopeRef: OpaqueId;
  readonly discovery: {
    readonly confidence: Ratio;
    readonly signalRefs: readonly OpaqueId[];
  };
  readonly configuredCandidateRefs: readonly OpaqueId[];
  readonly effectiveFactRefs: readonly OpaqueId[];
  readonly attributes: readonly ExtensionEntry[];
}

interface ProviderBindingPayload {
  readonly target:
    | RevisionRef<"capability">
    | RevisionRef<"proof">;
  readonly plugin: {
    readonly pluginId: string;
    readonly version: string;
    readonly artifactDigest: Sha256Digest;
  };
  readonly supportedCapabilityTypes: readonly string[];
  readonly configurationRefs: readonly OpaqueId[];
  readonly authenticationBindingRefs: readonly OpaqueId[];
  readonly attributes: readonly ExtensionEntry[];
}
```

`capabilityType` is a stable provider-neutral identifier governed by the domain
schema. Framework and provider names may occur only in provenance or
namespaced opaque attributes. Core never branches on them. Provider bindings
refer to exact plugin artifacts; secret values are never fields in these
documents.

### 5.5 Promise contracts and activation

```ts
type PromiseCriticality = "required" | "advisory";
type PromiseProvenance = "declared" | "policy" | "discovered";
type PromiseLifecycle = "proposed" | "active" | "superseded" | "retired";

interface ConditionRef {
  readonly evaluatorId: string;
  readonly evaluatorVersion: string;
  readonly parameters: CanonicalValue;
}

interface PredicateRef {
  readonly predicateId: string;
  readonly predicateVersion: string;
  readonly expectedCondition: CanonicalValue;
}

interface PromisePayload {
  readonly subjectRef: RevisionRef<"application"> | RevisionRef<"capability">;
  readonly scopeRef: OpaqueId;
  readonly capability: RevisionRef<"capability">;
  readonly predicate: PredicateRef;
  readonly criticality: PromiseCriticality;
  readonly source: PromiseProvenance;
  readonly requiredProofs: readonly RevisionRef<"proof">[];
  readonly applicability: readonly ConditionRef[];
  readonly ownerRef?: OpaqueId;
}

interface PromiseLifecycleEventPayload {
  readonly promise: RevisionRef<"promise">;
  readonly from?: PromiseLifecycle;
  readonly to: PromiseLifecycle;
  readonly reasonCode: string;
  readonly supersedingRevision?: RevisionRef<"promise">;
}
```

A discovered Promise begins `proposed`. It becomes `active` only through an
explicit policy decision or a versioned Engine activation rule whose identity,
version, and inputs are recorded. Low confidence alone never activates a
required Promise. Only one active revision for a logical Promise may be
effective in a new plan.

### 5.6 Sealed model graph

```ts
type ApplicationModelLifecycle = "constructed" | "sealed" | "superseded";

interface ApplicationModelPayload {
  readonly workspaceScopeRef: OpaqueId;
  readonly applications: readonly RevisionRef<"application">[];
  readonly capabilities: readonly RevisionRef<"capability">[];
  readonly promises: readonly RevisionRef<"promise">[];
  readonly proofs: readonly RevisionRef<"proof">[];
  readonly providerBindings: readonly RevisionRef<"providerBinding">[];
  readonly repairKnowledge: readonly RevisionRef<"repairKnowledge">[];
  readonly policyRefs: readonly OpaqueId[];
  readonly configurationRefs: readonly OpaqueId[];
  readonly discoveryOutputDigest: Sha256Digest;
  readonly resolvedFactRefs: readonly OpaqueId[];
}
```

The graph validator rejects:

- missing or non-exact references;
- reference cycles where the schema permits only a DAG;
- a Capability owned outside its Application scope;
- a Promise referencing a Capability or Proof outside its scope;
- a Proof that does not support the Promise that requires it;
- absent fact provenance or unresolved required conflicts;
- orphan Provider bindings or Repair Knowledge;
- mutable aliases such as `latest` or version ranges;
- duplicate logical objects where schema cardinality requires one;
- a model whose child document revision fails recomputation.

Sealing appends the child revisions, the Application Model revision, and its
seal event as one logical unit of work. A storage failure yields
`VFY_INTEGRITY_MODEL_PERSISTENCE` and no model is considered sealed. Atomic
supersession appends `ApplicationModelSuperseded` and
`ApplicationModelBecameCurrent`; historical graphs remain traversable. A
superseded revision cannot be the input to a newly created plan.

## 6. Proof planning and evaluation

### 6.1 Proof definition

```ts
type ReproducibilityClass = "hermetic" | "replayable" | "observational";
type ProofLifecycle = "proposed" | "active" | "superseded" | "retired";

interface EvidenceRequirement {
  readonly requirementId: OpaqueId;
  readonly evidenceType: string;
  readonly mediaTypes: readonly string[];
  readonly subjectRef: RevisionRef;
  readonly minCount: number;
  readonly maxCount: number;
  readonly validationPolicyRef: OpaqueId;
}

interface PermissionRequirements {
  readonly filesystem: readonly OpaqueId[];
  readonly networkPolicyRef?: OpaqueId;
  readonly secretBindingRefs: readonly OpaqueId[];
  readonly processExecution: boolean;
  readonly writes: readonly OpaqueId[];
}

interface ResourceBounds {
  readonly timeoutMs: DurationMs;
  readonly maxCpuMs: DurationMs;
  readonly maxMemoryBytes: ByteCount;
  readonly maxOutputBytes: ByteCount;
  readonly maxScratchBytes: ByteCount;
  readonly maxProcesses: number;
  readonly maxCreatedFiles: number;
}

interface CachePolicy {
  readonly eligibility: "never" | "declared";
  readonly validityWindowMs?: DurationMs;
}

interface DeterministicEvaluatorRef {
  readonly evaluatorId: string;
  readonly evaluatorVersion: string;
  readonly logicDigest: Sha256Digest;
  readonly configuration: CanonicalValue;
}

interface ProofPayload {
  readonly supportedPromises: readonly RevisionRef<"promise">[];
  readonly inputRefs: readonly RevisionRef[];
  readonly evidenceRequirements: readonly EvidenceRequirement[];
  readonly evaluator: DeterministicEvaluatorRef;
  readonly dependencies: readonly RevisionRef<"proof">[];
  readonly permissions: PermissionRequirements;
  readonly resources: ResourceBounds;
  readonly reproducibility: ReproducibilityClass;
  readonly cachePolicy: CachePolicy;
  readonly applicability: readonly ConditionRef[];
  readonly expectedFailureReasonCodes: readonly string[];
  readonly providerBinding?: RevisionRef<"providerBinding">;
}
```

Proof evaluators are registered by exact ID, version, and artifact digest at
Engine assembly. Unknown evaluators are compatibility errors. Evaluator input
is limited to the exact model context, validated Evidence documents, and sealed
configuration declared by the Proof. Evaluators receive no clock, randomness,
network, filesystem, ambient environment, storage, or credential port.

### 6.2 Invocation proof plan

Planning evaluates applicability deterministically against the sealed
Application Model and declared execution context. For every required active
Promise, it records one of:

- one applicable executable Proof selection for each required Proof;
- an explicit non-applicability decision;
- a typed coverage gap that will aggregate to `indeterminate`.

```ts
interface ExecutionContextRef {
  readonly contextId: OpaqueId;
  readonly model: RevisionRef<"applicationModel">;
  readonly normalizedEnvironmentDigest: Sha256Digest;
  readonly policyDigest: Sha256Digest;
  readonly configurationDigest: Sha256Digest;
}

interface PlannedProof {
  readonly proof: RevisionRef<"proof">;
  readonly promise: RevisionRef<"promise">;
  readonly applicability: "applicable" | "not_applicable";
  readonly applicabilityReason: string;
  readonly dependencyNodeIds: readonly OpaqueId[];
  readonly executionNodeId?: OpaqueId;
}

interface InvocationPlan {
  readonly planId: OpaqueId;
  readonly model: RevisionRef<"applicationModel">;
  readonly context: ExecutionContextRef;
  readonly selectedPromises: readonly RevisionRef<"promise">[];
  readonly proofs: readonly PlannedProof[];
  readonly actionGraph: ExecutionDag;
  readonly planDigest: Sha256Digest;
}
```

The planner rejects cycles, missing active revisions, cross-model selections,
ambiguous effective Proof implementations, and plans that select more than one
effective execution slot for a required Proof. Shared prerequisite nodes have a
single node ID and execute once per invocation.

### 6.3 Proof execution and attempts

```ts
type ProofExecutionState =
  | "queued"
  | "running"
  | "passed"
  | "failed"
  | "indeterminate"
  | "error"
  | "cancelled";

type ProofVerdict =
  | "passed"
  | "failed"
  | "indeterminate"
  | "error"
  | "cancelled";

interface ProofAttempt {
  readonly attemptId: OpaqueId;
  readonly proof: RevisionRef<"proof">;
  readonly promise: RevisionRef<"promise">;
  readonly model: RevisionRef<"applicationModel">;
  readonly executionContextId: OpaqueId;
  readonly ordinal: number;
  readonly previousAttemptId?: OpaqueId;
  readonly planKey: Sha256Digest;
  readonly manifest: RevisionRef<"executionManifest">;
}

interface ProofAttemptResult {
  readonly attemptId: OpaqueId;
  readonly verdict: ProofVerdict;
  readonly evidence: readonly RevisionRef<"evidence">[];
  readonly evidenceValidationEventIds: readonly OpaqueId[];
  readonly reasonCodes: readonly string[];
  readonly errors: readonly StructuredError[];
  readonly resultDigest: Sha256Digest;
  readonly cachedFromExecution?: OpaqueId;
}

interface EffectiveProofExecution {
  readonly proof: RevisionRef<"proof">;
  readonly promise: RevisionRef<"promise">;
  readonly attemptIds: readonly OpaqueId[];
  readonly effectiveAttemptId: OpaqueId;
  readonly selectionReason: "first_terminal" | "retry_policy_exhausted";
}
```

Attempt ordinals are consecutive within a planned Proof slot. Every retry is a
new `attemptId`; the previous attempt and its events remain immutable. The
effective attempt is the last authorized attempt after retry policy
termination. Cache reuse still creates a new execution record that cites the
originating execution and exact reused Evidence and validation events.

### 6.4 Evidence capture and validation

```ts
interface ChainOfCustodyEntry {
  readonly sequence: number;
  readonly action: "captured" | "normalized" | "redacted" | "persisted";
  readonly producer: ProducerRef;
  readonly inputDigest: Sha256Digest;
  readonly outputDigest: Sha256Digest;
}

interface EvidencePayload {
  readonly evidenceType: string;
  readonly mediaType: string;
  readonly producer: ProducerRef;
  readonly captureMethod: string;
  readonly capturedAt: Rfc3339Utc;
  readonly subjectRefs: readonly RevisionRef[];
  readonly inputRefs: readonly RevisionRef[];
  readonly contentDigest: Sha256Digest;
  readonly contentStorageRef: OpaqueId;
  readonly sensitivity: Exclude<DataClassification, "SECRET">;
  readonly chainOfCustody: readonly ChainOfCustodyEntry[];
  readonly supersedes: readonly RevisionRef<"evidence">[];
  readonly observation?: ObservationalContext;
}

interface ObservationalContext {
  readonly observedAt: Rfc3339Utc;
  readonly targetIdentityRef: OpaqueId;
  readonly sanitizedRequestParameters: CanonicalValue;
  readonly responseProvenance: readonly ProvenanceRecord[];
  readonly validUntil?: Rfc3339Utc;
}

type EvidenceValidationState = "captured" | "validated" | "rejected";

interface EvidenceValidationEventPayload {
  readonly evidence: RevisionRef<"evidence">;
  readonly from: "captured";
  readonly to: "validated" | "rejected";
  readonly validator: ProducerRef;
  readonly validationPolicyRef: OpaqueId;
  readonly reasonCodes: readonly string[];
}
```

Capture performs, in order: byte bounding, safe decoding, normalization,
classification, ingestion redaction, schema validation, content digesting,
chain-of-custody construction, and atomic persistence. Raw plugin or tool output
is never Evidence until this pipeline succeeds.

Validation checks the declared Evidence requirement, schema, media type,
producer identity, content integrity, subject and input references, chain of
custody, classification, and reproducibility-specific metadata. Validation or
rejection is an event and never mutates the Evidence document. A corrected
observation is a new Evidence revision whose `supersedes` list names the exact
prior revision.

`passed` and `failed` require at least the complete set of validated Evidence
required by the Proof. `indeterminate` and `error` require diagnostic Evidence
or a typed reason stating why it could not safely be captured. Evidence
persistence or validation failure cannot yield a durable pass or fail.

### 6.5 Deterministic evaluator result

```ts
interface EvaluationInput {
  readonly model: RevisionRef<"applicationModel">;
  readonly promise: RevisionRef<"promise">;
  readonly proof: RevisionRef<"proof">;
  readonly executionContextId: OpaqueId;
  readonly evidence: readonly RevisionRef<"evidence">[];
  readonly evidenceValidationEventIds: readonly OpaqueId[];
}

interface EvaluationDecision {
  readonly verdict: "passed" | "failed" | "indeterminate";
  readonly predicateId: string;
  readonly reasonCodes: readonly string[];
  readonly evaluatedEvidence: readonly RevisionRef<"evidence">[];
  readonly decisionDigest: Sha256Digest;
}

interface ProofEvaluator {
  evaluate(input: EvaluationInput): Promise<EvaluationDecision>;
}
```

Operational failures do not enter `ProofEvaluator` as synthetic facts. The
coordinator records `error` or `cancelled` directly when execution or a required
control does not reach Evidence evaluation. An evaluator may return
`indeterminate` only when valid Evidence exists but cannot decide the
predicate, or when the Proof contract explicitly permits a machine-readable
missing-Evidence decision.

The evaluator sorts Evidence by schema-defined stable keys, verifies exact
references again, and emits a decision digest over its evaluator identity and
canonical input/output. Re-evaluating already captured observational Evidence
is deterministic even though its capture was not.

## 7. Promise and invocation aggregation

### 7.1 Promise status

```ts
type PromiseStatus = "satisfied" | "violated" | "indeterminate";

interface PromiseEvaluation {
  readonly promise: RevisionRef<"promise">;
  readonly model: RevisionRef<"applicationModel">;
  readonly executionContextId: OpaqueId;
  readonly effectiveProofExecutions: readonly EffectiveProofExecution[];
  readonly status: PromiseStatus;
  readonly reasonCodes: readonly string[];
}
```

Aggregation is a pure function over one active Promise revision and the plan's
effective Proof executions:

1. Exclude Proofs recorded as not applicable by the sealed plan.
2. Verify that every remaining required Proof has exactly one effective
   execution from the same Application Model revision and execution context.
3. If any effective execution is `failed`, return `violated`.
4. If at least one required applicable Proof exists and all are `passed`,
   return `satisfied`.
5. Otherwise return `indeterminate`.

`error`, `cancelled`, missing execution, coverage gap, unavailable credentials,
permission denial, timeout, malformed output, and unsupported environment all
therefore produce an indeterminate Promise, never a violation. Advisory Promise
failures remain in the result and diagnostics but do not elevate the command
exit code.

### 7.2 Invocation outcome

```ts
type VerifyOutcome =
  | "satisfied"
  | "violated"
  | "indeterminate"
  | "not_evaluated";

interface VerificationSummary {
  readonly outcome: VerifyOutcome;
  readonly requiredPromiseCount: number;
  readonly advisoryPromiseCount: number;
  readonly satisfiedCount: number;
  readonly violatedCount: number;
  readonly indeterminateCount: number;
}
```

For required applicable Promises:

- none with effective Proof coverage: `not_evaluated`;
- any `violated`: `violated`;
- otherwise any `indeterminate`: `indeterminate`;
- otherwise at least one `satisfied`: `satisfied`.

The result order is model order for Applications, then stable logical ID and
revision for Promises and Proofs, then attempt ordinal, Evidence revision, and
Repair revision. Completion order never affects serialization.

## 8. Repair engine

### 8.1 Eligibility and generation

Repair generation is optional and begins only after a terminal failed or
indeterminate Proof execution has durable Evidence or a machine-readable
diagnostic reason. It never runs for a passed execution merely to propose an
alternative.

```ts
interface RepairKnowledgePayload {
  readonly knowledgeType: string;
  readonly supportedPredicateIds: readonly string[];
  readonly generatorCompatibility: readonly string[];
  readonly contentDigest: Sha256Digest;
  readonly contentStorageRef: OpaqueId;
}

interface ProposedAction {
  readonly actionType: string;
  readonly targetRef: OpaqueId;
  readonly payloadRef: OpaqueId;
  readonly dataClassification: DataClassification;
}

interface VerificationPlanRef {
  readonly proof: RevisionRef<"proof">;
  readonly expectedModelChangeRefs: readonly OpaqueId[];
  readonly requiredConsentGrantRefs: readonly OpaqueId[];
}

interface ModelGenerationRecord {
  readonly modelId: string;
  readonly modelVersion: string;
  readonly promptTemplateDigest: Sha256Digest;
  readonly parameters: CanonicalValue;
}

interface RepairPayload {
  readonly motivatingPromise: RevisionRef<"promise">;
  readonly motivatingAttemptId: OpaqueId;
  readonly motivatingEvidence: readonly RevisionRef<"evidence">[];
  readonly generator: ProducerRef;
  readonly repairKnowledge: readonly RevisionRef<"repairKnowledge">[];
  readonly proposedActions: readonly ProposedAction[];
  readonly assumptions: readonly string[];
  readonly requiredPermissions: PermissionRequirements;
  readonly expectedEffect: string;
  readonly confidence: Ratio;
  readonly confidenceBasis: readonly OpaqueId[];
  readonly verificationPlan: VerificationPlanRef;
  readonly modelGeneration?: ModelGenerationRecord;
}
```

Deterministic generators receive only exact motivating revisions and exact
Repair Knowledge revisions. An advisory model-backed generator additionally
receives a disclosure-approved, redacted input projection and records its exact
model, prompt-template digest, and generation parameters. Model output is
untrusted candidate data: it is bounded, decoded, redacted, schema-validated,
permission-analyzed, and persisted as advisory Repair. It is never Evidence.

### 8.2 Repair lifecycle

```ts
type RepairLifecycle =
  | "proposed"
  | "rejected"
  | "accepted"
  | "applied"
  | "verified"
  | "verification_failed";

interface RepairLifecycleEventPayload {
  readonly repair: RevisionRef<"repair">;
  readonly from?: RepairLifecycle;
  readonly to: RepairLifecycle;
  readonly actorRef: OpaqueId;
  readonly authorizationDecisionRef?: OpaqueId;
  readonly reasonCode: string;
  readonly verifyingAttemptId?: OpaqueId;
}
```

Allowed paths are:

```text
proposed -> rejected
proposed -> accepted -> applied -> verified
                              -> verification_failed
```

Acceptance and application are separate explicit commands and permission
decisions. Application creates a new event; it does not edit the Repair or the
motivating failure. `verified` requires a later attempt whose exact Proof
revision matches the Repair verification plan, whose result is `passed`, and
whose model/input lineage demonstrates the proposed change was in scope.
Every other terminal verifying attempt yields `verification_failed` or leaves
the Repair `applied` if policy permits another authorized verification attempt.

The Engine never applies Repairs during `verify`.

## 9. State machines and event sourcing

### 9.1 Transition rules

| Aggregate | Initial | Allowed transitions | Terminal or historical behavior |
|---|---|---|---|
| Application Model revision | `constructed` | `constructed -> sealed -> superseded` | Superseded remains traversable and cannot receive new plans |
| Promise definition | `proposed` | `proposed -> active`; `active -> superseded`; `active -> retired` | Only active revisions enter new plans |
| Proof definition | `proposed` | `proposed -> active`; `active -> superseded`; `active -> retired` | Only active revisions execute in new plans |
| Proof execution | `queued` | `queued -> running`; `queued -> cancelled`; `running -> passed|failed|indeterminate|error|cancelled` | Terminal states never transition |
| Evidence | `captured` | `captured -> validated`; `captured -> rejected` | Correction creates a new revision |
| Repair | `proposed` | Frozen lifecycle paths in §8.2 | Lifecycle events never edit the Repair |

Transition reducers are pure and reject:

- an unknown state or control-flow value;
- any transition not listed above;
- a second terminal transition;
- sequence regression or duplicate sequence with different content;
- a subject revision mismatch;
- a Proof pass/fail without complete validated Evidence;
- Repair verification without a later matching passing attempt.

### 9.2 Event contract

```ts
interface EventSubject {
  readonly id: OpaqueId;
  readonly revision: Sha256Digest;
}

interface DomainEvent<P = CanonicalValue> {
  readonly schemaVersion: number;
  readonly eventId: OpaqueId;
  readonly eventType: string;
  readonly occurredAt: Rfc3339Utc;
  readonly invocationId: OpaqueId;
  readonly subject?: EventSubject;
  readonly causationId: OpaqueId;
  readonly correlationId: OpaqueId;
  readonly sequence: number;
  readonly producer: ProducerRef;
  readonly dataClassification: DataClassification;
  readonly payload: P;
}
```

Required Engine event families include:

- invocation and stage: `InvocationAccepted`, `StageStarted`,
  `StageCompleted`, `StageBlocked`, `InvocationCancelled`;
- discovery and model: `DiscoveryPlanned`, `DiscoveryCompleted`,
  `ApplicationModelConstructed`, `ApplicationModelSealed`,
  `ApplicationModelSuperseded`;
- planning and authorization: `InvocationPlanned`,
  `ExecutionAuthorizationGranted`, `ExecutionAuthorizationDenied`;
- execution: `ProofExecutionQueued`, `ProofExecutionStarted`,
  `ProofExecutionRetried`, and one terminal Proof execution event;
- Evidence: `EvidenceCaptured`, `EvidenceValidated`, `EvidenceRejected`;
- evaluation: `PromiseEvaluated`, `VerificationAggregated`;
- Repair: `RepairProposed` and the lifecycle events in §8.2;
- cache: `CacheBypassed`, `CacheMissed`, `CacheHit`, `CacheEntryPublished`,
  `CacheEntryRejected`;
- audit-sensitive controls: permission, secret grant, degraded isolation,
  publication, deletion, and policy decisions.

Event names are stable past-tense facts. Desired actions are commands, not
events. Redaction and classification occur before event construction. Event
payloads contain opaque local references in place of forbidden paths, secret
values, or raw output.

### 9.3 Durable stage boundaries

The coordinator advances a stage only after required documents and events for
the prior stage are durably appended. The minimum commit boundaries are:

1. invocation acceptance and validated request;
2. sealed discovery plan;
3. discovery output;
4. sealed Application Model and current-revision event;
5. invocation plan and authorization decisions;
6. each attempt transition and execution manifest;
7. Evidence revision plus capture event;
8. Evidence validation/rejection event;
9. terminal Proof result;
10. Promise and invocation aggregation;
11. Repair revisions and events;
12. final canonical result and completion event.

Crash recovery replays complete append batches, marks abandoned invocations,
quarantines partial external artifacts, and reconciles surviving child
processes where possible. It never infers a pass from child exit status or an
uncommitted cache entry.

## 10. Execution planning and manifest

### 10.1 Sealed action plan

```ts
type RetrySafety = "not_retry_safe" | "retry_safe";

interface ExecutableIdentity {
  readonly componentId: string;
  readonly version: string;
  readonly artifactDigest: Sha256Digest;
  readonly entryPointRef: OpaqueId;
}

interface NetworkPolicy {
  readonly mode: "denied" | "allowlist";
  readonly destinationRefs: readonly OpaqueId[];
  readonly egressSchemaRefs: readonly OpaqueId[];
}

interface ActionPlanPayload {
  readonly executable: ExecutableIdentity;
  readonly arguments: readonly string[];
  readonly workingDirectoryRef: OpaqueId;
  readonly readableRootRefs: readonly OpaqueId[];
  readonly writableRootRefs: readonly OpaqueId[];
  readonly environmentBindingRefs: readonly OpaqueId[];
  readonly secretBindingRefs: readonly OpaqueId[];
  readonly network: NetworkPolicy;
  readonly resources: ResourceBounds;
  readonly pluginAndToolRefs: readonly OpaqueId[];
  readonly expectedInputRefs: readonly RevisionRef[];
  readonly expectedOutputSchemaRefs: readonly OpaqueId[];
  readonly expectedSideEffects: readonly string[];
  readonly retrySafety: RetrySafety;
}
```

Arguments are an argument vector, never a shell string. Repository-derived
values cannot select an executable or expand permissions after the plan is
sealed. Authorization evaluates the exact plan digest and emits one decision
per filesystem, network, secret, process, write, resource, and degraded
isolation requirement.

If the platform cannot enforce a declared control, authorization denies the
action unless a separately authenticated, explicit degraded-isolation grant
matches that exact plan and enforcement gap. The result and audit stream record
the effective enforcement tier.

### 10.2 Execution manifest

```ts
interface ExecutionManifestPayload {
  readonly engine: ProducerRef;
  readonly model: RevisionRef<"applicationModel">;
  readonly promise: RevisionRef<"promise">;
  readonly proof: RevisionRef<"proof">;
  readonly pluginAndToolArtifacts: readonly ProducerRef[];
  readonly sourceInputDigest: Sha256Digest;
  readonly repositoryDirtyState: "clean" | "dirty" | "unknown";
  readonly configurationDigest: Sha256Digest;
  readonly policyDigest: Sha256Digest;
  readonly platform: string;
  readonly architecture: string;
  readonly runtimeVersions: readonly CanonicalValue[];
  readonly authenticationBindingRefs: readonly OpaqueId[];
  readonly filesystemPolicyDigest: Sha256Digest;
  readonly networkPolicyDigest: Sha256Digest;
  readonly clockPolicy: string;
  readonly randomnessPolicy: string;
  readonly discoveryOutputDigest: Sha256Digest;
  readonly executionPlanDigest: Sha256Digest;
}
```

The pre-execution `planKey` covers the canonical manifest payload plus every
declared result-affecting input available before launch. A credential binding
contributes only a non-secret generation-and-scope fingerprint when the broker
can safely provide one. Otherwise the plan is non-cacheable.

After capture, `resultDigest` covers the attempt identity, exact manifest
revision, terminal status, sanitized external observations, Evidence revisions,
validation events, and deterministic evaluation decision. It does not replace
the pre-execution `planKey`.

A worktree stability monitor compares result-affecting inputs before and after
execution. Any relevant mutation yields `indeterminate` with
`VFY_INTEGRITY_INPUT_CHANGED` unless an approved immutable snapshot mechanism
proves the action consumed stable inputs.

## 11. Scheduler

### 11.1 DAG contract

```ts
type ExecutionNodeKind =
  | "prerequisite"
  | "proof_capture"
  | "evidence_validation"
  | "proof_evaluation"
  | "repair_generation";

interface ExecutionNode {
  readonly nodeId: OpaqueId;
  readonly kind: ExecutionNodeKind;
  readonly dependencyNodeIds: readonly OpaqueId[];
  readonly actionPlan?: RevisionRef<"executionPlan">;
  readonly cpuWeight: number;
  readonly pluginConcurrencyKey?: string;
  readonly networkConcurrencyKey?: string;
  readonly stableOrder: number;
}

interface ExecutionDag {
  readonly nodes: readonly ExecutionNode[];
  readonly graphDigest: Sha256Digest;
}

interface SchedulerLimits {
  readonly maxConcurrency: number;
  readonly maxCpuWeight: number;
  readonly perPlugin: readonly {
    readonly key: string;
    readonly maxConcurrency: number;
  }[];
  readonly perNetworkClass: readonly {
    readonly key: string;
    readonly maxConcurrency: number;
  }[];
  readonly maxQueuedNodes: number;
}
```

Planning validates acyclicity and computes `stableOrder` using a stable
topological sort. At runtime, the scheduler may choose any ready node that fits
resource and concurrency limits. The tie-break order is `stableOrder`, then
`nodeId`. Backpressure stops plan producers and plugin readers before in-memory
queues exceed policy limits.

Shared prerequisites have one canonical node identity derived from their
sealed inputs and execute once per invocation. Their result fans out to
dependents by exact result reference, not by copying mutable state.

The scheduler records node completion in stable plan order for the final
result, even when events truthfully retain actual occurrence order. Schedule
randomization in tests MUST produce canonical-equivalent results after volatile
event metadata is removed.

### 11.2 Dependency failure

When a dependency:

- `failed`: dependent evaluation may proceed only if its Proof definition
  explicitly declares that failed Evidence as an input; otherwise the dependent
  is `indeterminate`;
- is `indeterminate` or `error`: the dependent is `indeterminate` with exact
  causal references unless it has other sufficient declared Evidence;
- is `cancelled`: the dependent is cancelled when invocation cancellation is
  active, otherwise indeterminate with a dependency-cancelled reason;
- is denied or unavailable: the dependent is not launched and records a typed
  blocking reason.

No dependency condition is silently converted into `failed`.

## 12. Cancellation, deadlines, timeouts, and retries

### 12.1 Cancellation hierarchy

One invocation cancellation token is created at dispatcher acceptance. Child
tokens exist for stages, DAG nodes, plugin calls, and processes. Cancellation
propagates only downward and is idempotent.

Cancellation sources are:

- explicit adapter/user cancellation;
- invocation deadline expiration;
- Engine shutdown;
- fail-closed response to an internal integrity condition.

Upon cancellation, the scheduler stops admitting new work, signals all running
children, begins process-tree termination within one second, escalates according
to the process-runner policy, drains bounded protocol output, and appends
terminal cancellation events. A cancelled action cannot later publish a cache
entry or successful terminal result.

Invocation cancellation produces `operationalStatus: "cancelled"` and exit code
`5`. Started Proof executions end `cancelled`; queued work receives a
cancellation event without pretending it ran.

### 12.2 Timeout semantics

The canonical request `deadlineMs` is measured from dispatcher acceptance by a
monotonic timer. Expiration cancels the invocation.

An individual action's `ResourceBounds.timeoutMs` is distinct. Its expiration:

1. terminates the action process tree;
2. records `VFY_EXECUTION_TIMEOUT`;
3. ends that attempt as `error`, never `failed`;
4. permits a new attempt only when the action is declared retry-safe and policy
   authorizes another bounded attempt.

A plugin handshake or protocol deadline uses the same per-action behavior with
a plugin-domain timeout code. Deadline and timeout events include configured
duration and sanitized elapsed duration, never raw command arguments.

### 12.3 Retry policy

```ts
interface RetryPolicy {
  readonly maxAttempts: number;
  readonly initialBackoffMs: DurationMs;
  readonly maxBackoffMs: DurationMs;
  readonly multiplier: number;
  readonly jitter: "none";
  readonly retryableErrorCodes: readonly string[];
}
```

Phase 1 uses deterministic backoff without randomness. A retry occurs only
when:

1. the terminal attempt is `error`;
2. the sealed action plan says `retry_safe`;
3. the `StructuredError.retryability` is `safe`, or it is `policy_required`
   and a matching policy grant exists;
4. the error code is allowlisted by the sealed retry policy;
5. `maxAttempts` and the invocation deadline permit another attempt;
6. invocation cancellation is not active.

`passed`, `failed`, `indeterminate`, and `cancelled` are never retried to seek a
different verdict. Authorization denial, schema violation, integrity failure,
unknown control-flow values, and redaction failure are never automatically
retried. Each retry appends `ProofExecutionRetried` with the prior attempt,
reason code, authorization, and delay. The final authorized attempt is the
effective attempt.

## 13. Local cache

### 13.1 Eligibility and key

```ts
type CacheDisposition = "hit" | "miss" | "bypass";

interface CacheDecision {
  readonly disposition: CacheDisposition;
  readonly planKey: Sha256Digest;
  readonly reasonCode: string;
  readonly originatingExecutionId?: OpaqueId;
  readonly evidenceRefs: readonly RevisionRef<"evidence">[];
  readonly validationEventIds: readonly OpaqueId[];
}

interface CacheEntry {
  readonly schemaVersion: number;
  readonly planKey: Sha256Digest;
  readonly proof: RevisionRef<"proof">;
  readonly model: RevisionRef<"applicationModel">;
  readonly originatingExecutionId: OpaqueId;
  readonly originatingResultDigest: Sha256Digest;
  readonly evidenceRefs: readonly RevisionRef<"evidence">[];
  readonly validationEventIds: readonly OpaqueId[];
  readonly reproducibility: ReproducibilityClass;
  readonly validUntil?: Rfc3339Utc;
  readonly byteSize: ByteCount;
  readonly integrityDigest: Sha256Digest;
}
```

The key includes Engine and contract versions, plugin/tool artifact digests,
Proof and model revisions, source/input digests, normalized configuration and
policy, declared environment dimensions, reproducibility class, discovery
output digest, and safe credential-binding identity when available.

Cache eligibility is denied when:

- the Proof policy says `never`;
- any declared result-affecting input lacks a stable digest;
- an observational or credential-dependent input cannot be represented safely;
- an observational validity window is absent or expired;
- required Evidence or validation events are missing;
- integrity, schema, classification, or redaction validation fails;
- the invoking authorization is weaker than the permissions needed to reuse
  the result.

A cache hit revalidates the entry schema, integrity, Evidence documents,
validation events, expiry, exact references, current policy, and authorization.
It never elevates trust or permissions.

### 13.2 Publication and concurrency

Cache publication writes a complete entry to unpredictable temporary storage,
syncs as required by the selected local-store design, verifies it, and then
atomically compares and publishes by `planKey`. Partial entries are invisible.

Concurrent writers use per-key single-flight or atomic compare-and-publish with
owner identity, bounded lease, stale-owner recovery, and crash-safe release.
The loser validates and reuses the winner's complete entry or discards its own
temporary entry. Entries are never merged.

Corruption, an abandoned writer, an unsupported schema, or a missing referenced
object is a diagnosed miss. It is not a fatal Engine condition. Cache bypass,
inspection, and clearing are canonical local commands; clearing cache does not
delete authoritative execution or Evidence history.

The exact local cache layout, locking primitive, location, retention, and purge
mechanism are implementation selections to be recorded with the broader local
store decision required by Architecture Freeze §20.1(5).

## 14. Determinism

### 14.1 Deterministic inputs

Every semantic operation receives an explicit input bundle. Direct access to
the process clock, randomness, locale, timezone, environment, filesystem,
network, or current working directory outside an authorized port fails a static
or runtime control.

Deterministic rules include:

- RFC 8785 canonical JSON for semantic hashes;
- Unicode and path normalization rules fixed by schema version;
- stable ordering declared for every collection;
- exact evaluator, plugin, tool, policy, configuration, and schema versions;
- UTC timestamps only as observation or event metadata, never hidden evaluator
  inputs;
- no randomized retry jitter in Phase 1;
- decimal and integer bounds that avoid cross-runtime ambiguity;
- result serialization independent of completion order;
- explicit volatile-field annotations in public schemas.

### 14.2 Reproducibility behavior

| Class | Capture | Evaluation | Cache |
|---|---|---|---|
| `hermetic` | Reads only sealed declared inputs | Deterministic | Eligible when all key inputs and policy permit |
| `replayable` | Captures sufficient external observations | Deterministic from captured Evidence | Eligible only when replay identity is complete |
| `observational` | Reads live external state with required observation metadata | Deterministic from captured Evidence | Normally bypassed; eligible only with complete safe identity and bounded validity window |

The result and human projection state the class exactly. No Engine text or
field aliases observational work as hermetic, reproducible, or replayable.

### 14.3 Semantic comparison

Determinism tests remove only fields explicitly marked volatile by schema:
invocation IDs, attempt IDs, event IDs, envelope timestamps, actual durations,
and local storage references. They do not remove model revisions, plan keys,
result digests, statuses, reason codes, ordering, Evidence content digests,
producer versions, or policy/configuration identity.

## 15. Structured errors

```ts
type ErrorCategory =
  | "invalid"
  | "permission"
  | "authentication"
  | "environment"
  | "plugin"
  | "network"
  | "integrity"
  | "compatibility"
  | "resource"
  | "internal";

type ErrorRetryability = "never" | "safe" | "policy_required";

interface StructuredError {
  readonly code: `VFY_${string}`;
  readonly category: ErrorCategory;
  readonly retryability: ErrorRetryability;
  readonly blocksRequiredProof: boolean;
  readonly message: string;
  readonly remediation?: string;
  readonly causes: readonly StructuredError[];
  readonly component: ProducerRef;
  readonly operation: string;
  readonly evidenceRefs: readonly RevisionRef<"evidence">[];
  readonly diagnosticRefs: readonly OpaqueId[];
}
```

Codes use `VFY_<DOMAIN>_<CONDITION>` and never contain provider names. The code
registry owns meaning, category, default retryability, required data
classification, and compatibility status. A producer cannot override a code's
registered category.

Unknown codes with a known category are preserved and handled by category.
Unknown categories, Proof states, operational statuses, outcomes, and other
control-flow enums yield `VFY_COMPATIBILITY_UNKNOWN_CONTROL_VALUE` and fail
safely. Errors are operational facts and never become failed Evidence.

The initial Core Engine code families include:

- `VFY_REQUEST_*`, `VFY_CONFIGURATION_*`, and `VFY_POLICY_*`;
- `VFY_DISCOVERY_*` and `VFY_MODEL_*`;
- `VFY_PERMISSION_*` and `VFY_AUTHENTICATION_*`;
- `VFY_EXECUTION_*`, `VFY_RESOURCE_*`, and `VFY_ENVIRONMENT_*`;
- `VFY_PLUGIN_*` and `VFY_NETWORK_*`;
- `VFY_EVIDENCE_*`, `VFY_REDACTION_*`, and `VFY_INTEGRITY_*`;
- `VFY_CACHE_*` and `VFY_COMPATIBILITY_*`;
- `VFY_INTERNAL_*`.

Every new stable code requires schema fixtures and result-projection tests.

## 16. Canonical result integration

### 16.1 Result proposal

```ts
type OperationalStatus =
  | "completed"
  | "invalid"
  | "blocked"
  | "cancelled"
  | "internal_error";

interface VerifyResult {
  readonly kind: "verify";
  readonly outcome: VerifyOutcome;
  readonly partial?: true;
  readonly applicationModelRevision: Sha256Digest;
  readonly summary: VerificationSummary;
  readonly promises: readonly PromiseEvaluation[];
  readonly proofExecutions: readonly EffectiveProofExecution[];
  readonly evidence: readonly RevisionRef<"evidence">[];
  readonly repairs: readonly RevisionRef<"repair">[];
  readonly executionManifestRefs: readonly RevisionRef<"executionManifest">[];
  readonly cacheDecisions: readonly CacheDecision[];
}

interface CommandEnvelope<R> {
  readonly schemaVersion: 1;
  readonly command: string;
  readonly invocationId: OpaqueId;
  readonly engine: {
    readonly version: string;
    readonly artifactDigest: Sha256Digest;
  };
  readonly operationalStatus: OperationalStatus;
  readonly startedAt: Rfc3339Utc;
  readonly durationMs: DurationMs;
  readonly result: R | null;
  readonly diagnostics: readonly StructuredError[];
}
```

The Engine finalizer alone chooses `operationalStatus` and verify `outcome`.
It consumes persisted stage, attempt, Evidence, and evaluation records rather
than adapter state or process exit codes.

For a valid completed verify command, `result` is present. For another
operational status, `result` may be null. A non-completed result, when retained,
is `not_evaluated`, except a blocked invocation may expose an
`indeterminate`, `partial: true` result when some required work durably
completed.

### 16.2 Operational status decision

The finalizer uses these rules before applying the frozen exit-code precedence:

- `internal_error`: an Engine invariant, unexpected internal failure, or
  incompatible control-flow value prevented a trustworthy complete result;
- `cancelled`: invocation cancellation completed;
- `invalid`: request, configuration, policy, or schema was invalid before a
  valid execution could proceed;
- `blocked`: a required plugin, execution, environment, authentication,
  authorization, persistence, redaction, or security control failed;
- `completed`: all required Engine stages needed for the typed result completed,
  even when the verification outcome is violated, indeterminate, or not
  evaluated.

Advisory-only plugin or Repair-generation failure is a diagnostic and does not
change `completed`. Cloud publication failure does not alter a completed local
verify result unless publication is the primary command.

The protocol package maps the finalized pair to exit codes:

```text
internal/incompatible -> 6
cancelled             -> 5
invalid               -> 3
blocked               -> 4
completed/violated    -> 1
completed/indeterminate or not_evaluated -> 2
completed/satisfied   -> 0
```

The explicit frozen mixed-condition precedence remains `6, 5, 3, 4, 1, 2, 0`.
Human, JSON, JSONL, GitHub, MCP, editor, HTTP, and cloud projections consume
this envelope and do not aggregate again.

### 16.3 JSONL lifecycle stream

The JSONL stream emits independently versioned event envelopes in invocation
sequence, then exactly one final result event. Progress events are projections
of persisted or append-safe domain events. Machine stdout contains only JSONL
protocol bytes; all diagnostics intended as logs use bounded stderr.

A slow event consumer receives bounded buffering and backpressure. If the
adapter disconnects, its cancellation policy is propagated explicitly; the
Engine does not infer cancellation solely from a failed log write.

## 17. Canonical Engine coordinator

```ts
interface VerifyCommand {
  readonly schemaVersion: 1;
  readonly command: "verify";
  readonly invocationId: OpaqueId;
  readonly workspace: WorkspaceBinding;
  readonly arguments: CanonicalValue;
  readonly configurationReferences: readonly OpaqueId[];
  readonly policyReferences: readonly OpaqueId[];
  readonly consentGrantReferences: readonly OpaqueId[];
  readonly offline: boolean;
  readonly deadlineMs: DurationMs;
  readonly outputMode: "human" | "json" | "jsonl";
  readonly environment: {
    readonly platform: string;
    readonly allowlistedBindings: readonly OpaqueId[];
  };
}

interface VerificationEngine {
  verify(
    command: VerifyCommand,
    cancellation: CancellationPort,
    events: EventSink
  ): Promise<CommandEnvelope<VerifyResult>>;
}

interface CancellationPort {
  readonly cancelled: boolean;
  readonly reason?: string;
  onCancelled(listener: () => void): () => void;
}

interface EventSink {
  emit(event: DomainEvent): Promise<void>;
}
```

The coordinator follows the frozen twelve stages exactly:

```text
preflight -> discovery plan -> discover -> resolve -> seal -> plan
          -> authorize -> execute -> capture -> evaluate -> repair -> report
```

It may pipeline independent work within a stage but may not bypass a durable
boundary or infer that an omitted stage succeeded. Each stage has one input
schema, output schema, budget, cancellation point, and event family. Stage
handlers are idempotent for the same invocation and sealed input digest.

The `offline` flag is enforced in preflight by selecting a network-denied
execution profile and prohibiting cloud, update, registry, and provider-network
operations. Remote-only required work yields a typed `network_required`
condition while local results remain available.

## 18. Testing and acceptance Evidence

All acceptance tests retain machine-readable outputs, fixture identity, Engine
artifact digest, environment, and exact schema versions. Golden fixtures are
committed. A flaky test is failed Evidence and cannot be accepted by rerunning
until green.

### 18.1 Model and discovery

| ID | Acceptance condition |
|---|---|
| `CE-MODEL-001` | Recomputing every domain revision from its preimage matches the stored revision; changing any sealed field changes it |
| `CE-MODEL-002` | `createdAt`, invocation ID, and storage location do not change a semantic revision |
| `CE-MODEL-003` | Sealed graphs reject mutable aliases, missing exact references, orphan Evidence/Repair, cross-scope references, and invalid cycles |
| `CE-MODEL-004` | Supersession is atomic, leaves one current sealed revision per scope, and preserves traversal of the prior revision |
| `CE-DISC-001` | Empty repository, unknown ecosystem, single app, and monorepo fixtures produce stable useful outputs without network or execution |
| `CE-DISC-002` | Discovery never imports config, invokes a shell, runs scripts/hooks/install/build/test, writes, or reads outside the workspace |
| `CE-DISC-003` | Huge tree, deep tree, large file, archive, generated directory, malformed file, special file, and symlink/junction escape fixtures stop at declared bounds with diagnostics |
| `CE-DISC-004` | Configured and discovered facts remain separately attributable; precedence selects the documented effective fact without erasing candidates |
| `CE-DISC-005` | Low-confidence discovery cannot activate a required Promise without an Engine rule or explicit policy |
| `CE-NEUTRAL-001` | Static boundaries find no provider SDK import, provider-name branch, credential lookup, or provider-specific schema meaning in Core |

### 18.2 Proof, Evidence, and aggregation

| ID | Acceptance condition |
|---|---|
| `CE-PROOF-001` | Property tests cover every valid and invalid Proof execution transition |
| `CE-PROOF-002` | Passed or failed execution persistence is rejected without complete validated Evidence |
| `CE-PROOF-003` | Missing credentials, missing Evidence, network unavailability, unsupported environment, permission denial, timeout, malformed plugin output, and cancellation never become `failed` |
| `CE-PROOF-004` | Each required Proof slot has exactly one effective attempt; retries remain linked and queryable |
| `CE-AGG-001` | Table-driven Promise aggregation covers all combinations of pass, fail, indeterminate, error, cancellation, coverage gaps, and non-applicability |
| `CE-AGG-002` | Table-driven invocation aggregation covers satisfied, violated, indeterminate, and not-evaluated outcomes plus advisory-only failures |
| `CE-AGG-003` | Proofs aggregated for one Promise always reference the same model revision and execution context |
| `CE-EVID-001` | Evidence lifecycle property tests reject mutation and invalid transition; corrections create superseding revisions |
| `CE-EVID-002` | Provenance traverses model-to-Repair and Repair-to-model with exact revisions in both directions |
| `CE-EVID-003` | Observational Evidence requires target, time, sanitized request, response provenance, and validity metadata where declared |
| `CE-REPAIR-001` | Every Repair cites its motivating execution and Evidence and includes a verifying Proof plan |
| `CE-REPAIR-002` | Only a later matching passing Proof execution can append `verified`; earlier failures remain unchanged |
| `CE-REPAIR-003` | Model-generated Repair is schema-validated advisory data and cannot create Evidence or alter a verdict |

### 18.3 Scheduling, cancellation, retry, and cache

| ID | Acceptance condition |
|---|---|
| `CE-SCHED-001` | DAG cycles and missing dependencies are rejected before authorization |
| `CE-SCHED-002` | Shared prerequisites execute once per invocation under concurrent fan-out |
| `CE-SCHED-003` | CPU, global, per-plugin, network, queue, output, process, time, memory, scratch, and file bounds are enforced |
| `CE-SCHED-004` | Randomized legal schedules yield canonical-equivalent results and stable final ordering |
| `CE-CANCEL-001` | User cancellation and invocation deadline stop admission, begin process-tree cancellation within one second, and cannot publish success or cache |
| `CE-CANCEL-002` | Cancellation propagates through Engine, plugin, process, and adapter fixtures without orphaning a terminal running state |
| `CE-RETRY-001` | Only retry-safe `error` attempts with permitted codes retry; pass, fail, indeterminate, cancelled, schema, integrity, and permission conditions do not |
| `CE-RETRY-002` | Every retry has a new attempt ID, exact causal link, recorded reason, bounded deterministic backoff, and correct effective-attempt selection |
| `CE-CACHE-001` | Mutation of every result-affecting key dimension misses; irrelevant mutation does not |
| `CE-CACHE-002` | Raw secret canaries never occur in keys; unavailable safe credential identity makes the entry ineligible |
| `CE-CACHE-003` | Corrupt, partial, expired, incompatible, or unreferenced entries safely miss and do not fail the Engine |
| `CE-CACHE-004` | Concurrent same-key publication produces one complete winner, no merged state, and valid loser reuse or discard |
| `CE-CACHE-005` | Every hit links the originating execution, exact Evidence revisions, validation events, eligibility, and reason |

### 18.4 Determinism, events, errors, and result

| ID | Acceptance condition |
|---|---|
| `CE-DET-001` | Repeated hermetic fixtures with identical sealed inputs are semantically identical across adapters, schedules, and cache hit/miss |
| `CE-DET-002` | Evaluator static/runtime controls prevent clock, random, network, filesystem, environment, locale, and timezone access |
| `CE-DET-003` | RFC 8785 golden vectors, Unicode, numeric bounds, and collection-order fixtures agree on every supported runtime |
| `CE-EVENT-001` | Event sequences are monotonic, append-only, past-tense, redacted, schema-valid, and reconstruct every state machine |
| `CE-EVENT-002` | Crash injection at each durable stage boundary never exposes an uncommitted pass or partial cache hit |
| `CE-ERROR-001` | Every stable error code has fixed category/retryability fixtures; unknown codes/categories follow compatibility rules |
| `CE-RESULT-001` | Every operational-status/outcome combination and frozen mixed-condition exit-code precedence has table-driven coverage |
| `CE-RESULT-002` | Human, JSON, JSONL, MCP, GitHub, editor, HTTP, and cloud-adapter fixtures consume one canonical result without independent aggregation |
| `CE-RESULT-003` | Machine stdout remains valid protocol bytes while progress, plugin diagnostics, cache messages, and warnings are active |
| `CE-SECRET-001` | Canary secrets never appear in model objects, revisions, stdout, stderr, events, Evidence metadata, cache, errors, manifests, or result payloads |

### 18.5 Performance acceptance

Reference hardware and the public fixture corpus must be fixed before beta.
Measured acceptance is:

| ID | Budget |
|---|---|
| `CE-PERF-001` | Warm passive discovery of a 100,000-file repository completes within five seconds at p95 |
| `CE-PERF-002` | Engine overhead excluding plugin/tool work remains below one second at p95 |
| `CE-PERF-003` | Idle local execution produces zero DNS, socket, update, registry, analytics, or cloud activity |
| `CE-PERF-004` | Memory, disk, file, process, output, and concurrency limits remain within configured bounds under adversarial fixtures |
| `CE-PERF-005` | Cancellation begins process-tree termination within one second at p95 and at the worst supported policy threshold |

Performance runs report cold/warm state, repository shape, file count and bytes,
OS, filesystem, CPU, memory, runtime, Engine artifact, plugin set, sample count,
median, p95, maximum, and failures. An optimization is unacceptable if any
determinism, isolation, Evidence, redaction, or provenance acceptance regresses.

## 19. Rollout sequence

Core Engine implementation proceeds in dependency order:

1. canonical JSON, revision documents, schemas, exact references, and golden
   vectors in `contracts`;
2. event and StructuredError registries plus in-memory conformance stores;
3. passive discovery planner/readers, fact resolution, and model sealing;
4. Proof definition, Evidence capture/validation, pure evaluators, and
   aggregation;
5. sealed execution plans, manifest, authorization ports, and deterministic DAG
   scheduler using a fake process runner;
6. production process-runner and plugin-runtime integration after applicable
   sandbox decisions;
7. crash-safe local authoritative store and cache after local-store selections;
8. Repair generation and lifecycle;
9. canonical dispatcher/result/event integration and adapter conformance;
10. schedule randomization, fault injection, security, compatibility, resource,
    and performance gates.

Each step must satisfy its acceptance IDs before downstream packages treat the
contract as stable.

## 20. ADR and change assessment

### 20.1 Existing ADR-required selections

This design depends on, but does not resolve, the following pre-beta ADR work
already required by Architecture Freeze §20.1:

1. OS-specific sandbox implementations and enforcement tiers;
2. filesystem snapshot strategy for large mutable worktrees;
3. plugin signing, provenance, revocation, and local-development trust;
4. network allowlist enforcement and DNS/proxy protections;
5. local store/cache locations, retention, purge, and optional encryption;
6. Evidence attestation only if independent exchange is introduced.

The implementation can use test doubles and ports until each selection is
accepted. No fallback may claim an unenforced control.

### 20.2 EDD-level implementation choices

The following choices do not alter frozen semantics and may be resolved in
package-level design records rather than architecture-amending ADRs:

- concrete schema validation and RFC 8785 libraries;
- in-process immutable data structures;
- local database and cache storage engine, subject to the required local-store
  ADR;
- DAG queue and semaphore implementation;
- stable topological-sort implementation;
- process-runner abstraction details beneath the selected enforcement tier;
- property-testing and fault-injection libraries.

### 20.3 Formal change proposals

No Architecture Freeze change is required by this Core Engine design.

If implementation demonstrates that one is necessary, work stops at the
boundary and submits an ADR naming the affected frozen clauses, schema and
compatibility effects, migration, rollback, security/privacy impact, and new
conformance Evidence. A provider-specific request is insufficient; a
provider-neutral missing abstraction must have at least two independent
implementations.

## 21. Completion criteria

The Core Engine section is implementation-ready when:

- every proposal type has an owned machine-readable schema and golden fixtures;
- state transition and aggregation tables are executable as conformance tests;
- package dependency rules are statically enforceable;
- all lifecycle stages have declared inputs, outputs, budgets, cancellation,
  errors, events, and durable boundaries;
- all acceptance IDs map to a test, static rule, or named manual control;
- existing ADR dependencies are linked to their implementation gates;
- no adapter, plugin, provider, cache, Repair generator, or LLM can create an
  independent verification verdict;
- no requirement contradicts or weakens the Architecture Freeze.
