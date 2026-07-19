import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const valid = JSON.parse(
  await readFile(new URL("../fixtures/valid/primitives.json", import.meta.url), "utf8"),
);
const invalid = JSON.parse(
  await readFile(new URL("../fixtures/invalid/primitives.json", import.meta.url), "utf8"),
);

const validators = {
  opaqueId: (value) => typeof value === "string" && value.length >= 1 && value.length <= 512,
  sha256Digest: (value) => /^sha256:[a-f0-9]{64}$/.test(value),
  rfc3339Utc: (value) => typeof value === "string" && value.endsWith("Z") && !Number.isNaN(Date.parse(value)),
  durationMs: (value) => Number.isSafeInteger(value) && value >= 0,
  byteCount: (value) => Number.isSafeInteger(value) && value >= 0,
  ratio: (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1,
  dataClassification: (value) => [
    "SECRET",
    "LOCAL_SOURCE",
    "SENSITIVE_EVIDENCE",
    "MINIMAL_METADATA",
    "EXPLICIT_SHARE",
  ].includes(value),
};

test("valid primitive fixture satisfies every bound", () => {
  for (const [field, validate] of Object.entries(validators)) {
    assert.equal(validate(valid[field]), true, field);
  }
});

test("invalid primitive fixtures are rejected", () => {
  for (const fixture of invalid) {
    assert.equal(validators[fixture.field](fixture.value), false, `${fixture.field}: ${fixture.reason}`);
  }
});
