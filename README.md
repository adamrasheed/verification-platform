# Verify

**Know when an AI-generated JavaScript or TypeScript change is actually done.**

Verify checks a workspace with a deterministic, local-first engine and returns
an evidence-backed verdict that developers, coding agents, and CI can all read.

[![CI](https://github.com/adamrasheed/verification-platform/actions/workflows/ci.yml/badge.svg)](https://github.com/adamrasheed/verification-platform/actions/workflows/ci.yml)
[![CodeQL](https://github.com/adamrasheed/verification-platform/actions/workflows/codeql.yml/badge.svg)](https://github.com/adamrasheed/verification-platform/actions/workflows/codeql.yml)
[![npm](https://img.shields.io/npm/v/%40adamrasheed%2Fverify)](https://www.npmjs.com/package/@adamrasheed/verify)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

```sh
npx @adamrasheed/verify@latest verify .
```

No account or configuration is required. The Engine run is offline and
read-only: it does not execute repository code, contact external services, read
credentials, or change source files.

## What it catches today

Verify currently checks npm, pnpm, and Yarn workspaces for dependency and
workspace declaration problems:

| Problem | Example |
|---|---|
| Invalid manifests | malformed or ambiguous `package.json` data |
| Workspace identity conflicts | duplicate or missing package names |
| Broken local dependencies | ranges or paths that do not select the intended workspace package |
| Lockfile ownership drift | missing, conflicting, or incorrectly rooted package-manager signals |

These problems can survive code generation and look plausible in review while
still breaking installation, builds, or later automation.

## What a result tells you

A run separates two questions that ordinary pass/fail output often mixes:

- **Operational status:** did verification itself complete correctly?
- **Verification outcome:** were the workspace promises satisfied, violated, or
  indeterminate?

A violation identifies the failed Proof, cites retained Evidence, returns stable
reason codes such as `DUPLICATE_WORKSPACE_NAME`, and includes a Repair suggestion
when the Engine can derive one safely.

```text
operational status: completed
verification outcome: violated
required promises:
  - promise:<id> — proof:workspace-unique-v1: failed
      reason: DUPLICATE_WORKSPACE_NAME
evidence references:
  - evidence:<id>@sha256:<revision>
next actions:
  - repair:<id>: <targeted manifest edit>
```

The verifier—not the coding agent—determines the result.

## Use it from a terminal or an agent

Human-readable output:

```sh
npx @adamrasheed/verify@latest verify .
```

One canonical JSON document for an agent or script:

```sh
npx @adamrasheed/verify@latest verify . --json
```

Ordered lifecycle events followed by one terminal result:

```sh
npx @adamrasheed/verify@latest verify . --jsonl
```

Inspect retained results and Evidence:

```sh
npx @adamrasheed/verify@latest inspect run <invocation-id> --json
npx @adamrasheed/verify@latest inspect evidence <evidence-id> --json
```

Preview a supported Repair without writing:

```sh
npx @adamrasheed/verify@latest repair preview <invocation-id> <repair-id> --json
```

Repair application is deliberately separate. It requires the exact retained
suggestion, a current matching file revision, and the explicit
`--grant-workspace-write` flag. The edit is atomic and followed by a new
verification.

Node.js 22.5 or newer is required. `npx` may contact npm to download the
package; the verification Engine itself remains offline.

## How it works

```text
Application → Capability → Promise → Proof → Evidence → Repair
```

1. **Discover:** read a bounded set of ordinary workspace files without running
   repository code.
2. **Model:** identify the supported capability and the promises that apply.
3. **Prove:** evaluate exact, versioned Proofs against normalized observations.
4. **Report:** return one canonical result with Evidence and provenance links.
5. **Repair:** optionally derive a targeted advisory edit that must be applied
   with separate authority and verified again.

This model is designed to grow beyond workspace integrity to provider-neutral
capabilities such as authentication, billing, storage, notifications, and
permissions. Those broader checks are product direction, not current CLI
functionality.

## One engine, three interfaces

Every interface delegates verdict semantics to the same Engine.

| Interface | Status | Best for |
|---|---|---|
| [CLI](apps/cli/README.md) | Published as `@adamrasheed/verify` | local use, scripts, and agent subprocesses |
| [Local MCP server](apps/mcp-server/README.md) | Implemented and tested from source | workspace-bound agent verification and retained reads |
| [GitHub Action](apps/github-action/README.md) | Implemented and bundled; public version tag pending | offline verification in pull-request workflows |

The MCP server is read-only and bound to one host-configured workspace. The
Action publishes only an allowlisted metadata projection and does not upload
Evidence bodies or source annotations.

## Trust and privacy boundary

- Source and secrets stay local by default.
- Verification reads bounded ordinary files and performs no ambient network or
  process execution.
- Evidence is revision-addressed and results retain exact provenance.
- A product violation is never reported as an internal error, and an internal
  error is never converted into a product violation.
- Hosted development work uses customer-controlled execution and allows only
  metadata publication; the hosted product remains pre-release.

## Current scope

**Available now**

- deterministic dependency-integrity verification for npm, pnpm, and Yarn
  workspaces;
- human, JSON, and JSONL output;
- retained local runs, Evidence, provenance, and bounded cache entries;
- advisory Repair preview and explicitly authorized atomic application;
- local MCP and bundled GitHub Action adapters from this repository.

**Not claimed yet**

- verification of runtime journeys such as authentication, payments,
  deployment, or webhooks;
- a generally available hosted service or production availability SLO;
- an independently released MCP package or public GitHub Marketplace Action;
- signed Windows production sandbox support, which is intentionally on hold.

## Project status

This is an early-stage working product. CLI version `0.2.0` is published on npm.
The local Engine, Evidence store, cache, Repair loop, MCP adapter, GitHub Action,
and AWS metadata-cloud development path are implemented and tested. Broader
providers and public hosted delivery remain gated by their release Evidence.

See the [Roadmap](docs/product/ROADMAP.md) for exact completion status and the
[GTM plan](docs/product/GTM_PLAN.md) for the launch sequence.

## Develop the repository

```sh
npm ci --ignore-scripts
npm run build
node apps/cli/dist/verify.js verify . --json
npm test
```

The repository is architecture-enforced. Start with:

- [Engineering Design Document](docs/architecture/EDD.md)
- [Architecture Freeze](docs/architecture/ARCHITECTURE_FREEZE.md)
- [Shared Contracts](docs/architecture/SHARED_CONTRACTS.md)
- [Product Vision](docs/product/VISION.md)
- [Positioning](docs/product/POSITIONING.md)
- [ADR index](docs/architecture/ADR/README.md)

The [architecture authority map](docs/architecture/README.md) explains how the
documents relate.

## Contributing and security

Read [CONTRIBUTING.md](CONTRIBUTING.md) before changing code. Report
vulnerabilities through [SECURITY.md](SECURITY.md).

Apache-2.0 licensed. See [LICENSE](LICENSE).
