data "aws_iam_policy_document" "environment_key" {
  count = var.deployment_enabled ? 1 : 0

  statement {
    sid       = "AccountAdministration"
    effect    = "Allow"
    actions   = ["kms:*"]
    resources = ["*"]

    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${var.aws_account_id}:root"]
    }
  }

  statement {
    sid    = "EncryptedCloudWatchLogs"
    effect = "Allow"
    actions = [
      "kms:Encrypt", "kms:Decrypt", "kms:ReEncrypt*", "kms:GenerateDataKey*", "kms:DescribeKey"
    ]
    resources = ["*"]

    principals {
      type        = "Service"
      identifiers = ["logs.${var.aws_region}.amazonaws.com"]
    }

    condition {
      test     = "ArnLike"
      variable = "kms:EncryptionContext:aws:logs:arn"
      values = [
        "arn:aws:logs:${var.aws_region}:${var.aws_account_id}:log-group:/verification/${var.environment}/*",
        "arn:aws:logs:${var.aws_region}:${var.aws_account_id}:log-group:/aws/rds/instance/${local.name}-postgres/*",
      ]
    }
  }
}

resource "aws_kms_key" "environment" {
  count = var.deployment_enabled ? 1 : 0

  description             = "${local.name} metadata-cloud encryption"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  policy                  = data.aws_iam_policy_document.environment_key[0].json
}

resource "aws_kms_alias" "environment" {
  count = var.deployment_enabled ? 1 : 0

  name          = "alias/${local.name}-metadata"
  target_key_id = aws_kms_key.environment[0].key_id
}

resource "aws_security_group" "database" {
  count = var.deployment_enabled ? 1 : 0

  name        = "${local.name}-database"
  description = "PostgreSQL only from the metadata workload identity"
  vpc_id      = aws_vpc.metadata[0].id
}

resource "aws_security_group" "workload" {
  count = var.deployment_enabled ? 1 : 0

  name        = "${local.name}-workload"
  description = "No ambient ingress or internet egress"
  vpc_id      = aws_vpc.metadata[0].id
}

resource "aws_vpc_security_group_ingress_rule" "database_from_workload" {
  count = var.deployment_enabled ? 1 : 0

  security_group_id            = aws_security_group.database[0].id
  referenced_security_group_id = aws_security_group.workload[0].id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
  description                  = "Exact PostgreSQL path from workload"
}

resource "aws_vpc_security_group_egress_rule" "workload_to_database" {
  count = var.deployment_enabled ? 1 : 0

  security_group_id            = aws_security_group.workload[0].id
  referenced_security_group_id = aws_security_group.database[0].id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
  description                  = "Exact PostgreSQL path to database"
}
