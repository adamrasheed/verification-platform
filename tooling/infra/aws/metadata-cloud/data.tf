resource "aws_db_subnet_group" "metadata" {
  count = var.deployment_enabled ? 1 : 0

  name       = "${local.name}-database"
  subnet_ids = [for subnet in aws_subnet.private : subnet.id]
}

resource "aws_db_parameter_group" "metadata" {
  count = var.deployment_enabled ? 1 : 0

  name   = "${local.name}-postgres17"
  family = "postgres17"

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }
}

resource "aws_db_instance" "metadata" {
  count = var.deployment_enabled ? 1 : 0

  identifier     = "${local.name}-postgres"
  engine         = "postgres"
  engine_version = var.postgres_engine_version
  instance_class = var.database_instance_class

  allocated_storage     = 20
  max_allocated_storage = 100
  storage_type          = "gp3"
  storage_encrypted     = true
  kms_key_id            = aws_kms_key.environment[0].arn

  db_name                       = "verification"
  username                      = "verification_admin"
  manage_master_user_password   = true
  master_user_secret_kms_key_id = aws_kms_key.environment[0].arn

  db_subnet_group_name   = aws_db_subnet_group.metadata[0].name
  parameter_group_name   = aws_db_parameter_group.metadata[0].name
  vpc_security_group_ids = [aws_security_group.database[0].id]
  publicly_accessible    = false
  port                   = 5432

  multi_az                        = var.database_multi_az
  backup_retention_period         = var.database_backup_retention_days
  backup_window                   = "09:00-10:00"
  maintenance_window              = "sun:10:30-sun:11:30"
  auto_minor_version_upgrade      = true
  copy_tags_to_snapshot           = true
  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]

  deletion_protection       = var.environment == "production"
  skip_final_snapshot       = var.environment != "production"
  final_snapshot_identifier = var.environment == "production" ? "${local.name}-final" : null

  lifecycle {
    precondition {
      condition     = var.environment != "production" || var.database_multi_az
      error_message = "Production requires Multi-AZ RDS."
    }
    prevent_destroy = true
  }
}

resource "aws_sqs_queue" "dead_letter" {
  count = var.deployment_enabled ? 1 : 0

  name                      = "${local.name}-metadata-dead-letter"
  message_retention_seconds = 1209600
  kms_master_key_id         = aws_kms_key.environment[0].arn
}

resource "aws_sqs_queue" "metadata" {
  count = var.deployment_enabled ? 1 : 0

  name                       = "${local.name}-metadata"
  message_retention_seconds  = 345600
  visibility_timeout_seconds = 60
  receive_wait_time_seconds  = 20
  kms_master_key_id          = aws_kms_key.environment[0].arn

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dead_letter[0].arn
    maxReceiveCount     = 5
  })
}

resource "aws_sqs_queue_redrive_allow_policy" "metadata" {
  count = var.deployment_enabled ? 1 : 0

  queue_url = aws_sqs_queue.dead_letter[0].id
  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.metadata[0].arn]
  })
}

resource "aws_s3_bucket" "metadata" {
  count = var.deployment_enabled ? 1 : 0

  bucket = "verification-${var.environment}-${var.aws_account_id}-metadata"
}

resource "aws_s3_bucket" "quarantine" {
  count = var.deployment_enabled ? 1 : 0

  bucket = "verification-${var.environment}-${var.aws_account_id}-quarantine"
}

data "aws_iam_policy_document" "protected_bucket" {
  for_each = var.deployment_enabled ? {
    metadata   = aws_s3_bucket.metadata[0].arn
    quarantine = aws_s3_bucket.quarantine[0].arn
  } : {}

  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]
    resources = [
      each.value,
      "${each.value}/*",
    ]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

data "aws_iam_policy_document" "s3_endpoint" {
  count = var.deployment_enabled ? 1 : 0

  statement {
    sid    = "ExactMetadataBuckets"
    effect = "Allow"
    actions = [
      "s3:DeleteObject", "s3:GetObject", "s3:ListBucket", "s3:PutObject"
    ]
    resources = [
      aws_s3_bucket.metadata[0].arn,
      "${aws_s3_bucket.metadata[0].arn}/*",
      aws_s3_bucket.quarantine[0].arn,
      "${aws_s3_bucket.quarantine[0].arn}/*",
    ]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:PrincipalAccount"
      values   = [var.aws_account_id]
    }
  }
}

resource "aws_s3_bucket_policy" "protected" {
  for_each = var.deployment_enabled ? {
    metadata   = aws_s3_bucket.metadata[0].id
    quarantine = aws_s3_bucket.quarantine[0].id
  } : {}

  bucket = each.value
  policy = data.aws_iam_policy_document.protected_bucket[each.key].json
}

resource "aws_s3_bucket_public_access_block" "protected" {
  for_each = var.deployment_enabled ? {
    metadata   = aws_s3_bucket.metadata[0].id
    quarantine = aws_s3_bucket.quarantine[0].id
  } : {}

  bucket                  = each.value
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "protected" {
  for_each = var.deployment_enabled ? {
    metadata   = aws_s3_bucket.metadata[0].id
    quarantine = aws_s3_bucket.quarantine[0].id
  } : {}

  bucket = each.value
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "protected" {
  for_each = var.deployment_enabled ? {
    metadata   = aws_s3_bucket.metadata[0].id
    quarantine = aws_s3_bucket.quarantine[0].id
  } : {}

  bucket = each.value
  rule {
    apply_server_side_encryption_by_default {
      kms_master_key_id = aws_kms_key.environment[0].arn
      sse_algorithm     = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_versioning" "metadata" {
  count = var.deployment_enabled ? 1 : 0

  bucket = aws_s3_bucket.metadata[0].id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "metadata" {
  count = var.deployment_enabled ? 1 : 0

  bucket = aws_s3_bucket.metadata[0].id
  rule {
    id     = "metadata-retention"
    status = "Enabled"
    filter {}

    expiration { days = 30 }
    noncurrent_version_expiration { noncurrent_days = 35 }
    abort_incomplete_multipart_upload { days_after_initiation = 1 }
  }

  depends_on = [aws_s3_bucket_versioning.metadata]
}

resource "aws_s3_bucket_lifecycle_configuration" "quarantine" {
  count = var.deployment_enabled ? 1 : 0

  bucket = aws_s3_bucket.quarantine[0].id
  rule {
    id     = "quarantine-expiry"
    status = "Enabled"
    filter {}

    expiration { days = 1 }
    abort_incomplete_multipart_upload { days_after_initiation = 1 }
  }
}
