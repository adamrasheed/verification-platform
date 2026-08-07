# M9 PostgreSQL Migration Runbook

This runbook applies additive metadata-cloud migrations to the private AWS
development RDS instance without creating an internet, NAT, or public database
path.

## Authority and trigger

Only `.github/workflows/aws-postgres-migration.yml` may run the migration. The
workflow is manual, main-only, bound to the protected `development`
environment, and exchanges GitHub OIDC for the repository-scoped deployment
role. The migration image tag is the exact 40-character Git commit SHA.

## Bounded temporary topology

The workflow applies an immutable OpenTofu plan that temporarily creates:

- one KMS-encrypted, immutable-tag ECR repository;
- one Fargate task definition with a read-only root filesystem and no task
  role;
- one execution role limited to the exact image, log group, managed RDS
  credential, and KMS decrypt-through-Secrets-Manager path;
- one KMS-encrypted 30-day CloudWatch log group; and
- one-AZ interface endpoints for ECR API, ECR registry, CloudWatch Logs, and
  Secrets Manager.

The task retains the existing workload security group: PostgreSQL egress is
limited to the database security group, and TLS egress is limited to the
ephemeral endpoint security group. It has no public IP or default route. The
one-AZ endpoint placement is an explicit development cost control; AWS bills
each endpoint ENI by provisioned hour, including partial hours.

## Migration and probes

The task reads the RDS-managed credential through ECS secret injection, runs
`0001_publication_store`, and verifies the migration ledger. It then creates a
unique synthetic tenant and proves:

1. concurrent exact idempotency;
2. cross-tenant read and list isolation;
3. fenced outbox claim and acknowledgement;
4. atomic active deletion and a digest-free tombstone;
5. restore/replay denial while tombstoned;
6. 30-day active retention; and
7. 365-day tombstone retention.

Synthetic data is removed before the task emits its closed, secret-free JSON
result. A pre-existing deliverable outbox event fails the run before the probe
can claim any event.

## Cleanup and failure handling

The cleanup plan runs with `if: always()` and disables the migration runner,
which deletes the repository, endpoints, execution role, task definition, and
temporary log group. The final step requires a zero-drift plan against the
ordinary development foundation.

If cleanup or zero-drift validation fails, cloud admission remains disabled.
Rerun the workflow only after inspecting the failed GitHub run; never add a
public route or copy the database credential into GitHub to bypass a failure.
