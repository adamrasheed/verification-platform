resource "aws_cloudwatch_log_group" "api" {
  count = var.deployment_enabled ? 1 : 0

  name              = "/verification/${var.environment}/api"
  retention_in_days = 30
  kms_key_id        = aws_kms_key.environment[0].arn
}

resource "aws_cloudwatch_log_group" "worker" {
  count = var.deployment_enabled ? 1 : 0

  name              = "/verification/${var.environment}/worker"
  retention_in_days = 30
  kms_key_id        = aws_kms_key.environment[0].arn
}

resource "aws_cloudwatch_log_group" "database_postgresql" {
  count = var.deployment_enabled ? 1 : 0

  name              = "/aws/rds/instance/${local.name}-postgres/postgresql"
  retention_in_days = 30
  kms_key_id        = aws_kms_key.environment[0].arn
}

resource "aws_cloudwatch_log_group" "database_upgrade" {
  count = var.deployment_enabled ? 1 : 0

  name              = "/aws/rds/instance/${local.name}-postgres/upgrade"
  retention_in_days = 30
  kms_key_id        = aws_kms_key.environment[0].arn
}

resource "aws_ecs_cluster" "metadata" {
  count = var.deployment_enabled ? 1 : 0

  name = "${local.name}-metadata"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  configuration {
    execute_command_configuration {
      kms_key_id = aws_kms_key.environment[0].arn
      logging    = "OVERRIDE"

      log_configuration {
        cloud_watch_encryption_enabled = true
        cloud_watch_log_group_name     = aws_cloudwatch_log_group.api[0].name
      }
    }
  }
}
