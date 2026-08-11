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

This is measured development Evidence, not a claim of 99.9% monthly production
availability or a production Multi-AZ failover. Those claims remain blocked
until the separately protected production topology and observation window pass.
