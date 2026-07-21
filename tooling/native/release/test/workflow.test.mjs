import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(".github/workflows/native-host-release.yml", "utf8");

test("native signing workflow is manual, protected, least-privilege, and action-pinned", () => {
  assert.match(workflow, /workflow_dispatch:/);
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
