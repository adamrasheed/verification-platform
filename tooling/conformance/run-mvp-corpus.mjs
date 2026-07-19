import { readFile, readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const corpusRoot = path.join(root, "tooling/corpus");
const cli = path.join(root, "apps/cli/dist/bin/verify.js");

function run(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: root,
      env: { ...process.env, NO_COLOR: "1", ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

const fixtureNames = (await readdir(corpusRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const failures = [];

for (const fixtureName of fixtureNames) {
  const fixtureRoot = path.join(corpusRoot, fixtureName);
  const expected = JSON.parse(
    await readFile(path.join(fixtureRoot, "expected.json"), "utf8"),
  );
  const runResult = await run(["verify", fixtureRoot, "--json", "--no-cache"]);
  let document;
  try {
    document = JSON.parse(runResult.stdout);
  } catch {
    failures.push(`${fixtureName}: stdout is not exactly one JSON document`);
    continue;
  }
  const result = document.result ?? document;
  if (document.operationalStatus !== undefined && document.operationalStatus !== expected.operationalStatus) {
    failures.push(`${fixtureName}: operational status ${document.operationalStatus}`);
  }
  if (result.operationalStatus !== undefined && result.operationalStatus !== expected.operationalStatus) {
    failures.push(`${fixtureName}: operational status ${result.operationalStatus}`);
  }
  if (result.outcome !== expected.outcome) {
    failures.push(`${fixtureName}: outcome ${result.outcome}; expected ${expected.outcome}`);
  }
  if (expected.packageManager && result.workspace?.packageManager !== expected.packageManager) {
    failures.push(`${fixtureName}: package manager ${result.workspace?.packageManager}`);
  }
  for (const reason of expected.reasonCodes ?? []) {
    if (!(result.reasonCodes ?? []).includes(reason)) {
      failures.push(`${fixtureName}: missing reason ${reason}`);
    }
  }
  for (const canary of expected.absentFromOutput ?? []) {
    if (runResult.stdout.includes(canary) || runResult.stderr.includes(canary)) {
      failures.push(`${fixtureName}: leaked canary ${canary}`);
    }
  }
  const expectedExit = expected.outcome === "satisfied"
    ? 0
    : expected.outcome === "violated"
      ? 1
      : 2;
  if (runResult.code !== expectedExit) {
    failures.push(`${fixtureName}: exit ${runResult.code}; expected ${expectedExit}; stderr=${runResult.stderr.trim()}`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`MVP repository corpus passed: ${fixtureNames.length} repositories`);
