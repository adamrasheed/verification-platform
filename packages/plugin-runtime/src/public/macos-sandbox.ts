import { createHash } from "node:crypto";
import {
  execFile,
  spawn,
  type ChildProcess,
} from "node:child_process";
import { readFile } from "node:fs/promises";
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

export interface MacOsAppSandboxLauncherOptions {
  readonly appBundlePath: string;
  readonly expectedTeamIdentifier?: string;
  readonly expectedSigningAuthority?: string;
  readonly expectedHostCdHash?: string;
  readonly expectedHelperCdHash?: string;
  readonly expectedSupervisorCdHash?: string;
  readonly maximumMemoryBytes?: number;
  readonly maximumCpuNanoseconds?: number;
  readonly allowDevelopmentSignature?: boolean;
}

interface CodeIdentity {
  readonly identifier: string;
  readonly teamIdentifier: string | undefined;
  readonly cdHash: string;
  readonly authority: string | undefined;
  readonly entitlements: string;
  readonly hardenedRuntime: boolean;
}

async function inspectCodeIdentity(executable: string): Promise<CodeIdentity> {
  const result = await executeFile("/usr/bin/codesign", [
    "-dvvv",
    "--entitlements",
    "-",
    executable,
  ]);
  const value = `${result.stdout}\n${result.stderr}`;
  const identifier = value.match(/^Identifier=(.+)$/m)?.[1];
  const cdHash = value.match(/^CDHash=([a-f0-9]+)$/m)?.[1];
  if (!identifier || !cdHash) throw new Error("code identity is incomplete");
  return {
    identifier,
    teamIdentifier: value.match(/^TeamIdentifier=(.+)$/m)?.[1],
    cdHash,
    authority: value.match(/^Authority=(.+)$/m)?.[1],
    entitlements: value,
    hardenedRuntime: /^CodeDirectory .+\([^)]*runtime[^)]*\)/m.test(value),
  };
}

function hasTrueEntitlement(identity: CodeIdentity, key: string): boolean {
  const keyOffset = identity.entitlements.indexOf(`[Key] ${key}`);
  if (keyOffset < 0) return false;
  return identity.entitlements
    .slice(keyOffset, keyOffset + key.length + 160)
    .includes("[Bool] true");
}

async function verifyBundle(
  options: MacOsAppSandboxLauncherOptions,
): Promise<boolean> {
  if (process.platform !== "darwin") return false;
  try {
    await executeFile("/usr/bin/codesign", [
      "--verify",
      "--deep",
      "--strict",
      options.appBundlePath,
    ]);
    const hostPath = path.join(
      options.appBundlePath,
      "Contents/MacOS/VerifyPluginHost",
    );
    const helperPath = path.join(
      options.appBundlePath,
      "Contents/Helpers/node",
    );
    const supervisorPath = path.join(
      options.appBundlePath,
      "Contents/Helpers/VerifyPluginSupervisor",
    );
    const [host, helper, supervisor] = await Promise.all([
      inspectCodeIdentity(hostPath),
      inspectCodeIdentity(helperPath),
      inspectCodeIdentity(supervisorPath),
    ]);
    if (
      host.identifier !== "dev.verify.plugin-host"
      || helper.identifier !== "dev.verify.plugin-host.node"
      || supervisor.identifier !== "dev.verify.plugin-supervisor"
      || !hasTrueEntitlement(host, "com.apple.security.app-sandbox")
      || !hasTrueEntitlement(helper, "com.apple.security.app-sandbox")
      || !hasTrueEntitlement(helper, "com.apple.security.inherit")
      || !hasTrueEntitlement(helper, "com.apple.security.cs.allow-jit")
      || hasTrueEntitlement(supervisor, "com.apple.security.app-sandbox")
      || !host.hardenedRuntime
      || !helper.hardenedRuntime
      || !supervisor.hardenedRuntime
    ) return false;
    if (options.allowDevelopmentSignature) return true;
    const expectedTeam = options.expectedTeamIdentifier;
    const expectedAuthority = options.expectedSigningAuthority;
    if (
      typeof expectedTeam !== "string"
      || !/^[A-Z0-9]{10}$/.test(expectedTeam)
      || typeof expectedAuthority !== "string"
      || !expectedAuthority.startsWith("Developer ID Application:")
      || !expectedAuthority.endsWith(` (${expectedTeam})`)
    ) return false;
    const requirement = [
      "=anchor apple generic",
      "certificate 1[field.1.2.840.113635.100.6.2.6] exists",
      "certificate leaf[field.1.2.840.113635.100.6.1.13] exists",
      `certificate leaf[subject.OU] = \"${expectedTeam}\"`,
      `certificate leaf[subject.CN] = \"${expectedAuthority.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}\"`,
    ].join(" and ");
    await Promise.all([
      path.join(options.appBundlePath, "Contents/MacOS/VerifyPluginHost"),
      path.join(options.appBundlePath, "Contents/Helpers/node"),
      path.join(options.appBundlePath, "Contents/Helpers/VerifyPluginSupervisor"),
    ].map((executable) => executeFile("/usr/bin/codesign", [
      "--verify",
      "--strict",
      "--test-requirement",
      requirement,
      executable,
    ])));
    return (
      host.teamIdentifier === expectedTeam
      && helper.teamIdentifier === expectedTeam
      && supervisor.teamIdentifier === expectedTeam
      && host.authority === expectedAuthority
      && helper.authority === expectedAuthority
      && supervisor.authority === expectedAuthority
      && host.cdHash === options.expectedHostCdHash
      && helper.cdHash === options.expectedHelperCdHash
      && supervisor.cdHash === options.expectedSupervisorCdHash
    );
  } catch {
    return false;
  }
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

export function createMacOsAppSandboxLauncher(
  options: MacOsAppSandboxLauncherOptions,
): SandboxLauncher {
  const production = options.allowDevelopmentSignature !== true;
  const enforcementTier = production
    ? "macos-app-sandbox-v1"
    : "macos-app-sandbox-development-v1";
  const maximumMemoryBytes = options.maximumMemoryBytes ?? 256 * 1024 * 1024;
  const maximumCpuNanoseconds =
    options.maximumCpuNanoseconds ?? 30 * 1_000_000_000;
  if (
    !Number.isSafeInteger(maximumMemoryBytes)
    || maximumMemoryBytes < 64 * 1024 * 1024
    || !Number.isSafeInteger(maximumCpuNanoseconds)
    || maximumCpuNanoseconds < 1_000_000_000
  ) throw new TypeError("macOS sandbox resource limits are invalid");
  const resourceLimits = {
    maximumMemoryBytes,
    maximumCpuNanoseconds,
    maximumPluginProcesses: 1,
  } as const;
  return {
    production,
    enforcementTier,
    resourceLimits,
    async available(): Promise<boolean> {
      return verifyBundle(options);
    },
    async launch(request): Promise<SandboxProcess> {
      if (!(await verifyBundle(options))) {
        throw new PluginRuntimeError(
          "VFY_PLUGIN_PLATFORM_UNAVAILABLE",
          "the macOS sandbox host identity is unavailable",
        );
      }
      const artifact = await readFile(request.entryPoint);
      const digest = `sha256:${createHash("sha256").update(artifact).digest("hex")}`;
      const executable = path.join(
        options.appBundlePath,
        "Contents/Helpers/VerifyPluginSupervisor",
      );
      const child = spawn(executable, [
        "--artifact-digest",
        digest,
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
          "the macOS sandbox host artifact channel is unavailable",
        );
      }
      artifactChannel.end(artifact);
      if (!child.stdin || !child.stdout || !child.stderr) {
        child.kill("SIGKILL");
        throw new PluginRuntimeError(
          "VFY_PLUGIN_PLATFORM_UNAVAILABLE",
          "the macOS sandbox host protocol pipes are unavailable",
        );
      }
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
