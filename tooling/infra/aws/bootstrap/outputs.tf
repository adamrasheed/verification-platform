output "state_bucket_name" {
  description = "Remote-state bucket for backend configuration."
  value       = try(aws_s3_bucket.state[0].id, null)
}

output "state_kms_key_arn" {
  description = "KMS key used by the remote-state backend."
  value       = try(aws_kms_key.state[0].arn, null)
}

output "backend_example" {
  description = "Non-secret backend settings; use_lockfile provides native S3 locking."
  value = var.deployment_enabled ? {
    bucket       = aws_s3_bucket.state[0].id
    key          = "metadata-cloud/${var.github_environment}.tfstate"
    region       = var.aws_region
    encrypt      = true
    kms_key_id   = aws_kms_key.state[0].arn
    use_lockfile = true
  } : null
}

output "github_oidc_provider_arn" {
  description = "GitHub Actions OIDC provider created in the target account."
  value       = try(aws_iam_openid_connect_provider.github[0].arn, null)
}

output "github_state_role_arn" {
  description = "Short-lived identity for repository-scoped remote-state access."
  value       = try(aws_iam_role.github_state[0].arn, null)
}

output "github_deploy_role_arn" {
  description = "Short-lived identity for the bounded development metadata-cloud deployment."
  value       = try(aws_iam_role.github_deploy[0].arn, null)
}

output "github_oidc_subject" {
  description = "Exact GitHub Actions subject accepted by the state role."
  value       = var.deployment_enabled ? local.github_oidc_subject : null
}
