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

variable "github_repository" {
  description = "Exact GitHub repository allowed to obtain the deployment identity."
  type        = string
  default     = "adamrasheed/verification-platform"

  validation {
    condition     = var.github_repository == "adamrasheed/verification-platform"
    error_message = "The first deployment identity is fixed to adamrasheed/verification-platform."
  }
}

variable "github_environment" {
  description = "Protected GitHub environment encoded into the OIDC subject."
  type        = string
  default     = "development"

  validation {
    condition     = var.github_environment == "development"
    error_message = "The bootstrap identity is limited to the development environment."
  }
}

variable "budget_alert_email" {
  description = "Verified destination for account-level cost alerts."
  type        = string
  default     = ""

  validation {
    condition     = !var.deployment_enabled || can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", var.budget_alert_email))
    error_message = "A valid budget_alert_email is required when deployment is enabled."
  }
}

variable "monthly_budget_usd" {
  description = "Account-level bootstrap cost ceiling in US dollars."
  type        = number
  default     = 100

  validation {
    condition     = var.monthly_budget_usd == 100
    error_message = "The approved bootstrap budget is fixed at 100 USD per month."
  }
}
