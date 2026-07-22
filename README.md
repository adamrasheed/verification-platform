# Verification Platform

**Verification infrastructure for AI-generated software.**

Run one command to check whether a JavaScript or TypeScript workspace is coherently configured, inspect the evidence, and give humans or coding agents structured guidance for repairs.

[![CI](https://github.com/adamrasheed/verification-platform/actions/workflows/ci.yml/badge.svg)](https://github.com/adamrasheed/verification-platform/actions/workflows/ci.yml)
[![CodeQL](https://github.com/adamrasheed/verification-platform/actions/workflows/codeql.yml/badge.svg)](https://github.com/adamrasheed/verification-platform/actions/workflows/codeql.yml)
[![npm](https://img.shields.io/npm/v/%40adamrasheed%2Fverify)](https://www.npmjs.com/package/@adamrasheed/verify)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

```sh
npx @adamrasheed/verify@latest verify .
```

Generated code can look complete, compile, and still leave the application incorrectly configured. Verification Platform provides an independent source of evidence: applications make Promises, the Engine evaluates Proofs, retained Evidence supports the result, and Repairs point to the next change.

## From agent claim to evidence

The workflow available today is deliberately narrow and concrete:

1. Claude, Codex, Cursor, or another coding agent says a workspace change is finished.
2. You run `verify .`.
3. The Engine passively discovers the workspace's dependency-integrity Capability and its applicable Promises.
4. Four built-in Proofs evaluate package manifests, workspace membership, local dependency references, and lockfile ownership.
5. The CLI returns an operational status, a verification outcome, exact Evidence references, reason codes, and any supported Repair suggestions.
6. A human or agent uses the machine-readable result to make the change and verifies again.

The verifier—not the coding agent—determines the result. Authentication, payments, deployments, webhooks, and other runtime journeys are not verified by the current CLI; they illustrate where the same model is intended to extend later.

## See it work

For a valid workspace, current human output has this shape (opaque IDs are abbreviated):

```text
operational status: completed
verification outcome: satisfied
application model: model:<workspace-id>@sha256:<revision>
required promises:
  - sid:promise:<id> — proof:manifest-structural-v1: passed
  - sid:promise:<id> — proof:workspace-unique-v1: passed
  - sid:promise:<id> — proof:local-dependency-v1: passed
  - sid:promise:<id> — proof:lockfile-ownership-v1: passed
evidence references:
  - evidence:<id>@sha256:<revision>
  - evidence:<id>@sha256:<revision>
  - evidence:<id>@sha256:<revision>
  - evidence:<id>@sha256:<revision>
next actions:
  (none)
cache: miss
invocation: invocation:<id>
```

A violation changes the relevant Proof to `failed`, adds a stable reason such as `DUPLICATE_WORKSPACE_NAME`, and can include a targeted Repair such as a JSON patch for a `package.json` file.

Use JSON when a coding agent or script needs one final protocol document:

```sh
npx @adamrasheed/verify@latest verify . --json
```

The current result uses fields such as these:

```json
{
  "operationalStatus": "completed",
  "result": {
    "kind": "verify",
    "outcome": "satisfied",
    "summary": {
      "requiredPromiseCount": 4,
      "advisoryPromiseCount": 0,
      "satisfiedCount": 4,
      "violatedCount": 0,
      "indeterminateCount": 0
    },
    "reasonCodes": []
  }
}
```

The full document also carries model, Promise, Proof, attempt, Evidence, Repair, cache, and diagnostic data. JSONL mode emits ordered lifecycle `event` records followed by exactly one terminal `result` record:

```sh
npx @adamrasheed/verify@latest verify . --jsonl
```

## What it verifies today

The published CLI passively verifies dependency and workspace declaration integrity for npm, pnpm, and Yarn repositories. It checks that:

- package manifests are valid, unambiguous structured data;
- in-boundary workspace packages have unique names;
- local dependency ranges and path references select the intended workspace package;
- the workspace has one unambiguous, root-owned lockfile and package manager.

In practical terms, it finds malformed manifests, duplicate or missing workspace names, unresolved or ambiguous local package references, missing or conflicting lockfiles, and multiple package-manager signals before they become harder-to-diagnose build or runtime failures.

“Passive” describes the `verify` operation: it reads bounded ordinary files, but does not execute repository code, contact external services, read credentials, or modify source files. `npx` may contact npm to obtain the package when it is not already cached; the Engine run itself is offline. Separate Repair commands require an exact retained suggestion and an explicit write grant before applying an atomic JSON edit.

## How it complements existing tools

Unit and end-to-end tests check behavior selected by their authors. Type checkers and linters enforce language and style rules. CI providers run jobs, observability platforms report on deployed systems, and AI review tools reason about code changes.

Verification Platform builds on those categories rather than replacing them. Its role is to model application Promises, determine the Proofs and Evidence needed to evaluate them, normalize the result, retain its provenance, and expose compatible output to humans, agents, and automation.

## Platform model

```text
Application
  → Capabilities
  → Promises
  → Proofs
  → Evidence
  → Repairs
```

The current workspace verifier exercises the complete model:

- **Application:** a discovered JavaScript or TypeScript workspace
- **Capability:** `workspace.dependencyIntegrity`
- **Promise:** every in-boundary workspace package has a unique name
- **Proof:** statically compare package names from bounded manifest observations
- **Evidence:** validated, revision-addressed observations supporting the verdict
- **Repair:** a targeted manifest edit with the motivating Proof, Evidence, and a later verification plan

This is also the platform's extensibility model. The long-term direction is to represent provider-neutral capabilities such as Authentication, Billing, Storage, Notifications, and Permissions, then evaluate their configuration or runtime Promises through appropriately isolated Proofs. Those broader Proofs are not part of the current CLI.

## One Engine, multiple interfaces

Each interface delegates semantics to the same canonical local dispatcher. A developer, coding agent, and CI workflow can therefore receive compatible outcomes and reason codes instead of separate interpretations of the repository.

| Interface | Current status | Use |
|---|---|---|
| [CLI](apps/cli/README.md) | Published on npm as `@adamrasheed/verify` | Human, JSON, and JSONL verification; retained inspection; cache and Repair commands |
| [Local MCP server](apps/mcp-server/README.md) | Implemented and tested; built from this repository | Workspace-bound verification plus retained run, event, Evidence, and provenance reads over stdio |
| [GitHub Action](apps/github-action/README.md) | Implemented and bundled; a public version tag has not yet been released | Offline verification in a workflow checkout with an optional metadata-only GitHub check |

The MCP server cannot apply Repairs or accept arbitrary client paths. The Action does not recalculate verdicts, emit source annotations, or upload Evidence bodies.

## Quick start

Node.js 22.5 or newer is required. No account or configuration is needed.

```sh
# Human-readable result
npx @adamrasheed/verify@latest verify .

# One canonical JSON document
npx @adamrasheed/verify@latest verify . --json

# Lifecycle events followed by one terminal result
npx @adamrasheed/verify@latest verify . --jsonl
```

Exit codes preserve the distinction between a product verdict and an operational problem: satisfied `0`, violated `1`, indeterminate or not evaluated `2`, invalid `3`, blocked `4`, cancelled `5`, and internal or incompatible `6`. See the [CLI guide](apps/cli/README.md) for the complete command surface.

To work on the repository itself:

```sh
npm ci --ignore-scripts
npm run build
node apps/cli/dist/verify.js verify . --json
npm test
```

## Use cases

**Available now**

- Catch npm, pnpm, and Yarn workspace-integrity problems without running repository code.
- Produce concise terminal results for developers and protocol output for coding agents.
- Retain local run and Evidence history, inspect exact provenance, and reuse bounded cache entries.
- Generate deterministic advisory Repairs for supported workspace violations; preview or explicitly apply and re-verify eligible JSON patches.
- Invoke the same dispatcher through a local MCP server built from source.
- Run the same Engine through the bundled GitHub Action implementation from this repository.

**Direction**

- Release the implemented read-only repository-policy provider after its remaining production security gates.
- Extend beyond static workspace metadata to configuration and runtime Promises for capabilities such as Authentication and Billing.
- Coordinate verification in customer-controlled workloads while keeping source and secrets outside the product cloud.
- Publish allowlisted result projections and retain hosted proof history without recalculating local verdicts.
- Produce broader evidence-backed repair plans while keeping write authority separate from verification.

See the [Product Vision](docs/product/VISION.md) and [Roadmap](docs/product/ROADMAP.md) for product intent and implementation sequence.

## Architecture and documentation

- [Engineering Design Document](docs/architecture/EDD.md)
- [Architecture Freeze](docs/architecture/ARCHITECTURE_FREEZE.md)
- [Shared Contracts](docs/architecture/SHARED_CONTRACTS.md)
- [Product Vision](docs/product/VISION.md)
- [Roadmap](docs/product/ROADMAP.md)
- [ADR index](docs/architecture/ADR/README.md)

The compact [architecture authority map](docs/architecture/README.md) explains how these documents relate.

## Project status

Early-stage, working CLI MVP. Version `0.2.0` is published on npm; the local Engine, retained Evidence and cache, Repair preview/apply/re-verify flow, local MCP adapter, and bundled GitHub Action are implemented. The MCP and Action are currently source interfaces rather than independently released packages. Broader provider, runtime, deployment, and hosted verification remain under development.

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow and architecture requirements, and report vulnerabilities through the process in [SECURITY.md](SECURITY.md).

## License

Apache-2.0. See [LICENSE](LICENSE).
