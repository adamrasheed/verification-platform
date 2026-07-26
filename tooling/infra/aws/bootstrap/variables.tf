variable "deployment_enabled" {
  description = "Fail-closed creation gate. Must be set explicitly for bootstrap apply."
  type        = bool
  default     = false
}

variable "aws_account_id" {
  description = "Exact AWS account allowlist; credentials for any other account fail."
  type        = string
  default     = ""

  validation {
    condition     = !var.deployment_enabled || can(regex("^[0-9]{12}$", var.aws_account_id))
    error_message = "An exact 12-digit aws_account_id is required when deployment is enabled."
  }
}

variable "aws_region" {
  description = "ADR-0013 primary region."
  type        = string
  default     = "us-west-2"

  validation {
    condition     = var.aws_region == "us-west-2"
    error_message = "ADR-0013 fixes the first deployment to us-west-2."
  }
}

variable "state_bucket_name" {
  description = "Globally unique S3 bucket name for encrypted OpenTofu state."
  type        = string
  default     = ""

  validation {
    condition     = !var.deployment_enabled || can(regex("^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$", var.state_bucket_name))
    error_message = "A valid explicit state_bucket_name is required when deployment is enabled."
  }
}

variable "owner" {
  description = "Accountable infrastructure owner tag."
  type        = string
  default     = "founding-engineering"

  validation {
    condition     = length(trimspace(var.owner)) > 0
    error_message = "owner cannot be empty."
  }
}
