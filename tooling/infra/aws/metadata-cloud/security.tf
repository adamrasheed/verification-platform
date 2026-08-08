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

resource "aws_security_group" "migration_endpoints" {
  count = var.deployment_enabled ? (var.migration_runner_enabled ? 1 : 0) : 0

  name        = "${local.name}-migration-endpoints"
  description = "Ephemeral TLS endpoints for the bounded database migration"
  vpc_id      = aws_vpc.metadata[0].id

  tags = { CostControl = "ephemeral-migration" }
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

resource "aws_vpc_security_group_ingress_rule" "migration_endpoints_from_workload" {
  count = var.deployment_enabled ? (var.migration_runner_enabled ? 1 : 0) : 0

  security_group_id            = aws_security_group.migration_endpoints[0].id
  referenced_security_group_id = aws_security_group.workload[0].id
  from_port                    = 443
  to_port                      = 443
  ip_protocol                  = "tcp"
  description                  = "TLS only from the ephemeral migration task"
}

resource "aws_vpc_security_group_egress_rule" "migration_to_endpoints" {
  count = var.deployment_enabled ? (var.migration_runner_enabled ? 1 : 0) : 0

  security_group_id            = aws_security_group.workload[0].id
  referenced_security_group_id = aws_security_group.migration_endpoints[0].id
  from_port                    = 443
  to_port                      = 443
  ip_protocol                  = "tcp"
  description                  = "TLS only to ephemeral AWS service endpoints"
}

resource "aws_vpc_security_group_egress_rule" "migration_to_s3" {
  count = var.deployment_enabled ? (var.migration_runner_enabled ? 1 : 0) : 0

  security_group_id = aws_security_group.workload[0].id
  prefix_list_id    = aws_vpc_endpoint.s3[0].prefix_list_id
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
  description       = "TLS only to S3 for ephemeral ECR image layers"
}
