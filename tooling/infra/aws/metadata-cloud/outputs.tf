output "deployment_enabled" {
  value = var.deployment_enabled
}

output "region" {
  value = var.aws_region
}

output "vpc_id" {
  value = try(aws_vpc.metadata[0].id, null)
}

output "database_endpoint" {
  value     = try(aws_db_instance.metadata[0].address, null)
  sensitive = true
}

output "database_secret_arn" {
  value     = try(aws_db_instance.metadata[0].master_user_secret[0].secret_arn, null)
  sensitive = true
}

output "queue_url" {
  value = try(aws_sqs_queue.metadata[0].url, null)
}

output "metadata_bucket" {
  value = try(aws_s3_bucket.metadata[0].id, null)
}
