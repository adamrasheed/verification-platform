import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CanonicalRevisionDeriver,
  CanonicalSemanticIdDeriver,
  DelegatingEphemeralIdSource,
  assertExactRevisionRef,
  createRevisionDocument,
} from "../dist/public/index.js";

const validIdentity = JSON.parse(
  await readFile(new URL("../fixtures/valid/identity.json", import.meta.url), "utf8"),
);
const invalidIdentity = JSON.parse(
  await readFile(new URL("../fixtures/invalid/identity.json", import.meta.url), "utf8"),
);
const revisionVector = JSON.parse(
  await readFile(new URL("../fixtures/valid/revision.json", import.meta.url), "utf8"),
);
const invalidRevision = JSON.parse(
  await readFile(new URL("../fixtures/invalid/revision.json", import.meta.url), "utf8"),
);

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

test("semantic identity golden vectors are stable across fresh derivers", async () => {
  for (const vector of validIdentity) {
    const first = await new CanonicalSemanticIdDeriver(sha256).derive(vector.request);
    const freshStore = await new CanonicalSemanticIdDeriver(sha256).derive(
      structuredClone(vector.request),
    );
    assert.equal(first, vector.expected, vector.name);
    assert.equal(freshStore, vector.expected, `${vector.name}: fresh store`);
  }
});

test("checkout location and repeat-run metadata cannot enter application identity", async () => {
  const vector = validIdentity.find(({name}) => name === "application-relative-to-workspace");
  const derive = new CanonicalSemanticIdDeriver(sha256);
  const checkoutA = {absoluteCheckout: "/Users/alice/repo", invocationId: "run:a"};
  const checkoutB = {absoluteCheckout: "/tmp/repo", invocationId: "run:b"};
  assert.notDeepEqual(checkoutA, checkoutB);
  assert.equal(await derive.derive(vector.request), vector.expected);
  assert.equal(await derive.derive(structuredClone(vector.request)), vector.expected);
});

test("unavailable or checkout-dependent natural identities fail instead of using randomness", async () => {
  const derive = new CanonicalSemanticIdDeriver(sha256);
  for (const vector of invalidIdentity) {
    await assert.rejects(derive.derive(vector.request), TypeError, vector.name);
  }
});

test("ephemeral IDs come only from the injected source", () => {
  let sequence = 0;
  const source = new DelegatingEphemeralIdSource(
    (kind) => `${kind}:${sequence += 1}`,
  );
  assert.equal(source.next("invocation"), "invocation:1");
  assert.equal(source.next("attempt"), "attempt:2");
  assert.throws(
    () => new DelegatingEphemeralIdSource(() => "").next("event"),
    /invalid opaque ID/,
  );
});

test("revision vectors cover all sealed fields but exclude envelope metadata", async () => {
  const deriver = new CanonicalRevisionDeriver(sha256);
  assert.equal(
    await deriver.derive(revisionVector.request),
    revisionVector.expectedRevision,
  );
  for (const field of Object.keys(revisionVector.request.payload)) {
    const changed = structuredClone(revisionVector.request);
    changed.payload[field] =
      field === "provenance" ? [{method: "changed"}] : `${changed.payload[field]}:changed`;
    assert.notEqual(
      await deriver.derive(changed),
      revisionVector.expectedRevision,
      `sealed field ${field}`,
    );
  }
  for (const field of ["kind", "id", "schemaVersion"]) {
    const changed = structuredClone(revisionVector.request);
    changed[field] =
      field === "schemaVersion"
        ? 2
        : field === "kind"
          ? "capability"
          : `${changed[field]}Changed`;
    assert.notEqual(
      await deriver.derive(changed),
      revisionVector.expectedRevision,
      `revision domain field ${field}`,
    );
  }

  const document = await createRevisionDocument(revisionVector.request, deriver);
  const envelopes = revisionVector.envelopes.map((metadata) => ({
    document,
    ...metadata,
  }));
  assert.equal(envelopes[0].document.revision, envelopes[1].document.revision);
  assert.notEqual(envelopes[0].createdAt, envelopes[1].createdAt);
});

test("mutable aliases are not exact revision references", () => {
  assert.throws(
    () => assertExactRevisionRef(invalidRevision[0].reference),
    /exact immutable revision reference/,
  );
  assert.doesNotThrow(() =>
    assertExactRevisionRef({
      kind: "proof",
      id: "proof:workspace-integrity",
      revision: `sha256:${"a".repeat(64)}`,
      schemaVersion: 1,
    }),
  );
});
