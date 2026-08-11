locals {
  name = "verification-${var.environment}"

  private_operation_runner_enabled = var.migration_runner_enabled || var.readiness_runner_enabled

  mandatory_tags = {
    Project     = "verification-platform"
    Environment = var.environment
    ManagedBy   = "opentofu"
    Owner       = var.owner
    DataClass   = "minimal-metadata"
  }

  private_subnets = {
    for index, zone in var.availability_zones : zone => cidrsubnet(var.vpc_cidr, 8, index + 16)
  }
}
