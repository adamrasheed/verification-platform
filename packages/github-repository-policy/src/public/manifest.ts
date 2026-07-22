import type {
  PluginDestination,
  PluginPlatform,
  ProviderPluginManifest,
} from "@verify-internal/plugin-sdk";

export const GITHUB_REPOSITORY_POLICY_PLUGIN_ID: string = "github-repository-policy";
export const GITHUB_REPOSITORY_POLICY_DESTINATION_IDS: readonly string[] = Object.freeze([
  "github-repository-metadata",
  "github-branch-protection",
  "github-effective-rules",
]);
export const GITHUB_REPOSITORY_POLICY_SECRET_AUDIENCE: string = "github-api";
export const GITHUB_REPOSITORY_POLICY_SECRET_SCOPES: readonly string[] = Object.freeze([
  "repository-metadata:read",
  "repository-administration:read",
]);

function destination(
  id: string,
  pathTemplateId: string,
  maximumResponseBytes: number,
): PluginDestination {
  return {
    id,
    scheme: "https",
    host: "api.github.com",
    port: 443,
    pathTemplateIds: [pathTemplateId],
    methods: ["GET"],
    outboundSchemaIds: ["github.repository-policy.request.v1"],
    outboundClassifications: ["MINIMAL_METADATA"],
    maximumRequestBytes: 1024,
    maximumResponseBytes,
    secretAudience: GITHUB_REPOSITORY_POLICY_SECRET_AUDIENCE,
    secretScopes: GITHUB_REPOSITORY_POLICY_SECRET_SCOPES,
  };
}

export const GITHUB_REPOSITORY_POLICY_DESTINATIONS: readonly PluginDestination[] = Object.freeze([
  destination("github-repository-metadata", "github-repository-metadata", 256 * 1024),
  destination("github-branch-protection", "github-branch-protection", 512 * 1024),
  destination("github-effective-rules", "github-effective-rules", 1024 * 1024),
]);

export interface GitHubRepositoryPolicyManifestOptions {
  readonly artifactDigest: `sha256:${string}`;
  readonly entryPoint?: string;
  readonly platforms: readonly PluginPlatform[];
  readonly sourceRevision: string;
  readonly buildUrl: string;
  readonly publisherId: string;
  readonly keyId: string;
  readonly signature: string;
}

export function createGitHubRepositoryPolicyManifest(
  options: GitHubRepositoryPolicyManifestOptions,
): ProviderPluginManifest {
  return {
    schemaVersion: 1,
    namespace: "verify.providers",
    pluginId: GITHUB_REPOSITORY_POLICY_PLUGIN_ID,
    implementationVersion: "0.1.0",
    artifactDigest: options.artifactDigest,
    contractVersions: [{ major: 1, minor: 0 }],
    compatibleEngine: { minimum: "0.2.0", maximumExclusive: "1.0.0" },
    entryPoint: options.entryPoint ?? "dist/plugin.js",
    platforms: options.platforms,
    capabilities: ["repository.policy"],
    operations: ["observeProvider"],
    evidenceTypes: ["provider.repository-policy"],
    requiredInputs: ["repositoryBinding"],
    permissions: {
      filesystemReadRoots: [],
      filesystemWriteRoots: [],
      subprocess: false,
      destinations: GITHUB_REPOSITORY_POLICY_DESTINATIONS,
      secrets: [{
        audience: GITHUB_REPOSITORY_POLICY_SECRET_AUDIENCE,
        scopes: GITHUB_REPOSITORY_POLICY_SECRET_SCOPES,
      }],
    },
    sideEffects: [],
    publisher: {
      id: options.publisherId,
      keyId: options.keyId,
      sourceRevision: options.sourceRevision,
      buildUrl: options.buildUrl,
    },
    signature: {
      algorithm: "Ed25519",
      keyId: options.keyId,
      value: options.signature,
    },
  };
}
