import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CanonicalJsonError,
  canonicalSha256,
  canonicalize,
  encodeCanonical,
  parseCanonicalJson,
} from "../dist/public/index.js";

const valid = JSON.parse(
  await readFile(new URL("../fixtures/valid/canonical-json.json", import.meta.url), "utf8"),
);
const invalid = JSON.parse(
  await readFile(new URL("../fixtures/invalid/canonical-json.json", import.meta.url), "utf8"),
);

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

test("golden canonical bytes and digests are stable", async () => {
  for (const vector of valid) {
    assert.equal(canonicalize(vector.input), vector.canonical, vector.name);
    assert.deepEqual(
      encodeCanonical(vector.input),
      new TextEncoder().encode(vector.canonical),
      vector.name,
    );
    assert.equal(await canonicalSha256(vector.input, sha256), vector.sha256, vector.name);
  }
});

test("invalid I-JSON values are rejected with stable codes", () => {
  for (const vector of invalid) {
    assert.throws(
      () => canonicalize(vector.input),
      (error) => error instanceof CanonicalJsonError && error.code === vector.code,
      vector.name,
    );
  }
});

test("runtime-only invalid values are rejected", () => {
  assert.throws(() => canonicalize(Number.NaN), { code: "INVALID_NUMBER" });
  assert.throws(() => canonicalize(Number.POSITIVE_INFINITY), { code: "INVALID_NUMBER" });
  assert.throws(() => canonicalize(undefined), { code: "INVALID_TYPE" });
  assert.throws(() => canonicalize([, 1]), { code: "SPARSE_ARRAY" });
  assert.throws(() => canonicalize(new Date()), { code: "INVALID_OBJECT" });

  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => canonicalize(cyclic), { code: "CYCLE" });
});

test("shared references are permitted because they are not cycles", () => {
  const child = { value: 1 };
  assert.equal(
    canonicalize({ left: child, right: child }),
    "{\"left\":{\"value\":1},\"right\":{\"value\":1}}",
  );
});

test("invalid digest adapters are rejected", async () => {
  await assert.rejects(
    canonicalSha256(null, () => "not-a-digest"),
    /invalid digest/,
  );
});

test("trust-boundary parser rejects duplicate keys before information loss", () => {
  assert.throws(
    () => parseCanonicalJson('{"safe":1,"safe":2}'),
    (error) => error instanceof CanonicalJsonError && error.code === "DUPLICATE_KEY",
  );
  assert.deepEqual(
    parseCanonicalJson(' { "nested": [true, null, {"x":"\\u0061"}], "n": -1.5e2 } '),
    { nested: [true, null, { x: "a" }], n: -150 },
  );
  assert.throws(
    () => parseCanonicalJson('{"x":01}'),
    (error) => error instanceof CanonicalJsonError && error.code === "INVALID_JSON",
  );
});
