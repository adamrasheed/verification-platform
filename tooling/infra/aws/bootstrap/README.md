# AWS State Bootstrap

This root creates only the versioned, KMS-encrypted S3 backend required by
ADR-0013. Creation defaults off and the bucket/key are protected from destroy.

Run `tofu init` and `tofu plan` with explicit `deployment_enabled=true`, exact
AWS account ID, and a globally unique bucket name. Apply from a protected
founder session only after `aws sts get-caller-identity` matches the allowlist.
The resulting backend values configure `../metadata-cloud`; never commit local
state, plan files, credentials, or backend configuration containing account
details.
