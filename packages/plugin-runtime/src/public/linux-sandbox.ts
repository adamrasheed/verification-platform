import { createHash } from "node:crypto";
import {
  spawn,
  type ChildProcess,
} from "node:child_process";
import {
  readFile,
  stat,
} from "node:fs/promises";
import path from "node:path";
import {
  boundedUtf8Lines,
  type SandboxLauncher,
  type SandboxProcess,
  type SandboxProcessExit,
} from "./sandbox.js";
import { PluginRuntimeError } from "./errors.js";

export interface LinuxNamespaceSandboxLauncherOptions {
  readonly nativeDirectory: string;
  readonly nodePath?: string;
  readonly bubblewrapPath?: string;
  readonly expectedHostDigest: string;
  readonly expectedNodeDigest: string;
  readonly expectedBubblewrapDigest: string;
  readonly expectedSeccompLibraryDigest: string;
  readonly maximumMemoryBytes?: number;
  readonly maximumCpuNanoseconds?: number;
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function exactExecutable(
  file: string,
  expectedDigest: string,
  executable: boolean,
): Promise<boolean> {
  if (!/^sha256:[a-f0-9]{64}$/.test(expectedDigest)) return false;
  try {
    const information = await stat(file);
    const effectiveUser = process.geteuid?.();
    if (
      !information.isFile()
      || (information.mode & 0o022) !== 0
      || (executable && (information.mode & 0o111) === 0)
      || (
        effectiveUser !== undefined
        && information.uid !== effectiveUser
        && information.uid !== 0
      )
    ) return false;
    return sha256(await readFile(file)) === expectedDigest;
  } catch {
    return false;
  }
}

async function verifyIdentity(
  options: LinuxNamespaceSandboxLauncherOptions,
): Promise<boolean> {
  if (process.platform !== "linux") return false;
  const host = path.join(options.nativeDirectory, "VerifyPluginHost");
  const seccomp = path.join(
    options.nativeDirectory,
    "VerifyPluginSeccomp.so",
  );
  const node = options.nodePath ?? process.execPath;
  const bubblewrap = options.bubblewrapPath ?? "/usr/bin/bwrap";
  const identities = await Promise.all([
    exactExecutable(host, options.expectedHostDigest, true),
    exactExecutable(node, options.expectedNodeDigest, true),
    exactExecutable(bubblewrap, options.expectedBubblewrapDigest, true),
    exactExecutable(
      seccomp,
      options.expectedSeccompLibraryDigest,
      false,
    ),
  ]);
  return identities.every(Boolean);
}

function childExit(child: ChildProcess): Promise<SandboxProcessExit> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

function signalProcessGroup(
  child: ChildProcess,
  signal: NodeJS.Signals,
): void {
  try {
    if (child.pid) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    child.kill(signal);
  }
}

export function createLinuxNamespaceSandboxLauncher(
  options: LinuxNamespaceSandboxLauncherOptions,
): SandboxLauncher {
  const maximumMemoryBytes = options.maximumMemoryBytes ?? 256 * 1024 * 1024;
  const maximumCpuNanoseconds =
    options.maximumCpuNanoseconds ?? 30 * 1_000_000_000;
  if (
    !Number.isSafeInteger(maximumMemoryBytes)
    || maximumMemoryBytes < 64 * 1024 * 1024
    || !Number.isSafeInteger(maximumCpuNanoseconds)
    || maximumCpuNanoseconds < 1_000_000_000
  ) throw new TypeError("Linux sandbox resource limits are invalid");
  const resourceLimits = {
    maximumMemoryBytes,
    maximumCpuNanoseconds,
    maximumPluginProcesses: 1,
  } as const;
  const host = path.join(options.nativeDirectory, "VerifyPluginHost");
  const seccomp = path.join(
    options.nativeDirectory,
    "VerifyPluginSeccomp.so",
  );
  const node = options.nodePath ?? process.execPath;
  const bubblewrap = options.bubblewrapPath ?? "/usr/bin/bwrap";
  return {
    production: true,
    enforcementTier: "linux-namespace-seccomp-v1",
    resourceLimits,
    async available(): Promise<boolean> {
      return verifyIdentity(options);
    },
    async launch(request): Promise<SandboxProcess> {
      if (!(await verifyIdentity(options))) {
        throw new PluginRuntimeError(
          "VFY_PLUGIN_PLATFORM_UNAVAILABLE",
          "the Linux sandbox host identity is unavailable",
        );
      }
      const artifact = await readFile(request.entryPoint);
      const child = spawn(host, [
        "--artifact-digest",
        sha256(artifact),
        "--node",
        node,
        "--node-digest",
        options.expectedNodeDigest,
        "--bubblewrap",
        bubblewrap,
        "--bubblewrap-digest",
        options.expectedBubblewrapDigest,
        "--seccomp-library",
        seccomp,
        "--seccomp-library-digest",
        options.expectedSeccompLibraryDigest,
        "--maximum-memory-bytes",
        String(maximumMemoryBytes),
        "--maximum-cpu-nanoseconds",
        String(maximumCpuNanoseconds),
      ], {
        detached: true,
        env: {},
        stdio: ["pipe", "pipe", "pipe", "pipe"],
      });
      const artifactChannel = child.stdio[3];
      if (!artifactChannel || !("end" in artifactChannel)) {
        child.kill("SIGKILL");
        throw new PluginRuntimeError(
          "VFY_PLUGIN_PLATFORM_UNAVAILABLE",
          "the Linux sandbox artifact channel is unavailable",
        );
      }
      artifactChannel.end(artifact);
      if (!child.stdin || !child.stdout || !child.stderr) {
        child.kill("SIGKILL");
        throw new PluginRuntimeError(
          "VFY_PLUGIN_PLATFORM_UNAVAILABLE",
          "the Linux sandbox protocol pipes are unavailable",
        );
      }
      return {
        enforcementTier: "linux-namespace-seccomp-v1",
        stdoutLines: boundedUtf8Lines(child.stdout),
        stderr: child.stderr,
        exit: childExit(child),
        async write(line: string): Promise<void> {
          await new Promise<void>((resolve, reject) => {
            child.stdin.write(line, (error) => error ? reject(error) : resolve());
          });
        },
        terminate(): void {
          signalProcessGroup(child, "SIGTERM");
        },
        kill(): void {
          signalProcessGroup(child, "SIGTERM");
          const timer = setTimeout(
            () => signalProcessGroup(child, "SIGKILL"),
            50,
          );
          timer.unref();
        },
      };
    },
  };
}
