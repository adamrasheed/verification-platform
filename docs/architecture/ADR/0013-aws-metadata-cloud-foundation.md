# ADR-0013: AWS Metadata Cloud Foundation

**Status:** accepted
**Date:** 2026-07-26
**Owner:** Lead Architect

## Context

D-002 deferred the cloud vendor, primary region, managed products, retention,
backup, deletion, legal-hold, and tenant-key selections until immediately before
hosted implementation. The provider-neutral M8 contracts and foundation
Evidence now pass, so a concrete deployment target is required.

## Frozen clauses affected

This ADR resolves Architecture Freeze §20.1(6) and Open Question D-002 without
changing the Cloud Boundary, domain semantics, provider-neutral core, or
customer-controlled execution decision.

## Decision

The first metadata-cloud deployment uses AWS in `us-west-2` (US West/Oregon)
with these managed products:

- Amazon ECS on Fargate for stateless control API and metadata workers;
- Amazon RDS for PostgreSQL for tenant metadata, immutable projections,
  idempotency, audit, leases, and the transactional outbox;
- Amazon SQS standard queues with dead-letter queues for at-least-once
  reference delivery; queue delivery remains transport, not a Proof attempt;
- Amazon S3 only for explicitly authorized allowlisted objects, quarantine,
  backups, and OpenTofu state;
- AWS KMS customer-managed symmetric keys per environment for database,
  object, queue, secret, log, and state encryption;
- AWS Secrets Manager and RDS-managed credentials for service secrets;
- Amazon CloudWatch for schema-filtered operational logs and metrics;
- AWS Budgets for an environment-level monthly cost ceiling and alerts.

OpenTofu 1.12.x is the infrastructure authority. The AWS provider is locked to
the reviewed 6.56 patch line. State uses a dedicated versioned, encrypted S3
bucket with native lock files; state never enters source control.

The network spans at least two Availability Zones. RDS and workload interfaces
are private, the database is never publicly reachable, and security groups are
deny-by-default. A private workload receives no general internet route. Any
future service endpoint or egress path is added explicitly with destination,
data-class, audit, and cost controls.

Production RDS is Multi-AZ, encrypted with a customer-managed key, deletion
protected, uses RDS-managed credentials, and retains automated backups/PITR for
35 days. Development may use a single-AZ small instance, but it cannot satisfy
production SLO or disaster-recovery Evidence.

The initial cloud retention policy is:

| Data | Active retention | Backup expiry |
|---|---:|---:|
| Unpublished intent | 24 hours after expiry | 7 days |
| Metadata publication and projections | 30 days after acceptance | 35 days after active deletion |
| Idempotency record | 35 days | 35 days |
| Security and deletion audit | 365 days | 35 days after audit expiry |
| Tombstone | At least 365 days | Same as tombstone expiry |
| Quarantined invalid upload | At most 24 hours | No routine backup |

Deletion is tenant-scoped, immediately removes active protected data, installs
the minimal digest-free tombstone, propagates to all active secondary stores,
and records a bounded backup-expiry deadline. Recovery applies the live
tombstone ledger before restored data can serve traffic.

Legal hold, custom residency, per-tenant KMS keys, customer-managed keys, and
multi-region failover are unsupported in the first metadata beta. Tenant
separation uses exact tenant keys and authorization plus environment KMS keys
with tenant/resource encryption context where supported. These exclusions are
visible product constraints, not implied future guarantees.

Infrastructure creation is disabled by default. Enabling it requires an exact
AWS account allowlist, a budget alert destination and ceiling, mandatory tags,
and an explicit environment input. Production additionally fails planning
unless Multi-AZ and deletion protection controls are active.

## Alternatives considered

- AWS `us-east-1`, Google Cloud, and Microsoft Azure.
- Kubernetes/EKS instead of ECS Fargate.
- Aurora Serverless instead of RDS PostgreSQL.
- EventBridge or a streaming broker instead of SQS.
- One KMS key or database per tenant in the first beta.
- Indefinite retention, arbitrary retention classes, or immediate backup
  mutation on deletion.

## Tradeoffs

AWS-specific deployment code is isolated under tooling and adapter packages;
core remains provider-neutral. RDS and private interface endpoints create a
non-zero idle cost, so billable resources are gated and budgets are mandatory.
Single-region operation cannot claim regional failover. Time-bounded immutable
backups mean physical expiry follows active deletion rather than occurring
instantaneously.

## Consequences

Hosted adapter implementation may begin against one exact platform. The
foundation report remains `not_releasable` until deployed isolation, load,
backup, restore, deletion replay, and recovery drills pass. Local verification
continues to work during any AWS outage.

## Domain impact

None. AWS resources implement existing ports and projections. They do not add
domain statuses, reinterpret verification results, or become semantic
authority.

## Security and privacy impact

Default cloud data remains `MINIMAL_METADATA`; source, secrets, prompts,
commands, paths, raw revisions, and sensitive Evidence remain prohibited.
Encryption, private networking, tenant-scoped IAM/database access, canary
scans, deletion inventory, and restore gates are mandatory. Cloud credentials
are obtained from workload identity and never committed or stored in OpenTofu
variables.

## Compatibility and migration

Database changes use expand, compatible read/write, verified backfill, then
contract. AWS adapters implement the provider-neutral cloud ports and must pass
the same conformance suite. A future provider requires an independent adapter;
it cannot introduce provider branches into core.

## Conformance changes

CI validates formatting, initialization, provider locks, closed inputs,
account/region guards, private database posture, encryption, backup retention,
queue DLQs, object lifecycle, budget gates, and default-disabled creation.
Deployed environments additionally require tenant-isolation, secondary-sink,
load, failover, restore, tombstone replay, and cost-abuse Evidence.

## Rollback strategy

Disable cloud admission and publication while retaining local verification.
Application rollback leaves additive database schema intact. Infrastructure
destruction requires prior export/retention review, deletion completion, and
state backup; production deletion protection cannot be bypassed by automation.

## Reconsideration triggers

Measured availability, latency, compliance, residency, tenant isolation, or
cost cannot meet the frozen contracts; a second region is required; or a
second provider implementation exposes a genuinely missing provider-neutral
abstraction.

## Approval

Accepted by the founder and Lead Architect on 2026-07-26.
