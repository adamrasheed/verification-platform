locals {
  name = "verification-${var.environment}"

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
