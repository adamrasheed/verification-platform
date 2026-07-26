locals {
  mandatory_tags = {
    Project     = "verification-platform"
    Environment = "bootstrap"
    ManagedBy   = "opentofu"
    Owner       = var.owner
    DataClass   = "infrastructure-state"
  }
}

resource "aws_kms_key" "state" {
  count = var.deployment_enabled ? 1 : 0

  description             = "verification-platform OpenTofu state"
  enable_key_rotation     = true
  deletion_window_in_days = 30

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_kms_alias" "state" {
  count = var.deployment_enabled ? 1 : 0

  name          = "alias/verification-platform-opentofu-state"
  target_key_id = aws_kms_key.state[0].key_id
}

resource "aws_s3_bucket" "state" {
  count = var.deployment_enabled ? 1 : 0

  bucket = var.state_bucket_name

  lifecycle {
    prevent_destroy = true
  }
}

data "aws_iam_policy_document" "state_bucket" {
  count = var.deployment_enabled ? 1 : 0

  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.state[0].arn,
      "${aws_s3_bucket.state[0].arn}/*",
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

resource "aws_s3_bucket_policy" "state" {
  count = var.deployment_enabled ? 1 : 0

  bucket = aws_s3_bucket.state[0].id
  policy = data.aws_iam_policy_document.state_bucket[0].json
}

resource "aws_s3_bucket_public_access_block" "state" {
  count = var.deployment_enabled ? 1 : 0

  bucket                  = aws_s3_bucket.state[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "state" {
  count = var.deployment_enabled ? 1 : 0

  bucket = aws_s3_bucket.state[0].id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_versioning" "state" {
  count = var.deployment_enabled ? 1 : 0

  bucket = aws_s3_bucket.state[0].id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  count = var.deployment_enabled ? 1 : 0

  bucket = aws_s3_bucket.state[0].id
  rule {
    apply_server_side_encryption_by_default {
      kms_master_key_id = aws_kms_key.state[0].arn
      sse_algorithm     = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "state" {
  count = var.deployment_enabled ? 1 : 0

  bucket = aws_s3_bucket.state[0].id
  rule {
    id     = "bounded-state-history"
    status = "Enabled"
    filter {}

    noncurrent_version_expiration {
      noncurrent_days = 90
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }

  depends_on = [aws_s3_bucket_versioning.state]
}
