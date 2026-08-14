# Verify

**Catch workspace mistakes your coding agent thinks are done.**


Verify is a deterministic, offline checker for npm, pnpm, and Yarn monorepos.


It catches broken workspace declarations, local dependency mismatches, lockfile ownership problems, and related issues before they turn into CI failures or debugging sessions.


```sh
npx @adamrasheed/verify@latest verify .
```


No account. No config. No source upload.


Verify runs locally, does not execute repository code, and does not contact external services during verification.


[![CI](https://github.com/adamrasheed/verification-platform/actions/workflows/ci.yml/badge.svg)](https://github.com/adamrasheed/verification-platform/actions/workflows/ci.yml)
[![CodeQL](https://github.com/adamrasheed/verification-platform/actions/workflows/codeql.yml/badge.svg)](https://github.com/adamrasheed/verification-platform/actions/workflows/codeql.yml)
[![npm](https://img.shields.io/npm/v/%40adamrasheed%2Fverify)](https://www.npmjs.com/package/@adamrasheed/verify)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)


## What it catches

Verify currently checks npm, pnpm, and Yarn workspaces for:

| Problem                      | Example                                                             |
| ---------------------------- | ------------------------------------------------------------------- |
| Invalid manifests            | malformed or ambiguous `package.json` data                          |
| Workspace identity conflicts | duplicate or missing package names                                  |
| Broken local dependencies    | ranges or paths that do not select the intended workspace package   |
| Lockfile ownership drift     | missing, conflicting, or incorrectly rooted package-manager signals |


These are exactly the kinds of changes that can look plausible in review, especially after a coding agent edits several packages at once, while leaving the workspace internally inconsistent.


## See it fail


Imagine an agent creates two packages with the same workspace name:


```jsonc
// package.json
{
  "name": "npm-duplicate",
  "private": true,
  "workspaces": ["packages/*"]
}


// packages/a/package.json
{
  "name": "@fixture/duplicate",
  "version": "1.0.0"
}


// packages/b/package.json
{
  "name": "@fixture/duplicate",
  "version": "1.0.0"
}
```


Run:


```sh
npx @adamrasheed/verify@latest verify .
```


Verify returns:


```text
operational status: completed
verification outcome: violated


required promises:
  - proof:manifest-structural-v1: passed
  - proof:workspace-unique-v1: failed
      reason: DUPLICATE_WORKSPACE_NAME
  - proof:local-dependency-v1: passed
  - proof:lockfile-ownership-v1: passed


next actions:
  - repair:<id>: jsonPatch packages/b/package.json
```


Output abbreviated for readability.


The command exits `1`, so the same failure can stop a shell script or CI job.


More importantly, the verdict comes from Verify's Engine, not from the coding agent that made the change.


The agent can propose a fix.


**Verify decides whether the workspace is actually valid afterward.**


## Add Verify to your coding agent


Once Verify works on your repository, make it part of the agent's definition of done.


Add this to your `CLAUDE.md`, `AGENTS.md`, or equivalent project instructions:


```markdown
## Verification gate

Before declaring a task complete or asking for review, run:

    npx @adamrasheed/verify@latest verify .

If Verify returns `violated`, inspect the reported evidence, fix the underlying
workspace issue if it is within the scope of the task, and run Verify again.

Do not report the workspace as verified unless Verify completes with a
`satisfied` outcome.

Treat `indeterminate`, `not_evaluated`, blocked, cancelled, invalid invocation,
and internal errors as non-success states that require investigation rather
than as a successful verification.

Do not automatically apply Verify repairs unless explicitly authorized.
```


This does not replace tests, linting, typechecking, or code review.


It gives your agent an independent completion gate for the workspace promises Verify currently supports.


## Usage


### Run locally


```sh
npx @adamrasheed/verify@latest verify .
```


### JSON for agents and scripts


```sh
npx @adamrasheed/verify@latest verify . --json
```


Example:


```json
{
  "schemaVersion": 1,
  "command": "verify",
  "operationalStatus": "completed",
  "result": {
    "kind": "verify",
    "outcome": "violated",
    "reasonCodes": ["DUPLICATE_WORKSPACE_NAME"],
    "summary": {
      "requiredPromiseCount": 4,
      "violatedCount": 1
    }
  }
}
```


The complete result includes Promise, Proof, Evidence, provenance, and invocation information.


### JSONL


For ordered lifecycle events followed by one terminal result:


```sh
npx @adamrasheed/verify@latest verify . --jsonl
```


### Inspect a retained run


```sh
npx @adamrasheed/verify@latest inspect run <invocation-id> --json
```


### Inspect retained Evidence


```sh
npx @adamrasheed/verify@latest inspect evidence <evidence-id> --json
```


## Preview a repair


When Verify can safely derive a Repair, the violation includes a `repair:<id>`.


Preview it without changing the repository:


```sh
npx @adamrasheed/verify@latest repair preview <invocation-id> <repair-id> --json
```


A preview includes the target file, expected revision, proposed operations, and before/after data.


Preview never writes.


Applying a Repair is deliberately separate and requires explicit write authority:


```sh
npx @adamrasheed/verify@latest repair apply \
  <invocation-id> \
  <repair-id> \
  --grant-workspace-write
```


Verify only applies the exact retained Repair against the expected current file revision.


The edit is atomic and followed by a new verification.


## Exit codes


| Code | Meaning                        |
| ---: | ------------------------------ |
|  `0` | satisfied                      |
|  `1` | violated                       |
|  `2` | indeterminate or not evaluated |
|  `3` | invalid invocation             |
|  `4` | blocked                        |
|  `5` | cancelled                      |
|  `6` | internal error                 |


Machine-readable modes never prompt.


## Use it in CI


A `violated` result already exits non-zero, so the CLI can be used directly in an existing CI workflow:


```yaml
- name: Verify workspace
  run: npx @adamrasheed/verify@latest verify .
```


A dedicated, versioned GitHub Action runs the same Engine:


```yaml
permissions:
  contents: read
  checks: write

steps:
  - uses: actions/checkout@v7
  - uses: adamrasheed/verify-action@v1
```


Use `adamrasheed/verify-action@v1.0.0` to pin the immutable first release.


## How Verify works


```text
Application → Capability → Promise → Proof → Evidence → Repair
```


Verify does more than return a boolean.


### Discover


Read a bounded set of ordinary workspace files without executing repository code.


### Model


Determine the supported capability and the Promises that apply.


### Prove


Evaluate exact, versioned Proofs against normalized observations.


### Report


Return one canonical result with Evidence and provenance.


### Repair


When possible, derive a narrowly scoped advisory Repair that must be separately authorized and verified again.


This model is designed to expand beyond workspace integrity over time.


Potential future capabilities include authentication, billing, storage, notifications, and permissions.


Those are product direction, not functionality claimed by the current CLI.


## One Engine, multiple interfaces


Every interface delegates verdict semantics to the same Engine.


| Interface                                     | Status                                                                              | Best for                                              |
| --------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------- |
| [CLI](apps/cli/README.md)                     | Published as `@adamrasheed/verify`                                                  | local use, scripts, agents, and CI                    |
| [Local MCP server](apps/mcp-server/README.md) | Implemented and tested from source                                                  | workspace-bound agent verification and retained reads |
| [GitHub Action](apps/github-action/README.md) | [`v1.0.0`](https://github.com/adamrasheed/verify-action/releases/tag/v1.0.0) released | pull-request verification                             |


## Trust boundary


Verify is intentionally local-first.


- Source and secrets stay local by default.
- Verification does not execute repository code.
- Verification performs no ambient network access.
- Evidence is revision-addressed.
- Results retain exact provenance.
- Product violations remain distinct from verifier failures.
- Repairs require separate explicit write authority.


`npx` may contact npm to download the package. The verification Engine itself runs offline.


## Current scope


### Available now


- npm, pnpm, and Yarn workspace verification
- manifest structural checks
- workspace identity checks
- local dependency checks
- lockfile ownership checks
- human-readable output
- JSON output
- JSONL lifecycle output
- retained local runs
- retained Evidence and provenance
- bounded local cache
- Repair preview
- explicitly authorized atomic Repair application
- local MCP adapter
- bundled GitHub Action implementation


### Not claimed yet


Verify does **not** currently claim to verify:


- authentication flows
- payments
- deployments
- webhooks
- runtime application behavior
- production availability
- arbitrary code correctness


It is not a replacement for tests, CI, typechecking, linting, or code review.


It verifies the specific Promises supported by its current Proof set.


## Requirements


Node.js 22.5 or newer.


Try it:


```sh
npx @adamrasheed/verify@latest verify .
```


If the result is useful, the next step is to add Verify to your agent instructions so it runs automatically before work is declared complete.


## Project status


Verify is an early-stage working product.


The CLI is published on npm. The local Engine, Evidence store, cache, Repair loop, MCP adapter, and GitHub Action implementation are working and tested.


The broader hosted product remains pre-release.


See:


- [Roadmap](docs/product/ROADMAP.md)
- [Go-to-Market Plan](docs/product/GTM_PLAN.md)
- [Product Positioning](docs/product/POSITIONING.md)


## Develop the repository


```sh
npm ci --ignore-scripts
npm run build
node apps/cli/dist/verify.js verify . --json
npm test
```


Architecture documentation:


- [Engineering Design Document](docs/architecture/EDD.md)
- [Architecture Freeze](docs/architecture/ARCHITECTURE_FREEZE.md)
- [Shared Contracts](docs/architecture/SHARED_CONTRACTS.md)
- [Product Vision](docs/product/VISION.md)
- [ADR index](docs/architecture/ADR/README.md)
- [Architecture authority map](docs/architecture/README.md)


## Contributing and security


Read [CONTRIBUTING.md](CONTRIBUTING.md) before changing code.


Report security issues through [SECURITY.md](SECURITY.md).


Apache-2.0 licensed. See [LICENSE](LICENSE).
