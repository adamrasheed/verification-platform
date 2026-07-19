#!/usr/bin/env node
import process from "node:process";
import { dirname, relative, resolve, sep } from "node:path";
import {
  digestFile,
  readJson,
  run,
  writeCanonical,
} from "./lib.mjs";

const separator = process.argv.indexOf("--");
if (separator < 0 || separator < 4 || separator === process.argv.length - 1) {
  console.error(
    "usage: node tooling/release/attest-tested-bytes.mjs <candidate.json> <attestation.json> -- <test command...>",
  );
  process.exit(2);
}
const candidatePath = resolve(process.cwd(), process.argv[2]);
const attestationPath = resolve(process.cwd(), process.argv[3]);
const command = process.argv[separator + 1];
const args = process.argv.slice(separator + 2);
const candidate = await readJson(candidatePath);
if (candidate.status !== "pending_test_attestation") {
  throw new Error("candidate is not awaiting test attestation");
}
const artifactPath = resolve(dirname(candidatePath), candidate.artifact.path);
const policy = await readJson(
  resolve(process.cwd(), "tooling/release/candidate-policy.json"),
);
const suppliedCommand = [command, ...args];
if (JSON.stringify(suppliedCommand) !== JSON.stringify(policy.requiredTestCommand)) {
  throw new Error(
    `tested-byte command must be exactly: ${policy.requiredTestCommand.join(" ")}`,
  );
}
const before = await digestFile(artifactPath);
if (before.digest !== candidate.artifact.sha256) {
  throw new Error("candidate artifact changed before testing");
}
const result = await run(command, args, {
  cwd: process.cwd(),
  env: {
    ...process.env,
    VERIFY_RELEASE_ARTIFACT: artifactPath,
    VERIFY_RELEASE_ARTIFACT_SHA256: before.digest,
  },
});
const after = await digestFile(artifactPath);
if (after.digest !== before.digest || after.size !== before.size) {
  throw new Error("candidate artifact changed while tests ran");
}
const attestation = {
  schemaVersion: 1,
  kind: "testedBytesAttestation",
  status: result.code === 0 ? "passed" : "failed",
  artifactSha256: before.digest,
  artifactSize: before.size,
  command: suppliedCommand,
  exitCode: result.code,
  signal: result.signal,
  stdoutSha256: `sha256:${(await import("node:crypto")).createHash("sha256").update(result.stdout).digest("hex")}`,
  stderrSha256: `sha256:${(await import("node:crypto")).createHash("sha256").update(result.stderr).digest("hex")}`,
};
await writeCanonical(attestationPath, attestation);
if (result.code !== 0) {
  process.stderr.write(result.stderr);
  process.exit(result.code ?? 1);
}
const attestationFile = await digestFile(attestationPath);
candidate.testAttestation = {
  path: relative(dirname(candidatePath), attestationPath).split(sep).join("/"),
  sha256: attestationFile.digest,
  size: attestationFile.size,
};
candidate.status = "ready";
await writeCanonical(candidatePath, candidate);
console.log(candidatePath);
