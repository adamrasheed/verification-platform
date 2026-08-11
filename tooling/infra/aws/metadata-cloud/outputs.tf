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

output "migration_repository_url" {
  value = try(aws_ecr_repository.migration[0].repository_url, null)
}

output "migration_task_definition_arn" {
  value = try(aws_ecs_task_definition.migration[0].arn, null)
}

output "migration_cluster_arn" {
  value = try(aws_ecs_cluster.metadata[0].arn, null)
}

output "migration_subnet_id" {
  value = var.deployment_enabled && var.migration_runner_enabled ? aws_subnet.private[var.availability_zones[0]].id : null
}

output "migration_security_group_id" {
  value = try(aws_security_group.workload[0].id, null)
}

output "migration_log_group_name" {
  value = try(aws_cloudwatch_log_group.migration[0].name, null)
}

output "queue_runner_repository_url" {
  value = try(aws_ecr_repository.queue_runner[0].repository_url, null)
}

output "queue_runner_task_definition_arn" {
  value = try(aws_ecs_task_definition.queue_runner[0].arn, null)
}

output "queue_runner_cluster_arn" {
  value = try(aws_ecs_cluster.metadata[0].arn, null)
}

output "queue_runner_subnet_id" {
  value = var.deployment_enabled && var.queue_runner_enabled ? aws_subnet.private[var.availability_zones[0]].id : null
}

output "queue_runner_security_group_id" {
  value = try(aws_security_group.queue_runner[0].id, null)
}

output "queue_runner_log_group_name" {
  value = try(aws_cloudwatch_log_group.queue_runner[0].name, null)
}

output "control_api_runner_repository_url" {
  value = try(aws_ecr_repository.control_api_runner[0].repository_url, null)
}

output "control_api_runner_task_definition_arn" {
  value = try(aws_ecs_task_definition.control_api_runner[0].arn, null)
}

output "control_api_runner_cluster_arn" {
  value = try(aws_ecs_cluster.metadata[0].arn, null)
}

output "control_api_runner_subnet_id" {
  value = var.deployment_enabled && var.control_api_runner_enabled ? aws_subnet.private[var.availability_zones[0]].id : null
}

output "control_api_runner_security_group_id" {
  value = try(aws_security_group.control_api_runner[0].id, null)
}

output "control_api_runner_log_group_name" {
  value = try(aws_cloudwatch_log_group.control_api_runner[0].name, null)
}

output "customer_workload_runner_repository_url" {
  value = try(aws_ecr_repository.customer_workload_runner[0].repository_url, null)
}

output "customer_workload_runner_task_definition_arn" {
  value = try(aws_ecs_task_definition.customer_workload_runner[0].arn, null)
}

output "customer_workload_runner_cluster_arn" {
  value = try(aws_ecs_cluster.metadata[0].arn, null)
}

output "customer_workload_runner_subnet_id" {
  value = var.deployment_enabled && var.customer_workload_runner_enabled ? aws_subnet.private[var.availability_zones[0]].id : null
}

output "customer_workload_runner_security_group_id" {
  value = try(aws_security_group.customer_workload_runner[0].id, null)
}

output "customer_workload_runner_log_group_name" {
  value = try(aws_cloudwatch_log_group.customer_workload_runner[0].name, null)
}
