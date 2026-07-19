import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import test from "node:test";
import {
  digestFile,
  inspectNpmTarball,
  readJson,
  run,
  validatePackedArtifact,
  writeCanonical,
} from "../lib.mjs";

const root = process.cwd();
const policy = await readJson(
  join(root, "tooling/release/candidate-policy.json"),
);
const good = join(root, "tooling/release/test-fixtures/good");
const badLifecycle = join(
  root,
  "tooling/release/test-fixtures/bad-lifecycle",
);

async function pack(packageDirectory, output) {
  const result = await run(
    "npm",
    ["pack", "--json", "--ignore-scripts", "--pack-destination", output],
    {
      cwd: packageDirectory,
      env: { ...process.env, npm_config_ignore_scripts: "true" },
    },
  );
  assert.equal(result.code, 0, result.stderr);
  const metadata = JSON.parse(result.stdout)[0];
  return join(output, metadata.filename);
}

test("exact npm tar inspection accepts the release fixture", async () => {
  const output = await mkdtemp(join(tmpdir(), "verify-pack-good-"));
  try {
    const artifact = await pack(good, output);
    const entries = inspectNpmTarball(await readFile(artifact));
    const validation = validatePackedArtifact(entries, policy);
    assert.deepEqual(validation.errors, []);
    assert.equal(validation.manifest.name, "verify-release-fixture");
    assert.ok(entries.some(({ path, mode }) =>
      path === "package/dist/bin.js" && (mode & 0o111) !== 0));
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test("packed lifecycle hooks are rejected even when npm scripts are disabled", async () => {
  const output = await mkdtemp(join(tmpdir(), "verify-pack-bad-"));
  try {
    const artifact = await pack(badLifecycle, output);
    const validation = validatePackedArtifact(
      inspectNpmTarball(await readFile(artifact)),
      policy,
    );
    assert.ok(
      validation.errors.includes("forbidden lifecycle script postinstall"),
    );
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test("candidate generation is deterministic and promotion uses tested bytes", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "verify-release-flow-"));
  try {
    const performance = join(temporary, "performance.json");
    const security = join(temporary, "security.json");
    await writeCanonical(performance, {
      schemaVersion: 1,
      kind: "performance",
      status: "passed",
      artifact: {
        command: "node tooling/conformance/benchmark.mjs",
        measurementSha256: `sha256:${"4".repeat(64)}`,
      },
      measurements: {
        warmDiscovery100k: { p95Ms: 1, budgetMs: 5000 },
      },
      requirements: {
        warmDiscoveryP95Passed: true,
        coldVerifyP95Passed: true,
        cacheLookupP95Passed: true,
        cancellationWithinOneSecondPassed: true,
        firstProgressWithin250MsPassed: true,
        machineOutputBoundPassed: true,
        memoryBoundPassed: true,
      },
    });
    await writeCanonical(security, {
      schemaVersion: 1,
      kind: "security",
      status: "passed",
      gates: [
        {
          id: "M5-T06-MVP-CORPUS",
          status: "passed",
          stdoutSha256: `sha256:${"1".repeat(64)}`,
        },
        {
          id: "M5-T07-OFFLINE-PASSIVE",
          status: "passed",
          stdoutSha256: `sha256:${"2".repeat(64)}`,
        },
        {
          id: "M5-T07-RUNTIME-NETWORK-DENY",
          status: "passed",
          stdoutSha256: `sha256:${"5".repeat(64)}`,
        },
        {
          id: "M5-T07-SECRET-CANARIES",
          status: "passed",
          stdoutSha256: `sha256:${"3".repeat(64)}`,
        },
      ],
      claims: {
        zeroEngineNetwork: true,
        zeroRepositoryExecution: true,
        zeroCanaryLeakage: true,
        hostileCorpusPassed: true,
      },
    });
    const outputs = [join(temporary, "one"), join(temporary, "two")];
    for (const output of outputs) {
      const result = await run(
        process.execPath,
        [
          "tooling/release/prepare-candidate.mjs",
          "--package",
          "tooling/release/test-fixtures/good",
          "--out",
          output,
          "--performance",
          performance,
          "--security",
          security,
          "--source-revision",
          "0123456789abcdef0123456789abcdef01234567",
        ],
        { cwd: root, env: process.env },
      );
      assert.equal(result.code, 0, result.stderr);
    }
    for (const name of [
      "pack-manifest.json",
      "sbom.cdx.json",
      "provenance.intoto.json",
    ]) {
      assert.deepEqual(
        await digestFile(join(outputs[0], name)),
        await digestFile(join(outputs[1], name)),
        name,
      );
    }
    const firstCandidate = await readJson(
      join(outputs[0], "release-candidate.json"),
    );
    const secondCandidate = await readJson(
      join(outputs[1], "release-candidate.json"),
    );
    assert.equal(
      firstCandidate.artifact.sha256,
      secondCandidate.artifact.sha256,
    );

    const candidatePath = join(outputs[0], "release-candidate.json");
    const attestationPath = join(outputs[0], "test-attestation.json");
    const attest = await run(
      process.execPath,
      [
        "tooling/release/attest-tested-bytes.mjs",
        candidatePath,
        attestationPath,
        "--",
        "node",
        "tooling/release/verify-packed-artifact.mjs",
      ],
      { cwd: root, env: process.env },
    );
    assert.equal(attest.code, 0, attest.stderr);
    const check = await run(
      process.execPath,
      ["tooling/release/check-candidate.mjs", candidatePath],
      { cwd: root, env: process.env },
    );
    assert.equal(check.code, 0, check.stderr);

    const promoted = join(temporary, "promoted.tgz");
    const promotion = await run(
      process.execPath,
      [
        "tooling/release/promote-tested-bytes.mjs",
        candidatePath,
        promoted,
      ],
      { cwd: root, env: process.env },
    );
    assert.equal(promotion.code, 0, promotion.stderr);
    assert.equal(
      (await digestFile(promoted)).digest,
      (await readJson(candidatePath)).artifact.sha256,
    );
    const readyCandidate = await readJson(candidatePath);
    const artifactPath = resolve(
      outputs[0],
      readyCandidate.artifact.path,
    );
    await writeFile(
      artifactPath,
      Buffer.concat([await readFile(artifactPath), Buffer.from("tamper")]),
    );
    const rejected = await run(
      process.execPath,
      ["tooling/release/check-candidate.mjs", candidatePath],
      { cwd: root, env: process.env },
    );
    assert.equal(rejected.code, 1);
    assert.match(rejected.stderr, /artifact digest mismatch/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
