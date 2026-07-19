import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ModelGraphError,
  assertExactRevisionRef,
  assertValidApplicationModelGraph,
} from "../dist/public/index.js";

const valid = JSON.parse(
  await readFile(new URL("../fixtures/valid/domain.json", import.meta.url), "utf8"),
);
const invalid = JSON.parse(
  await readFile(new URL("../fixtures/invalid/domain.json", import.meta.url), "utf8"),
);
const domainSchema = JSON.parse(
  await readFile(
    new URL("../schemas/evidence-repair-execution.schema.json", import.meta.url),
    "utf8",
  ),
);

function graph(fixture) {
  return {
    promises: [fixture.promise],
    proofs: [fixture.proof],
    bindings: [fixture.binding],
  };
}

test("valid Promise-Proof association graph is exactly traversable", () => {
  assert.doesNotThrow(() =>
    assertValidApplicationModelGraph(valid.model, graph(valid)),
  );
  assert.equal(valid.binding.promise.id, valid.promise.id);
  assert.equal(valid.binding.proof.id, valid.proof.id);
  assert.equal("proof" in valid.promise, false);
  assert.equal("promise" in valid.proof, false);
});

test("invalid binding and dependency graphs fail with stable codes", () => {
  for (const vector of invalid.slice(0, 6)) {
    const fixture = structuredClone(valid);
    const objects = graph(fixture);
    switch (vector.mutation) {
      case "wrongKind":
        fixture.binding.promise.kind = "application";
        break;
      case "dangling":
        fixture.binding.proof.revision = `sha256:${"0".repeat(64)}`;
        break;
      case "crossScope":
        fixture.binding.modelScope.relativeRoot = "packages/other";
        break;
      case "duplicate": {
        const duplicate = structuredClone(fixture.binding);
        duplicate.id = "binding:duplicate";
        duplicate.revision = `sha256:${"d".repeat(64)}`;
        objects.bindings.push(duplicate);
        break;
      }
      case "cycle":
        fixture.proof.dependencies.push(structuredClone(fixture.binding.proof));
        break;
      case "missingBinding":
        objects.bindings.length = 0;
        fixture.model.promiseProofBindings.length = 0;
        break;
    }
    assert.throws(
      () => assertValidApplicationModelGraph(fixture.model, objects),
      (error) => error instanceof ModelGraphError && error.code === vector.code,
      vector.name,
    );
  }
});

test("Evidence and Repair retain exact motivating provenance", () => {
  assertExactRevisionRef(valid.evidence.attempt.proof);
  assertExactRevisionRef(valid.evidence.subjects[0]);
  assertExactRevisionRef(valid.repair.motivatingPromise);
  assertExactRevisionRef(valid.repair.evidence[0]);
  assertExactRevisionRef(valid.repair.verificationPlan);
  assert.equal(valid.repair.action.kind, "jsonPatch");
  assert.equal(valid.repair.requiredPermissions.secrets.length, 0);
});

test("plans and manifests select exact revisions and secret binding identifiers only", () => {
  assertExactRevisionRef(valid.plan.applicationModel);
  assertExactRevisionRef(valid.plan.executionContext);
  assertExactRevisionRef(valid.plan.proofs[0].binding);
  assertExactRevisionRef(valid.manifest.applicationModel);
  assertExactRevisionRef(valid.manifest.proof);
  assertExactRevisionRef(valid.manifest.executionPlan);

  const manifestSchema = domainSchema.$defs.executionManifest;
  assert.equal(manifestSchema.additionalProperties, false);
  assert.equal(Object.hasOwn(manifestSchema.properties, "secret"), false);
  assert.equal(Object.hasOwn(manifestSchema.properties, "secretValue"), false);
  assert.equal(
    Object.hasOwn(manifestSchema.properties, "authenticationBindingIds"),
    true,
  );

  const withInlineSecret = {
    ...valid.manifest,
    secretValue: "must-not-cross-contract-boundary",
  };
  const unknown = Object.keys(withInlineSecret).filter(
    (key) => !Object.hasOwn(manifestSchema.properties, key),
  );
  assert.deepEqual(unknown, ["secretValue"]);
});

test("all M1 domain schema sources are independently versioned and exact", async () => {
  for (const file of [
    "identity.schema.json",
    "revision.schema.json",
    "application-model.schema.json",
    "evidence-repair-execution.schema.json",
  ]) {
    const schema = JSON.parse(
      await readFile(new URL(`../schemas/${file}`, import.meta.url), "utf8"),
    );
    assert.match(schema.$id, /:v1$/);
    assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
    assert.equal(typeof schema.title, "string");
  }
});
