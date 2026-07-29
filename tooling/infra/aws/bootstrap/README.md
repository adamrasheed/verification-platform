# AWS State Bootstrap

This root creates the versioned, KMS-encrypted S3 backend and repository-scoped
GitHub Actions OIDC state role required by ADR-0013. Creation defaults off and
the bucket/key are protected from destroy. The role trusts only the immutable
GitHub owner/repository IDs for the `development` environment subject and can
access only that environment's state object and KMS key. An account-level
monthly budget with forecasted 50%, actual 80%, and actual 100% alerts is
created before the persistent state key.

Run `tofu init` and `tofu plan` with explicit `deployment_enabled=true`, exact
AWS account ID, and a globally unique bucket name. Apply from a protected
founder session only after `aws sts get-caller-identity` matches the allowlist.
The resulting backend values configure `../metadata-cloud`. Create from an
isolated temporary working copy, then add an S3 backend block there and migrate
bootstrap state into the same backend under `bootstrap/bootstrap.tfstate`.
Retain a versioned encrypted recovery copy and record an audit Evidence
artifact. Never commit local state, plan files, credentials, or backend
configuration containing account details. GitHub jobs must request
`id-token: write`, run in the protected `development` environment, and exchange
OIDC for the output state-role ARN.
