# Packages

Reusable implementation packages belong here.

Expected responsibilities include domain contracts, schemas, the verification
engine, execution and policy services, Evidence handling, protocols, plugin
SDK/runtime, first-party provider plugins, caching, authentication, and audit.
Shared adapter-core code owns canonical local dispatch and projection used by
CLI, MCP, and GitHub integrations. The GitHub check projector owns the pure,
privacy-reduced presentation allowlist and has no provider or network client.

Package responsibilities and dependency directions are frozen in
[Shared Contracts](../docs/architecture/SHARED_CONTRACTS.md); the eventual
public npm scope remains founder-owned. Provider SDKs and interface-specific
behavior MUST NOT enter core packages.
