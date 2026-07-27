locals {
  github_oidc_subject = "repo:${var.github_repository}:environment:${var.github_environment}"
}

resource "aws_iam_openid_connect_provider" "github" {
  count = var.deployment_enabled ? 1 : 0

  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

resource "aws_iam_role" "github_state" {
  count = var.deployment_enabled ? 1 : 0

  name                 = "verification-platform-github-state-${var.github_environment}"
  description          = "Repository-scoped GitHub Actions access to encrypted OpenTofu state"
  max_session_duration = 3600

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid    = "GitHubActionsEnvironment"
      Effect = "Allow"
      Principal = {
        Federated = aws_iam_openid_connect_provider.github[0].arn
      }
      Action = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = local.github_oidc_subject
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "github_state" {
  count = var.deployment_enabled ? 1 : 0

  name = "encrypted-opentofu-state-${var.github_environment}"
  role = aws_iam_role.github_state[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ReadStateBucket"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = aws_s3_bucket.state[0].arn
        Condition = {
          StringLike = {
            "s3:prefix" = [
              "metadata-cloud/${var.github_environment}.tfstate",
              "metadata-cloud/${var.github_environment}.tfstate.tflock",
            ]
          }
        }
      },
      {
        Sid    = "UseEnvironmentState"
        Effect = "Allow"
        Action = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = [
          "${aws_s3_bucket.state[0].arn}/metadata-cloud/${var.github_environment}.tfstate",
          "${aws_s3_bucket.state[0].arn}/metadata-cloud/${var.github_environment}.tfstate.tflock",
        ]
      },
      {
        Sid    = "UseStateKey"
        Effect = "Allow"
        Action = [
          "kms:Decrypt",
          "kms:DescribeKey",
          "kms:Encrypt",
          "kms:GenerateDataKey",
        ]
        Resource = aws_kms_key.state[0].arn
      },
    ]
  })
}
