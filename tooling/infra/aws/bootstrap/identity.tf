locals {
  github_oidc_subject = "${var.github_oidc_subject_prefix}:environment:${var.github_environment}"
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

resource "aws_iam_role" "github_deploy" {
  count = var.deployment_enabled ? 1 : 0

  name                 = "verification-platform-github-deploy-${var.github_environment}"
  description          = "Repository-scoped GitHub Actions deployment for the development metadata cloud"
  max_session_duration = 3600
  assume_role_policy   = aws_iam_role.github_state[0].assume_role_policy
}

resource "aws_iam_role_policy" "github_deploy" {
  count = var.deployment_enabled ? 1 : 0

  name = "metadata-cloud-${var.github_environment}"
  role = aws_iam_role.github_deploy[0].id
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
      {
        Sid    = "ReadDevelopmentFoundation"
        Effect = "Allow"
        Action = [
          "budgets:DescribeBudget",
          "ec2:DescribeAvailabilityZones",
          "ec2:DescribePrefixLists",
          "ec2:DescribeRouteTables",
          "ec2:DescribeSecurityGroupRules",
          "ec2:DescribeSecurityGroups",
          "ec2:DescribeSubnets",
          "ec2:DescribeVpcAttribute",
          "ec2:DescribeVpcEndpoints",
          "ec2:DescribeVpcs",
          "ecs:DescribeClusters",
          "kms:DescribeKey",
          "kms:GetKeyPolicy",
          "kms:GetKeyRotationStatus",
          "kms:ListAliases",
          "kms:ListResourceTags",
          "logs:DescribeLogGroups",
          "rds:DescribeDBInstances",
          "rds:DescribeDBParameterGroups",
          "rds:DescribeDBParameters",
          "rds:DescribeDBSubnetGroups",
        ]
        Resource = "*"
      },
      {
        Sid    = "ManageRegionalDevelopmentFoundation"
        Effect = "Allow"
        Action = [
          "ec2:AssociateRouteTable",
          "ec2:CreateRouteTable",
          "ec2:CreateSecurityGroup",
          "ec2:CreateSubnet",
          "ec2:CreateTags",
          "ec2:CreateVpc",
          "ec2:CreateVpcEndpoint",
          "ec2:DeleteRouteTable",
          "ec2:DeleteSecurityGroup",
          "ec2:DeleteSubnet",
          "ec2:DeleteVpc",
          "ec2:DeleteVpcEndpoints",
          "ec2:DisassociateRouteTable",
          "ec2:ModifySubnetAttribute",
          "ec2:ModifyVpcAttribute",
          "ec2:ModifyVpcEndpoint",
          "ec2:RevokeSecurityGroupEgress",
          "ec2:RevokeSecurityGroupIngress",
          "ec2:AuthorizeSecurityGroupEgress",
          "ec2:AuthorizeSecurityGroupIngress",
          "ec2:ModifySecurityGroupRules",
          "ecs:CreateCluster",
          "ecs:DeleteCluster",
          "ecs:PutClusterCapacityProviders",
          "ecs:TagResource",
          "ecs:UntagResource",
          "kms:CreateAlias",
          "kms:CreateGrant",
          "kms:CreateKey",
          "kms:Decrypt",
          "kms:DeleteAlias",
          "kms:DisableKey",
          "kms:Encrypt",
          "kms:EnableKeyRotation",
          "kms:GenerateDataKey",
          "kms:PutKeyPolicy",
          "kms:ReEncryptFrom",
          "kms:ReEncryptTo",
          "kms:ScheduleKeyDeletion",
          "kms:TagResource",
          "kms:UntagResource",
          "kms:UpdateAlias",
          "kms:UpdateKeyDescription",
          "logs:AssociateKmsKey",
          "logs:CreateLogGroup",
          "logs:DeleteLogGroup",
          "logs:ListTagsForResource",
          "logs:PutRetentionPolicy",
          "logs:TagResource",
          "logs:UntagResource",
          "rds:AddTagsToResource",
          "rds:CreateDBInstance",
          "rds:CreateDBParameterGroup",
          "rds:CreateDBSubnetGroup",
          "rds:DeleteDBInstance",
          "rds:DeleteDBParameterGroup",
          "rds:DeleteDBSubnetGroup",
          "rds:ListTagsForResource",
          "rds:ModifyDBInstance",
          "rds:ModifyDBParameterGroup",
          "rds:ModifyDBSubnetGroup",
          "rds:RemoveTagsFromResource",
          "rds:RebootDBInstance",
          "sqs:CreateQueue",
          "sqs:DeleteQueue",
          "sqs:SetQueueAttributes",
          "sqs:TagQueue",
          "sqs:UntagQueue",
        ]
        Resource = "*"
        Condition = {
          StringEquals = {
            "aws:RequestedRegion" = var.aws_region
          }
        }
      },
      {
        Sid    = "ManageDevelopmentBuckets"
        Effect = "Allow"
        Action = [
          "s3:CreateBucket",
          "s3:DeleteBucket",
          "s3:DeleteBucketPolicy",
          "s3:GetAccelerateConfiguration",
          "s3:GetBucketAcl",
          "s3:GetBucketCORS",
          "s3:GetBucketLifecycleConfiguration",
          "s3:GetBucketLogging",
          "s3:GetBucketObjectLockConfiguration",
          "s3:GetBucketOwnershipControls",
          "s3:GetBucketPolicy",
          "s3:GetBucketPublicAccessBlock",
          "s3:GetBucketRequestPayment",
          "s3:GetBucketTagging",
          "s3:GetBucketVersioning",
          "s3:GetBucketWebsite",
          "s3:GetEncryptionConfiguration",
          "s3:GetLifecycleConfiguration",
          "s3:GetReplicationConfiguration",
          "s3:ListBucket",
          "s3:PutBucketLifecycleConfiguration",
          "s3:PutLifecycleConfiguration",
          "s3:PutBucketPolicy",
          "s3:PutBucketPublicAccessBlock",
          "s3:PutBucketTagging",
          "s3:PutBucketVersioning",
          "s3:PutEncryptionConfiguration",
          "s3:PutBucketOwnershipControls",
          "s3:DeleteBucketOwnershipControls",
        ]
        Resource = [
          "arn:aws:s3:::verification-${var.github_environment}-${var.aws_account_id}-metadata",
          "arn:aws:s3:::verification-${var.github_environment}-${var.aws_account_id}-quarantine",
        ]
      },
      {
        Sid      = "ManageDevelopmentBudget"
        Effect   = "Allow"
        Action   = ["budgets:CreateBudget", "budgets:DeleteBudget", "budgets:DescribeBudget", "budgets:ModifyBudget", "budgets:TagResource", "budgets:UntagResource", "budgets:ViewBudget"]
        Resource = "arn:aws:budgets::${var.aws_account_id}:budget/verification-${var.github_environment}-monthly"
      },
      {
        Sid    = "ReadDevelopmentQueues"
        Effect = "Allow"
        Action = ["sqs:GetQueueAttributes", "sqs:GetQueueUrl", "sqs:ListQueueTags"]
        Resource = [
          "arn:aws:sqs:${var.aws_region}:${var.aws_account_id}:verification-${var.github_environment}-metadata",
          "arn:aws:sqs:${var.aws_region}:${var.aws_account_id}:verification-${var.github_environment}-metadata-dead-letter",
        ]
      },
    ]
  })
}
