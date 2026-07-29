mock_provider "aws" {}

override_resource {
  target = aws_kms_key.environment
  values = {
    arn    = "arn:aws:kms:us-west-2:123456789012:key/11111111-2222-3333-4444-555555555555"
    key_id = "11111111-2222-3333-4444-555555555555"
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
    condition     = aws_sqs_queue.metadata[0].redrive_policy != null && aws_kms_key.environment[0].enable_key_rotation
    error_message = "Queue redrive and environment key rotation are mandatory."
  }

  assert {
    condition     = aws_cloudwatch_log_group.database_postgresql[0].retention_in_days == 30 && aws_cloudwatch_log_group.database_upgrade[0].retention_in_days == 30
    error_message = "RDS export logs must be explicitly managed with bounded retention."
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
