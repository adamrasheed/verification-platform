# Verification Platform

[![CI](https://github.com/adamrasheed/verification-platform/actions/workflows/ci.yml/badge.svg)](https://github.com/adamrasheed/verification-platform/actions/workflows/ci.yml)
[![CodeQL](https://github.com/adamrasheed/verification-platform/actions/workflows/codeql.yml/badge.svg)](https://github.com/adamrasheed/verification-platform/actions/workflows/codeql.yml)
[![npm](https://img.shields.io/npm/v/%40adamrasheed%2Fverify)](https://www.npmjs.com/package/@adamrasheed/verify)

Verification infrastructure for modern software.

Applications make promises. Proofs verify promises. Evidence supports proofs.
Repair suggestions derive from evidence.

## Project status

The first local CLI MVP is implemented against the approved
[Engineering Design Document](docs/architecture/EDD.md) and
[Architecture Freeze](docs/architecture/ARCHITECTURE_FREEZE.md).
It passively verifies npm, pnpm, and Yarn workspace integrity without executing
repository code, contacting a network, reading credentials, or writing source.

M7 local integrations are also implemented: a one-workspace stdio MCP server
and a bundled GitHub Action both use the same canonical dispatcher as the CLI.
The Action's optional GitHub check is a metadata-only projection. See the
[adapter compatibility matrix](docs/architecture/ADAPTER_COMPATIBILITY.md).

No document, package, application, or integration may silently redefine a
frozen architectural concept. Changes require an accepted
[Architecture Decision Record](docs/architecture/ADR/README.md).

## Run locally

Requires Node.js 22.5 or newer.

Run the published CLI:

```sh
npx @adamrasheed/verify@0.2.0 verify .
```

Or work from source:

```sh
npm install
npm test
npm run build --workspace @adamrasheed/verify
node apps/cli/dist/verify.js verify . --json
```

The CLI also supports human and JSONL output, retained run/Evidence inspection,
cache inspection/clear, version, and schema commands. See the
[CLI README](apps/cli/README.md), [MCP README](apps/mcp-server/README.md), and
[GitHub Action README](apps/github-action/README.md).

## Repository map

```text
.
├── docs/
│   ├── architecture/  # Normative engineering architecture and decisions
│   ├── product/       # Product direction and sequencing
│   └── research/      # Evidence and investigations, not decisions
├── packages/          # Reusable engine, domain, protocol, and plugin packages
├── apps/              # CLI and other product interfaces
└── tooling/           # Repository development and conformance tooling
```

## Start here

1. [Architecture authority map](docs/architecture/README.md)
2. [Architecture Freeze](docs/architecture/ARCHITECTURE_FREEZE.md)
3. [Glossary](docs/architecture/GLOSSARY.md)
4. [Shared Contracts](docs/architecture/SHARED_CONTRACTS.md)
5. [Engineering Design Document](docs/architecture/EDD.md)
6. [Product Vision](docs/product/VISION.md)
7. [Roadmap](docs/product/ROADMAP.md)

## Authority

If documents conflict, the precedence rules in the Architecture Freeze apply.
Research informs decisions but does not make them. Roadmaps sequence work but do
not change contracts. ADRs change frozen decisions only after acceptance by the
Lead Architect and incorporation into the freeze.

## License

Apache-2.0. See [LICENSE](LICENSE).
