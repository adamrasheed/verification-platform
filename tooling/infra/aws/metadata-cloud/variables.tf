variable "deployment_enabled" {
  description = "Fail-closed gate for every remotely billable resource."
  type        = bool
  default     = false
}

variable "aws_account_id" {
  description = "Exact AWS account allowlist."
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

variable "environment" {
  description = "Exact deployment environment."
  type        = string
  default     = "development"

  validation {
    condition     = contains(["development", "staging", "production"], var.environment)
    error_message = "environment must be development, staging, or production."
  }
}

variable "owner" {
  description = "Accountable owner tag."
  type        = string
  default     = "founding-engineering"

  validation {
    condition     = length(trimspace(var.owner)) > 0
    error_message = "owner cannot be empty."
  }
}

variable "budget_alert_email" {
  description = "Verified cost-alert destination."
  type        = string
  default     = ""

  validation {
    condition     = !var.deployment_enabled || can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", var.budget_alert_email))
    error_message = "A valid budget_alert_email is required when deployment is enabled."
  }
}

variable "monthly_budget_usd" {
  description = "Hard planning ceiling and alert budget; pricing remains F-003."
  type        = number
  default     = 100

  validation {
    condition     = var.monthly_budget_usd >= 10 && var.monthly_budget_usd <= 5000
    error_message = "monthly_budget_usd must be between 10 and 5000."
  }
}

variable "vpc_cidr" {
  description = "Private metadata-cloud network."
  type        = string
  default     = "10.42.0.0/16"
}

variable "availability_zones" {
  description = "Exact two-AZ topology in the primary region."
  type        = list(string)
  default     = ["us-west-2a", "us-west-2b"]

  validation {
    condition     = length(var.availability_zones) == 2 && alltrue([for zone in var.availability_zones : startswith(zone, "us-west-2")])
    error_message = "Exactly two us-west-2 Availability Zones are required."
  }
}

variable "database_instance_class" {
  description = "Development defaults small; production sizing follows measured load."
  type        = string
  default     = "db.t4g.micro"
}

variable "postgres_engine_version" {
  description = "Reviewed PostgreSQL engine line."
  type        = string
  default     = "17.9"

  validation {
    condition     = var.postgres_engine_version == "17.9"
    error_message = "The reviewed development PostgreSQL engine is exactly 17.9."
  }
}

variable "database_multi_az" {
  description = "Required for production."
  type        = bool
  default     = false
}

variable "database_backup_retention_days" {
  description = "ADR-0013 operational database backup/PITR window."
  type        = number
  default     = 35

  validation {
    condition     = var.database_backup_retention_days == 35
    error_message = "ADR-0013 requires exactly 35 days of database backup retention."
  }
}

variable "migration_runner_enabled" {
  description = "Creates the ephemeral private Fargate migration runner; disabled outside an explicit migration operation."
  type        = bool
  default     = false

  validation {
    condition     = !var.migration_runner_enabled || var.deployment_enabled
    error_message = "The migration runner requires the guarded metadata-cloud deployment."
  }
}

variable "migration_image_tag" {
  description = "Immutable Git commit tag for the ephemeral migration image."
  type        = string
  default     = ""

  validation {
    condition     = !var.migration_runner_enabled || can(regex("^[a-f0-9]{40}$", var.migration_image_tag))
    error_message = "An exact 40-character Git commit tag is required for a migration run."
  }
}

variable "readiness_runner_enabled" {
  description = "Creates the ephemeral private production-readiness runner; disabled outside an explicit protected drill."
  type        = bool
  default     = false

  validation {
    condition     = !var.readiness_runner_enabled || var.deployment_enabled
    error_message = "The readiness runner requires the guarded metadata-cloud deployment."
  }

  validation {
    condition = !var.readiness_runner_enabled || (
      !var.migration_runner_enabled &&
      !var.queue_runner_enabled &&
      !var.control_api_runner_enabled &&
      !var.customer_workload_runner_enabled
    )
    error_message = "The readiness runner requires exclusive use of the ephemeral private-runner namespace."
  }
}

variable "readiness_runner_image_tag" {
  description = "Immutable Git commit tag for the ephemeral production-readiness image."
  type        = string
  default     = ""

  validation {
    condition     = !var.readiness_runner_enabled || can(regex("^[a-f0-9]{40}$", var.readiness_runner_image_tag))
    error_message = "An exact 40-character Git commit tag is required for a production-readiness run."
  }
}

variable "queue_runner_enabled" {
  description = "Creates the ephemeral private Fargate SQS conformance runner; disabled outside an explicit protected run."
  type        = bool
  default     = false

  validation {
    condition     = !var.queue_runner_enabled || var.deployment_enabled
    error_message = "The queue runner requires the guarded metadata-cloud deployment."
  }
}

variable "queue_runner_image_tag" {
  description = "Immutable Git commit tag for the ephemeral SQS conformance image."
  type        = string
  default     = ""

  validation {
    condition     = !var.queue_runner_enabled || can(regex("^[a-f0-9]{40}$", var.queue_runner_image_tag))
    error_message = "An exact 40-character Git commit tag is required for an SQS conformance run."
  }
}

variable "control_api_runner_enabled" {
  description = "Creates the ephemeral private control API conformance runner; disabled outside an explicit protected run."
  type        = bool
  default     = false

  validation {
    condition     = !var.control_api_runner_enabled || var.deployment_enabled
    error_message = "The control API runner requires the guarded metadata-cloud deployment."
  }

  validation {
    condition     = !var.control_api_runner_enabled || !var.migration_runner_enabled
    error_message = "The control API and migration runners share one ephemeral namespace and cannot be enabled together."
  }
}

variable "control_api_runner_image_tag" {
  description = "Immutable Git commit tag for the ephemeral control API conformance image."
  type        = string
  default     = ""

  validation {
    condition     = !var.control_api_runner_enabled || can(regex("^[a-f0-9]{40}$", var.control_api_runner_image_tag))
    error_message = "An exact 40-character Git commit tag is required for a control API conformance run."
  }
}

variable "customer_workload_runner_enabled" {
  description = "Creates the ephemeral private customer-workload conformance runner; disabled outside an explicit protected run."
  type        = bool
  default     = false

  validation {
    condition     = !var.customer_workload_runner_enabled || var.deployment_enabled
    error_message = "The customer-workload runner requires the guarded metadata-cloud deployment."
  }

  validation {
    condition = !var.customer_workload_runner_enabled || (
      !var.migration_runner_enabled &&
      !var.queue_runner_enabled &&
      !var.control_api_runner_enabled
    )
    error_message = "The customer-workload runner requires exclusive use of the ephemeral private-runner namespace."
  }
}

variable "customer_workload_runner_image_tag" {
  description = "Immutable Git commit tag for the ephemeral customer-workload conformance image."
  type        = string
  default     = ""

  validation {
    condition     = !var.customer_workload_runner_enabled || can(regex("^[a-f0-9]{40}$", var.customer_workload_runner_image_tag))
    error_message = "An exact 40-character Git commit tag is required for a customer-workload conformance run."
  }
}
