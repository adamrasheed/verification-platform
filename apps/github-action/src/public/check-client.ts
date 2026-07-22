import { request as httpsRequest } from "node:https";
import type { GitHubCheckProjection } from "@verify-internal/github-check-projector";

const MAX_RESPONSE_BYTES = 1024 * 1024;
const API_VERSION = "2026-03-10";

export interface GitHubCheckContext {
  readonly repository: string;
  readonly headSha: string;
  readonly token: string;
}

export interface GitHubCheckRequest {
  readonly method: "POST";
  readonly hostname: "api.github.com";
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface GitHubCheckResponse {
  readonly statusCode: number;
  readonly body: string;
}

export interface GitHubCheckTransport {
  send(request: GitHubCheckRequest, signal: AbortSignal): Promise<GitHubCheckResponse>;
}

export interface GitHubCheckPublication {
  readonly published: boolean;
  readonly code: "VFY_GITHUB_CHECK_PUBLISHED" | "VFY_GITHUB_CHECK_UNAVAILABLE";
  readonly checkRunId?: number;
}

class HttpsCheckTransport implements GitHubCheckTransport {
  send(request: GitHubCheckRequest, signal: AbortSignal): Promise<GitHubCheckResponse> {
    return new Promise((resolve, reject) => {
      const outgoing = httpsRequest({
        method: request.method,
        hostname: request.hostname,
        path: request.path,
        headers: request.headers,
        signal,
        timeout: 30_000,
      }, (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_RESPONSE_BYTES) {
            outgoing.destroy(new Error("GitHub response exceeded the fixed limit"));
            return;
          }
          chunks.push(chunk);
        });
        response.once("end", () => resolve({
          statusCode: response.statusCode ?? 0,
          body: Buffer.concat(chunks).toString("utf8"),
        }));
      });
      outgoing.once("timeout", () => outgoing.destroy(new Error("GitHub request timed out")));
      outgoing.once("error", reject);
      outgoing.end(request.body);
    });
  }
}

function repositoryPath(repository: string): string {
  if (!/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(repository)) {
    throw new Error("repository identity is invalid");
  }
  return `/repos/${repository}/check-runs`;
}

function headSha(value: string): string {
  if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(value)) {
    throw new Error("commit identity is invalid");
  }
  return value;
}

export async function publishGitHubCheck(
  projection: GitHubCheckProjection,
  context: GitHubCheckContext,
  signal: AbortSignal,
  transport: GitHubCheckTransport = new HttpsCheckTransport(),
): Promise<GitHubCheckPublication> {
  if (context.token.length === 0 || context.token.length > 4096 || /[\r\n]/.test(context.token)) {
    return { published: false, code: "VFY_GITHUB_CHECK_UNAVAILABLE" };
  }
  let path: string;
  let sha: string;
  try {
    path = repositoryPath(context.repository);
    sha = headSha(context.headSha);
  } catch {
    return { published: false, code: "VFY_GITHUB_CHECK_UNAVAILABLE" };
  }
  const body = JSON.stringify({
    name: "Verify",
    head_sha: sha,
    status: projection.status,
    conclusion: projection.conclusion,
    external_id: projection.invocationId,
    output: projection.output,
  });
  try {
    const response = await transport.send({
      method: "POST",
      hostname: "api.github.com",
      path,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${context.token}`,
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(body)),
        "user-agent": "verify-github-action",
        "x-github-api-version": API_VERSION,
      },
      body,
    }, signal);
    if (response.statusCode !== 201) {
      return { published: false, code: "VFY_GITHUB_CHECK_UNAVAILABLE" };
    }
    const parsed = JSON.parse(response.body) as { readonly id?: unknown };
    if (!Number.isSafeInteger(parsed.id) || Number(parsed.id) <= 0) {
      return { published: false, code: "VFY_GITHUB_CHECK_UNAVAILABLE" };
    }
    return {
      published: true,
      code: "VFY_GITHUB_CHECK_PUBLISHED",
      checkRunId: Number(parsed.id),
    };
  } catch {
    return { published: false, code: "VFY_GITHUB_CHECK_UNAVAILABLE" };
  }
}
