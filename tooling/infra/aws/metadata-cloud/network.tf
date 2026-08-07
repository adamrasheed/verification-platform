resource "aws_vpc" "metadata" {
  count = var.deployment_enabled ? 1 : 0

  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = "${local.name}-vpc" }
}

resource "aws_subnet" "private" {
  for_each = var.deployment_enabled ? local.private_subnets : {}

  vpc_id                  = aws_vpc.metadata[0].id
  availability_zone       = each.key
  cidr_block              = each.value
  map_public_ip_on_launch = false

  tags = {
    Name = "${local.name}-private-${each.key}"
    Tier = "private-isolated"
  }
}

resource "aws_route_table" "private" {
  for_each = var.deployment_enabled ? local.private_subnets : {}

  vpc_id = aws_vpc.metadata[0].id
  tags   = { Name = "${local.name}-private-${each.key}" }
}

resource "aws_route_table_association" "private" {
  for_each = var.deployment_enabled ? local.private_subnets : {}

  subnet_id      = aws_subnet.private[each.key].id
  route_table_id = aws_route_table.private[each.key].id
}

resource "aws_vpc_endpoint" "s3" {
  count = var.deployment_enabled ? 1 : 0

  vpc_id            = aws_vpc.metadata[0].id
  service_name      = "com.amazonaws.${var.aws_region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [for table in aws_route_table.private : table.id]
  policy            = data.aws_iam_policy_document.s3_endpoint[0].json

  tags = { Name = "${local.name}-s3" }
}

locals {
  migration_endpoint_services = toset([
    "ecr.api",
    "ecr.dkr",
    "logs",
    "secretsmanager",
  ])

  migration_endpoint_policies = var.migration_runner_enabled ? {
    "ecr.api" = jsonencode({
      Version = "2012-10-17"
      Statement = [
        {
          Sid       = "EcrAuthorization"
          Effect    = "Allow"
          Principal = "*"
          Action    = ["ecr:GetAuthorizationToken"]
          Resource  = "*"
          Condition = { StringEquals = { "aws:PrincipalAccount" = var.aws_account_id } }
        },
        {
          Sid       = "ExactMigrationRepository"
          Effect    = "Allow"
          Principal = "*"
          Action    = ["ecr:BatchCheckLayerAvailability", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"]
          Resource  = aws_ecr_repository.migration[0].arn
          Condition = { StringEquals = { "aws:PrincipalAccount" = var.aws_account_id } }
        },
      ]
    })
    "ecr.dkr" = jsonencode({
      Version = "2012-10-17"
      Statement = [
        {
          Sid       = "EcrAuthorization"
          Effect    = "Allow"
          Principal = "*"
          Action    = ["ecr:GetAuthorizationToken"]
          Resource  = "*"
          Condition = { StringEquals = { "aws:PrincipalAccount" = var.aws_account_id } }
        },
        {
          Sid       = "ExactMigrationRepository"
          Effect    = "Allow"
          Principal = "*"
          Action    = ["ecr:BatchCheckLayerAvailability", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"]
          Resource  = aws_ecr_repository.migration[0].arn
          Condition = { StringEquals = { "aws:PrincipalAccount" = var.aws_account_id } }
        },
      ]
    })
    "logs" = jsonencode({
      Version = "2012-10-17"
      Statement = [{
        Sid       = "ExactMigrationLogs"
        Effect    = "Allow"
        Principal = "*"
        Action    = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource  = "${aws_cloudwatch_log_group.migration[0].arn}:*"
        Condition = { StringEquals = { "aws:PrincipalAccount" = var.aws_account_id } }
      }]
    })
    "secretsmanager" = jsonencode({
      Version = "2012-10-17"
      Statement = [{
        Sid       = "ExactRdsManagedCredential"
        Effect    = "Allow"
        Principal = "*"
        Action    = ["secretsmanager:GetSecretValue"]
        Resource  = aws_db_instance.metadata[0].master_user_secret[0].secret_arn
        Condition = { StringEquals = { "aws:PrincipalAccount" = var.aws_account_id } }
      }]
    })
  } : {}
}

resource "aws_vpc_endpoint" "migration" {
  for_each = var.deployment_enabled ? (var.migration_runner_enabled ? local.migration_endpoint_services : toset([])) : toset([])

  vpc_id              = aws_vpc.metadata[0].id
  service_name        = "com.amazonaws.${var.aws_region}.${each.key}"
  vpc_endpoint_type   = "Interface"
  private_dns_enabled = true
  subnet_ids          = [aws_subnet.private[var.availability_zones[0]].id]
  security_group_ids  = [aws_security_group.migration_endpoints[0].id]
  policy              = local.migration_endpoint_policies[each.key]

  tags = {
    Name        = "${local.name}-migration-${replace(each.key, ".", "-")}"
    CostControl = "ephemeral-migration"
  }
}
