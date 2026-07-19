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
- `version`
- `schema`

Typical use:

```sh
npx @adamrasheed/verify
npx @adamrasheed/verify --json
npx @adamrasheed/verify --jsonl
npx @adamrasheed/verify inspect run <invocation-id> --json
```

Machine modes never prompt. JSON emits one final document. JSONL emits
lifecycle records followed by one final result record. Human progress and
diagnostics use stderr; final human output uses stdout.

The MVP engine always runs offline; `--offline` is an idempotent assertion.
Local history, Evidence, and cache state are stored outside the repository
under `$XDG_STATE_HOME/verify` or `~/.local/state/verify`, scoped by the
resolved directory from which the CLI is invoked. `cache clear` preserves
retained run and Evidence history.
