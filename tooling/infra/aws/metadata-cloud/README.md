# AWS Metadata Cloud Foundation

This OpenTofu root implements ADR-0013 in `us-west-2`. It creates no resources
with defaults: `deployment_enabled` is `false`, account and budget inputs are
empty, and every remote resource is gated.

The initial root provides an isolated two-AZ VPC, environment KMS key, private
RDS PostgreSQL, encrypted SQS/DLQ, protected metadata and quarantine buckets,
bounded logs, an ECS cluster, and a tagged monthly budget. It deliberately does
not deploy an API, worker task, internet route, NAT gateway, legal hold,
multi-region failover, or product-hosted source execution.

Initialize with the encrypted backend created by `../bootstrap` and a protected
backend configuration. Run `tofu plan` only after verifying the AWS identity
and supplying exact account, environment, budget email, and ceiling inputs.
Production planning requires `database_multi_az=true`; database deletion
protection and final snapshots are enforced by configuration.

No plan or apply output is release Evidence. Deployed adapter, isolation,
secondary-sink, load, restore, tombstone-replay, recovery, and cost-abuse drills
must pass before the foundation report can become releasable.

`queue_runner_enabled=true` temporarily adds the exact private endpoints,
least-privilege IAM roles, immutable ECR repository, encrypted log group, and
read-only Fargate task definition used by the protected M9-T05 SQS run. The
runner can reach only PostgreSQL, the regional ECR/log/secret/SQS endpoints,
and the S3 gateway used for ECR layers. The workflow always replans with the
flag disabled, removes every runner resource, and requires a final zero-drift
plan.
