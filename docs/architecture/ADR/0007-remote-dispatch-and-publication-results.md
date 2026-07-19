# ADR-0007: Remote Dispatch and Publication Results

**Status:** accepted
**Date:** 2026-07-18
**Owner:** Lead Architect

## Context

Remote adapters cannot receive a full local Verify Result under the default
Cloud Boundary, and a routing failure is not a Proof or Engine result.

## Decision

Define distinct command result kinds: `verify`, `dispatchVerification`,
`publishedVerification`, `getRun`, and `getPublishedRun`.

Dispatch owns routing states. The workload retains the exact local Verify Result.
Publication creates an allowlisted projection using `PublishedObjectRef`, never
local `RevisionRef`. Remote parity compares pure projections of the same local
result, not full local JSON.

## Alternatives considered

- Redact fields from Verify Result in place.
- Fabricate a blocked Verify Result when no workload exists.
- Upload the full local result.

## Tradeoffs

Callers must handle more explicit result kinds and asynchronous state. Privacy
and semantic authority remain unambiguous.

## Consequences

MCP remote mode and GitHub App use dispatch and published resources. Local MCP
and GitHub Actions running beside the repository may use Verify Result directly
when authorized.

## Domain impact

No new Proof or Promise status is introduced.

## Security and privacy impact

Published IDs are locally keyed and tenant-scoped. Default GitHub projection
contains no filenames, Promise prose, source locations, commands, logs, or raw
revisions.

## Compatibility and migration

Every result kind has an independent schema under the common envelope.

## Conformance changes

Add routing, unavailable workload, projection suppression, cancellation race,
retrieval authorization, and unknown-state fixtures.

## Rollback strategy

Disable remote dispatch while retaining local verification and published
metadata already accepted.

## Reconsideration triggers

The Cloud Boundary later authorizes a richer explicit-share response class.

## Approval

Accepted by Lead Architect.
