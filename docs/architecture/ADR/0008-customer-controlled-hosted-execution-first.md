# ADR-0008: Customer-Controlled Hosted Execution First

**Status:** accepted
**Date:** 2026-07-18
**Owner:** Lead Architect

## Context

Product-hosted source execution would cross the frozen Cloud Boundary and
requires unresolved multi-tenant isolation, retention, source encryption,
egress, and workload lifecycle guarantees.

## Decision

The first hosted verification uses an explicitly authorized customer-controlled
workload Engine, such as a GitHub Action or customer runner. Product cloud may
coordinate dispatch and receive only the allowlisted published projection.

Product-operated workers MUST NOT receive source or sensitive Evidence until a
future explicit-share ADR amends the feature boundary and all hosted security
gates pass.

## Alternatives considered

- Upload source to product workers in the first cloud release.
- Metadata-only cloud with no dispatch.
- Build a new CI fleet.

## Tradeoffs

Customer-controlled runners reduce setup simplicity and central optimization.
They preserve the local/source boundary and avoid becoming a CI platform.

## Consequences

The hosted execution sequence is gateway → authorized workload → local Engine →
allowlisted publication. Product-hosted worker diagrams remain a blocked
long-term variant, not committed scope.

## Domain impact

The workload Engine produces the canonical result; cloud stores a projection.

## Security and privacy impact

Source and provider secrets stay in the customer-controlled boundary.

## Compatibility and migration

A future product-hosted result must preserve the same command and publication
contracts.

## Conformance changes

Dispatch identity, tenant binding, cancellation acknowledgements, offline
workload, replay, projection, and source-egress canary tests are required.

## Rollback strategy

Disable dispatch; local verification remains fully functional.

## Reconsideration triggers

Founder approves the product commitment and an explicit-share, isolation,
retention, deletion, region, and incident design passes independent review.

## Approval

Accepted by Lead Architect.
