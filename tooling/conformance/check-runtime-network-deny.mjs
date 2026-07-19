import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const root = process.cwd();
const denyModule = path.join(
  root,
  "tooling/conformance/runtime-network-deny.cjs",
);

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: {
        ...process.env,
        NODE_OPTIONS: `--require=${JSON.stringify(denyModule)}`,
        ...options.env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });
  });
}

const canary = await run(process.execPath, [
  "-e",
  "require('node:net').connect({host:'127.0.0.1',port:9})",
]);
if (
  canary.code === 0 ||
  !canary.stderr.includes("VFY_RUNTIME_NETWORK_DENIED")
) {
  console.error("runtime network deny harness did not stop the socket canary");
  process.exit(1);
}

const state = await mkdtemp(path.join(tmpdir(), "verify-network-deny-"));
try {
  const cli = await run(process.execPath, [
    "apps/cli/dist/verify.js",
    "verify",
    "tooling/corpus/npm-valid",
    "--json",
    "--no-cache",
  ], {
    env: { XDG_STATE_HOME: state },
  });
  let document;
  try {
    document = JSON.parse(cli.stdout);
  } catch {
    console.error(`CLI stdout was not JSON under runtime deny: ${cli.stdout}`);
    process.exit(1);
  }
  if (cli.code !== 0 || document.result?.outcome !== "satisfied") {
    console.error(
      `CLI failed under runtime deny: exit=${cli.code} stderr=${cli.stderr}`,
    );
    process.exit(1);
  }
} finally {
  await rm(state, { recursive: true, force: true });
}

console.log(
  "runtime network deny passed: socket canary blocked and CLI verification completed",
);
