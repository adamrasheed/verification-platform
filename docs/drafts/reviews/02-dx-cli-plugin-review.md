# DX, CLI, and Plugin Cross-Review

**Status:** Cross-domain review
**Reviewer:** Product and Developer Experience
**Reviewed:** `01-product-developer-experience.md`,
`03-plugin-platform.md`, Architecture Freeze, and Shared Contracts
**Focus:** CLI behavior, setup, errors, provider onboarding, permission consent,
MVP coherence, and user safety

## Summary

The plugin draft respects the frozen engine/plugin authority boundary and
correctly separates installation from runtime permission. Its process,
credential, Evidence-candidate, and provider-neutrality posture is compatible
with the product draft.

There are no Blocking findings. Six Major findings require reconciliation before
the canonical EDD is complete. They concern milestone ambiguity, dead-end
first-release guidance, the difference between provider-author and end-user
onboarding, effective permission disclosure, permission-denial remediation, and
the initial GitHub scope. Minor and Deferred findings do not prevent EDD
reconciliation if they are recorded with owners and triggers.

## Blocking

None.

## Major

### DX-PLG-001 — “Phase 1” and “MVP” describe different release boundaries

**Evidence:** Plugin §§3, 6, 11, and 14 use “Phase 1” for plugin installation,
fresh processes, runtime limits, and Repair contributions. Plugin §14 says the
MVP avoids a large catalog. Product §§12–13 explicitly exclude every plugin from
the first public npm release and place the plugin runtime, synthetic providers,
and GitHub plugin in later milestones.

**Impact:** The canonical EDD could make plugin signing, sandboxing, credential
brokerage, and synthetic-provider conformance prerequisites for the first useful
local CLI, defeating the aggressive MVP cut.

**Required resolution:** Reserve “first public npm release” for the plugin-free
local CLI. Replace plugin-draft “Phase 1” with “initial plugin-platform
milestone” wherever it means the first plugin implementation. State one ordered
sequence in the EDD:

1. passive local CLI;
2. plugin runtime plus three synthetic providers;
3. read-only GitHub provider;
4. MCP and GitHub projections.

Plugin contract schemas may be designed earlier, but executable plugin support
is not an acceptance gate for step 1.

### DX-PLG-002 — First-release guidance recommends a facility that does not exist

**Evidence:** Product §5.3 tells an unknown-ecosystem user to “install a
compatible pinned plugin,” while Product §§6.2 and 12.3 state that plugin
commands, the runtime, provider plugins, and third-party installation are absent
from the first release. Product §14.1 also includes malformed plugin output in
the zero-configuration first-release gate.

**Impact:** The CLI gives a dead-end remediation, and the release gate silently
pulls plugin-runtime scope back into MVP.

**Required resolution:** In first-release copy, direct unknown-ecosystem users
to inspect discovered facts and the published supported-ecosystem list. Show
plugin installation as a next action only after the plugin command family is
available. Move malformed-plugin-output acceptance from Product §14.1 into the
post-MVP plugin conformance gate; keep all plugin-specific gates out of the
first npm release.

### DX-PLG-003 — “Provider onboarding” covers authors, not users connecting a provider

**Evidence:** Plugin §15 is an SDK author publication checklist. Product §11 is
the end-user sequence of select, install, inspect, authorize, credential bind,
and execute. The plugin draft has no equivalent user flow for inspection,
revocation, removal, or a failed partial onboarding.

**Impact:** A technically conformant plugin could ship without a safe,
comprehensible connection experience, and the EDD could conflate publisher
trust with user authorization.

**Required resolution:** Keep Plugin §15 as **provider developer onboarding**.
Add a separate **user plugin onboarding** flow in the canonical EDD by adopting
Product §11. It must:

- distinguish artifact integrity/publisher status from runtime authorization;
- expose inspect before authorize;
- keep credential binding separate from product-cloud login;
- support authorization denial, revocation, and plugin removal;
- report incomplete onboarding without treating it as a violated Promise;
- avoid exposing commands until their result schemas and conformance fixtures
  exist.

No single “connect” action may collapse installation, trust, permissions,
credentials, and execution.

### DX-PLG-004 — Consent must show the effective sealed grant, not only manifest maxima

**Evidence:** Plugin §5 correctly says manifest permissions are requested
maximum authority and Plugin §3 computes actual authority by intersection.
Product §4.2 requires a bounded execution-plan preview. Plugin §15 does not
require the end-user UI to distinguish requested, granted, denied, and enforced
authority before execution.

**Impact:** A user could approve a generic provider label without knowing the
actual source roots, destination hosts, secret scope, disclosure class, side
effects, duration, or degraded enforcement tier.

**Required resolution:** Reconcile the two drafts into a two-stage disclosure:

1. installation inspection shows the static manifest maximum and publisher
   status;
2. execution consent shows the exact sealed plan and effective grant after
   policy intersection.

The second view must name readable/writable roots, provider destinations,
outbound data classes and maximum bytes, secret binding identifier/audience/
scopes, side effects, grant duration, and effective isolation tier. It must show
denied differences from the manifest request. JSON/JSONL and non-interactive
execution never prompt; they require an external consent/policy reference and
return a structured blocked result when it is absent. Repository configuration
may request but never grant this authority.

### DX-PLG-005 — Permission denial has the wrong remediation classification

**Evidence:** Plugin §16 marks `VFY_PLUGIN_PERMISSION_DENIED` as retryability
`never` for every missing authorization. Shared Contracts permits
`policy_required`, and Product §7 requires retry guidance that distinguishes
hard denial from authority that a user or policy could separately grant.

**Impact:** The CLI may tell a user that an intentionally denied operation can
never be retried, or encourage an unsafe blind retry without recording new
authority.

**Required resolution:** Use `policy_required` when another attempt could proceed
only after a new external user or CI grant. Use `never` for a non-overridable
engine safety or organization-policy denial. If the canonical error registry
uses one top-level code, carry the distinction in its stable reason and
retryability fields. Human remediation must say what authority is missing and
must never imply that a normal retry changes it.

### DX-PLG-006 — The real GitHub pilot is broader than the agreed safe first scope

**Evidence:** Product §11.2 limits the first GitHub plugin to read-only repository
policy configuration. Plugin §14.1 adds `source.change-review` and review-state
observations, which introduces per-pull-request data, additional authorization
and privacy surface, and possible confusion with the separate GitHub check
adapter.

**Impact:** The first provider becomes larger, more privacy-sensitive, and less
clearly separated from the GitHub projection, delaying the plugin milestone.

**Required resolution:** Limit the first GitHub provider to observational,
read-only repository-policy configuration: default branch, required status
checks, review requirements, and branch-protection/ruleset settings. Defer
pull-request review-state capture. Keep the provider credential/principal
separate from the GitHub Action/App adapter principal, as Plugin §14.1 already
requires. Evaluate provider-native details only inside the plugin and describe
network/auth/rate-limit failures as operational reasons.

## Minor

### DX-PLG-007 — Plugin updates need a user-visible permission delta

**Evidence:** Artifacts and grants are exact and digest-bound, but the plugin
draft does not state the update UX. Product §11 says changed manifests require a
new review.

**Resolution:** Before an updated digest becomes selectable, show publisher,
compatibility, operation, permission, Evidence type, side-effect, and
classification differences. Do not transfer a user grant silently to the new
artifact. A signed organization policy may authorize it only when that exact
policy scope covers the new artifact.

### DX-PLG-008 — “Enabled/disabled” is underspecified and overlaps authorization

**Evidence:** Plugin §3 adds mutable local enabled/disabled state without
defining whether enabled means selectable, executable, or authorized.

**Resolution:** In user-facing language, use enabled only for deterministic
selection eligibility. Explicitly state that it grants no execution, network,
secret, write, or disclosure authority. If the state has no independent user
need, omit it from the initial product surface.

### DX-PLG-009 — Plugin diagnostics need the common human error shape

**Evidence:** Plugin §16 lists generic codes but does not require the Product §7
fields in rendered remediation.

**Resolution:** For every plugin error fixture, verify the rendered view includes
the stable code, sanitized cause, affected operation/Proof, retryability, bounded
next action, invocation ID, and diagnostic reference. Continue to keep
provider-native codes in sanitized namespaced detail only.

## Deferred

### DX-PLG-010 — Unverified local-development trust tier

**Evidence:** Plugin §3 permits clearly marked, digest-pinned unverified
development plugins. The freeze requires a pre-beta ADR for signing authority,
provenance, revocation, and the local-development trust tier.

**Resolution and trigger:** Do not expose unverified-plugin onboarding in the
first public CLI. Resolve the required signing/trust ADR before third-party or
development plugin execution is user-facing. The flow must require authority
outside workspace content and must not present a digest as publisher trust.

### DX-PLG-011 — Generic HTTPS observation plugin

**Evidence:** Plugin §14.1 recommends a generic HTTPS plugin as the second real
pilot, while the product draft aggressively selects only GitHub and excludes
monitoring/uptime positioning.

**Resolution and trigger:** Remove it from committed MVP/post-MVP sequencing.
Keep it as research until a concrete Promise, owner, Evidence schema, consumer
need, bounded destination/disclosure model, and non-monitoring positioning are
documented. Its genericity alone is not a product use case.

## Reconciliation acceptance

This review is resolved when the canonical EDD and roadmap:

- identify the plugin-free first npm release and plugin milestones
  unambiguously;
- contain no first-release plugin command, remediation, or test dependency;
- separately specify provider-developer and end-user onboarding;
- require manifest inspection and exact effective-plan consent;
- distinguish remediable missing consent from hard policy denial;
- restrict the first GitHub plugin to read-only repository-policy Evidence;
- preserve the frozen exit-code, Evidence, Authentication, Cloud Boundary, and
  provider-neutrality rules without defining a new domain concept.
