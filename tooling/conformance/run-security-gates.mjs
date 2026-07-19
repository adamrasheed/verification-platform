import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { canonicalize } from "../../packages/contracts/dist/public/index.js";

const root = process.cwd();
const outputIndex = process.argv.indexOf("--out");
const outputPath = outputIndex < 0
  ? undefined
  : path.resolve(root, process.argv[outputIndex + 1]);
if (outputIndex >= 0 && process.argv[outputIndex + 1] === undefined) {
  throw new Error("--out requires a path");
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function runScript(script) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      cwd: root,
      env: { ...process.env, NO_COLOR: "1" },
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

const definitions = [
  {
    id: "M5-T06-MVP-CORPUS",
    script: "tooling/conformance/run-mvp-corpus.mjs",
  },
  {
    id: "M5-T07-OFFLINE-PASSIVE",
    script: "tooling/conformance/check-offline.mjs",
  },
  {
    id: "M5-T07-RUNTIME-NETWORK-DENY",
    script: "tooling/conformance/check-runtime-network-deny.mjs",
  },
  {
    id: "M5-T07-SECRET-CANARIES",
    script: "tooling/conformance/run-adversarial-corpus.mjs",
  },
];
const gates = [];
for (const definition of definitions) {
  const result = await runScript(definition.script);
  gates.push({
    id: definition.id,
    command: `node ${definition.script}`,
    status: result.code === 0 ? "passed" : "failed",
    exitCode: result.code,
    signal: result.signal,
    stdoutSha256: sha256(result.stdout),
    stderrSha256: sha256(result.stderr),
    summary: result.code === 0
      ? result.stdout.trim().split("\n").at(-1)
      : result.stderr.trim().split("\n").at(-1),
  });
}
const passed = gates.every(({ status }) => status === "passed");
const report = {
  schemaVersion: 1,
  kind: "security",
  status: passed ? "passed" : "failed",
  gates,
  claims: {
    zeroEngineNetwork:
      gates.find(({ id }) => id === "M5-T07-OFFLINE-PASSIVE")?.status ===
        "passed" &&
      gates.find(({ id }) => id === "M5-T07-RUNTIME-NETWORK-DENY")?.status ===
        "passed",
    zeroRepositoryExecution:
      gates.find(({ id }) => id === "M5-T07-OFFLINE-PASSIVE")?.status ===
        "passed" &&
      gates.find(({ id }) => id === "M5-T06-MVP-CORPUS")?.status === "passed",
    zeroCanaryLeakage:
      gates.find(({ id }) => id === "M5-T07-SECRET-CANARIES")?.status ===
        "passed",
    hostileCorpusPassed:
      gates.find(({ id }) => id === "M5-T07-SECRET-CANARIES")?.status ===
        "passed" &&
      gates.find(({ id }) => id === "M5-T06-MVP-CORPUS")?.status === "passed",
  },
};
const document = `${canonicalize(report)}\n`;
if (outputPath !== undefined) await writeFile(outputPath, document);
process.stdout.write(document);
if (!passed) process.exitCode = 1;
