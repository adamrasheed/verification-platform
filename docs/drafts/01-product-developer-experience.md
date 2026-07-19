# Product and Developer Experience

**Status:** Domain draft for EDD reconciliation
**Owner:** Product and Developer Experience
**Governing references:** [Architecture Freeze](../architecture/ARCHITECTURE_FREEZE.md),
[Glossary](../architecture/GLOSSARY.md), and
[Shared Contracts](../architecture/SHARED_CONTRACTS.md)
**Scope:** Product behavior and user-facing interface decisions; this draft does
not define engine, plugin, cloud, MCP, or GitHub implementation architecture

## 1. Product context

The product is verification infrastructure for software development. Its first
job is not to prove every possible application claim. Its first job is to make a
small set of useful claims mechanically inspectable, with the result traceable
from a Promise through a Proof execution to validated Evidence.

The primary user is a developer or coding agent asking one immediate question:

> What promises can this repository substantiate now, what evidence supports
> that answer, and what is the smallest verifiable next action?

The CLI is the canonical public interface. GitHub, MCP, editors, and future cloud
views are projections of the same structured command result. They do not produce
independent verdicts.

The product earns adoption in this order:

1. **Trust:** a default run neither executes repository code nor sends source,
   secrets, analytics, or metadata over the network.
2. **Usefulness:** the run finds applications and evaluates at least one narrow,
   understandable Promise in a supported repository.
3. **Explainability:** every result distinguishes a verified violation from an
   operational inability to decide.
4. **Automation:** structured output is stable enough for coding agents and
   other tools to consume without parsing prose.
5. **Extension:** users can add provider plugins without changing the meaning of
   the core result.

## 2. Goals

The product experience MUST:

- make an installed or package-manager-cached `npx verify` useful with no
  account, login, configuration file, engine network request, or repository
  execution;
- lead with the verification outcome and the most consequential Promise, then
  offer the Evidence and execution detail that explains it;
- preserve the distinction among `satisfied`, `violated`, `indeterminate`, and
  `not_evaluated`, and separately display operational status;
- use the same names and exact object references in human output, JSON, JSONL,
  MCP responses, GitHub checks, and retained-run views;
- explain discovery signals, conflicts, skipped inputs, permission decisions,
  cache behavior, and resource limits in actionable language;
- work predictably in interactive terminals, non-interactive shells, CI, and
  agent tool calls;
- allow a developer to inspect the exact data and permissions involved before
  provider access or cloud publication;
- make Repair visibly advisory and require a later Proof execution before
  describing it as verified;
- enable provider onboarding without exposing provider-specific semantics in
  the engine-facing user model.

## 3. Non-goals

The first product experience will not:

- replace a test runner, CI scheduler, deployment system, observability system,
  package manager, or code editor;
- advertise a universal application correctness score;
- ask an LLM to determine whether a Proof passed or failed;
- execute builds, tests, lifecycle hooks, executable configuration, or
  repository scripts during zero-configuration discovery;
- require the cloud for local discovery, local Proofs, retained local runs,
  Evidence inspection, cache use, or structured output;
- silently install, update, authorize, or execute a plugin;
- silently convert an unavailable credential, denied permission, timeout,
  unsupported environment, or network outage into a violated Promise;
- automatically apply Repair;
- make GitHub or MCP a second semantic interface;
- ship a plugin marketplace, enterprise policy administration, hosted execution
  fleet, billing system, or organization dashboard in the first release.

## 4. Product principles

### 4.1 Answer first, provenance one step away

Human output starts with operational status and verification outcome. It then
shows required Promises in severity order, followed by the smallest useful
explanation. Each Promise line exposes a stable display reference that can be
used to inspect its Proof execution and Evidence.

The UI MUST NOT hide an `indeterminate` result in a warning footer or render it
as a failure. A run that could not execute is not shown as evidence that the
application broke its promise.

### 4.2 Progressive consent

Read-only passive discovery is the default. Any operation requiring repository
execution, network, secrets, source writes, degraded isolation, or publication
first presents a bounded plan:

- the operation and plugin requesting it;
- the exact readable and writable roots;
- the network destinations or destination class;
- the secret binding identifier and scope, never the value;
- the expected side effects;
- the duration of the grant;
- whether the grant comes from the current user or signed policy.

An interactive grant applies only to the displayed plan or a clearly bounded
set of equivalent plans. Non-interactive execution never prompts and requires a
pre-existing consent or policy reference.

### 4.3 No configuration ceremony

The absence of product configuration is a valid state, not a setup error.
Discovery happens before domain configuration. If configuration would improve
coverage, the CLI explains the discovered fact, the proposed override, and the
new Proof coverage before the user creates a file.

### 4.4 Machine output is a product surface

Human rendering is a projection of the canonical result. JSON and JSONL are not
debug formats. Machine modes never include banners, spinners, progress text,
upgrade notices, or log bytes on stdout.

### 4.5 Exact language over false certainty

The product uses:

- **satisfied** when every required applicable Proof passed;
- **violated** when validated Evidence contradicts at least one required
  Promise;
- **indeterminate** when available Evidence cannot decide a required Promise;
- **not evaluated** when no required applicable Promise had effective Proof
  coverage;
- **blocked** for an operational status when a required control or execution
  could not proceed.

“Passed,” “failed,” “verified,” and “fixed” are reserved for their frozen
domain meanings. Marketing language MUST NOT weaken those meanings.

## 5. Zero-configuration journey

### 5.1 Bootstrap

The documentation distinguishes package bootstrap from engine execution:

```text
# May download a pinned package if it is not already cached:
npx verify

# Makes no engine network request once the package is installed or cached:
npx --offline verify
```

An uncached `npx` invocation is never described as offline. The eventual public
package name remains subject to founder decision F-001; `verify` is the frozen
command name and product-facing placeholder.

### 5.2 Default invocation

From a repository root, the user runs:

```text
npx verify
```

The default command:

1. binds the current repository as the workspace;
2. applies engine safety controls and resolves only installed, pinned
   components;
3. passively discovers applications and candidate Promises;
4. seals the Application Model revision;
5. runs only applicable engine-native passive Proofs;
6. captures and validates local Evidence;
7. reports the outcome, uncovered candidates, and next actions;
8. retains the run locally under the configured retention policy.

It does not create a configuration file, modify the repository, contact a
registry, check for updates, emit analytics, or prompt for login.

### 5.3 Useful outcomes

For a supported repository, the concise human view is shaped as:

```text
VERIFICATION VIOLATED
2 applications · 3 promises evaluated · 1 violated · 2 satisfied

VIOLATED  dependency declarations resolve within the workspace
Evidence: duplicate package name "api" in two workspace manifests
Next: inspect promise prm_... or request an advisory repair

Run: inv_...  Model: sha256:...  Network: denied  Source writes: denied
```

For an unknown ecosystem or repository without executable Proof coverage:

```text
VERIFICATION NOT EVALUATED
Repository structure was discovered, but no required applicable Promise had an
engine-native Proof.

Inspected: 418 files within repository boundaries
Skipped: generated and ignored paths
Next: inspect discovered capabilities or install a compatible pinned plugin
```

The second result is still useful: it returns the sealed discovered model,
candidate Promises, diagnostics, skipped-input reasons, and exact next steps.

### 5.4 Monorepos and subdirectories

The default workspace is the repository boundary containing the current
directory. Nested applications remain distinct. A path argument narrows
presentation and requested application scope but MUST NOT silently change the
bound workspace root or grant access to a sibling repository.

If discovery finds ambiguous roots or conflicting workspace declarations, the
run explains the candidates and produces `indeterminate` or `not_evaluated` as
the applicable contracts require. It does not guess.

## 6. CLI command and option surface

### 6.1 First-release stable surface

The first release ships the smallest stable command surface that satisfies the
frozen operational requirements:

| Command | User purpose |
|---|---|
| `verify [workspace]` | Discover, plan, execute applicable passive Proofs, and report |
| `verify run show <invocation-id>` | Inspect a retained canonical result and its provenance |
| `verify cache inspect` | Show local cache entries, eligibility, origin, and retention information |
| `verify cache clear` | Explicitly remove eligible local cache entries and report what changed |

`verify` accepts:

- `--json` for one final protocol-v1 result document on stdout;
- `--jsonl` for versioned lifecycle events followed by one final result event;
- `--offline` to reject network-required work without hidden retries;
- `--no-cache` to bypass reads and writes for this invocation;
- `--deadline <duration>` to set the dispatcher deadline within policy bounds;
- `--application <opaque-id>` to select one discovered application after an
  initial model exists;
- `--explain <object-reference>` to expand one Promise, Proof execution,
  Evidence, diagnostic, or Repair in the current result.

`--json` and `--jsonl` are mutually exclusive. Unknown options, contradictory
options, malformed durations, and references that do not resolve within the
bound workspace produce `operationalStatus: "invalid"` and exit code `3`.

Human-friendly selectors such as display labels MAY be accepted only when they
resolve unambiguously. Structured results always use opaque IDs and exact
revisions.

### 6.2 Deferred stable surface

The following command families are reserved for later milestones and MUST NOT
be stubbed into the first release:

- `verify plugin ...` for install, inspect, authorize, revoke, and conformance;
- `verify credential ...` for provider Authentication bindings;
- `verify repair ...` for list, inspect, apply, and re-verify;
- `verify auth ...` for optional product-cloud identity;
- `verify publish ...` for explicit Cloud Boundary disclosure and publication;
- `verify policy ...` for organization policy inspection;
- `verify configure ...` for discovery-led configuration authoring.

These become stable only when their schemas, permissions, machine results, and
conformance fixtures exist. Until then, documentation describes no unavailable
command.

### 6.3 Interactive behavior

In a terminal, progress is stage-oriented and derives from canonical lifecycle
events. The renderer may update in place, but redirected output uses
line-oriented progress on stderr. Ctrl-C propagates cancellation, begins
process-tree termination within the frozen budget, and exits with code `5`
after a canonical cancelled envelope is available.

Interactive questions are allowed only for an explicit action that cannot
continue without a user grant. The default answer is deny. Prompts are
prohibited in JSON/JSONL mode and when stdin is not an interactive terminal.

Color is never the only carrier of meaning. The renderer honors conventional
no-color behavior and terminal accessibility, while machine output remains
unchanged.

### 6.4 Result ordering and verbosity

The default human result order is:

1. operational status and verification outcome;
2. required violated Promises;
3. required indeterminate Promises;
4. required satisfied Promises;
5. advisory results;
6. uncovered candidate Promises;
7. diagnostics and next actions;
8. run, model, policy, permission, and cache provenance.

The concise view suppresses repetitive Evidence detail but never suppresses a
required non-satisfied Promise. `--explain` expands exact provenance without
re-evaluation.

## 7. Error and remediation experience

Every human-facing operational error contains:

1. the stable `VFY_<DOMAIN>_<CONDITION>` code;
2. a one-sentence sanitized description of what happened;
3. the affected operation or Proof;
4. whether retry is safe, never appropriate, or requires policy;
5. one bounded remediation that does not ask the user to weaken security by
   default;
6. the invocation ID and diagnostic reference.

Examples of correct classification:

| Situation | Product treatment |
|---|---|
| Validated manifest Evidence contradicts a Promise predicate | Proof `failed`; Promise may be `violated` |
| Provider credential is absent or expired | Proof `indeterminate` or operationally blocked with an Authentication reason |
| Network is denied for an observational Proof | `network_required`; never a failed Promise |
| Plugin emits malformed output | typed plugin error; core remains healthy |
| Cache entry is corrupt | diagnosed cache miss; continue if execution is otherwise possible |
| Configuration is malformed | `invalid`; no execution |
| A required redaction or persistence control fails | fail closed; no durable successful result |
| User cancels | `cancelled`; never success |

Human copy names the consequence precisely. For example:

```text
VFY_NETWORK_REQUIRED — GitHub repository-policy evidence could not be observed
while offline. The promise is indeterminate; no application violation was
established. Retry online with an authorized GitHub plugin, or omit that
advisory proof.
```

Exit codes and their precedence are exactly those frozen in Architecture Freeze
§12.4. Documentation MUST tell shell and CI users to branch on exit code or
structured fields, never on human text.

## 8. Setup and configuration experience

### 8.1 First release

There is no setup wizard. The supported path is:

1. obtain a pinned package version through an explicit package-manager action;
2. run `npx verify` at a repository boundary;
3. inspect the result;
4. add no product file unless the user needs to activate or override domain
   semantics later.

The CLI detects unsupported runtime or platform versions before discovery and
reports the compatible range. It does not silently switch runtimes or install
dependencies.

### 8.2 Future discovery-led configuration

When configuration authoring ships, `verify configure` first performs passive
discovery and then previews:

- the facts it will preserve;
- the discovered defaults it proposes to override;
- the Promises it proposes to activate;
- the permissions it requests but cannot grant;
- the Proof coverage gained;
- the exact repository file change.

Creating the file requires explicit confirmation or a separate write command.
Repository configuration may request authority but cannot grant network,
secrets, execution, writes, degraded isolation, or publication to itself.

## 9. MCP-facing user concepts

The MCP surface presents a workspace-bound verification tool, retained-result
inspection, and provenance lookup. It uses the canonical request and returns the
canonical envelope directly.

From a user and agent perspective:

- an MCP client selects an explicit local workspace before invoking
  verification;
- the tool advertises whether the request is passive or requires a consent
  reference;
- the agent receives exact Promise, Proof, Evidence, Repair, diagnostic, and
  invocation references;
- a coding agent may explain or propose a Repair, but cannot convert advisory
  output into verified status;
- an apply operation, when eventually supported, is a separate explicit action
  followed by a later verification invocation;
- MCP cancellation and deadlines have the same visible result as CLI
  cancellation and deadlines;
- source-dependent work runs only in the explicitly authorized local or
  workload engine; a remote MCP adapter does not fetch source to simulate
  parity.

MCP method names, transport details, and tool schemas belong to the integration
design. The product requirement is semantic parity and explicit workspace and
permission context.

## 10. GitHub-facing user concepts

GitHub presents one check per canonical verification invocation, not one
independently calculated check per Proof. The check summary shows:

- the overall verification outcome and operational status;
- counts of required satisfied, violated, indeterminate, and uncovered
  Promises;
- concise annotations for actionable violated or indeterminate Promises;
- the exact engine, Application Model, policy, and invocation identities;
- whether the result came from local/workload execution and whether publication
  is partial;
- a link or command to inspect retained Evidence where authorization permits.

Status mapping is fixed:

| Canonical state | GitHub presentation |
|---|---|
| `completed/satisfied` | success |
| `completed/violated` | failure |
| `completed/indeterminate` | neutral / action required |
| `completed/not_evaluated` | neutral / action required |
| `cancelled` | cancelled |
| blocked or internal operational state | action required / error |

The first GitHub integration SHOULD be a GitHub Action that invokes the same CLI
inside the repository's existing runner and uploads only an authorized result
projection. A GitHub App that schedules hosted source execution is deferred.
This keeps source handling explicit, avoids creating a CI platform, and gives
users the same command locally and in review.

GitHub annotations are projections. Dismissing an annotation does not mutate a
Promise, Proof execution, or Evidence revision. Re-running does not erase
earlier attempts.

## 11. Provider onboarding experience

### 11.1 Product model

Users onboard a provider in five separate, inspectable decisions:

1. **Select** an exact compatible plugin revision.
2. **Install** the integrity-pinned artifact without granting runtime authority.
3. **Inspect** its declared operations, Evidence types, side effects, network
   destinations, filesystem needs, and secret scopes.
4. **Authorize** a bounded operation or policy-defined set of operations.
5. **Bind** a provider credential through the broker using an opaque
   Authentication binding, then preview and execute a plan.

The UI never says “connect your account” when the actual action grants network,
secret, or source authority. It names each grant.

Provider-specific resource names and settings may appear in a plugin-owned,
namespaced view, but the core-facing result remains Capability, Promise, Proof,
Evidence, Repair, and StructuredError. Plugin installation and permission
authorization are visibly separate. Updating a plugin to a new artifact digest
requires a new compatibility and permission review when its manifest changes.

### 11.2 First provider recommendation

GitHub is the first external provider plugin, after the first local npm release.
Its initial scope is read-only repository policy Evidence:

- default-branch identity;
- required status-check configuration;
- pull-request review requirements;
- branch-protection/ruleset observations.

The corresponding provider-neutral Capability is repository change governance.
Capture is `observational`; deterministic evaluation operates only on the
captured, validated response. Authentication, authorization, rate limit,
network, and API-availability failures produce operational reasons, never a
violated Promise.

GitHub is selected because it has broad developer reach, a familiar review
surface, a high-demonstration-value mismatch between declared policy and live
configuration, and a clean read-only starting scope. Automatic policy mutation,
repository administration, issue creation, pull-request authoring, and source
upload are excluded.

This provider is not required for first-release usefulness. Keeping it one
milestone behind the passive local CLI prevents provider authentication,
network enforcement, and observational validity windows from delaying the
first credible release.

## 12. Aggressive MVP recommendation

### 12.1 First public npm release

The MVP is a local CLI for JavaScript and TypeScript repositories using npm,
pnpm, or Yarn workspace metadata. It implements one provider-neutral Capability
family: **dependency and workspace declaration integrity**.

The first active Promises are limited to facts that passive static readers can
substantiate:

1. recognized package and workspace manifests are structurally valid;
2. declared workspace members resolve to unique in-boundary application roots;
3. local workspace dependency references resolve unambiguously to discovered
   applications;
4. a recognized lockfile has one unambiguous repository ownership scope.

The exact predicates and parser support belong to the Core Engine draft and
machine schemas. Product requires them to be deterministic, evidence-bearing,
repairable by a coding agent, and free of package-manager execution.

Evidence consists of bounded parsed observations, exact input references,
content digests, producer versions, and validation events. It does not persist
raw source by default. Repairs are initially limited to deterministic advisory
edits such as correcting a workspace member declaration or disambiguating a
local package reference. Every Repair includes a later Proof plan; the CLI does
not apply it in the first release.

### 12.2 Why this cut

This scope has:

- common pain in modern monorepos;
- immediate demonstration value in an empty-account, offline run;
- deterministic evidence from static files;
- no provider credentials or cloud dependency;
- failures that coding agents can understand and repair;
- fixtures that can be tested across package managers and operating systems;
- enough domain depth to validate the Application Model and provenance graph
  without pretending to verify application runtime behavior.

### 12.3 Explicitly excluded from the first release

The first release does not include:

- provider plugins, including GitHub;
- MCP, GitHub, editor, agent, REST, or cloud adapters;
- repository command, build, test, or package-manager execution;
- cloud login, publication, team history, policy distribution, or attestation;
- configuration generation;
- Repair application;
- LLM-based Repair generation or ranking;
- a plugin marketplace or third-party plugin installation;
- hosted workers, queues, database, billing, or usage charging;
- enterprise identity, retention, residency, or legal-hold controls;
- non-JavaScript ecosystems;
- runtime, deployment, production-health, or external-service Promises.

The architecture and schemas may support those later; the executable product
does not advertise them until their release gates pass.

## 13. Deferred product scope

### 13.1 Post-MVP

In order:

1. deterministic Repair inspection and explicit apply/re-verify;
2. out-of-process plugin runtime and three synthetic-provider conformance
   fixtures;
3. the read-only GitHub repository-policy plugin;
4. MCP adapter over local workspace execution;
5. GitHub Action projection using the canonical CLI result;
6. one additional ecosystem selected from observed unsupported-repository data
   collected only through explicit user research, not automatic telemetry.

### 13.2 Long-term platform

- optional cloud publication with disclosure preview;
- durable team history and signed organization policy distribution;
- GitHub App and editor projections;
- hosted execution only after Cloud Boundary, sandbox, retention, and workload
  identity decisions are complete;
- externally verifiable attestations;
- provider ecosystem and distribution policy;
- usage metering and commercial packaging;
- enterprise authorization, retention, deletion, region, and legal-hold
  controls.

Roadmap order can change, but no later surface may redefine the canonical
result or weaken local-first behavior.

## 14. Measurable acceptance criteria

### 14.1 Zero-configuration release

The first public release is acceptable only when:

- on every supported OS/runtime pair, an installed or cached
  `npx --offline verify` succeeds with network denied and emits no DNS,
  analytics, registry, update, or login-probe request;
- the command creates no repository file and executes no repository module,
  lifecycle hook, shell, package-manager, build, test, or script;
- fixtures for an empty repository, unknown ecosystem, single-package
  JavaScript/TypeScript application, npm workspace, pnpm workspace, Yarn
  workspace, nested applications, malformed manifest, conflicting roots, huge
  tree, ignored directory, and symlink escape produce reviewed golden results;
- every supported fixture produces a sealed Application Model or a typed
  invalid/blocked result with no fabricated model;
- every `passed` or `failed` Proof references validated Evidence, and every
  Promise result traverses to exact Proof and Evidence revisions in both
  directions;
- a missing credential, denied network request, timeout, malformed plugin
  response fixture, unsupported environment, and cancellation never appear as
  a failed Proof;
- repeated and schedule-randomized runs over identical sealed inputs are
  canonical-equivalent after documented volatile fields are removed;
- human, JSON, and JSONL modes derive from the same result; JSON stdout parses
  with no extra bytes while progress and diagnostics are active;
- all exit codes and mixed-condition precedence cases in Architecture Freeze
  §12.4 pass table-driven tests;
- a corrupt cache entry is reported as a miss, `--no-cache` records a bypass,
  and cache inspection traces hits to their originating Evidence;
- interruption begins cancellation within one second;
- passive discovery of the frozen 100,000-file reference fixture meets the
  five-second p95 budget, and engine overhead excluding plugin/tool work meets
  the one-second p95 budget;
- canary secrets placed in filenames, file content, environment, tool-shaped
  output, and errors never appear in stdout, stderr, local records, cache,
  audit, or structured protocol fixtures;
- every normative release claim maps to a test ID, static rule, or named manual
  control.

### 14.2 Usefulness bar

On each supported single-package or workspace fixture, the run MUST:

- discover every expected application boundary with attributed signals;
- activate and execute at least one applicable required Promise;
- identify each seeded manifest, workspace-member, local-reference, or lockfile
  scope contradiction as a violated Promise from validated Evidence;
- show an actionable next step in no more than one concise result block per
  non-satisfied required Promise;
- return the exact same canonical outcome through the dispatcher and CLI JSON
  conformance oracle;
- emit at least one deterministic advisory Repair for each designated
  repairable violation fixture, citing its motivating revisions and later
  verification plan.

Unknown repositories pass the usefulness bar by returning bounded discovery,
candidate Promises, skipped-input explanations, and a `not_evaluated` outcome;
they MUST NOT claim satisfaction.

### 14.3 Provider onboarding

Before the GitHub plugin is described as supported:

- install and authorization are separate recorded actions;
- the permission preview names every network, secret, filesystem, and side
  effect request;
- denial, revocation, expiry, rate limiting, network loss, malformed output,
  timeout, and cancellation have distinct structured outcomes;
- no credential value appears in an argument, title, output, Evidence, cache
  key, audit event, or publication payload;
- observational Evidence includes target identity, observation time, sanitized
  parameters, provenance, and validity window;
- the plugin passes the common conformance suite alongside three materially
  different synthetic providers without a core change.

### 14.4 Interface parity

Before MCP or GitHub is supported, shared golden fixtures MUST demonstrate:

- canonical-equivalent operational status, verification outcome, object
  references, and diagnostics across the CLI and adapter;
- exact cancellation and deadline propagation;
- no adapter-side aggregation, exit calculation, filtering, Repair selection,
  or authorization;
- GitHub status mapping exactly matches Architecture Freeze §12.4;
- MCP returns the envelope rather than prose-only interpretation;
- no source crosses the Cloud Boundary merely to obtain interface parity.

## 15. Product risks and mitigations

| Risk | Product mitigation |
|---|---|
| Zero-config produces only discovery trivia | Require an active, evidence-bearing Promise on every supported fixture |
| Users interpret `indeterminate` as a failure | Render operational status and verification outcome separately, with explicit copy |
| The narrow JavaScript scope is mistaken for a universal verifier | State supported ecosystems and uncovered candidates in every relevant view |
| Plugin setup becomes an opaque OAuth button | Separate selection, installation, permission review, credential binding, and execution |
| Repair language implies autonomous mutation | Label every Repair advisory and show the later verifying Proof plan |
| GitHub becomes an independent policy engine | Treat checks and annotations only as projections of the canonical envelope |
| Machine consumers depend on prose | Publish and test schemas, exit codes, and JSON purity from the first release |
| Package bootstrap undermines offline trust | Document bootstrap separately and test the cached `npx --offline` path |

## 16. Architecture change proposal

None. All recommendations in this draft operate within the frozen Application
Model, command contract, provider plugin boundary, Authentication Model, Cloud
Boundary, security defaults, status semantics, and compatibility policy.
