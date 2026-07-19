# Contributing

Thank you for helping improve the Verification Platform.

## Before opening a change

Read the [architecture authority map](docs/architecture/README.md), the
[Architecture Freeze](docs/architecture/ARCHITECTURE_FREEZE.md), and the
[Engineering Design Document](docs/architecture/EDD.md). An implementation may
not silently redefine a frozen term, contract, authority boundary, or invariant.
Material architectural changes require an accepted ADR first.

For security vulnerabilities, use
[private vulnerability reporting](https://github.com/adamrasheed/verification-platform/security/advisories/new)
instead of a public issue.

## Development

Node.js 22.5 or newer is required.

```sh
npm ci --ignore-scripts
npm test
```

Keep changes focused, add deterministic tests for changed behavior, and update
the relevant conformance evidence when a governed requirement changes. Pull
requests must pass CI, dependency review, and CodeQL analysis.

By contributing, you agree that your contribution is licensed under the
Apache License 2.0.
