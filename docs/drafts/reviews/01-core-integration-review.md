# Core Engine Review of MCP, GitHub, and Agent Integrations

**Review target:** `docs/drafts/04-integrations.md`
**Review basis:** Architecture Freeze §§4, 5, 10–13, 16–18; Shared Contracts; `docs/drafts/02-core-engine.md`
**Disposition:** Reconcile two blocking remote-contract issues before EDD merge

## Summary

The draft correctly keeps adapters outside discovery, evaluation, aggregation,
retry selection, Repair state, and authorization policy. Local CLI, local MCP,
and in-runner GitHub Action paths align with the canonical dispatcher. Deadline
and cancellation handling is substantially consistent with Core Engine.

The remote MCP/REST/workload path is not yet contract-consistent. Under the
frozen default Cloud Boundary, a workload may retain a full canonical verify
result locally, but cloud and remote adapters receive only an allowlisted
metadata projection. That projection is not the canonical `VerifyResult` and
cannot be advertised as the same tool result or as full CLI parity.

## Blocking findings

### B-01 — Remote `verification.verify` promises two incompatible result shapes

**Locations:** §§1, 3.2, 4.1–4.4, 5.1–5.4, 8.3

The draft says every machine response contains the canonical envelope, that an
MCP tool with the same name has the same command/result semantics in local and
remote profiles, and that `verification.verify` returns the exact command
envelope. The remote topology simultaneously says only an allowlisted metadata
projection crosses the Cloud Boundary.

A protocol-v1 `VerifyResult` contains the raw Application Model revision and
exact local Promise, Proof, Evidence, Repair, attempt, manifest, and diagnostic
references. Architecture Freeze §11.3 prohibits raw local semantic revisions,
commands, arguments, local paths, and sensitive bodies from default
publication. A tenant-scoped publication identifier is intentionally not an
exact local `RevisionRef`. Therefore the remote projection cannot validate as,
or substitute for, the canonical local `VerifyResult`.

**Required resolution:**

1. Keep `verification.verify` as an exact canonical-envelope tool only where
   the caller is locally authorized to receive that envelope.
2. Give remote dispatch a distinct canonical command/result kind, for example
   `dispatch_verification -> DispatchReceipt`, containing only invocation
   correlation, workload dispatch state, and a retrievable published-resource
   reference.
3. Expose a separate `get_published_run` resource/result with a versioned
   allowlisted `PublishedVerificationProjection` schema.
4. State explicitly that the workload's local `verify` invocation remains the
   semantic authority; receipt and publication schemas never recompute or
   masquerade as its outcome.
5. Remove the claim that local and remote MCP profiles return the same result
   shape. They may preserve the same domain meaning only to the extent present
   in the published projection.

This split preserves the shared dispatcher rule: dispatch and retrieval are
stable canonical commands with distinct `result.kind` values, not
adapter-private semantics.

### B-02 — Remote parity and no-workload behavior lack a canonical command owner

**Locations:** §§4.1–4.4, 5.1, 7.3, 8.1–8.3

For an unavailable workload, the draft alternates among a “typed
blocked/not-available response,” a GitHub `action_required` projection, an MCP
transport result, and an asynchronous receipt. It does not identify which
canonical command schema owns that state. An adapter-created blocked verify
envelope would invent Engine semantics because no verify dispatcher ran; a
transport-only error would lose the stable machine contract.

Likewise, §8.3 includes remote adapters in parity expectations even though it
later acknowledges that published-metadata operation cannot provide
source-dependent parity.

**Required resolution:**

- Define workload routing outcomes on the distinct dispatch result:
  `accepted`, `unavailable`, `unauthorized`, `expired`, `cancelled`, and
  `transport_error`, with unknown values failing incompatible.
- Do not use verify `operationalStatus` for a dispatch that never reached the
  workload Engine.
- Once the workload accepts the canonical verify request, retain its exact
  local terminal envelope and link it from the dispatch record without copying
  forbidden fields.
- Scope canonical-equivalence tests to interfaces that receive the same sealed
  inputs and the same response class. Test a remote published projection
  against the publication projection derived from the CLI result, not against
  the full CLI JSON document.

## Major findings

### M-01 — Published identifiers are conflated with exact revisions

**Locations:** §§1, 3.2, 5.2–5.3, 7.4, 8.1, 11.1–11.4

The draft requires projections to preserve exact object/revision references,
uses exact revision resource URIs for remote MCP, and asks GitHub checks to show
“exact invocation/model identity.” Default publication instead permits locally
keyed, tenant-scoped publication identifiers. Those identifiers must not be
decoded or typed as domain revisions.

**Recommendation:** Define separate types:

```ts
interface PublishedObjectRef {
  objectType: "applicationModel" | "promise" | "proof" | "evidence";
  publicationId: string;
  tenantBinding: string;
}
```

Use `RevisionRef` only inside the authorized local history. Projection
construction maps exact local references to `PublishedObjectRef` at the Cloud
Boundary and records that mapping locally. Remote provenance traversal is over
published references and may be incomplete by policy; it must never imply full
local graph traversal.

### M-02 — Cancellation needs separate dispatch and Engine acknowledgements

**Locations:** §§3.4, 4.2–4.4, 5.4, 8.1, 11.4

Local cancellation correctly signals the Engine handle and waits for its
canonical cancelled envelope. For remote dispatch, an adapter can know that a
cancellation request was accepted by the gateway without knowing that the
workload Engine accepted it or completed process-tree termination. The current
text risks collapsing these states.

**Recommendation:** Give dispatch cancellation an idempotent command and event
sequence:

```text
CancellationRequested
  -> CancellationForwarded
  -> WorkloadCancellationAccepted
  -> WorkloadInvocationCancelled
```

Missing or offline workload acknowledgement remains a dispatch operational
condition. Only `WorkloadInvocationCancelled` linked to the retained Engine
envelope permits a projection to say the verify invocation is cancelled. A
late cancellation returns the already-terminal workload state.

### M-03 — GitHub projection text exceeds the stated default allowlist

**Locations:** §§7.2, 7.4, 9.2, 11.3

The mapping table proposes “violated required Promises,” bounded annotations,
and optional source locations. Promise display text and source locations may
contain `LOCAL_SOURCE` or `SENSITIVE_EVIDENCE`; filenames are explicitly
forbidden by the default upload allowlist. GitHub is separate third-party
egress and does not gain authority from an Action token or App installation.

**Recommendation:** Specify the Phase 1 check payload field-by-field: typed
status, stable reason code, counts, duration, classifications, opaque
publication IDs, and a non-sensitive application alias only. Exclude Promise
labels, file locations, annotations containing repository text, commands, logs,
and raw revisions. Keep location-bearing annotations behind the future
feature-specific explicit-share ADR and disclosure preview.

### M-04 — Presentation filtering can hide canonical coverage

**Location:** §3.2

The draft permits a presentation to omit detail if it preserves the full result
“by reference.” For a remote caller, that reference may not be authorized or
may point only to the same reduced projection. The condition “never hides a
required non-satisfied Promise” also requires a precise deterministic
projection rule, not adapter judgment.

**Recommendation:** Put each bounded presentation projection in `protocol` as a
versioned schema and pure projector owned with the canonical result contracts.
Its overflow rule must retain status counts and stable published identifiers
for every non-satisfied required Promise that the publication policy permits.
When policy suppresses identity, emit a suppressed count and reason rather than
claiming a complete Promise list.

### M-05 — Retrieval errors must not be shaped as Engine verify results

**Locations:** §§5.2, 5.4, 8.1–8.2

`verification.get_run` returns a canonical envelope “or typed retrieval error,”
but it is unclear whether that error uses verify `operationalStatus`.
Authentication, routing, not-found concealment, and publication-authorization
failures can occur before any Engine command envelope is available.

**Recommendation:** Define `get_run`/`get_published_run` as canonical commands
with their own `result.kind` and StructuredError handling. A valid retrieval
command envelope may be `invalid` or `blocked`; an HTTP/MCP transport error is
reserved for failure to obtain any valid retrieval envelope. Never synthesize
or mutate the retained verify envelope to report retrieval failure.

## Minor findings

### m-01 — Duplicate data-minimization sentence

**Location:** §9.2

“Adapters receive the least-sensitive representation needed for their
function” appears twice.

**Recommendation:** Remove the duplicate during reconciliation.

### m-02 — GitHub `internal_error` mapping should name the frozen alternative

**Location:** §7.4

Mapping `internal_error` to `action_required` is a reasonable concrete choice,
but the freeze describes blocked/internal mappings as
“action-required/error.” Without a rationale, readers may assume the choice is
new domain meaning.

**Recommendation:** State that `action_required` is the selected GitHub
transport projection for Phase 1 and remains non-semantic. If GitHub introduces
a more appropriate supported conclusion, changing the transport mapping does
not change the retained canonical envelope but requires compatibility fixtures.

## Deferred findings

### D-01 — Asynchronous dispatch protocol

The exact receipt resource, polling protocol, lease duration, and gateway
delivery mechanism can remain deferred until remote workload implementation.
Before that feature ships, it needs stable schemas, idempotency, replay,
authorization, cancellation, retention, and compatibility tests. This is not
an Architecture Freeze change if it obeys the split recommended in B-01.

### D-02 — Location-bearing GitHub annotations

Source locations and Promise prose are deferred behind a feature-specific
explicit-share decision, disclosure preview, and third-party egress policy.
They are not part of the Phase 1 allowlisted projection.

## Reconciliation checklist

- [ ] Split local canonical verify, remote dispatch receipt, and published run
      projection into distinct `result.kind` schemas.
- [ ] Type published identifiers separately from exact local `RevisionRef`.
- [ ] Assign no-workload and routing outcomes to the dispatch contract, not the
      verify outcome.
- [ ] Add gateway/workload cancellation acknowledgement states.
- [ ] Make remote parity compare deterministic projections, not full local
      envelopes.
- [ ] Freeze the Phase 1 GitHub check projection allowlist.
- [ ] Move all bounded presentation filtering to protocol-owned projectors.
- [ ] Give retained-run retrieval its own canonical command/result contract.
- [ ] Add golden fixtures for partial blocked local results, null-result
      envelopes, dispatch failures, projection suppression, cancellation races,
      and unknown control-flow values.

## Final assessment

No adapter in the draft intentionally calculates a Proof or Promise verdict,
and the local adapter designs respect the Engine boundary. After B-01 and B-02
are reconciled, the remaining findings are contract clarification rather than a
change to frozen domain semantics. No Architecture Freeze amendment is required
for the recommended split.
