terraform {
  required_version = ">= 1.12.5, < 1.13.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.56.0"
    }
  }

  backend "s3" {}
}

provider "aws" {
  region              = var.aws_region
  allowed_account_ids = [var.aws_account_id]
  access_key          = var.deployment_enabled ? null : "disabled-validation-only"
  secret_key          = var.deployment_enabled ? null : "disabled-validation-only"

  skip_credentials_validation = !var.deployment_enabled
  skip_metadata_api_check     = !var.deployment_enabled
  skip_region_validation      = !var.deployment_enabled
  skip_requesting_account_id  = !var.deployment_enabled

  default_tags {
    tags = local.mandatory_tags
  }
}
