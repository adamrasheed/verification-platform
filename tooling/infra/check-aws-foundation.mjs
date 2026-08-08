#!/usr/bin/env node
import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { run } from "../release/lib.mjs";

const root = process.cwd();
const infraRoot = path.join(root, "tooling/infra/aws");
const bootstrapRoot = path.join(infraRoot, "bootstrap");
const metadataRoot = path.join(infraRoot, "metadata-cloud");

const read = async (relative) => readFile(path.join(root, relative), "utf8");
const requireText = (text, expected, label) => {
  assert.ok(text.includes(expected), `${label}: missing ${expected}`);
};

async function checked(command, args, cwd = root) {
  const result = await run(command, args, { cwd, env: process.env });
  assert.equal(result.code, 0, `${command} ${args.join(" ")}\n${result.stderr}\n${result.stdout}`);
  return result;
}

function assertEveryResourceIsGated(text, label) {
  const starts = [...text.matchAll(/^resource\s+"[^"]+"\s+"[^"]+"\s*\{/gm)];
  assert.ok(starts.length > 0, `${label}: no resources found`);
  for (const [index, match] of starts.entries()) {
    const next = starts[index + 1]?.index ?? text.length;
    const block = text.slice(match.index, next);
    assert.match(
      block,
      /(?:count|for_each)\s*=\s*var\.deployment_enabled\s*\?/,
      `${label}: ungated ${match[0]}`,
    );
  }
}

const requiredFiles = [
  "tooling/infra/aws/bootstrap/.terraform.lock.hcl",
  "tooling/infra/aws/bootstrap/versions.tf",
  "tooling/infra/aws/bootstrap/variables.tf",
  "tooling/infra/aws/bootstrap/main.tf",
  "tooling/infra/aws/metadata-cloud/.terraform.lock.hcl",
  "tooling/infra/aws/metadata-cloud/versions.tf",
  "tooling/infra/aws/metadata-cloud/variables.tf",
  "tooling/infra/aws/metadata-cloud/network.tf",
  "tooling/infra/aws/metadata-cloud/security.tf",
  "tooling/infra/aws/metadata-cloud/data.tf",
  "tooling/infra/aws/metadata-cloud/compute.tf",
  "tooling/infra/aws/metadata-cloud/migration.tf",
  "tooling/infra/aws/metadata-cloud/budget.tf",
  ".github/workflows/aws-oidc-smoke.yml",
  ".github/workflows/aws-metadata-cloud.yml",
  ".github/workflows/aws-postgres-migration.yml",
  "tooling/infra/aws/metadata-cloud/migration.Dockerfile",
  "tooling/infra/aws/metadata-cloud/us-west-2-bundle.pem",
  "tooling/infra/run-live-postgres-migration.mjs",
  "docs/architecture/ADR/0013-aws-metadata-cloud-foundation.md",
];
await Promise.all(requiredFiles.map((file) => read(file)));

const bootstrap = ["versions.tf", "variables.tf", "main.tf", "identity.tf", "budget.tf", "outputs.tf"]
  .map((file) => readFile(path.join(bootstrapRoot, file), "utf8"));
const metadata = [
  "versions.tf", "variables.tf", "locals.tf", "network.tf", "security.tf",
  "data.tf", "compute.tf", "migration.tf", "budget.tf", "outputs.tf",
].map((file) => readFile(path.join(metadataRoot, file), "utf8"));
const bootstrapText = (await Promise.all(bootstrap)).join("\n");
const bootstrapIdentity = await read("tooling/infra/aws/bootstrap/identity.tf");
const dockerignore = await read(".dockerignore");
const metadataData = await read("tooling/infra/aws/metadata-cloud/data.tf");
const migrationProbe = await read("tooling/infra/run-live-postgres-migration.mjs");
const rdsCaBundle = await read("tooling/infra/aws/metadata-cloud/us-west-2-bundle.pem");
const metadataText = (await Promise.all(metadata)).join("\n");
const allInfra = `${bootstrapText}\n${metadataText}`;

assertEveryResourceIsGated(bootstrapText, "bootstrap");
assertEveryResourceIsGated(metadataText, "metadata-cloud");
assert.equal((allInfra.match(/variable "deployment_enabled"/g) ?? []).length, 2);
assert.equal((allInfra.match(/default\s*=\s*false/g) ?? []).length >= 3, true);
assert.equal((allInfra.match(/allowed_account_ids\s*=\s*\[var\.aws_account_id\]/g) ?? []).length, 2);
assert.equal((allInfra.match(/default\s*=\s*"us-west-2"/g) ?? []).length, 2);
assert.equal((allInfra.match(/version\s*=\s*"~> 6\.56\.0"/g) ?? []).length, 2);
assert.doesNotMatch(allInfra, /0\.0\.0\.0\/0|::\/0|aws_nat_gateway|aws_internet_gateway/);
assert.doesNotMatch(allInfra, /AKIA[0-9A-Z]{16}|-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/);
requireText(allInfra, 'access_key          = var.deployment_enabled ? null : "disabled-validation-only"', "offline validation credential");
requireText(allInfra, 'secret_key          = var.deployment_enabled ? null : "disabled-validation-only"', "offline validation credential");
requireText(metadataText, "publicly_accessible    = false", "private RDS");
requireText(metadataText, "backup_retention_period         = var.database_backup_retention_days", "RDS backups");
requireText(metadataText, 'default     = 35', "backup retention");
requireText(metadataText, 'apply_method = "pending-reboot"', "static RDS parameter reconciliation");
requireText(metadataText, 'condition     = var.environment != "production" || var.database_multi_az', "production Multi-AZ gate");
requireText(metadataText, 'deletion_protection       = var.environment == "production"', "production deletion protection");
requireText(metadataText, "enable_key_rotation     = true", "KMS rotation");
requireText(metadataText, 'name              = "/aws/rds/instance/${local.name}-postgres/postgresql"', "managed RDS logs");
assert.equal((metadataText.match(/retention_in_days = 30/g) ?? []).length, 5, "all five log groups need 30-day retention");
requireText(metadataText, "block_public_acls       = true", "S3 public access block");
requireText(metadataText, "noncurrent_days = 35", "metadata backup expiry");
requireText(metadataText, "expiration { days = 1 }", "quarantine expiry");
requireText(metadataText, "deadLetterTargetArn", "SQS dead-letter queue");
requireText(metadataText, 'resource "aws_budgets_budget" "monthly"', "cost budget");
requireText(metadataText, 'Tier = "private-isolated"', "isolated subnet");
requireText(metadataText, 'CostControl = "ephemeral-migration"', "ephemeral migration cost control");
requireText(metadataText, '"ecr.api"', "private ECR API endpoint");
requireText(metadataText, '"ecr.dkr"', "private ECR registry endpoint");
requireText(metadataText, '"logs"', "private log endpoint");
requireText(metadataText, '"secretsmanager"', "private secret endpoint");
requireText(metadataText, "readonlyRootFilesystem = true", "read-only migration container");
requireText(metadataText, 'image_tag_mutability = "IMMUTABLE"', "immutable migration image");
requireText(metadataText, 'force_delete         = true', "ephemeral repository cleanup");
requireText(metadataText, 'name = "PGPASSWORD"', "RDS-managed password injection");
requireText(metadataText, 'name = "PGSSLMODE", value = "verify-full"', "RDS TLS hostname verification");
requireText(metadataText, 'name = "PGSSLROOTCERT", value = "/app/rds-ca-bundle.pem"', "RDS trust root path");
requireText(migrationProbe, "rejectUnauthorized: true", "RDS certificate verification");
requireText(dockerignore, "!tooling/infra/aws/metadata-cloud/us-west-2-bundle.pem", "RDS CA build context");
const rdsRootCertificates = rdsCaBundle.match(/-----BEGIN CERTIFICATE-----[^]*?-----END CERTIFICATE-----/g) ?? [];
assert.equal(rdsRootCertificates.length, 3, "regional RDS trust bundle must contain three roots");
for (const pem of rdsRootCertificates) {
  const certificate = new X509Certificate(pem);
  assert.equal(certificate.ca, true, "RDS trust bundle entries must be CA certificates");
  assert.match(certificate.subject, /Amazon RDS us-west-2 Root CA/);
}
requireText(
  metadataData,
  'resources = ["arn:aws:s3:::prod-${var.aws_region}-starport-layer-bucket/*"]',
  "regional ECR layer bucket boundary",
);
const ecrLayerPolicy = metadataData.slice(
  metadataData.indexOf('sid       = "EphemeralEcrLayerPull"'),
  metadataData.indexOf('resource "aws_s3_bucket_policy" "protected"'),
);
assert.ok(ecrLayerPolicy.length > 0, "ephemeral ECR layer endpoint policy must exist");
assert.doesNotMatch(ecrLayerPolicy, /condition\s*\{/);
assert.doesNotMatch(metadataText, /task_role_arn\s*=/);
requireText(metadataText, 'backend "s3" {}', "encrypted remote-state backend");
requireText(bootstrapText, 'url            = "https://token.actions.githubusercontent.com"', "GitHub OIDC provider");
requireText(bootstrapText, '"token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"', "OIDC audience restriction");
requireText(bootstrapText, '"token.actions.githubusercontent.com:sub" = local.github_oidc_subject', "OIDC subject restriction");
requireText(bootstrapText, 'default     = "repo:adamrasheed@10425543/verification-platform@1305420403"', "immutable GitHub repository identity");
requireText(bootstrapText, 'name         = "verification-platform-account-monthly"', "bootstrap account budget");
requireText(bootstrapText, "depends_on = [aws_budgets_budget.account]", "budget-before-state dependency");
assert.doesNotMatch(bootstrapText, /repo:\*|environment:\*|StringLike[^]*token\.actions\.githubusercontent\.com:sub/);
requireText(bootstrapText, 'resource "aws_iam_role" "github_deploy"', "separate deployment identity");
requireText(bootstrapText, '"aws:RequestedRegion" = var.aws_region', "regional deployment boundary");
for (const action of [
  "budgets:ListTagsForResource",
  "budgets:TagResource",
  "ec2:DescribePrefixLists",
  "kms:ListResourceTags",
  "s3:PutLifecycleConfiguration",
  "secretsmanager:CreateSecret",
  "secretsmanager:TagResource",
  "ecs:RegisterTaskDefinition",
  "ecs:RunTask",
  "ecr:CreateRepository",
  "ecr:PutImage",
  "iam:PassRole",
]) requireText(bootstrapIdentity, `"${action}"`, "provider apply permission");
requireText(
  bootstrapIdentity,
  'arn:aws:secretsmanager:${var.aws_region}:${var.aws_account_id}:secret:rds!db-*',
  "RDS-managed credential boundary",
);
assert.doesNotMatch(bootstrapIdentity, /AdministratorAccess|"iam:\*"|"ec2:\*"|"rds:\*"|"s3:\*"/);

const oidcWorkflow = await read(".github/workflows/aws-oidc-smoke.yml");
requireText(oidcWorkflow, "id-token: write", "OIDC workflow token permission");
requireText(oidcWorkflow, "environment: development", "protected GitHub environment");
requireText(oidcWorkflow, "allowed-account-ids: ${{ vars.AWS_ACCOUNT_ID }}", "OIDC account allowlist");
requireText(oidcWorkflow, "aws-actions/configure-aws-credentials@e6de054238d6b7531b4efff3b6587d9aade6a06c", "pinned AWS credential action");
assert.doesNotMatch(oidcWorkflow, /AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|pull_request/);

const deployWorkflow = await read(".github/workflows/aws-metadata-cloud.yml");
requireText(deployWorkflow, "id-token: write", "deployment workflow token permission");
requireText(deployWorkflow, "environment: development", "deployment environment boundary");
requireText(deployWorkflow, "role-to-assume: ${{ vars.AWS_DEPLOY_ROLE_ARN }}", "separate deployment role");
requireText(deployWorkflow, "tofu apply -input=false -auto-approve development.tfplan", "immutable apply plan");
requireText(deployWorkflow, "Verify zero drift after apply", "post-apply drift check");
assert.doesNotMatch(deployWorkflow, /AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|pull_request|workflow_run/);

const migrationWorkflow = await read(".github/workflows/aws-postgres-migration.yml");
requireText(migrationWorkflow, "id-token: write", "migration workflow token permission");
requireText(migrationWorkflow, "environment: development", "migration environment boundary");
requireText(migrationWorkflow, "github.ref == 'refs/heads/main'", "main-only migration boundary");
requireText(migrationWorkflow, "migration_runner_enabled=true", "explicit migration enablement");
requireText(migrationWorkflow, "migration_runner_enabled=false", "mandatory migration cleanup");
requireText(migrationWorkflow, "assignPublicIp=DISABLED", "private Fargate task");
requireText(migrationWorkflow, "Verify zero drift after cleanup", "post-cleanup drift gate");
assert.doesNotMatch(migrationWorkflow, /AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|pull_request|workflow_run/);

for (const lockRoot of [bootstrapRoot, metadataRoot]) {
  const lock = await readFile(path.join(lockRoot, ".terraform.lock.hcl"), "utf8");
  requireText(lock, 'version     = "6.56.0"', "provider lock");
  assert.ok((lock.match(/"(?:h1|zh):/g) ?? []).length >= 3, "provider lock needs signed multi-platform checksums");
}

const openQuestions = await read("docs/architecture/OPEN_QUESTIONS.md");
const adr = await read("docs/architecture/ADR/0013-aws-metadata-cloud-foundation.md");
const roadmap = await read("docs/product/ROADMAP.md");
assert.doesNotMatch(openQuestions.split("## Resolved architecture selections")[0], /\| D-002 \|/);
requireText(openQuestions, "ADR-0013", "D-002 resolution");
for (const claim of [
  "us-west-2", "ECS on Fargate", "RDS for PostgreSQL", "SQS standard queues",
  "35 days", "No routine backup", "unsupported in the first metadata beta",
]) requireText(adr, claim, "ADR-0013");
requireText(roadmap, "Epic M9 — AWS Metadata Cloud Deployment", "roadmap");

await checked("tofu", ["fmt", "-check", "-recursive", infraRoot]);
for (const directory of [bootstrapRoot, metadataRoot]) {
  await checked("tofu", ["init", "-backend=false", "-lockfile=readonly", "-input=false"], directory);
  await checked("tofu", ["validate", "-no-color"], directory);
  await checked("tofu", ["test", "-no-color"], directory);
}

const temporary = await mkdtemp(path.join(tmpdir(), "verify-aws-bootstrap-"));
try {
  const planPath = path.join(temporary, "disabled.tfplan");
  await checked("tofu", [
    "plan", "-refresh=false", "-input=false", "-lock=false", "-out", planPath,
  ], bootstrapRoot);
  const shown = await checked("tofu", ["show", "-json", planPath], bootstrapRoot);
  const plan = JSON.parse(shown.stdout);
  assert.equal(plan.resource_changes?.length ?? 0, 0, "disabled bootstrap plan must create zero resources");
} finally {
  await rm(temporary, { recursive: true, force: true });
}

console.log("AWS metadata-cloud foundation valid: D-002 fixed, creation disabled");
