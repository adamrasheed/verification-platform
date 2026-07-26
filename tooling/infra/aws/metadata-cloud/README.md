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
