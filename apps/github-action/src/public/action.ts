import { join } from "node:path";
import { LocalCanonicalDispatcher } from "@verify-internal/adapter-core";
import type { AnyCommandEnvelope } from "@verify-internal/protocol";
import {
  projectGitHubCheck,
} from "@verify-internal/github-check-projector";
import type {
  GitHubCheckProjection,
} from "@verify-internal/github-check-projector";
import {
  publishGitHubCheck,
} from "./check-client.js";
import type {
  GitHubCheckPublication,
  GitHubCheckTransport,
} from "./check-client.js";

export interface GitHubActionEnvironment {
  readonly GITHUB_WORKSPACE?: string;
  readonly GITHUB_REPOSITORY?: string;
  readonly GITHUB_SHA?: string;
  readonly RUNNER_TEMP?: string;
  readonly [key: string]: string | undefined;
}

export interface GitHubActionOptions {
  readonly environment: GitHubActionEnvironment;
  readonly signal: AbortSignal;
  readonly dispatcher?: LocalCanonicalDispatcher;
  readonly checkTransport?: GitHubCheckTransport;
}

export interface GitHubActionResult {
  readonly envelope: AnyCommandEnvelope;
  readonly projection: GitHubCheckProjection;
  readonly publication: GitHubCheckPublication | {
    readonly published: false;
    readonly code: "VFY_GITHUB_CHECK_DISABLED";
  };
}

function booleanInput(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === "") return defaultValue;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error("boolean action input must be true or false");
}

export async function runGitHubAction(options: GitHubActionOptions): Promise<GitHubActionResult> {
  const workspace = options.environment.GITHUB_WORKSPACE;
  if (workspace === undefined || workspace.length === 0) {
    throw new Error("GITHUB_WORKSPACE is required");
  }
  const ownedDispatcher = options.dispatcher === undefined;
  const dispatcher = options.dispatcher ?? new LocalCanonicalDispatcher({
    workspace: { id: "workspace:github-action", root: workspace },
    stateRoot: join(options.environment.RUNNER_TEMP ?? workspace, "verify-state"),
  });
  try {
    const dispatch = await dispatcher.verify({
      workspaceBinding: "workspace:github-action",
      offline: true,
      noCache: booleanInput(options.environment["INPUT_NO-CACHE"], true),
    }, options.signal);
    const projection = projectGitHubCheck(dispatch.envelope);
    const publish = booleanInput(options.environment["INPUT_PUBLISH-CHECK"], true);
    const publication = publish
      ? await publishGitHubCheck(projection, {
          repository: options.environment.GITHUB_REPOSITORY ?? "",
          headSha: options.environment.GITHUB_SHA ?? "",
          token: options.environment["INPUT_GITHUB-TOKEN"] ?? "",
        }, options.signal, options.checkTransport)
      : { published: false as const, code: "VFY_GITHUB_CHECK_DISABLED" as const };
    return { envelope: dispatch.envelope, projection, publication };
  } finally {
    if (ownedDispatcher) dispatcher.close();
  }
}
