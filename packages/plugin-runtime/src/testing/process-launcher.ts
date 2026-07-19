import { spawn } from "node:child_process";
import type {
  SandboxLaunchRequest,
  SandboxLauncher,
  SandboxProcess,
  SandboxProcessExit,
} from "../public/sandbox.js";
import { boundedUtf8Lines } from "../public/sandbox.js";

export function createConformanceProcessLauncher(
  environment: Readonly<Record<string, string>> = {},
): SandboxLauncher {
  return {
    production: false,
    enforcementTier: "conformance-process-v1",
    async available(): Promise<boolean> {
      return true;
    },
    async launch(request: SandboxLaunchRequest): Promise<SandboxProcess> {
      const child = spawn(process.execPath, [request.entryPoint], {
        cwd: request.pluginRoot,
        env: {
          PATH: process.env.PATH ?? "/usr/bin:/bin",
          LANG: "C",
          LC_ALL: "C",
          TZ: "UTC",
          ...environment,
        },
        stdio: ["pipe", "pipe", "pipe"],
        shell: false,
      });
      const exit = new Promise<SandboxProcessExit>((resolve) => {
        child.once("exit", (code, signal) => resolve({ code, signal }));
      });
      return {
        enforcementTier: this.enforcementTier,
        stdoutLines: boundedUtf8Lines(child.stdout),
        stderr: child.stderr,
        exit,
        write(line: string): Promise<void> {
          return new Promise((resolve, reject) => {
            child.stdin.write(line, "utf8", (error) => error ? reject(error) : resolve());
          });
        },
        terminate(): void {
          child.kill("SIGTERM");
        },
        kill(): void {
          child.kill("SIGKILL");
        },
      };
    },
  };
}
