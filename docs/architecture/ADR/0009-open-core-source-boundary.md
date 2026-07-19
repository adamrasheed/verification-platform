# ADR-0009: Open-Core Source Boundary

**Status:** accepted
**Date:** 2026-07-18
**Owner:** Lead Architect

## Context

The local Engine and plugin ecosystem need trust and adoption, while hosted
tenant operations, billing, and managed execution are commercial service
capabilities. The exact public license remains a founder/legal decision.

## Decision

The intended open-source boundary contains public contracts and schemas, events,
discovery, Proof/Evidence/Repair engines, local execution and cache, plugin SDK
and runtime, protocol bindings, CLI, local MCP adapter, synthetic plugins, and
conformance fixtures.

The intended closed-source boundary contains the product cloud control plane,
tenant administration, hosted persistence implementation, billing, managed
dispatch service, product-operated worker implementation, and proprietary
provider plugins. Closed services consume the same public contracts and receive
no semantic exception.

The founder selected Apache-2.0 for the repository and public local CLI under
F-002 on 2026-07-18.

## Alternatives considered

- Fully proprietary product.
- Fully open-source cloud implementation.
- Open SDK with closed Engine.

## Tradeoffs

Open local infrastructure makes semantic forks possible but improves auditability,
trust, contribution, and provider adoption. Commercial differentiation moves to
managed operations and enterprise controls.

## Consequences

Public contracts cannot import closed types. Cloud-specific schemas that clients
must consume are public even when their server implementation is closed.

## Domain impact

None; both sides use one Application Model.

## Security and privacy impact

Security controls are not hidden as a substitute for design. Sensitive
operational configuration and credentials remain private.

## Compatibility and migration

Published package APIs follow the compatibility policy regardless of license.

## Conformance changes

CI enforces import direction and builds the public package graph without access
to closed source.

## Rollback strategy

Before public release, retain all source privately. After publication, license
obligations govern rollback and cannot be undone architecturally.

## Reconsideration triggers

Founder/legal rejects open-core packaging or a sustainable business model
requires a different boundary.

## Approval

Accepted as the technical boundary. Public repository and local CLI source are
licensed under Apache-2.0; hosted commercial packaging remains separately
founder-owned.
