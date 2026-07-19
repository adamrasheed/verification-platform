import {
  LocalVerificationRuntime,
  VerificationEngine,
} from "@verify-internal/engine";
import type {
  VerifyResult as EngineVerifyResult,
} from "@verify-internal/engine";
import type {
  CliExitCode,
  VerifyRequest,
} from "@verify-internal/protocol";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface CliEngineAdapter {
  verify(
    request: VerifyRequest,
    signal: AbortSignal,
  ): Promise<EngineVerifyResult>;
}

export class CurrentEngineAdapter implements CliEngineAdapter {
  readonly #engine: VerificationEngine;

  constructor(engine: VerificationEngine = new VerificationEngine()) {
    this.#engine = engine;
  }

  async verify(
    request: VerifyRequest,
    signal: AbortSignal,
  ): Promise<EngineVerifyResult> {
    return this.#engine.verify({
      schemaVersion: 1,
      workspaceRoot: request.workspace.rootBinding,
      invocationId: request.invocationId,
      ...(request.deadlineMs === undefined
        ? {}
        : { deadlineMs: request.deadlineMs }),
      signal,
    });
  }
}

function requestDisablesCache(request: VerifyRequest): boolean {
  return (
    typeof request.arguments === "object" &&
    request.arguments !== null &&
    !Array.isArray(request.arguments) &&
    "noCache" in request.arguments &&
    request.arguments.noCache === true
  );
}

export interface PersistenceProjection {
  /**
   * Canonical service-owned document. The CLI serializes it without adding
   * domain fields or recalculating a verdict.
   */
  readonly document: unknown;
  /**
   * Service-owned human projection. This keeps persistence semantics out of
   * the CLI until execution exports a shared protocol contract for them.
   */
  readonly humanLines: readonly string[];
  readonly exitCode: CliExitCode;
}

export interface CliPersistenceAdapter {
  inspectRun(id: string): Promise<PersistenceProjection>;
  inspectEvidence(id: string): Promise<PersistenceProjection>;
  inspectCache(): Promise<PersistenceProjection>;
  clearCache(): Promise<PersistenceProjection>;
}

export class PersistenceUnavailableError extends Error {
  constructor() {
    super("local persistence is not configured for this CLI process");
    this.name = "PersistenceUnavailableError";
  }
}

export class PersistenceNotFoundError extends Error {
  constructor(resource: "run" | "evidence", id: string) {
    super(`${resource} not found: ${id}`);
    this.name = "PersistenceNotFoundError";
  }
}

export class UnavailablePersistenceAdapter implements CliPersistenceAdapter {
  async inspectRun(_id: string): Promise<PersistenceProjection> {
    throw new PersistenceUnavailableError();
  }

  async inspectEvidence(_id: string): Promise<PersistenceProjection> {
    throw new PersistenceUnavailableError();
  }

  async inspectCache(): Promise<PersistenceProjection> {
    throw new PersistenceUnavailableError();
  }

  async clearCache(): Promise<PersistenceProjection> {
    throw new PersistenceUnavailableError();
  }
}

export interface LocalStateEnvironment {
  readonly XDG_STATE_HOME?: string;
}

export function defaultLocalStateRoot(
  workspace: string,
  environment: LocalStateEnvironment = process.env as LocalStateEnvironment,
): string {
  const workspaceDigest = createHash("sha256")
    .update(resolve(workspace))
    .digest("hex");
  const base = environment.XDG_STATE_HOME ?? join(homedir(), ".local", "state");
  return join(base, "verify", "workspaces", workspaceDigest);
}

/**
 * Public-engine composition for the production CLI. The adapter contains only
 * request transport and presentation; storage semantics remain engine-owned.
 */
export class LocalRuntimeAdapter
  implements CliEngineAdapter, CliPersistenceAdapter {
  readonly #runtime: LocalVerificationRuntime;
  readonly #nonPersistentEngine: VerificationEngine;

  constructor(stateRoot: string) {
    this.#runtime = new LocalVerificationRuntime(stateRoot);
    this.#nonPersistentEngine = new VerificationEngine();
  }

  async verify(
    request: VerifyRequest,
    signal: AbortSignal,
  ): Promise<EngineVerifyResult> {
    const engineRequest = {
      schemaVersion: 1 as const,
      workspaceRoot: request.workspace.rootBinding,
      invocationId: request.invocationId,
      ...(request.deadlineMs === undefined
        ? {}
        : { deadlineMs: request.deadlineMs }),
      signal,
    };
    try {
      return await this.#runtime.verify(
        engineRequest,
        requestDisablesCache(request),
      );
    } catch (error) {
      if (!signal.aborted) throw error;
      // Persistence may reject a cancellation before discovery produced a
      // revision-addressed subject. Ask the same public Engine for the
      // cancellation result without attempting a second durable write.
      return this.#nonPersistentEngine.verify(engineRequest);
    }
  }

  async inspectRun(id: string): Promise<PersistenceProjection> {
    const document = this.#runtime.readRun(id);
    if (document === undefined) throw new PersistenceNotFoundError("run", id);
    return {
      document,
      humanLines: JSON.stringify(document, null, 2).split("\n"),
      exitCode: 0,
    };
  }

  async inspectEvidence(id: string): Promise<PersistenceProjection> {
    const document = await this.#runtime.readEvidence(id);
    if (document === undefined) {
      throw new PersistenceNotFoundError("evidence", id);
    }
    return {
      document,
      humanLines: JSON.stringify(document, null, 2).split("\n"),
      exitCode: 0,
    };
  }

  async inspectCache(): Promise<PersistenceProjection> {
    const document = this.#runtime.inspectCache();
    return {
      document,
      humanLines: JSON.stringify(document, null, 2).split("\n"),
      exitCode: 0,
    };
  }

  async clearCache(): Promise<PersistenceProjection> {
    const document = await this.#runtime.clearCache();
    return {
      document,
      humanLines: JSON.stringify(document, null, 2).split("\n"),
      exitCode: 0,
    };
  }

  close(): void {
    this.#runtime.close();
  }
}
