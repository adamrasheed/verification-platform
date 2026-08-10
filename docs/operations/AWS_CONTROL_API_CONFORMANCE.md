# AWS Control API Conformance

The protected `AWS control API conformance` workflow is the M9-T06 deployment
gate. It is main-only, uses GitHub OIDC in the `development` environment, and
creates a short-lived private Fargate runner from the exact Git commit under
test. Do not interpret a local test, OpenTofu plan, or image build as live
Evidence.

The runner has no ingress, public address, internet route, NAT gateway, or AWS
task credentials. Its only egress is PostgreSQL on port 5432, TLS to exact
private ECR/log/secret endpoints, and TLS to the regional S3 gateway for ECR
layers. PostgreSQL requires hostname verification against the checked regional
RDS trust bundle. The image uses an immutable commit tag and a read-only root
filesystem.

The control API and PostgreSQL migration workflows share one GitHub concurrency
group and one ephemeral AWS runner namespace. This lets the existing bounded
deployment role manage the probe without broadening account bootstrap policy;
the two operations cannot create that namespace concurrently.

The live probe creates ephemeral Ed25519 identity and intent-signing keys and a
synthetic tenant. Through the real Node HTTP boundary it proves:

- closed identity verification, audience binding, expiry, and revocation;
- exact principal/action/tenant/resource grants with cross-tenant and IDOR
  responses that reveal no protected existence;
- transactional, concurrent-safe publication-intent idempotency;
- publication admission and replay through the PostgreSQL projection store;
- tenant-bounded list and read operations; and
- authorization and operation audit rows with no token, secret, request body,
  manifest, payload, or body canary.

The final CloudWatch line must be one `awsControlApiEvidence` JSON object whose
outcome and every check are `passed`. The task deletes all synthetic rows in a
`finally` path. The workflow then destroys its ECR repository, endpoints,
security groups, roles, task definition, and log group before requiring a
zero-drift plan against the ordinary development foundation.

If the workflow fails, inspect the Fargate exit code and bounded log stream,
then verify the cleanup and zero-drift steps. Never bypass cleanup by applying
with `control_api_runner_enabled=true` outside the protected workflow. A failed
cleanup is an operational incident because it can leave billable resources or
test-only access paths active.
