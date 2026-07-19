# Verification Platform

Verification infrastructure for modern software.

Applications make promises. Proofs verify promises. Evidence supports proofs.
Repair suggestions derive from evidence.

## Project status

The first local CLI MVP is implemented against the approved
[Engineering Design Document](docs/architecture/EDD.md) and
[Architecture Freeze](docs/architecture/ARCHITECTURE_FREEZE.md).
It passively verifies npm, pnpm, and Yarn workspace integrity without executing
repository code, contacting a network, reading credentials, or writing source.

No document, package, application, or integration may silently redefine a
frozen architectural concept. Changes require an accepted
[Architecture Decision Record](docs/architecture/ADR/README.md).

## Run locally

Requires Node.js 22.5 or newer.

```sh
npm install
npm test
npm run build --workspace verify
node apps/cli/dist/verify.js verify . --json
```

The CLI also supports human and JSONL output, retained run/Evidence inspection,
cache inspection/clear, version, and schema commands. See
[the CLI README](apps/cli/README.md).

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
