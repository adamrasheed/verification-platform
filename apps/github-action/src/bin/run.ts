#!/usr/bin/env node
import { appendFile } from "node:fs/promises";
import { runGitHubAction } from "../public/action.js";

const controller = new AbortController();
process.once("SIGINT", () => controller.abort("caller"));
process.once("SIGTERM", () => controller.abort("shutdown"));

function safeCommandValue(value: string): string {
  return value.replace(/[\r\n]/g, " ").slice(0, 1024);
}

async function writeOutput(name: string, value: string): Promise<void> {
  const output = process.env.GITHUB_OUTPUT;
  if (output === undefined || output.length === 0) return;
  await appendFile(output, `${name}=${safeCommandValue(value)}\n`, "utf8");
}

try {
  const result = await runGitHubAction({
    environment: process.env,
    signal: controller.signal,
  });
  await writeOutput("operational-status", result.projection.operationalStatus);
  await writeOutput("outcome", result.projection.outcome ?? "");
  await writeOutput("conclusion", result.projection.conclusion);
  await writeOutput("invocation-id", result.projection.invocationId);
  await writeOutput("check-published", String(result.publication.published));
  if (!result.publication.published && result.publication.code !== "VFY_GITHUB_CHECK_DISABLED") {
    process.stderr.write("::warning title=Verify check unavailable::Canonical verification completed, but the minimal check could not be published.\n");
  }
  process.stdout.write("Verify canonical local verification completed.\n");
  if (!["success", "neutral"].includes(result.projection.conclusion)) process.exitCode = 1;
} catch {
  process.stderr.write("::error title=Verify Action failed::The local verification adapter could not complete.\n");
  process.exitCode = 1;
}
