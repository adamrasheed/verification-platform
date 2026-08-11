# AWS Production-Readiness Drills

The `AWS production readiness` workflow is the protected M9-T08 development
drill. It runs only from `main`, uses GitHub OIDC in the `development`
environment, and shares the mutually exclusive private PostgreSQL runner slot.

Before AWS execution, the workflow builds the exact commit and regenerates the
security report, performance report, tested npm bytes, CycloneDX SBOM, and
in-toto provenance. It then builds an immutable ECR image from the same commit
and resolves the pushed image digest.

The private Fargate task receives no AWS task identity, ingress, public address,
internet route, or writable root filesystem. It has one ephemeral `/work`
volume and exact PostgreSQL and private ECR/log/secret access. Inside that
boundary it must prove:

- at least 500 authenticated control-API samples with at least 99.9% sampled
  availability and p95 below 500 ms;
- exact recovery of accepted dispatches with no duplicate identities;
- PostgreSQL and publication-projection recovery inside the EDD RPO/RTO bounds;
- logical PostgreSQL 17 backup and restore using argv-only tools;
- replay of a post-backup tombstone before restored data becomes observable;
- bounded connection-pool recovery after forced backend termination;
- 100 hostile additive dispatches rejected as non-retryable with no durable
  rows;
- cross-tenant denial and absence of source, secret, token, body, and
  idempotency canaries from retained stores and CloudWatch; and
- complete security, SBOM, provenance, and immutable-image prerequisites.

The last CloudWatch line must be one `awsProductionReadinessEvidence` object
whose outcome and every derived check are `passed`. Cleanup drops the isolated
restore database, removes synthetic primary rows, deletes the backup scratch
file, destroys all ephemeral AWS resources, requires a zero-drift plan, and
reruns the development-foundation audit.

## Retained live result

Protected workflow run
[`31460493329`](https://github.com/adamrasheed/verification-platform/actions/runs/31460493329)
tested commit `50942841e9f8b487cacbb5ca4856635fbfa79305` on 2026-08-11.
The first Fargate launch encountered a transient private ECR image-pull timeout;
the workflow's bounded retry launched the exact same immutable task, which
completed successfully on attempt two.

The successful task measured 500 successful responses from 500 requests,
100% sampled availability, 490.488 ms p95, 5.775 s PostgreSQL/publication RPO,
449 ms PostgreSQL/publication RTO, and 39.554 ms connection recovery. All twelve
derived load, durability, recovery, tombstone, abuse, security, and supply-chain
checks passed. The workflow then destroyed all 13 ephemeral resources, restored
the one temporarily changed persistent resource, observed no remaining drift,
and passed the cleaned-foundation audit.

The machine-checkable retained result is
[`AWS_PRODUCTION_READINESS.json`](../compliance/release/AWS_PRODUCTION_READINESS.json).

This is measured development Evidence, not a claim of 99.9% monthly production
availability or a production Multi-AZ failover. Those claims remain blocked
until the separately protected production topology and observation window pass.
