mock_provider "aws" {}

override_resource {
  target = aws_kms_key.environment
  values = {
    arn    = "arn:aws:kms:us-west-2:123456789012:key/11111111-2222-3333-4444-555555555555"
    key_id = "11111111-2222-3333-4444-555555555555"
  }
}

override_resource {
  target = aws_db_instance.metadata
  values = {
    master_user_secret = [{
      kms_key_id    = "arn:aws:kms:us-west-2:123456789012:key/11111111-2222-3333-4444-555555555555"
      secret_arn    = "arn:aws:secretsmanager:us-west-2:123456789012:secret:rds!db-test"
      secret_status = "active"
    }]
  }
}

override_resource {
  target = aws_iam_role.migration_execution
  values = {
    arn = "arn:aws:iam::123456789012:role/verification-development-migration-execution"
  }
}

override_resource {
  target = aws_ecr_repository.migration
  values = {
    arn            = "arn:aws:ecr:us-west-2:123456789012:repository/verification-development-postgres-migration"
    repository_url = "123456789012.dkr.ecr.us-west-2.amazonaws.com/verification-development-postgres-migration"
  }
}

override_resource {
  target = aws_iam_role.queue_runner_execution
  values = {
    arn = "arn:aws:iam::123456789012:role/verification-development-sqs-conformance-execution"
  }
}

override_resource {
  target = aws_iam_role.queue_runner_task
  values = {
    arn = "arn:aws:iam::123456789012:role/verification-development-sqs-conformance-task"
  }
}

override_resource {
  target = aws_ecr_repository.queue_runner
  values = {
    arn            = "arn:aws:ecr:us-west-2:123456789012:repository/verification-development-sqs-conformance"
    repository_url = "123456789012.dkr.ecr.us-west-2.amazonaws.com/verification-development-sqs-conformance"
  }
}

override_resource {
  target = aws_iam_role.control_api_runner_execution
  values = {
    arn = "arn:aws:iam::123456789012:role/verification-development-control-api-conformance-execution"
  }
}

override_resource {
  target = aws_ecr_repository.control_api_runner
  values = {
    arn            = "arn:aws:ecr:us-west-2:123456789012:repository/verification-development-control-api-conformance"
    repository_url = "123456789012.dkr.ecr.us-west-2.amazonaws.com/verification-development-control-api-conformance"
  }
}

override_resource {
  target = aws_iam_role.customer_workload_runner_execution
  values = {
    arn = "arn:aws:iam::123456789012:role/verification-development-migration-execution"
  }
}

override_resource {
  target = aws_ecr_repository.customer_workload_runner
  values = {
    arn            = "arn:aws:ecr:us-west-2:123456789012:repository/verification-development-postgres-migration"
    repository_url = "123456789012.dkr.ecr.us-west-2.amazonaws.com/verification-development-postgres-migration"
  }
}

override_data {
  target = data.aws_iam_policy_document.environment_key
  values = {
    json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}"
  }
}

override_data {
  target = data.aws_iam_policy_document.protected_bucket
  values = {
    json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}"
  }
}

override_data {
  target = data.aws_iam_policy_document.s3_endpoint
  values = {
    json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}"
  }
}

override_data {
  target = data.aws_iam_policy_document.migration_task_assume
  values = {
    json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}"
  }
}

override_data {
  target = data.aws_iam_policy_document.migration_execution
  values = {
    json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}"
  }
}

override_data {
  target = data.aws_iam_policy_document.queue_runner_task_assume
  values = {
    json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}"
  }
}

override_data {
  target = data.aws_iam_policy_document.queue_runner_execution
  values = {
    json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}"
  }
}

override_data {
  target = data.aws_iam_policy_document.queue_runner_task
  values = {
    json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}"
  }
}

override_data {
  target = data.aws_iam_policy_document.control_api_runner_task_assume
  values = {
    json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}"
  }
}

override_data {
  target = data.aws_iam_policy_document.control_api_runner_execution
  values = {
    json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}"
  }
}

override_data {
  target = data.aws_iam_policy_document.customer_workload_runner_task_assume
  values = {
    json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}"
  }
}

override_data {
  target = data.aws_iam_policy_document.customer_workload_runner_execution
  values = {
    json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}"
  }
}

run "creation_is_disabled_by_default" {
  command = plan

  assert {
    condition     = length(aws_vpc.metadata) == 0 && length(aws_db_instance.metadata) == 0 && length(aws_budgets_budget.monthly) == 0
    error_message = "Default metadata-cloud planning must create zero resources."
  }
}

run "development_foundation_is_private_and_bounded" {
  command = plan

  variables {
    deployment_enabled = true
    aws_account_id     = "123456789012"
    budget_alert_email = "alerts@example.com"
  }

  assert {
    condition     = length(aws_subnet.private) == 2 && alltrue([for subnet in aws_subnet.private : !subnet.map_public_ip_on_launch])
    error_message = "Development must use exactly two private subnets."
  }

  assert {
    condition     = !aws_db_instance.metadata[0].publicly_accessible && aws_db_instance.metadata[0].backup_retention_period == 35
    error_message = "Development RDS must remain private with the bounded backup window."
  }

  assert {
    condition     = aws_db_instance.metadata[0].engine_version == "17.9"
    error_message = "Development RDS must use the reviewed PostgreSQL 17.9 engine."
  }

  assert {
    condition     = aws_sqs_queue.metadata[0].redrive_policy != null && aws_kms_key.environment[0].enable_key_rotation
    error_message = "Queue redrive and environment key rotation are mandatory."
  }

  assert {
    condition     = aws_cloudwatch_log_group.database_postgresql[0].retention_in_days == 30 && aws_cloudwatch_log_group.database_upgrade[0].retention_in_days == 30
    error_message = "RDS export logs must be explicitly managed with bounded retention."
  }

  assert {
    condition     = length(aws_ecr_repository.migration) == 0 && length(aws_vpc_endpoint.migration) == 0 && length(aws_ecs_task_definition.migration) == 0 && length(aws_ecr_repository.queue_runner) == 0 && length(aws_vpc_endpoint.queue_runner) == 0 && length(aws_ecs_task_definition.queue_runner) == 0 && length(aws_ecr_repository.control_api_runner) == 0 && length(aws_vpc_endpoint.control_api_runner) == 0 && length(aws_ecs_task_definition.control_api_runner) == 0 && length(aws_ecr_repository.customer_workload_runner) == 0 && length(aws_vpc_endpoint.customer_workload_runner) == 0 && length(aws_ecs_task_definition.customer_workload_runner) == 0
    error_message = "Ephemeral runner infrastructure must remain absent during an ordinary foundation deployment."
  }
}

run "ephemeral_customer_workload_runner_is_private_and_bounded" {
  command = plan

  variables {
    deployment_enabled                 = true
    aws_account_id                     = "123456789012"
    budget_alert_email                 = "alerts@example.com"
    customer_workload_runner_enabled   = true
    customer_workload_runner_image_tag = "dddddddddddddddddddddddddddddddddddddddd"
  }

  assert {
    condition     = length(aws_vpc_endpoint.customer_workload_runner) == 4 && alltrue([for endpoint in aws_vpc_endpoint.customer_workload_runner : length(endpoint.subnet_ids) == 1 && endpoint.private_dns_enabled])
    error_message = "The customer-workload runner requires exactly four one-AZ private service endpoints."
  }

  assert {
    condition     = length(aws_vpc_security_group_egress_rule.customer_workload_runner_to_s3) == 1 && aws_vpc_security_group_egress_rule.customer_workload_runner_to_s3[0].from_port == 443 && aws_vpc_security_group_egress_rule.customer_workload_runner_to_s3[0].to_port == 443
    error_message = "The customer-workload runner requires one bounded TLS path to the S3 gateway endpoint for ECR layers."
  }

  assert {
    condition     = length(aws_vpc_security_group_egress_rule.customer_workload_runner_to_database) == 1 && aws_vpc_security_group_egress_rule.customer_workload_runner_to_database[0].referenced_security_group_id == aws_security_group.database[0].id
    error_message = "The customer-workload runner requires one identity-bound PostgreSQL path."
  }

  assert {
    condition     = aws_ecr_repository.customer_workload_runner[0].image_tag_mutability == "IMMUTABLE" && aws_ecr_repository.customer_workload_runner[0].force_delete
    error_message = "The ephemeral customer-workload repository must use immutable tags and support automatic cleanup."
  }

  assert {
    condition     = aws_ecs_task_definition.customer_workload_runner[0].network_mode == "awsvpc" && contains(aws_ecs_task_definition.customer_workload_runner[0].requires_compatibilities, "FARGATE")
    error_message = "Customer-workload conformance must run only as a private Fargate task."
  }

  assert {
    condition     = jsondecode(aws_ecs_task_definition.customer_workload_runner[0].container_definitions)[0].readonlyRootFilesystem && jsondecode(aws_ecs_task_definition.customer_workload_runner[0].container_definitions)[0].mountPoints[0].containerPath == "/work" && !jsondecode(aws_ecs_task_definition.customer_workload_runner[0].container_definitions)[0].mountPoints[0].readOnly
    error_message = "The customer-workload runner requires a read-only root and one bounded writable scratch mount."
  }

  assert {
    condition     = aws_ecs_task_definition.customer_workload_runner[0].task_role_arn == null
    error_message = "The customer-workload process must receive no AWS task credentials."
  }
}

run "customer_workload_runner_namespace_is_exclusive" {
  command = plan

  variables {
    deployment_enabled                 = true
    aws_account_id                     = "123456789012"
    budget_alert_email                 = "alerts@example.com"
    control_api_runner_enabled         = true
    control_api_runner_image_tag       = "cccccccccccccccccccccccccccccccccccccccc"
    customer_workload_runner_enabled   = true
    customer_workload_runner_image_tag = "dddddddddddddddddddddddddddddddddddddddd"
  }

  expect_failures = [var.customer_workload_runner_enabled]
}

run "ephemeral_control_api_runner_is_private_and_bounded" {
  command = plan

  variables {
    deployment_enabled           = true
    aws_account_id               = "123456789012"
    budget_alert_email           = "alerts@example.com"
    control_api_runner_enabled   = true
    control_api_runner_image_tag = "cccccccccccccccccccccccccccccccccccccccc"
  }

  assert {
    condition     = length(aws_vpc_endpoint.control_api_runner) == 4 && alltrue([for endpoint in aws_vpc_endpoint.control_api_runner : length(endpoint.subnet_ids) == 1 && endpoint.private_dns_enabled])
    error_message = "The control API runner requires exactly four one-AZ private service endpoints."
  }

  assert {
    condition     = length(aws_vpc_security_group_egress_rule.control_api_runner_to_s3) == 1 && aws_vpc_security_group_egress_rule.control_api_runner_to_s3[0].from_port == 443 && aws_vpc_security_group_egress_rule.control_api_runner_to_s3[0].to_port == 443
    error_message = "The control API runner requires one bounded TLS path to the S3 gateway endpoint for ECR layers."
  }

  assert {
    condition     = length(aws_vpc_security_group_egress_rule.control_api_runner_to_endpoints) == 1 && aws_vpc_security_group_egress_rule.control_api_runner_to_endpoints[0].cidr_ipv4 == var.vpc_cidr && aws_vpc_security_group_egress_rule.control_api_runner_to_endpoints[0].from_port == 443 && aws_vpc_security_group_egress_rule.control_api_runner_to_endpoints[0].to_port == 443
    error_message = "The control API runner requires one VPC-bounded TLS path to private interface endpoints."
  }

  assert {
    condition     = length(aws_vpc_security_group_egress_rule.control_api_runner_to_database) == 1 && aws_vpc_security_group_egress_rule.control_api_runner_to_database[0].referenced_security_group_id == aws_security_group.database[0].id
    error_message = "The control API runner requires one identity-bound PostgreSQL path."
  }

  assert {
    condition     = aws_ecr_repository.control_api_runner[0].image_tag_mutability == "IMMUTABLE" && aws_ecr_repository.control_api_runner[0].force_delete
    error_message = "The ephemeral control API repository must use immutable tags and support automatic cleanup."
  }

  assert {
    condition     = aws_ecs_task_definition.control_api_runner[0].network_mode == "awsvpc" && contains(aws_ecs_task_definition.control_api_runner[0].requires_compatibilities, "FARGATE")
    error_message = "Control API conformance must run only as a private Fargate task."
  }

  assert {
    condition     = jsondecode(aws_ecs_task_definition.control_api_runner[0].container_definitions)[0].readonlyRootFilesystem && aws_cloudwatch_log_group.control_api_runner[0].retention_in_days == 30
    error_message = "The control API runner must be read-only with bounded encrypted logs."
  }

  assert {
    condition     = aws_ecs_task_definition.control_api_runner[0].task_role_arn == null
    error_message = "The control API conformance process must receive no AWS task credentials."
  }
}

run "private_postgres_runner_namespace_is_exclusive" {
  command = plan

  variables {
    deployment_enabled           = true
    aws_account_id               = "123456789012"
    budget_alert_email           = "alerts@example.com"
    migration_runner_enabled     = true
    migration_image_tag          = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    control_api_runner_enabled   = true
    control_api_runner_image_tag = "cccccccccccccccccccccccccccccccccccccccc"
  }

  expect_failures = [var.control_api_runner_enabled]
}

run "ephemeral_sqs_runner_is_private_and_bounded" {
  command = plan

  variables {
    deployment_enabled     = true
    aws_account_id         = "123456789012"
    budget_alert_email     = "alerts@example.com"
    queue_runner_enabled   = true
    queue_runner_image_tag = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  }

  assert {
    condition     = length(aws_vpc_endpoint.queue_runner) == 5 && alltrue([for endpoint in aws_vpc_endpoint.queue_runner : length(endpoint.subnet_ids) == 1 && endpoint.private_dns_enabled])
    error_message = "The SQS runner requires exactly five one-AZ private service endpoints."
  }

  assert {
    condition     = length(aws_vpc_security_group_egress_rule.queue_runner_to_s3) == 1 && aws_vpc_security_group_egress_rule.queue_runner_to_s3[0].from_port == 443 && aws_vpc_security_group_egress_rule.queue_runner_to_s3[0].to_port == 443
    error_message = "The SQS runner requires one bounded TLS path to the S3 gateway endpoint for ECR layers."
  }

  assert {
    condition     = length(aws_vpc_security_group_egress_rule.queue_runner_to_endpoints) == 1 && aws_vpc_security_group_egress_rule.queue_runner_to_endpoints[0].referenced_security_group_id == aws_security_group.queue_runner_endpoints[0].id && aws_vpc_security_group_egress_rule.queue_runner_to_endpoints[0].from_port == 443 && aws_vpc_security_group_egress_rule.queue_runner_to_endpoints[0].to_port == 443
    error_message = "The SQS runner requires one identity-bound TLS path to private interface endpoints."
  }

  assert {
    condition     = aws_ecr_repository.queue_runner[0].image_tag_mutability == "IMMUTABLE" && aws_ecr_repository.queue_runner[0].force_delete
    error_message = "The ephemeral SQS repository must use immutable tags and support automatic cleanup."
  }

  assert {
    condition     = aws_ecs_task_definition.queue_runner[0].network_mode == "awsvpc" && contains(aws_ecs_task_definition.queue_runner[0].requires_compatibilities, "FARGATE")
    error_message = "SQS conformance must run only as a private Fargate task."
  }

  assert {
    condition     = jsondecode(aws_ecs_task_definition.queue_runner[0].container_definitions)[0].readonlyRootFilesystem && aws_cloudwatch_log_group.queue_runner[0].retention_in_days == 30
    error_message = "The SQS runner must be read-only with bounded encrypted logs."
  }

  assert {
    condition     = aws_ecs_task_definition.queue_runner[0].task_role_arn == aws_iam_role.queue_runner_task[0].arn
    error_message = "The SQS runner requires its exact least-privilege task identity."
  }
}

run "ephemeral_migration_runner_is_private_and_bounded" {
  command = plan

  variables {
    deployment_enabled       = true
    aws_account_id           = "123456789012"
    budget_alert_email       = "alerts@example.com"
    migration_runner_enabled = true
    migration_image_tag      = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }

  assert {
    condition     = length(aws_vpc_endpoint.migration) == 4 && alltrue([for endpoint in aws_vpc_endpoint.migration : length(endpoint.subnet_ids) == 1 && endpoint.private_dns_enabled])
    error_message = "The migration runner requires exactly four one-AZ private service endpoints."
  }

  assert {
    condition     = length(aws_vpc_security_group_egress_rule.migration_to_s3) == 1 && aws_vpc_security_group_egress_rule.migration_to_s3[0].from_port == 443 && aws_vpc_security_group_egress_rule.migration_to_s3[0].to_port == 443
    error_message = "The migration runner requires one bounded TLS path to the S3 gateway endpoint for ECR layers."
  }

  assert {
    condition     = length(aws_vpc_security_group_egress_rule.migration_to_endpoints) == 1 && aws_vpc_security_group_egress_rule.migration_to_endpoints[0].cidr_ipv4 == var.vpc_cidr && aws_vpc_security_group_egress_rule.migration_to_endpoints[0].from_port == 443 && aws_vpc_security_group_egress_rule.migration_to_endpoints[0].to_port == 443
    error_message = "The migration runner requires one VPC-bounded TLS path to its private interface endpoints."
  }

  assert {
    condition     = aws_ecr_repository.migration[0].image_tag_mutability == "IMMUTABLE" && aws_ecr_repository.migration[0].force_delete
    error_message = "The ephemeral migration repository must use immutable tags and support automatic cleanup."
  }

  assert {
    condition     = aws_ecs_task_definition.migration[0].network_mode == "awsvpc" && contains(aws_ecs_task_definition.migration[0].requires_compatibilities, "FARGATE")
    error_message = "The migration must run only as a private Fargate task."
  }

  assert {
    condition     = jsondecode(aws_ecs_task_definition.migration[0].container_definitions)[0].readonlyRootFilesystem && aws_cloudwatch_log_group.migration[0].retention_in_days == 30
    error_message = "The migration container must be read-only and retain encrypted logs for 30 days while active."
  }
}

run "production_rejects_single_az" {
  command = plan

  variables {
    deployment_enabled = true
    aws_account_id     = "123456789012"
    budget_alert_email = "alerts@example.com"
    environment        = "production"
    database_multi_az  = false
  }

  expect_failures = [aws_db_instance.metadata]
}

run "production_enforces_multi_az_and_deletion_protection" {
  command = plan

  variables {
    deployment_enabled = true
    aws_account_id     = "123456789012"
    budget_alert_email = "alerts@example.com"
    environment        = "production"
    database_multi_az  = true
  }

  assert {
    condition     = aws_db_instance.metadata[0].multi_az && aws_db_instance.metadata[0].deletion_protection && !aws_db_instance.metadata[0].skip_final_snapshot
    error_message = "Production must be Multi-AZ, deletion protected, and retain a final snapshot."
  }
}
