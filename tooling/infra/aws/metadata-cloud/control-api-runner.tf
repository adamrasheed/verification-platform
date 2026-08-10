locals {
  control_api_runner_endpoint_services = toset([
    "ecr.api",
    "ecr.dkr",
    "logs",
    "secretsmanager",
  ])

  control_api_runner_endpoint_policies = var.control_api_runner_enabled ? {
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
          Sid       = "ExactControlApiRunnerRepository"
          Effect    = "Allow"
          Principal = "*"
          Action    = ["ecr:BatchCheckLayerAvailability", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"]
          Resource  = aws_ecr_repository.control_api_runner[0].arn
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
          Sid       = "ExactControlApiRunnerRepository"
          Effect    = "Allow"
          Principal = "*"
          Action    = ["ecr:BatchCheckLayerAvailability", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"]
          Resource  = aws_ecr_repository.control_api_runner[0].arn
          Condition = { StringEquals = { "aws:PrincipalAccount" = var.aws_account_id } }
        },
      ]
    })
    "logs" = jsonencode({
      Version = "2012-10-17"
      Statement = [{
        Sid       = "ExactControlApiRunnerLogs"
        Effect    = "Allow"
        Principal = "*"
        Action    = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource  = "${aws_cloudwatch_log_group.control_api_runner[0].arn}:*"
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

data "aws_iam_policy_document" "control_api_runner_task_assume" {
  count = var.deployment_enabled ? (var.control_api_runner_enabled ? 1 : 0) : 0

  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = ["arn:aws:ecs:${var.aws_region}:${var.aws_account_id}:*"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [var.aws_account_id]
    }
  }
}

resource "aws_ecr_repository" "control_api_runner" {
  count = var.deployment_enabled ? (var.control_api_runner_enabled ? 1 : 0) : 0

  name                 = "${local.name}-postgres-migration"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = true
  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = aws_kms_key.environment[0].arn
  }
  image_scanning_configuration { scan_on_push = true }
  tags = { CostControl = "ephemeral-control-api-conformance" }
}

resource "aws_cloudwatch_log_group" "control_api_runner" {
  count = var.deployment_enabled ? (var.control_api_runner_enabled ? 1 : 0) : 0

  name              = "/verification/${var.environment}/migration"
  retention_in_days = 30
  kms_key_id        = aws_kms_key.environment[0].arn
  tags              = { CostControl = "ephemeral-control-api-conformance" }
}

resource "aws_security_group" "control_api_runner" {
  count = var.deployment_enabled ? (var.control_api_runner_enabled ? 1 : 0) : 0

  name        = "${local.name}-control-api-conformance"
  description = "No ingress; exact database and private endpoint egress"
  vpc_id      = aws_vpc.metadata[0].id
  tags        = { CostControl = "ephemeral-control-api-conformance" }
}

resource "aws_security_group" "control_api_runner_endpoints" {
  count = var.deployment_enabled ? (var.control_api_runner_enabled ? 1 : 0) : 0

  name        = "${local.name}-control-api-conformance-endpoints"
  description = "Ephemeral TLS endpoints for bounded control API conformance"
  vpc_id      = aws_vpc.metadata[0].id
  tags        = { CostControl = "ephemeral-control-api-conformance" }
}

resource "aws_vpc_security_group_ingress_rule" "database_from_control_api_runner" {
  count = var.deployment_enabled ? (var.control_api_runner_enabled ? 1 : 0) : 0

  security_group_id            = aws_security_group.database[0].id
  referenced_security_group_id = aws_security_group.control_api_runner[0].id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
  description                  = "Exact PostgreSQL path from control API conformance task"
}

resource "aws_vpc_security_group_egress_rule" "control_api_runner_to_database" {
  count = var.deployment_enabled ? (var.control_api_runner_enabled ? 1 : 0) : 0

  security_group_id            = aws_security_group.control_api_runner[0].id
  referenced_security_group_id = aws_security_group.database[0].id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
  description                  = "Exact PostgreSQL path from control API conformance task"
}

resource "aws_vpc_security_group_ingress_rule" "control_api_runner_endpoints" {
  count = var.deployment_enabled ? (var.control_api_runner_enabled ? 1 : 0) : 0

  security_group_id            = aws_security_group.control_api_runner_endpoints[0].id
  referenced_security_group_id = aws_security_group.control_api_runner[0].id
  from_port                    = 443
  to_port                      = 443
  ip_protocol                  = "tcp"
  description                  = "TLS only from the control API conformance task"
}

resource "aws_vpc_security_group_egress_rule" "control_api_runner_to_endpoints" {
  count = var.deployment_enabled ? (var.control_api_runner_enabled ? 1 : 0) : 0

  security_group_id            = aws_security_group.control_api_runner[0].id
  referenced_security_group_id = aws_security_group.control_api_runner_endpoints[0].id
  from_port                    = 443
  to_port                      = 443
  ip_protocol                  = "tcp"
  description                  = "TLS only to the control API endpoint identity"
}

resource "aws_vpc_security_group_egress_rule" "control_api_runner_to_s3" {
  count = var.deployment_enabled ? (var.control_api_runner_enabled ? 1 : 0) : 0

  security_group_id = aws_security_group.control_api_runner[0].id
  prefix_list_id    = aws_vpc_endpoint.s3[0].prefix_list_id
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
  description       = "TLS only to S3 for ephemeral ECR image layers"
}

resource "aws_vpc_endpoint" "control_api_runner" {
  for_each = var.deployment_enabled ? (var.control_api_runner_enabled ? local.control_api_runner_endpoint_services : toset([])) : toset([])

  vpc_id              = aws_vpc.metadata[0].id
  service_name        = "com.amazonaws.${var.aws_region}.${each.key}"
  vpc_endpoint_type   = "Interface"
  private_dns_enabled = true
  subnet_ids          = [aws_subnet.private[var.availability_zones[0]].id]
  security_group_ids  = [aws_security_group.control_api_runner_endpoints[0].id]
  policy              = local.control_api_runner_endpoint_policies[each.key]
  tags = {
    Name        = "${local.name}-control-api-conformance-${replace(each.key, ".", "-")}"
    CostControl = "ephemeral-control-api-conformance"
  }
}

resource "aws_iam_role" "control_api_runner_execution" {
  count = var.deployment_enabled ? (var.control_api_runner_enabled ? 1 : 0) : 0

  name               = "${local.name}-migration-execution"
  assume_role_policy = data.aws_iam_policy_document.control_api_runner_task_assume[0].json
  tags               = { CostControl = "ephemeral-control-api-conformance" }
}

data "aws_iam_policy_document" "control_api_runner_execution" {
  count = var.deployment_enabled ? (var.control_api_runner_enabled ? 1 : 0) : 0

  statement {
    sid       = "EcrAuthorization"
    effect    = "Allow"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }
  statement {
    sid    = "ExactControlApiRunnerImage"
    effect = "Allow"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
    ]
    resources = [aws_ecr_repository.control_api_runner[0].arn]
  }
  statement {
    sid       = "ExactControlApiRunnerLogs"
    effect    = "Allow"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.control_api_runner[0].arn}:*"]
  }
  statement {
    sid       = "ExactRdsManagedCredential"
    effect    = "Allow"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_db_instance.metadata[0].master_user_secret[0].secret_arn]
  }
  statement {
    sid       = "DecryptRdsManagedCredential"
    effect    = "Allow"
    actions   = ["kms:Decrypt"]
    resources = [aws_kms_key.environment[0].arn]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["secretsmanager.${var.aws_region}.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "control_api_runner_execution" {
  count = var.deployment_enabled ? (var.control_api_runner_enabled ? 1 : 0) : 0

  name   = "exact-private-control-api-conformance-execution"
  role   = aws_iam_role.control_api_runner_execution[0].id
  policy = data.aws_iam_policy_document.control_api_runner_execution[0].json
}

resource "aws_ecs_task_definition" "control_api_runner" {
  count = var.deployment_enabled ? (var.control_api_runner_enabled ? 1 : 0) : 0

  family                   = "${local.name}-control-api-conformance"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.control_api_runner_execution[0].arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }
  container_definitions = jsonencode([{
    name                   = "control-api-conformance"
    image                  = "${aws_ecr_repository.control_api_runner[0].repository_url}:${var.control_api_runner_image_tag}"
    essential              = true
    readonlyRootFilesystem = true
    environment = [
      { name = "AWS_REGION", value = var.aws_region },
      { name = "CONTROL_API_RUN_ID", value = var.control_api_runner_image_tag },
      { name = "PGDATABASE", value = "verification" },
      { name = "PGHOST", value = aws_db_instance.metadata[0].address },
      { name = "PGPORT", value = "5432" },
      { name = "PGSSLMODE", value = "verify-full" },
      { name = "PGSSLROOTCERT", value = "/app/rds-ca-bundle.pem" },
      { name = "PGUSER", value = "verification_admin" },
    ]
    secrets = [
      { name = "PGPASSWORD", valueFrom = "${aws_db_instance.metadata[0].master_user_secret[0].secret_arn}:password::" },
    ]
    linuxParameters = { initProcessEnabled = true }
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.control_api_runner[0].name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "control-api"
      }
    }
  }])
  tags = { CostControl = "ephemeral-control-api-conformance" }
  depends_on = [
    aws_iam_role_policy.control_api_runner_execution,
    aws_vpc_endpoint.control_api_runner,
  ]
}
