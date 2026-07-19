# Verify CLI

Canonical public adapter for the local verification Engine.

The CLI owns argument parsing, workspace binding, signal propagation, stdout/
stderr separation, human presentation, JSON/JSONL serialization, and process
exit mapping. It does not discover, evaluate, aggregate, authorize, select
Repairs, or calculate a verification outcome.

Stable commands:

- `verify [workspace] [--offline] [--no-cache] [--deadline <ms>]`
- `inspect run <id>`
- `inspect evidence <id>`
- `cache inspect`
- `cache clear`
- `repair preview <run-id> <repair-id> [--workspace <path>]`
- `repair apply <run-id> <repair-id> [--workspace <path>] --grant-workspace-write`
- `version`
- `schema`

Typical use:

```sh
npx @adamrasheed/verify
npx @adamrasheed/verify --json
npx @adamrasheed/verify --jsonl
npx @adamrasheed/verify inspect run <invocation-id> --json
npx @adamrasheed/verify repair preview <invocation-id> <repair-id> --json
```

Machine modes never prompt. JSON emits one final document. JSONL emits
lifecycle records followed by one final result record. Human progress and
diagnostics use stderr; final human output uses stdout.

The MVP engine always runs offline; `--offline` is an idempotent assertion.
Local history, Evidence, and cache state are stored outside the repository
under `$XDG_STATE_HOME/verify` or `~/.local/state/verify`, scoped by the
resolved directory from which the CLI is invoked. `cache clear` preserves
retained run and Evidence history.

Repair preview never writes. Apply accepts only an exact Repair retained by the
named run, rejects stale or escaping targets, requires the explicit
`--grant-workspace-write` authority, atomically replaces one JSON file, records
append-only lifecycle events, and runs a later exact Proof verification.
