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
    key          = "metadata-cloud/dev.tfstate"
    region       = var.aws_region
    encrypt      = true
    kms_key_id   = aws_kms_key.state[0].arn
    use_lockfile = true
  } : null
}
