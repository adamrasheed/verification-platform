# AWS Customer Workload Conformance

The protected `AWS customer workload conformance` workflow is the M9-T07
deployment gate. It is main-only, uses GitHub OIDC in the `development`
environment, and runs the customer-owned GitHub workload adapter from the exact
Git commit under test. A local test, OpenTofu plan, or container build is not
live Evidence.

The probe creates one short-lived private Fargate task with no ingress, public
address, internet route, NAT gateway, AWS task role, or writable root
filesystem. Its writable `/work` volume is ephemeral. Network egress is limited
to PostgreSQL on port 5432, exact private ECR, CloudWatch Logs, and Secrets
Manager endpoints, plus the regional S3 gateway used for ECR layers.
PostgreSQL uses hostname-verifying TLS and the pinned official `us-west-2` RDS
CA bundle.

The customer-workload, control-API, and PostgreSQL migration workflows share
one GitHub concurrency group and one ephemeral AWS namespace. The existing
bounded deployment role can therefore manage the probe without new persistent
privileges, while mutually exclusive runner flags prevent namespace collision.

Against real private PostgreSQL and the real authenticated HTTP publication
boundary, the probe proves:

- exact `workload:github:<owner>/<repository>` offer binding and wrong-repository
  rejection;
- execution through the canonical offline Engine with a copied synthetic
  checkout;
- durable fenced heartbeats that remain active through slow publication;
- publication of only a validated `MetadataPublicationPayload`, without the
  request, lease envelope, source tree, or local revision;
- completion by immutable publication reference rather than uploaded source;
- forwarded cancellation with terminal acknowledgement and no publication;
- cross-tenant reads that reveal no protected existence; and
- absence of the source canary in PostgreSQL and CloudWatch Logs.

The final CloudWatch line must be one `awsCustomerWorkloadEvidence` JSON object
whose outcome and every check are `passed`. The task removes all synthetic rows
in a `finally` path. The workflow then destroys its ECR repository, endpoints,
security groups, execution role, task definition, and log group before requiring
a zero-drift plan and a clean development-foundation audit.

If the workflow fails, inspect only the bounded task exit reason and log stream,
then verify cleanup, zero drift, and the foundation audit. Never enable
`customer_workload_runner_enabled` outside the protected workflow. Failed
cleanup is an operational incident because it can retain billable resources or
test-only access paths.
