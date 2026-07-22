import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(".github/workflows/native-host-release.yml", "utf8");

test("native signing workflow is manual, protected, least-privilege, and action-pinned", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /target:\n[\s\S]*type: choice/);
  assert.match(workflow, /inputs\.target == 'all' \|\| inputs\.target == 'macos'/);
  assert.match(workflow, /inputs\.target == 'all' \|\| inputs\.target == 'windows'/);
  assert.match(workflow, /timeout-minutes: 90/);
  assert.match(workflow, /permissions:\n  contents: read/);
  assert.equal(workflow.match(/environment: native-host-release/g)?.length, 2);
  for (const action of [
    "actions/checkout@11d5960a326750d5838078e36cf38b85af677262",
    "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
    "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
    "ilammy/msvc-dev-cmd@0b201ec74fa43914dc39ae48a89fd1d8cb592756",
  ]) assert.match(workflow, new RegExp(action.replaceAll("/", "\\/")));
});

test("native signing workflow timestamps, notarizes, checks pins, and deletes keys", () => {
  for (const control of [
    "xcrun notarytool submit",
    "xcrun stapler staple",
    "--host-thumbprint",
    "--node-thumbprint",
    "'/tr', $env:WINDOWS_TIMESTAMP_URL",
    "'/td', 'SHA256'",
    "security delete-keychain",
    "verify-code-signing.pfx",
  ]) assert.ok(workflow.includes(control), `missing release control: ${control}`);
  assert.ok(
    workflow.indexOf("'/tr', $env:WINDOWS_TIMESTAMP_URL")
      < workflow.indexOf("'/td', 'SHA256'"),
    "RFC 3161 digest selection must follow /tr",
  );
});

test("macOS signing exposes the temporary keychain and selects one exact identity", () => {
  for (const control of [
    'security list-keychains -d user -s "$KEYCHAIN_PATH"',
    'grep -F "\\\"$MACOS_DEVELOPER_ID_APPLICATION\\\""',
    'test "$IDENTITY_COUNT" -eq 1',
    'MACOS_SIGNING_IDENTITY_SHA1',
    '--identity "$MACOS_SIGNING_IDENTITY_SHA1"',
  ]) assert.ok(workflow.includes(control), `missing macOS identity control: ${control}`);
});

test("macOS release reruns conformance through the pinned production host", () => {
  for (const control of [
    "VERIFY_RUN_MACOS_PRODUCTION=1",
    'VERIFY_MACOS_PRODUCTION_APP="$APP"',
    'VERIFY_MACOS_PRODUCTION_MANIFEST="$RELEASE_ROOT/manifest.json"',
    '--test-name-pattern="signed macOS production host"',
    "VERIFY_RUN_GITHUB_PROVIDER_MACOS_PRODUCTION=1",
    "packages/github-repository-policy",
    '--test-name-pattern="signed macOS production host runs the GitHub repository-policy provider"',
  ]) assert.ok(workflow.includes(control), `missing production conformance gate: ${control}`);
});
