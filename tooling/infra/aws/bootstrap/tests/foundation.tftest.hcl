mock_provider "aws" {}

override_data {
  target = data.aws_iam_policy_document.state_bucket
  values = {
    json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}"
  }
}

run "creation_is_disabled_by_default" {
  command = plan

  assert {
    condition     = length(aws_s3_bucket.state) == 0 && length(aws_kms_key.state) == 0
    error_message = "Default bootstrap planning must create zero resources."
  }
}

run "explicit_bootstrap_is_bounded" {
  command = plan

  variables {
    deployment_enabled = true
    aws_account_id     = "123456789012"
    state_bucket_name  = "verification-platform-test-state"
  }

  assert {
    condition     = length(aws_s3_bucket.state) == 1 && aws_kms_key.state[0].enable_key_rotation
    error_message = "Explicit bootstrap must create one versioned state bucket and rotating key."
  }

  assert {
    condition     = aws_s3_bucket_public_access_block.state[0].restrict_public_buckets
    error_message = "State bucket must reject public access."
  }
}
