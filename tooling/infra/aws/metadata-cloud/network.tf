resource "aws_vpc" "metadata" {
  count = var.deployment_enabled ? 1 : 0

  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = "${local.name}-vpc" }
}

resource "aws_subnet" "private" {
  for_each = var.deployment_enabled ? local.private_subnets : {}

  vpc_id                  = aws_vpc.metadata[0].id
  availability_zone       = each.key
  cidr_block              = each.value
  map_public_ip_on_launch = false

  tags = {
    Name = "${local.name}-private-${each.key}"
    Tier = "private-isolated"
  }
}

resource "aws_route_table" "private" {
  for_each = var.deployment_enabled ? local.private_subnets : {}

  vpc_id = aws_vpc.metadata[0].id
  tags   = { Name = "${local.name}-private-${each.key}" }
}

resource "aws_route_table_association" "private" {
  for_each = var.deployment_enabled ? local.private_subnets : {}

  subnet_id      = aws_subnet.private[each.key].id
  route_table_id = aws_route_table.private[each.key].id
}

resource "aws_vpc_endpoint" "s3" {
  count = var.deployment_enabled ? 1 : 0

  vpc_id            = aws_vpc.metadata[0].id
  service_name      = "com.amazonaws.${var.aws_region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [for table in aws_route_table.private : table.id]
  policy            = data.aws_iam_policy_document.s3_endpoint[0].json

  tags = { Name = "${local.name}-s3" }
}
