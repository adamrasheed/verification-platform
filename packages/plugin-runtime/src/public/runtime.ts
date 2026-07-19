import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rm,
} from "node:fs/promises";
import path from "node:path";
import type { PluginAuthorizationDecision } from "@verify-internal/auth";
import {
  CURRENT_PLUGIN_CONTRACT,
  PLUGIN_MANIFEST_MAX_BYTES,
  PLUGIN_STDERR_MAX_BYTES,
  assertProviderPluginManifest,
  decodePluginMessage,
  encodePluginMessage,
  negotiatePluginContract,
  pluginVersionString,
  type PluginMessage,
  type PluginOperationRequest,
  type ProviderPluginManifest,
} from "@verify-internal/plugin-sdk";
import {
  canonicalize,
  parseCanonicalJson,
  type CanonicalValue,
} from "@verify-internal/contracts";
import type { ProviderEgressBroker, ProviderEgressGrant } from "./broker.js";
import {
  PluginRuntimeError,
  asPluginRuntimeError,
} from "./errors.js";
import type {
  PluginRevocations,
  PluginTrustDecision,
  TrustedPluginPublisher,
} from "./trust.js";
import {
  localDevelopmentTrust,
  verifyPluginPublisher,
} from "./trust.js";
import type {
  SandboxLauncher,
  SandboxProcess,
  SandboxResourceLimits,
} from "./sandbox.js";

export interface PluginInvocation {
  readonly manifest: unknown;
  readonly pluginRoot: string;
  readonly operation: PluginOperationRequest;
  readonly authorization: PluginAuthorizationDecision;
  readonly egressGrant: ProviderEgressGrant;
  readonly readRoots: readonly string[];
  readonly scratchRoot: string;
  readonly allowLocalDevelopment: boolean;
  readonly signal: AbortSignal;
}

export interface PluginInvocationResult {
  readonly selectedProtocolVersion: string;
  readonly enforcementTier: string;
  readonly trustTier: PluginTrustDecision["tier"];
  readonly contributions: readonly CanonicalValue[];
  readonly diagnostics: readonly string[];
  readonly resourceLimits: SandboxLauncher["resourceLimits"];
}

export interface PluginRuntimeOptions {
  readonly engineVersion: string;
  readonly publishers: readonly TrustedPluginPublisher[];
  readonly revocations: PluginRevocations;
  readonly sandbox: SandboxLauncher;
  readonly egress: ProviderEgressBroker;
  readonly now: () => Date;
  readonly redactDiagnostic: (value: string) => string | undefined;
  readonly artifactStagingRoot: string;
  readonly cancellationGraceMs?: number;
  readonly conformanceMode?: boolean;
}

function artifactDigest(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function stageArtifact(
  bytes: Uint8Array,
  stagingRoot: string,
): Promise<{ readonly directory: string; readonly entryPoint: string }> {
  try {
    await mkdir(stagingRoot, { recursive: true, mode: 0o700 });
    const root = await realpath(stagingRoot);
    const directory = await mkdtemp(path.join(root, "plugin-"));
    const entryPoint = path.join(directory, "plugin.mjs");
    const handle = await open(entryPoint, "wx", 0o500);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    const stagedBytes = await readFile(entryPoint);
    if (artifactDigest(stagedBytes) !== artifactDigest(bytes)) {
      throw new Error("staged artifact digest mismatch");
    }
    return { directory, entryPoint };
  } catch {
    throw new PluginRuntimeError(
      "VFY_PLUGIN_ARTIFACT_STAGE_FAILED",
      "plugin artifact could not be staged immutably",
    );
  }
}

function semanticVersion(value: string): readonly [number, number, number] {
  const match = value.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) throw new PluginRuntimeError("VFY_PLUGIN_INCOMPATIBLE", "semantic version is invalid");
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersion(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): number {
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

function enforceGrant(
  manifest: ProviderPluginManifest,
  invocation: PluginInvocation,
  trust: PluginTrustDecision,
  expectedEnforcementTier: string,
  expectedResourceLimits: SandboxResourceLimits,
  now: Date,
): void {
  if (!invocation.authorization.allowed) {
    throw new PluginRuntimeError("VFY_PLUGIN_PERMISSION_DENIED", "plugin operation was not authorized");
  }
  const authorized = invocation.authorization.grant;
  if (
    authorized.pluginId !== manifest.pluginId
    || authorized.operationId !== invocation.operation.operationId
    || authorized.enforcementTier !== expectedEnforcementTier
    || authorized.maximumMemoryBytes !== expectedResourceLimits.maximumMemoryBytes
    || authorized.maximumCpuNanoseconds !== expectedResourceLimits.maximumCpuNanoseconds
    || authorized.maximumPluginProcesses
      !== expectedResourceLimits.maximumPluginProcesses
    || !Number.isFinite(Date.parse(authorized.expiresAt))
    || Date.parse(authorized.expiresAt) <= now.getTime()
    || authorized.destinationIds.length !== invocation.egressGrant.destinationIds.length
    || authorized.destinationIds.some((id) => !invocation.egressGrant.destinationIds.includes(id))
    || authorized.secretReferenceIds.length !== invocation.egressGrant.secretReferenceIds.length
    || authorized.secretReferenceIds.some((id) =>
      !invocation.egressGrant.secretReferenceIds.includes(id))
  ) throw new PluginRuntimeError("VFY_PLUGIN_PERMISSION_DENIED", "plugin grant differs from authorization");
  if (!manifest.operations.includes(invocation.operation.operation)) {
    throw new PluginRuntimeError("VFY_PLUGIN_PERMISSION_DENIED", "plugin operation was not declared");
  }
  if (
    manifest.permissions.filesystemReadRoots.length > 0
    || manifest.permissions.filesystemWriteRoots.length > 0
    || manifest.permissions.subprocess
    || manifest.sideEffects.length > 0
    || authorized.filesystemReadRoots.length > 0
    || authorized.filesystemWriteRoots.length > 0
    || authorized.subprocess
    || authorized.sideEffects.length > 0
  ) {
    throw new PluginRuntimeError(
      "VFY_PLUGIN_PERMISSION_DENIED",
      "initial provider runtime permits no filesystem, subprocess, or side-effect grant",
    );
  }
  if (
    invocation.egressGrant.pluginId !== manifest.pluginId
    || invocation.egressGrant.operationId !== invocation.operation.operationId
    || invocation.egressGrant.destinationIds.some((id) =>
      !manifest.permissions.destinations.some((destination) => destination.id === id))
    || invocation.operation.grantedDestinationIds.some((id) =>
      !invocation.egressGrant.destinationIds.includes(id))
    || invocation.operation.secretReferenceIds.some((id) =>
      !invocation.egressGrant.secretReferenceIds.includes(id))
  ) throw new PluginRuntimeError("VFY_PLUGIN_PERMISSION_DENIED", "effective plugin grant exceeds manifest");
  if (trust.tier === "local-development" && (
    invocation.egressGrant.destinationIds.length > 0
    || invocation.egressGrant.secretReferenceIds.length > 0
    || manifest.permissions.filesystemWriteRoots.length > 0
    || manifest.permissions.subprocess
  )) {
    throw new PluginRuntimeError(
      "VFY_PLUGIN_PERMISSION_DENIED",
      "local-development plugins cannot receive network, secrets, writes, or subprocesses",
    );
  }
}

function abortError(signal: AbortSignal): PluginRuntimeError {
  return new PluginRuntimeError(
    signal.aborted ? "VFY_PLUGIN_CANCELLED" : "VFY_PLUGIN_DEADLINE",
    signal.aborted ? "plugin invocation was cancelled" : "plugin deadline elapsed",
  );
}

function processExitError(
  exit: { readonly code: number | null; readonly signal: NodeJS.Signals | null },
  phase: string,
): PluginRuntimeError {
  if (exit.code === 125) {
    return new PluginRuntimeError(
      "VFY_PLUGIN_RESOURCE_EXHAUSTED",
      "plugin exceeded its native resource limit",
    );
  }
  return new PluginRuntimeError(
    "VFY_PLUGIN_CRASH",
    `plugin exited ${phase} (${exit.code ?? exit.signal ?? "unknown"})`,
  );
}

async function nextWithDeadline<T>(
  iterator: AsyncIterator<T>,
  deadline: number,
  signal: AbortSignal,
): Promise<IteratorResult<T>> {
  if (signal.aborted) throw abortError(signal);
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new PluginRuntimeError("VFY_PLUGIN_DEADLINE", "plugin deadline elapsed");
  return new Promise<IteratorResult<T>>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new PluginRuntimeError("VFY_PLUGIN_DEADLINE", "plugin deadline elapsed")),
      remaining,
    );
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortError(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    iterator.next().then(
      (value) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

async function collectStderr(
  processHandle: SandboxProcess,
  diagnostics: string[],
  redact: (value: string) => string | undefined,
): Promise<void> {
  let bytes = 0;
  for await (const chunk of processHandle.stderr) {
    bytes += chunk.byteLength;
    if (bytes > PLUGIN_STDERR_MAX_BYTES) {
      processHandle.kill();
      throw new PluginRuntimeError("VFY_PLUGIN_STDERR_OVERSIZED", "plugin stderr exceeded its limit");
    }
    const value = redact(new TextDecoder().decode(chunk));
    if (value?.trim()) diagnostics.push(value.trim());
  }
}

async function terminate(
  processHandle: SandboxProcess,
  graceMs: number,
): Promise<void> {
  processHandle.terminate();
  const exited = await Promise.race([
    processHandle.exit.then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), graceMs)),
  ]);
  if (!exited) processHandle.kill();
}

export class ProviderPluginRuntime {
  readonly #options: PluginRuntimeOptions;

  constructor(options: PluginRuntimeOptions) {
    this.#options = options;
  }

  async invoke(invocation: PluginInvocation): Promise<PluginInvocationResult> {
    let manifest: ProviderPluginManifest;
    try {
      const copied = parseCanonicalJson(
        canonicalize(invocation.manifest as CanonicalValue),
      );
      assertProviderPluginManifest(copied);
      manifest = copied;
    } catch {
      throw new PluginRuntimeError("VFY_PLUGIN_MANIFEST_INVALID", "plugin manifest is invalid");
    }
    if (new TextEncoder().encode(JSON.stringify(manifest)).byteLength > PLUGIN_MANIFEST_MAX_BYTES) {
      throw new PluginRuntimeError("VFY_PLUGIN_MANIFEST_INVALID", "plugin manifest exceeds byte limit");
    }
    const engineVersion = semanticVersion(this.#options.engineVersion);
    if (
      compareVersion(engineVersion, semanticVersion(manifest.compatibleEngine.minimum)) < 0
      || compareVersion(engineVersion, semanticVersion(manifest.compatibleEngine.maximumExclusive)) >= 0
    ) throw new PluginRuntimeError("VFY_PLUGIN_INCOMPATIBLE", "plugin is incompatible with this Engine");
    if (!manifest.platforms.some((platform) =>
      platform.os === process.platform && platform.architecture === process.arch)) {
      throw new PluginRuntimeError("VFY_PLUGIN_PLATFORM_UNAVAILABLE", "plugin does not support this platform");
    }
    const root = await realpath(invocation.pluginRoot);
    const entryPoint = await realpath(path.resolve(root, manifest.entryPoint));
    if (entryPoint !== root && !entryPoint.startsWith(`${root}${path.sep}`)) {
      throw new PluginRuntimeError("VFY_PLUGIN_PERMISSION_DENIED", "plugin entry point escapes artifact root");
    }
    const bytes = await readFile(entryPoint);
    if (artifactDigest(bytes) !== manifest.artifactDigest) {
      throw new PluginRuntimeError("VFY_PLUGIN_ARTIFACT_MISMATCH", "plugin artifact digest mismatch");
    }
    let trust: PluginTrustDecision;
    try {
      trust = verifyPluginPublisher(
        manifest,
        this.#options.publishers,
        this.#options.revocations,
        this.#options.now(),
      );
    } catch (error) {
      if (error instanceof PluginRuntimeError && error.code === "VFY_PLUGIN_REVOKED") throw error;
      if (!invocation.allowLocalDevelopment) throw error;
      trust = localDevelopmentTrust(manifest);
    }
    enforceGrant(
      manifest,
      invocation,
      trust,
      this.#options.sandbox.enforcementTier,
      this.#options.sandbox.resourceLimits,
      this.#options.now(),
    );
    if (
      !this.#options.conformanceMode
      && (!this.#options.sandbox.production || !(await this.#options.sandbox.available()))
    ) {
      throw new PluginRuntimeError("VFY_PLUGIN_PLATFORM_UNAVAILABLE", "production plugin sandbox is unavailable");
    }
    let processHandle: SandboxProcess | undefined;
    let stageDirectory: string | undefined;
    let stderrTask: Promise<void> | undefined;
    let stderrFailure: PluginRuntimeError | undefined;
    const diagnostics: string[] = [];
    try {
      const staged = await stageArtifact(bytes, this.#options.artifactStagingRoot);
      stageDirectory = staged.directory;
      processHandle = await this.#options.sandbox.launch({
        entryPoint: staged.entryPoint,
        pluginRoot: staged.directory,
        readRoots: invocation.authorization.allowed
          ? invocation.authorization.grant.filesystemReadRoots
          : [],
        scratchRoot: invocation.scratchRoot,
        maximumStderrBytes: PLUGIN_STDERR_MAX_BYTES,
      });
      stderrTask = collectStderr(
        processHandle,
        diagnostics,
        this.#options.redactDiagnostic,
      ).catch((error: unknown) => {
        stderrFailure = asPluginRuntimeError(error);
        processHandle?.kill();
      });
      const iterator = processHandle.stdoutLines[Symbol.asyncIterator]();
      const deadline = Date.parse(invocation.operation.deadline);
      if (!Number.isFinite(deadline)) {
        throw new PluginRuntimeError("VFY_PLUGIN_PROTOCOL", "plugin deadline is invalid");
      }
      const handshakeRequestId = `${invocation.operation.operationId}:handshake`;
      await processHandle.write(encodePluginMessage({
        protocolVersion: pluginVersionString(CURRENT_PLUGIN_CONTRACT),
        messageType: "handshake.request",
        requestId: handshakeRequestId,
        payload: {
          supportedVersions: [CURRENT_PLUGIN_CONTRACT],
          engineVersion: this.#options.engineVersion,
        } as unknown as CanonicalValue,
      }));
      const handshakeLine = await nextWithDeadline(iterator, deadline, invocation.signal);
      if (handshakeLine.done) {
        const exit = await processHandle.exit;
        throw processExitError(exit, "before handshake");
      }
      const handshake = decodePluginMessage(handshakeLine.value);
      if (
        handshake.protocolVersion !== pluginVersionString(CURRENT_PLUGIN_CONTRACT)
        ||
        handshake.messageType !== "handshake.response"
        || handshake.requestId !== handshakeRequestId
        || typeof handshake.payload !== "object"
        || handshake.payload === null
        || Array.isArray(handshake.payload)
      ) throw new PluginRuntimeError("VFY_PLUGIN_PROTOCOL", "invalid plugin handshake");
      const payload = handshake.payload as Record<string, CanonicalValue>;
      const selected = negotiatePluginContract(
        [CURRENT_PLUGIN_CONTRACT],
        manifest.contractVersions,
      );
      const selectedPayload = payload.selectedVersion as
        | Record<string, CanonicalValue>
        | undefined;
      if (
        typeof payload.pluginId !== "string"
        || payload.pluginId !== manifest.pluginId
        || typeof selectedPayload !== "object"
        || selectedPayload === null
        || Array.isArray(selectedPayload)
        || selectedPayload.major !== selected.major
        || selectedPayload.minor !== selected.minor
      ) throw new PluginRuntimeError("VFY_PLUGIN_INCOMPATIBLE", "plugin selected an incompatible contract");
      await processHandle.write(encodePluginMessage({
        protocolVersion: pluginVersionString(selected),
        messageType: "operation.request",
        requestId: invocation.operation.operationId,
        payload: {
          ...invocation.operation,
          enforcementTier: processHandle.enforcementTier,
          grantedDestinationIds: invocation.egressGrant.destinationIds,
          secretReferenceIds: invocation.egressGrant.secretReferenceIds,
          resourceLimits: {
            maximumMemoryBytes:
              this.#options.sandbox.resourceLimits.maximumMemoryBytes,
            maximumCpuNanoseconds:
              this.#options.sandbox.resourceLimits.maximumCpuNanoseconds,
            maximumPluginProcesses:
              this.#options.sandbox.resourceLimits.maximumPluginProcesses,
          },
        } as CanonicalValue,
      }));
      const contributions: CanonicalValue[] = [];
      const providerRequestIds = new Set<string>();
      let complete = false;
      while (!complete) {
        const next = await nextWithDeadline(iterator, deadline, invocation.signal);
        if (next.done) {
          const exit = await processHandle.exit;
          throw processExitError(exit, "without completion");
        }
        let message: PluginMessage;
        try {
          message = decodePluginMessage(next.value);
        } catch (error) {
          throw asPluginRuntimeError(error);
        }
        if (message.requestId !== invocation.operation.operationId) {
          throw new PluginRuntimeError("VFY_PLUGIN_PROTOCOL", "plugin message request ID does not match operation");
        }
        switch (message.messageType) {
          case "contribution":
            contributions.push(message.payload);
            if (contributions.length > 1024) {
              throw new PluginRuntimeError("VFY_PLUGIN_MESSAGE_OVERSIZED", "plugin contribution count exceeded");
            }
            break;
          case "provider.request": {
            const candidate = message.payload as unknown as { providerRequestId?: unknown };
            if (
              typeof candidate.providerRequestId !== "string"
              || providerRequestIds.has(candidate.providerRequestId)
            ) throw new PluginRuntimeError("VFY_PLUGIN_DUPLICATE_MESSAGE", "duplicate provider request");
            providerRequestIds.add(candidate.providerRequestId);
            const response = await this.#options.egress.execute(
              manifest,
              invocation.egressGrant,
              message.payload,
              invocation.signal,
            );
            await processHandle.write(encodePluginMessage({
              protocolVersion: pluginVersionString(selected),
              messageType: "provider.response",
              requestId: invocation.operation.operationId,
              payload: response as unknown as CanonicalValue,
            }));
            break;
          }
          case "complete":
            complete = true;
            break;
          case "error":
            throw new PluginRuntimeError("VFY_PLUGIN_PROTOCOL", "plugin returned an operational error");
          default:
            throw new PluginRuntimeError("VFY_PLUGIN_PROTOCOL", `unexpected plugin message ${message.messageType}`);
        }
      }
      await terminate(processHandle, this.#options.cancellationGraceMs ?? 250);
      await stderrTask;
      if (stderrFailure) throw stderrFailure;
      const result: PluginInvocationResult = {
        selectedProtocolVersion: pluginVersionString(selected),
        enforcementTier: processHandle.enforcementTier,
        trustTier: trust.tier,
        contributions,
        diagnostics,
        resourceLimits: this.#options.sandbox.resourceLimits,
      };
      await rm(stageDirectory, { recursive: true, force: true });
      stageDirectory = undefined;
      return result;
    } catch (error) {
      let runtimeError = asPluginRuntimeError(error);
      if (processHandle) {
        if (
          runtimeError.code === "VFY_PLUGIN_CANCELLED"
          || runtimeError.code === "VFY_PLUGIN_DEADLINE"
        ) {
          try {
            await processHandle.write(encodePluginMessage({
              protocolVersion: pluginVersionString(CURRENT_PLUGIN_CONTRACT),
              messageType: "cancel.request",
              requestId: invocation.operation.operationId,
              payload: {
                cancellationRequestId: invocation.operation.cancellationRequestId,
                reasonCode: runtimeError.code,
              },
            }));
          } catch {
            // Termination remains authoritative when cooperative cancellation fails.
          }
        }
        await terminate(processHandle, this.#options.cancellationGraceMs ?? 250);
      }
      if (stderrTask) await stderrTask;
      if (stderrFailure) runtimeError = stderrFailure;
      if (stageDirectory) await rm(stageDirectory, { recursive: true, force: true });
      throw runtimeError;
    }
  }
}
