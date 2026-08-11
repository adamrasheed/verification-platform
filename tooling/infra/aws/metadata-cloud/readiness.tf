data "aws_iam_policy_document" "readiness_task_assume" {
  count = var.deployment_enabled ? (var.readiness_runner_enabled ? 1 : 0) : 0

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

resource "aws_ecr_repository" "readiness" {
  count = var.deployment_enabled ? (var.readiness_runner_enabled ? 1 : 0) : 0

  name                 = "${local.name}-postgres-migration"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = true

  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = aws_kms_key.environment[0].arn
  }

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = { CostControl = "ephemeral-production-readiness" }
}

resource "aws_cloudwatch_log_group" "readiness" {
  count = var.deployment_enabled ? (var.readiness_runner_enabled ? 1 : 0) : 0

  name              = "/verification/${var.environment}/migration"
  retention_in_days = 30
  kms_key_id        = aws_kms_key.environment[0].arn

  tags = { CostControl = "ephemeral-production-readiness" }
}

resource "aws_iam_role" "readiness_execution" {
  count = var.deployment_enabled ? (var.readiness_runner_enabled ? 1 : 0) : 0

  name               = "${local.name}-migration-execution"
  assume_role_policy = data.aws_iam_policy_document.readiness_task_assume[0].json

  tags = { CostControl = "ephemeral-production-readiness" }
}

data "aws_iam_policy_document" "readiness_execution" {
  count = var.deployment_enabled ? (var.readiness_runner_enabled ? 1 : 0) : 0

  statement {
    sid       = "EcrAuthorization"
    effect    = "Allow"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid    = "ExactReadinessImage"
    effect = "Allow"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
    ]
    resources = [aws_ecr_repository.readiness[0].arn]
  }

  statement {
    sid       = "ExactReadinessLogs"
    effect    = "Allow"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.readiness[0].arn}:*"]
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

resource "aws_iam_role_policy" "readiness_execution" {
  count = var.deployment_enabled ? (var.readiness_runner_enabled ? 1 : 0) : 0

  name   = "exact-private-readiness"
  role   = aws_iam_role.readiness_execution[0].id
  policy = data.aws_iam_policy_document.readiness_execution[0].json
}

resource "aws_ecs_task_definition" "readiness" {
  count = var.deployment_enabled ? (var.readiness_runner_enabled ? 1 : 0) : 0

  family                   = "${local.name}-postgres-migration"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 1024
  memory                   = 2048
  execution_role_arn       = aws_iam_role.readiness_execution[0].arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  volume {
    name = "operation-scratch"
  }

  container_definitions = jsonencode([{
    name                   = "production-readiness"
    image                  = "${aws_ecr_repository.readiness[0].repository_url}:${var.readiness_runner_image_tag}"
    essential              = true
    readonlyRootFilesystem = true
    mountPoints = [{
      sourceVolume  = "operation-scratch"
      containerPath = "/work"
      readOnly      = false
    }]
    environment = [
      { name = "EXPECTED_POSTGRES_VERSION", value = var.postgres_engine_version },
      { name = "PGDATABASE", value = "verification" },
      { name = "PGHOST", value = aws_db_instance.metadata[0].address },
      { name = "PGPORT", value = "5432" },
      { name = "PGSSLMODE", value = "verify-full" },
      { name = "PGSSLROOTCERT", value = "/app/rds-ca-bundle.pem" },
      { name = "PGUSER", value = "verification_admin" },
      { name = "CONTROL_API_RUN_ID", value = var.readiness_runner_image_tag },
      { name = "READINESS_SUPPLY_CHAIN", value = "passed" },
    ]
    secrets = [
      { name = "PGPASSWORD", valueFrom = "${aws_db_instance.metadata[0].master_user_secret[0].secret_arn}:password::" },
    ]
    linuxParameters = { initProcessEnabled = true }
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.readiness[0].name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "postgres"
      }
    }
  }])

  tags = { CostControl = "ephemeral-production-readiness" }

  depends_on = [
    aws_iam_role_policy.readiness_execution,
    aws_vpc_endpoint.migration,
  ]
}
