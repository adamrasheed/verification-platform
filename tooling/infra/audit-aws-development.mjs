#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import process from "node:process";

const execute = promisify(execFile);
const accountId = "661590454564";
const region = "us-west-2";
const environment = "development";
const reviewedPostgresVersion = "17.9";
const name = `verification-${environment}`;
const keyAlias = `alias/${name}-metadata`;

const requireCheck = (condition, message) => {
  if (!condition) throw new Error(`AWS development audit failed: ${message}`);
};

async function aws(service, operation, args = []) {
  const { stdout } = await execute(
    "aws",
    [service, operation, ...args, "--region", region, "--output", "json", "--no-cli-pager"],
    {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, AWS_EC2_METADATA_DISABLED: "true" },
    },
  );
  return JSON.parse(stdout);
}

const identity = await aws("sts", "get-caller-identity");
requireCheck(identity.Account === accountId, `expected account ${accountId}, received ${identity.Account}`);

const key = (await aws("kms", "describe-key", ["--key-id", keyAlias])).KeyMetadata;
const rotation = await aws("kms", "get-key-rotation-status", ["--key-id", key.KeyId]);
requireCheck(key.Enabled && key.KeyState === "Enabled", "environment KMS key is not enabled");
requireCheck(rotation.KeyRotationEnabled, "environment KMS key rotation is disabled");

const rds = (await aws("rds", "describe-db-instances", [
  "--db-instance-identifier", `${name}-postgres`,
])).DBInstances[0];
requireCheck(rds.DBInstanceStatus === "available", "RDS is not available");
requireCheck(rds.StorageEncrypted && rds.KmsKeyId === key.Arn, "RDS storage is not encrypted with the environment key");
requireCheck(!rds.PubliclyAccessible, "RDS is publicly accessible");
requireCheck(rds.BackupRetentionPeriod === 35, "RDS backup retention is not 35 days");
requireCheck(
  rds.Engine === "postgres" && rds.EngineVersion === reviewedPostgresVersion,
  "RDS engine is not the reviewed PostgreSQL version",
);
requireCheck(rds.MasterUserSecret?.SecretStatus === "active", "RDS-managed credential is not active");
requireCheck(rds.MasterUserSecret?.KmsKeyId === key.Arn, "RDS-managed credential is not encrypted with the environment key");
requireCheck(
  ["postgresql", "upgrade"].every((entry) => rds.EnabledCloudwatchLogsExports?.includes(entry)),
  "RDS log exports are incomplete",
);

const vpcs = await aws("ec2", "describe-vpcs", [
  "--filters", `Name=tag:Name,Values=${name}-vpc`,
]);
requireCheck(vpcs.Vpcs.length === 1, "expected exactly one development VPC");
const vpc = vpcs.Vpcs[0];

const subnets = (await aws("ec2", "describe-subnets", [
  "--filters", `Name=vpc-id,Values=${vpc.VpcId}`,
])).Subnets;
requireCheck(subnets.length === 2, "expected exactly two private subnets");
requireCheck(subnets.every((subnet) => !subnet.MapPublicIpOnLaunch), "a development subnet maps public IP addresses");
requireCheck(new Set(subnets.map((subnet) => subnet.AvailabilityZone)).size === 2, "private subnets do not span two Availability Zones");

const routeTables = (await aws("ec2", "describe-route-tables", [
  "--filters", `Name=vpc-id,Values=${vpc.VpcId}`,
])).RouteTables;
requireCheck(routeTables.length === 3, "expected two private route tables plus the VPC main route table");
requireCheck(
  routeTables.every((table) => table.Routes.every((route) => (
    route.DestinationCidrBlock !== "0.0.0.0/0"
    && route.DestinationIpv6CidrBlock !== "::/0"
    && !route.NatGatewayId
    && !route.TransitGatewayId
  ))),
  "an internet, NAT, IPv6-default, or transit route exists",
);

const endpoints = (await aws("ec2", "describe-vpc-endpoints", [
  "--filters", `Name=vpc-id,Values=${vpc.VpcId}`,
])).VpcEndpoints.filter((endpoint) => endpoint.State === "available");
requireCheck(
  endpoints.length === 1
    && endpoints[0].VpcEndpointType === "Gateway"
    && endpoints[0].ServiceName === `com.amazonaws.${region}.s3`
    && endpoints[0].State === "available",
  "the bounded S3 gateway endpoint is unavailable or unexpected",
);

const securityGroups = (await aws("ec2", "describe-security-groups", [
  "--filters", `Name=vpc-id,Values=${vpc.VpcId}`,
])).SecurityGroups;
const databaseGroup = securityGroups.find((group) => group.GroupName === `${name}-database`);
const workloadGroup = securityGroups.find((group) => group.GroupName === `${name}-workload`);
requireCheck(databaseGroup && workloadGroup, "database or workload security group is missing");
const securityRules = (await aws("ec2", "describe-security-group-rules", [
  "--filters", `Name=group-id,Values=${databaseGroup.GroupId},${workloadGroup.GroupId}`,
])).SecurityGroupRules;
requireCheck(securityRules.length === 2, "security groups contain an unexpected rule");
requireCheck(securityRules.every((rule) => (
  rule.IpProtocol === "tcp"
  && rule.FromPort === 5432
  && rule.ToPort === 5432
  && [databaseGroup.GroupId, workloadGroup.GroupId].includes(rule.ReferencedGroupInfo?.GroupId)
)), "security groups allow a path other than PostgreSQL between the workload and database");

async function inspectBucket(bucket, expected) {
  const [publicAccess, ownership, encryption, lifecycle, policy] = await Promise.all([
    aws("s3api", "get-public-access-block", ["--bucket", bucket]),
    aws("s3api", "get-bucket-ownership-controls", ["--bucket", bucket]),
    aws("s3api", "get-bucket-encryption", ["--bucket", bucket]),
    aws("s3api", "get-bucket-lifecycle-configuration", ["--bucket", bucket]),
    aws("s3api", "get-bucket-policy", ["--bucket", bucket]),
  ]);
  const block = publicAccess.PublicAccessBlockConfiguration;
  requireCheck(Object.values(block).every(Boolean), `${bucket} does not block all public access`);
  requireCheck(
    ownership.OwnershipControls.Rules.some((rule) => rule.ObjectOwnership === "BucketOwnerEnforced"),
    `${bucket} does not enforce bucket ownership`,
  );
  const encryptionRule = encryption.ServerSideEncryptionConfiguration.Rules[0];
  requireCheck(
    encryptionRule.ApplyServerSideEncryptionByDefault.SSEAlgorithm === "aws:kms"
      && encryptionRule.ApplyServerSideEncryptionByDefault.KMSMasterKeyID === key.Arn
      && encryptionRule.BucketKeyEnabled,
    `${bucket} encryption is not bound to the environment key with bucket keys`,
  );
  const rule = lifecycle.Rules.find((entry) => entry.ID === expected.id);
  requireCheck(rule?.Status === "Enabled", `${bucket} lifecycle rule is unavailable`);
  requireCheck(rule.Expiration?.Days === expected.expiryDays, `${bucket} expiry is not ${expected.expiryDays} days`);
  if (expected.noncurrentDays) {
    requireCheck(
      rule.NoncurrentVersionExpiration?.NoncurrentDays === expected.noncurrentDays,
      `${bucket} noncurrent expiry is not ${expected.noncurrentDays} days`,
    );
  }
  const statements = JSON.parse(policy.Policy).Statement;
  requireCheck(statements.some((statement) => (
    statement.Sid === "DenyInsecureTransport"
    && statement.Effect === "Deny"
    && statement.Condition?.Bool?.["aws:SecureTransport"] === "false"
  )), `${bucket} does not deny insecure transport`);
  return { bucket, lifecycleRule: expected.id, expiryDays: expected.expiryDays };
}

const metadataBucket = `${name}-${accountId}-metadata`;
const quarantineBucket = `${name}-${accountId}-quarantine`;
const [metadataStorage, quarantineStorage, metadataVersioning] = await Promise.all([
  inspectBucket(metadataBucket, { id: "metadata-retention", expiryDays: 30, noncurrentDays: 35 }),
  inspectBucket(quarantineBucket, { id: "quarantine-expiry", expiryDays: 1 }),
  aws("s3api", "get-bucket-versioning", ["--bucket", metadataBucket]),
]);
requireCheck(metadataVersioning.Status === "Enabled", "metadata bucket versioning is disabled");

async function inspectQueue(queueName) {
  const queueUrl = (await aws("sqs", "get-queue-url", ["--queue-name", queueName])).QueueUrl;
  const attributes = (await aws("sqs", "get-queue-attributes", [
    "--queue-url", queueUrl,
    "--attribute-names", "All",
  ])).Attributes;
  requireCheck(attributes.KmsMasterKeyId === key.Arn, `${queueName} is not encrypted with the environment key`);
  return attributes;
}

const [queue, deadLetterQueue] = await Promise.all([
  inspectQueue(`${name}-metadata`),
  inspectQueue(`${name}-metadata-dead-letter`),
]);
const redrive = JSON.parse(queue.RedrivePolicy);
const redriveAllow = JSON.parse(deadLetterQueue.RedriveAllowPolicy);
requireCheck(Number(queue.MessageRetentionPeriod) === 345600, "metadata queue retention is not four days");
requireCheck(Number(deadLetterQueue.MessageRetentionPeriod) === 1209600, "dead-letter queue retention is not fourteen days");
requireCheck(Number(redrive.maxReceiveCount) === 5, "queue max receive count is not five");
requireCheck(redriveAllow.redrivePermission === "byQueue", "dead-letter queue redrive permission is not source-bound");

const clusters = await aws("ecs", "describe-clusters", [
  "--clusters", `${name}-metadata`,
  "--include", "SETTINGS", "CONFIGURATIONS", "TAGS",
]);
const cluster = clusters.clusters[0];
requireCheck(cluster?.status === "ACTIVE", "metadata ECS cluster is not active");
requireCheck(cluster.settings?.some((setting) => setting.name === "containerInsights" && setting.value === "enabled"), "ECS container insights are disabled");
requireCheck(
  cluster.configuration?.executeCommandConfiguration?.kmsKeyId === key.Arn
    && cluster.configuration?.executeCommandConfiguration?.logConfiguration?.cloudWatchEncryptionEnabled,
  "ECS execute-command logging is not encrypted with the environment key",
);

const logGroups = (await aws("logs", "describe-log-groups", [
  "--log-group-name-prefix", "/",
])).logGroups.filter((group) => (
  group.logGroupName.startsWith(`/verification/${environment}/`)
  || group.logGroupName.startsWith(`/aws/rds/instance/${name}-postgres/`)
));
const expectedLogGroups = [
  `/verification/${environment}/api`,
  `/verification/${environment}/worker`,
  `/aws/rds/instance/${name}-postgres/postgresql`,
  `/aws/rds/instance/${name}-postgres/upgrade`,
];
requireCheck(expectedLogGroups.every((expected) => logGroups.some((group) => group.logGroupName === expected)), "a required log group is missing");
requireCheck(logGroups.every((group) => group.retentionInDays === 30 && group.kmsKeyId === key.Arn), "a required log group lacks 30-day KMS-encrypted retention");

const budget = (await aws("budgets", "describe-budget", [
  "--account-id", accountId,
  "--budget-name", `${name}-monthly`,
])).Budget;
const notifications = (await aws("budgets", "describe-notifications-for-budget", [
  "--account-id", accountId,
  "--budget-name", `${name}-monthly`,
])).Notifications;
requireCheck(Number(budget.BudgetLimit.Amount) === 100 && budget.BudgetLimit.Unit === "USD", "development budget is not 100 USD");
requireCheck(budget.TimeUnit === "MONTHLY" && budget.BudgetType === "COST", "development budget type or period is unexpected");
const notificationSet = new Set(notifications.map((notification) => `${notification.NotificationType}:${notification.Threshold}`));
requireCheck(
  ["FORECASTED:50", "ACTUAL:80", "ACTUAL:100"].every((expected) => notificationSet.has(expected)),
  "development budget thresholds are incomplete",
);

console.log(JSON.stringify({
  schemaVersion: 1,
  kind: "awsDevelopmentFoundationAudit",
  observedAt: new Date().toISOString(),
  accountId,
  region,
  environment,
  outcome: "passed",
  checks: {
    identity: "passed",
    privateTwoAzNetwork: "passed",
    exactPostgresqlSecurityPath: "passed",
    encryptedPrivateRdsWithManagedCredential: "passed",
    thirtyFiveDayDatabaseBackups: "passed",
    rotatingEnvironmentKey: "passed",
    boundedEncryptedStorage: "passed",
    encryptedQueueAndDeadLetterControls: "passed",
    encryptedBoundedLogs: "passed",
    encryptedEcsAdministration: "passed",
    monthlyBudgetAlerts: "passed",
  },
  resources: {
    vpcId: vpc.VpcId,
    subnetIds: subnets.map((subnet) => subnet.SubnetId).sort(),
    s3EndpointId: endpoints[0].VpcEndpointId,
    databaseSecurityGroupId: databaseGroup.GroupId,
    workloadSecurityGroupId: workloadGroup.GroupId,
    kmsKeyArn: key.Arn,
    rds: {
      identifier: rds.DBInstanceIdentifier,
      status: rds.DBInstanceStatus,
      engine: rds.Engine,
      engineVersion: rds.EngineVersion,
      instanceClass: rds.DBInstanceClass,
      backupRetentionDays: rds.BackupRetentionPeriod,
      publiclyAccessible: rds.PubliclyAccessible,
      storageEncrypted: rds.StorageEncrypted,
      multiAz: rds.MultiAZ,
      managedCredentialStatus: rds.MasterUserSecret.SecretStatus,
    },
    storage: [metadataStorage, quarantineStorage],
    queue: {
      retentionSeconds: Number(queue.MessageRetentionPeriod),
      maxReceiveCount: Number(redrive.maxReceiveCount),
      deadLetterRetentionSeconds: Number(deadLetterQueue.MessageRetentionPeriod),
    },
    ecsClusterArn: cluster.clusterArn,
    logGroups: expectedLogGroups,
    budget: { amount: Number(budget.BudgetLimit.Amount), unit: budget.BudgetLimit.Unit },
  },
}, null, 2));
