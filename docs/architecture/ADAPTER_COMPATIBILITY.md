# Local Adapter Compatibility Matrix

**Status:** Implemented for M7

**Protocol:** command schema major 1

**Engine:** shared local Engine and dispatcher
**Owner:** Integrations

CLI JSON remains the external conformance oracle. The CLI, local MCP server,
and GitHub Action all call `LocalCanonicalDispatcher`; no adapter evaluates a
Promise, selects a Proof, aggregates an outcome, or chooses a Repair.

## Interface matrix

| Property | CLI | Local MCP | GitHub Action |
|---|---|---|---|
| Execution location | Local process | Local stdio server process | Existing GitHub runner checkout |
| Workspace authority | Explicit CLI path bound during preflight | One host-selected root and opaque startup binding | Fixed `GITHUB_WORKSPACE` binding |
| Engine request | Canonical `VerifyRequest` | Canonical `VerifyRequest` after strict tool decoding | Canonical offline `VerifyRequest` |
| Full canonical envelope | JSON/JSONL or human rendering | Structured tool result and retained-run resource | Retained locally on the runner; not written to the workflow log |
| Progress | Engine events on stderr/JSONL | Bounded MCP progress notifications | Check is terminal-only in phase one |
| Cancellation | SIGINT/SIGTERM | MCP `notifications/cancelled` / connection shutdown | SIGINT/SIGTERM from the runner |
| Deadline | `--deadline` | `deadlineMs`, bounded to one hour | Runner cancellation in phase one |
| Retained reads | Run and Evidence commands | Run, events, Evidence, and exact-revision provenance resources | Local Engine state only |
| Mutation or Repair apply | Explicit CLI command and grant only | None | None |
| Network | Denied during verification | Denied during verification | Verification is offline; a separate fixed Checks API call is optional |
| Third-party projection | None | None | Literal metadata allowlist; no annotations |

## Semantic equivalence

For identical workspace bytes, Engine version, protocol version, policy,
consent, environment, deadline, and cache mode, adapters preserve:

- operational status and verification outcome;
- result digest, summary, reason codes, and deterministic ordering;
- Application Model, Promise, Proof, Evidence, Repair, attempt, and manifest
  references;
- cancellation and deadline behavior.

Allowed differences are invocation identity, start time, elapsed duration,
adapter-local opaque workspace binding, progress transport, cache observation
when modes differ, and presentation. The M7 parity test removes only those
volatile fields and compares CLI, MCP, and Action results from the same corpus.

## GitHub check allowlist

The pure projector may emit only canonical operational status, outcome, stable
reason codes, aggregate counts, duration, Evidence classification counts, an
opaque invocation identifier, and fixed presentation text derived from those
fields. The Checks request adds only the fixed check name and exact workflow
commit. It emits no filenames, source, Promise prose, commands, logs, Evidence
bodies, raw revisions, or annotations. A missing or read-only token returns a
typed publication failure and never changes the canonical envelope.

## Version and compatibility policy

| Boundary | Current selection | Compatibility rule |
|---|---|---|
| Verify protocol | Schema major 1 | Additive informational fields are accepted; unknown control values fail incompatible |
| MCP transport | `@modelcontextprotocol/sdk` 1.29.0 with patched Hono override | Stable v1 SDK; standard lifecycle, tools, resources, progress, and cancellation only |
| GitHub Action runtime | Node 24 | The committed bundle is the executed artifact |
| GitHub Checks REST | API version 2026-03-10 | Fixed `api.github.com` host and check-runs path; non-201 is presentation failure |

Remote MCP, GitHub App dispatch, cloud publication, source annotations, and
Windows production signing are not enabled by M7.
