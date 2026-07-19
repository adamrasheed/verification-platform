# ADR-0004: Plugin Runtime and Egress Broker

**Status:** accepted
**Date:** 2026-07-18
**Owner:** Lead Architect

## Context

Provider plugins need independent extensibility without provider code in core,
ambient credentials, or arbitrary data exfiltration.

## Decision

Plugins run as fresh child processes per operation over versioned NDJSON. Static
manifests declare compatibility and requested permissions before launch.
Initial network-capable plugins receive no raw socket permission; they submit
typed Provider Requests to an Engine-controlled egress broker. Credentials are
attached by the broker from invocation-scoped Secret References.

Distributable trusted plugins require pinned artifact integrity and verified
publisher provenance. Unverified local-development plugins receive no automatic
network or secret grant.

## Alternatives considered

- In-process TypeScript plugins.
- Direct plugin network allowlists.
- WebAssembly-only plugins.
- Provider integrations compiled into core.

## Tradeoffs

Process startup, serialization, broker request schemas, and provider SDK
adaptation add cost. They create enforceable fault, credential, and disclosure
boundaries.

## Consequences

SDKs requiring ambient network, proxies, telemetry, redirects, or credential
discovery are incompatible until adapted. Direct network permission is future
scope requiring a new ADR and equivalence Evidence.

## Domain impact

Plugin outputs remain candidates; Engine validation owns domain objects and
statuses.

## Security and privacy impact

Plugin release remains gated on OS sandbox selection, signature/revocation
policy, secret-delivery conformance, and egress canary tests. These gates do not
block the plugin-free MVP.

## Compatibility and migration

Current and previous stable protocol majors are supported under the frozen
window.

## Conformance changes

Three synthetic providers plus crash, flood, cancellation, permission, secret,
DNS, redirect, telemetry, and egress fixtures are required.

## Rollback strategy

Disable or revoke the plugin artifact without changing Engine semantics.

## Reconsideration triggers

A portable sandboxed ABI or direct-network design proves equivalent security,
SDK compatibility, and performance.

## Approval

Accepted by Lead Architect.
