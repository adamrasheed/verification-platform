#!/usr/bin/env node
import process from "node:process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  digestFile,
  inspectNpmTarball,
  readJson,
  run,
  validatePackedArtifact,
} from "./lib.mjs";

const artifactPath = process.env.VERIFY_RELEASE_ARTIFACT;
const expectedDigest = process.env.VERIFY_RELEASE_ARTIFACT_SHA256;
if (artifactPath === undefined || expectedDigest === undefined) {
  throw new Error("tested artifact path and digest environment are required");
}
const actual = await digestFile(artifactPath);
if (actual.digest !== expectedDigest) {
  throw new Error("tested artifact digest does not match attestation input");
}
const policy = await readJson(
  join(process.cwd(), "tooling/release/candidate-policy.json"),
);
const entries = inspectNpmTarball(await readFile(artifactPath));
const validation = validatePackedArtifact(entries, policy);
if (validation.errors.length > 0) {
  console.error(validation.errors.join("\n"));
  process.exit(1);
}
const manifest = validation.manifest;
const binTarget = Object.values(manifest.bin ?? {})[0];
if (typeof binTarget !== "string") throw new Error("packed artifact has no executable bin");
const binEntry = entries.find(({ path }) =>
  path === `package/${binTarget.replace(/^\.\//, "")}`
);
if (binEntry === undefined) throw new Error("packed executable bytes are unavailable");

const temporary = await mkdtemp(join(tmpdir(), "verify-packed-runtime-"));
try {
  const executable = join(temporary, "verify.js");
  const workspace = join(temporary, "workspace");
  await writeFile(executable, binEntry.body);
  await chmod(executable, 0o755);
  await mkdir(workspace);
  await writeFile(
    join(workspace, "package.json"),
    JSON.stringify({ name: "packed-runtime-fixture", private: true }),
  );
  await writeFile(
    join(workspace, "package-lock.json"),
    JSON.stringify({
      name: "packed-runtime-fixture",
      lockfileVersion: 3,
      packages: { "": { name: "packed-runtime-fixture" } },
    }),
  );
  const runtime = await run(
    process.execPath,
    [executable, "verify", workspace, "--json", "--no-cache"],
    {
      cwd: temporary,
      env: {
        ...process.env,
        NODE_NO_WARNINGS: "1",
        XDG_STATE_HOME: join(temporary, "state"),
      },
    },
  );
  if (runtime.code !== 0 || runtime.signal !== null) {
    throw new Error(`packed executable failed: ${runtime.stderr.trim()}`);
  }
  if (manifest.name === "verify") {
    const lines = runtime.stdout.trim().split("\n");
    const envelope = JSON.parse(runtime.stdout);
    if (
      lines.length !== 1
      || envelope.operationalStatus !== "completed"
      || envelope.result?.outcome !== "satisfied"
    ) {
      throw new Error("packed executable did not produce the canonical satisfied JSON result");
    }
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
console.log(`tested packed bytes valid: ${actual.digest}`);
