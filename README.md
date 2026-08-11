# Verify

**Catch broken workspace changes before CI does.**

Verify is a deterministic, offline checker for npm, pnpm, and Yarn monorepos.
It reads workspace declarations, evaluates a fixed set of promises, and returns
one evidence-backed verdict. Dependency and workspace declaration mistakes,
whether introduced by a human or an AI coding agent, get caught here instead of
in CI.

[![CI](https://github.com/adamrasheed/verification-platform/actions/workflows/ci.yml/badge.svg)](https://github.com/adamrasheed/verification-platform/actions/workflows/ci.yml)
[![CodeQL](https://github.com/adamrasheed/verification-platform/actions/workflows/codeql.yml/badge.svg)](https://github.com/adamrasheed/verification-platform/actions/workflows/codeql.yml)
[![npm](https://img.shields.io/npm/v/%40adamrasheed%2Fverify)](https://www.npmjs.com/package/@adamrasheed/verify)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

```sh
npx @adamrasheed/verify@latest verify .
```

No account or configuration is required. The Engine run is offline and
read-only: it does not execute repository code, contact external services, read
credentials, or change source files. A `violated` verdict exits 1, which fails
a shell step or a CI job on its own.

## What it catches

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

## See it fail

The smallest realistic failure: two workspace packages with the same name.

```jsonc
// package.json
{ "name": "npm-duplicate", "private": true, "workspaces": ["packages/*"] }

// packages/a/package.json
{ "name": "@fixture/duplicate", "version": "1.0.0" }

// packages/b/package.json
{ "name": "@fixture/duplicate", "version": "1.0.0" }
```

Run Verify from the workspace root:

```sh
npx @adamrasheed/verify@latest verify .
```

```text
operational status: completed
verification outcome: violated
application model: model:<id>@sha256:<revision>
required promises:
  - promise:<id> — proof:manifest-structural-v1: passed
  - promise:<id> — proof:workspace-unique-v1: failed
      reason: DUPLICATE_WORKSPACE_NAME
  - promise:<id> — proof:local-dependency-v1: passed
  - promise:<id> — proof:lockfile-ownership-v1: passed
evidence references:
  - evidence:<id>@sha256:<revision>
next actions:
  - repair:<id>: jsonPatch packages/b/package.json
cache: miss
invocation: invocation:<id>
```

(Output abbreviated; identifiers shortened.)

The command exits 1. Verify separates operational status (did the run complete)
from verification outcome (were the promises satisfied). A violation names the
failed Proof, cites retained Evidence, returns a stable reason code such as
`DUPLICATE_WORKSPACE_NAME`, and includes a Repair suggestion when one can be
derived safely.

The verdict is produced by Verify's Engine, not by whoever changed the files.
An agent or a human can propose a fix; the verifier decides whether the fix
holds.

## Add Verify to your coding agent

Copy this into `CLAUDE.md` or `AGENTS.md` so every agent that works in the
repository runs Verify before declaring work complete:

````markdown
## Verification gate

Before declaring a task complete or asking for review, run:

    npx @adamrasheed/verify@latest verify .

If verification fails, resolve the reported violations first, then re-run until
the verdict is `satisfied`. The verifier determines the result, not you. Never
skip, bypass, or explain away a failing verification.
````

Verify runs as an independent, deterministic subprocess. The agent cannot argue
with the verdict; it can only fix the workspace and re-run.

## Usage

### Local CLI

```sh
npx @adamrasheed/verify@latest verify .             # human output
npx @adamrasheed/verify@latest verify . --json      # one JSON document
npx @adamrasheed/verify@latest verify . --jsonl     # lifecycle events + one terminal result
npx @adamrasheed/verify@latest inspect run <invocation-id> --json
npx @adamrasheed/verify@latest inspect evidence <evidence-id> --json
```

Exit codes: `0` satisfied, `1` violated, `2` indeterminate or not evaluated,
`3` invalid invocation, `4` blocked, `5` cancelled, `6` internal error.
Machine modes never prompt.

### JSON for scripts and agents

```sh
npx @adamrasheed/verify@latest verify . --json
```

Excerpt of the result document (identifiers abbreviated):

```json
{
  "schemaVersion": 1,
  "command": "verify",
  "invocationId": "invocation:<id>",
  "operationalStatus": "completed",
  "result": {
    "kind": "verify",
    "outcome": "violated",
    "reasonCodes": ["DUPLICATE_WORKSPACE_NAME"],
    "summary": { "requiredPromiseCount": 4, "violatedCount": 1 },
    "promises": [
      {
        "promise": {
          "kind": "promise",
          "id": "sid:promise:<id>",
          "revision": "sha256:<revision>",
          "schemaVersion": 1
        },
        "status": "violated",
        "proofAttempts": [
          {
            "attemptId": "attempt:<id>",
            "proof": {
              "kind": "proof",
              "id": "proof:workspace-unique-v1",
              "revision": "sha256:<revision>",
              "schemaVersion": 1
            },
            "invocationId": "invocation:<id>"
          }
        ],
        "evidence": [
          {
            "kind": "evidence",
            "id": "evidence:<id>",
            "revision": "sha256:<revision>",
            "schemaVersion": 1
          }
        ],
        "reasonCodes": ["DUPLICATE_WORKSPACE_NAME"]
      }
    ]
  }
}
```

### GitHub Actions / CI

The Action runs the same Engine on the checked-out workspace and publishes a
metadata-only check.

```yaml
permissions:
  contents: read
  checks: write
steps:
  - uses: actions/checkout@v4
  - uses: adamrasheed/verification-platform/apps/github-action@v1
```

The Action is implemented and bundled in this repository, but no released tag
contains it yet; the `@v1` reference follows the Action's own README and
resolves once the public release is cut. It publishes only an allowlisted
metadata projection and does not upload Evidence bodies or source
annotations.

### Repair preview

A `repair:<id>` from a failed run can be previewed without writing anything:

```sh
npx @adamrasheed/verify@latest repair preview <invocation-id> <repair-id> --json
```

```json
{
  "schemaVersion": 1,
  "kind": "repairPreview",
  "sourceInvocationId": "invocation:<id>",
  "writeAuthorized": false,
  "writePerformed": false,
  "preview": {
    "schemaVersion": 1,
    "kind": "repairPatchPreview",
    "repair": {
      "kind": "repair",
      "id": "repair:<id>",
      "revision": "sha256:<revision>",
      "schemaVersion": 1
    },
    "target": "packages/b/package.json",
    "expectedContentDigest": "sha256:<digest>",
    "currentContentDigest": "sha256:<digest>",
    "patchedContentDigest": "sha256:<digest>",
    "operations": [
      { "operation": "replace", "pointer": "/name", "value": "replace-with-unique-name-1" }
    ],
    "before": { "name": "@fixture/duplicate", "version": "1.0.0" },
    "after": { "name": "replace-with-unique-name-1", "version": "1.0.0" }
  }
}
```

(Digests and identifiers abbreviated.)

Preview never writes. Applying a Repair requires the exact retained suggestion,
a current matching file revision, and the explicit `--grant-workspace-write`
flag; the edit is atomic and followed by a new verification.

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
