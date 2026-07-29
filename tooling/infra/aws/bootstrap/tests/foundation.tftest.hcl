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

  assert {
    condition     = length(aws_iam_openid_connect_provider.github) == 0 && length(aws_iam_role.github_state) == 0 && length(aws_iam_role.github_deploy) == 0
    error_message = "Default bootstrap planning must create no deployment identity."
  }
}

run "explicit_bootstrap_is_bounded" {
  command = plan

  variables {
    deployment_enabled = true
    aws_account_id     = "123456789012"
    state_bucket_name  = "verification-platform-test-state"
    budget_alert_email = "alerts@example.com"
  }

  assert {
    condition     = length(aws_s3_bucket.state) == 1 && aws_kms_key.state[0].enable_key_rotation
    error_message = "Explicit bootstrap must create one versioned state bucket and rotating key."
  }

  assert {
    condition     = aws_s3_bucket_public_access_block.state[0].restrict_public_buckets
    error_message = "State bucket must reject public access."
  }

  assert {
    condition     = aws_budgets_budget.account[0].limit_amount == "100"
    error_message = "Bootstrap must create the approved 100 USD monthly budget."
  }

  assert {
    condition     = jsondecode(aws_iam_role.github_state[0].assume_role_policy).Statement[0].Condition.StringEquals["token.actions.githubusercontent.com:sub"] == "repo:adamrasheed@10425543/verification-platform@1305420403:environment:development"
    error_message = "The GitHub role must trust only the immutable repository development environment."
  }

  assert {
    condition     = jsondecode(aws_iam_role.github_state[0].assume_role_policy).Statement[0].Condition.StringEquals["token.actions.githubusercontent.com:aud"] == "sts.amazonaws.com"
    error_message = "The GitHub role must require the AWS STS audience."
  }

  assert {
    condition     = aws_iam_role.github_deploy[0].assume_role_policy == aws_iam_role.github_state[0].assume_role_policy
    error_message = "State and deployment roles must share the exact immutable OIDC trust boundary."
  }

  assert {
    condition     = !strcontains(aws_iam_role_policy.github_deploy[0].policy, "iam:*") && !strcontains(aws_iam_role_policy.github_deploy[0].policy, "AdministratorAccess")
    error_message = "The deployment role must not receive IAM administration or administrator access."
  }
}
