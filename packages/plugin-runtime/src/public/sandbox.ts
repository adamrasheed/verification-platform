import {
  PLUGIN_MESSAGE_MAX_BYTES,
} from "@verify-internal/plugin-sdk";

export interface SandboxLaunchRequest {
  readonly entryPoint: string;
  readonly pluginRoot: string;
  readonly readRoots: readonly string[];
  readonly scratchRoot: string;
  readonly maximumStderrBytes: number;
}

export interface SandboxProcessExit {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

export interface SandboxProcess {
  readonly enforcementTier: string;
  readonly stdoutLines: AsyncIterable<string>;
  readonly stderr: AsyncIterable<Uint8Array>;
  readonly exit: Promise<SandboxProcessExit>;
  write(line: string): Promise<void>;
  terminate(): void;
  kill(): void;
}

export interface SandboxLauncher {
  readonly production: boolean;
  readonly enforcementTier: string;
  available(): Promise<boolean>;
  launch(request: SandboxLaunchRequest): Promise<SandboxProcess>;
}

export async function* boundedUtf8Lines(
  source: AsyncIterable<Uint8Array>,
  maximumLineBytes: number = PLUGIN_MESSAGE_MAX_BYTES,
): AsyncIterable<string> {
  let pending = Buffer.alloc(0);
  for await (const raw of source) {
    const chunk = Buffer.from(raw);
    pending = Buffer.concat([pending, chunk]);
    let newline = pending.indexOf(0x0a);
    while (newline >= 0) {
      if (newline > maximumLineBytes) throw new Error("VFY_PLUGIN_MESSAGE_OVERSIZED");
      const line = pending.subarray(0, newline);
      pending = pending.subarray(newline + 1);
      yield new TextDecoder("utf-8", { fatal: true }).decode(line);
      newline = pending.indexOf(0x0a);
    }
    if (pending.byteLength > maximumLineBytes) throw new Error("VFY_PLUGIN_MESSAGE_OVERSIZED");
  }
  if (pending.byteLength > 0) {
    if (pending.byteLength > maximumLineBytes) throw new Error("VFY_PLUGIN_MESSAGE_OVERSIZED");
    yield new TextDecoder("utf-8", { fatal: true }).decode(pending);
  }
}

/**
 * Production execution remains deliberately unavailable until a signed native
 * host for the current platform passes the architecture's isolation canaries.
 */
export function createProductionSandboxLauncher(): SandboxLauncher {
  return {
    production: true,
    enforcementTier: `unavailable-${process.platform}`,
    async available(): Promise<boolean> {
      return false;
    },
    async launch(): Promise<SandboxProcess> {
      throw new Error("VFY_PLUGIN_PLATFORM_UNAVAILABLE");
    },
  };
}
