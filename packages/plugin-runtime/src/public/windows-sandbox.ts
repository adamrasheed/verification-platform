import { createHash } from "node:crypto";
import {
  execFile,
  spawn,
  type ChildProcess,
} from "node:child_process";
import {
  lstat,
  readFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  boundedUtf8Lines,
  type SandboxLauncher,
  type SandboxProcess,
  type SandboxProcessExit,
} from "./sandbox.js";
import { PluginRuntimeError } from "./errors.js";

const executeFile = promisify(execFile);

export interface WindowsAppContainerSandboxLauncherOptions {
  readonly nativeDirectory: string;
  readonly nodePath?: string;
  readonly expectedHostDigest: string;
  readonly expectedNodeDigest: string;
  readonly expectedHostSignerThumbprint?: string;
  readonly expectedNodeSignerThumbprint?: string;
  readonly maximumMemoryBytes?: number;
  readonly maximumCpuNanoseconds?: number;
  readonly allowDevelopmentIdentity?: boolean;
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function exactExecutable(
  file: string,
  expectedDigest: string,
): Promise<boolean> {
  if (!/^sha256:[a-f0-9]{64}$/.test(expectedDigest)) return false;
  try {
    const information = await lstat(file);
    return information.isFile() && sha256(await readFile(file)) === expectedDigest;
  } catch {
    return false;
  }
}

async function authenticodeThumbprint(file: string): Promise<string | undefined> {
  try {
    const script = [
      "$signature = Get-AuthenticodeSignature -LiteralPath $args[0]",
      "if ($signature.Status -ne 'Valid' -or $null -eq $signature.SignerCertificate) { exit 3 }",
      "$signature.SignerCertificate.Thumbprint",
    ].join("; ");
    const result = await executeFile("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      script,
      file,
    ], { windowsHide: true });
    const thumbprint = result.stdout.trim().toUpperCase();
    return /^[A-F0-9]{40,128}$/.test(thumbprint) ? thumbprint : undefined;
  } catch {
    return undefined;
  }
}

async function verifyIdentity(
  options: WindowsAppContainerSandboxLauncherOptions,
): Promise<boolean> {
  if (process.platform !== "win32") return false;
  const host = path.join(options.nativeDirectory, "VerifyPluginHost.exe");
  const node = options.nodePath ?? process.execPath;
  const exact = await Promise.all([
    exactExecutable(host, options.expectedHostDigest),
    exactExecutable(node, options.expectedNodeDigest),
  ]);
  if (!exact.every(Boolean)) return false;
  if (options.allowDevelopmentIdentity) return true;
  const expectedHost = options.expectedHostSignerThumbprint?.toUpperCase();
  const expectedNode = options.expectedNodeSignerThumbprint?.toUpperCase();
  if (
    !expectedHost
    || !expectedNode
    || !/^[A-F0-9]{40,128}$/.test(expectedHost)
    || !/^[A-F0-9]{40,128}$/.test(expectedNode)
  ) return false;
  const [hostSigner, nodeSigner] = await Promise.all([
    authenticodeThumbprint(host),
    authenticodeThumbprint(node),
  ]);
  return hostSigner === expectedHost && nodeSigner === expectedNode;
}

function childExit(child: ChildProcess): Promise<SandboxProcessExit> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

export function createWindowsAppContainerSandboxLauncher(
  options: WindowsAppContainerSandboxLauncherOptions,
): SandboxLauncher {
  const production = options.allowDevelopmentIdentity !== true;
  const enforcementTier = production
    ? "windows-appcontainer-v1"
    : "windows-appcontainer-development-v1";
  const maximumMemoryBytes = options.maximumMemoryBytes ?? 256 * 1024 * 1024;
  const maximumCpuNanoseconds =
    options.maximumCpuNanoseconds ?? 30 * 1_000_000_000;
  if (
    !Number.isSafeInteger(maximumMemoryBytes)
    || maximumMemoryBytes < 64 * 1024 * 1024
    || !Number.isSafeInteger(maximumCpuNanoseconds)
    || maximumCpuNanoseconds < 1_000_000_000
  ) throw new TypeError("Windows sandbox resource limits are invalid");
  const resourceLimits = {
    maximumMemoryBytes,
    maximumCpuNanoseconds,
    maximumPluginProcesses: 1,
  } as const;
  const host = path.join(options.nativeDirectory, "VerifyPluginHost.exe");
  const node = options.nodePath ?? process.execPath;
  return {
    production,
    enforcementTier,
    resourceLimits,
    async available(): Promise<boolean> {
      return verifyIdentity(options);
    },
    async launch(request): Promise<SandboxProcess> {
      if (!(await verifyIdentity(options))) {
        throw new PluginRuntimeError(
          "VFY_PLUGIN_PLATFORM_UNAVAILABLE",
          "the Windows sandbox host identity is unavailable",
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
        "--maximum-memory-bytes",
        String(maximumMemoryBytes),
        "--maximum-cpu-nanoseconds",
        String(maximumCpuNanoseconds),
      ], {
        detached: false,
        env: {},
        stdio: ["pipe", "pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      const artifactChannel = child.stdio[3];
      if (!artifactChannel || !("end" in artifactChannel)) {
        child.kill();
        throw new PluginRuntimeError(
          "VFY_PLUGIN_PLATFORM_UNAVAILABLE",
          "the Windows sandbox artifact channel is unavailable",
        );
      }
      artifactChannel.on("error", () => {
        // The one-shot pipe may reset when the native host is terminated.
      });
      artifactChannel.end(artifact);
      if (!child.stdin || !child.stdout || !child.stderr) {
        child.kill();
        throw new PluginRuntimeError(
          "VFY_PLUGIN_PLATFORM_UNAVAILABLE",
          "the Windows sandbox protocol pipes are unavailable",
        );
      }
      child.stdin.on("error", () => {
        // Live writes receive their callback error; termination may reset the pipe.
      });
      return {
        enforcementTier,
        stdoutLines: boundedUtf8Lines(child.stdout),
        stderr: child.stderr,
        exit: childExit(child),
        async write(line: string): Promise<void> {
          await new Promise<void>((resolve, reject) => {
            child.stdin.write(line, (error) => error ? reject(error) : resolve());
          });
        },
        terminate(): void {
          child.kill();
        },
        kill(): void {
          child.kill();
        },
      };
    },
  };
}
