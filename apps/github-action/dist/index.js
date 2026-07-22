#!/usr/bin/env node
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};

// ../../packages/contracts/dist/public/canonical-json.js
function assertUnicodeScalarString2(value, path5) {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 55296 && unit <= 56319) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 56320 && next <= 57343)) {
        throw new CanonicalJsonError2("INVALID_STRING", path5, "unpaired high surrogate");
      }
      index += 1;
    } else if (unit >= 56320 && unit <= 57343) {
      throw new CanonicalJsonError2("INVALID_STRING", path5, "unpaired low surrogate");
    }
  }
}
function propertyPath2(parent, key) {
  return `${parent}[${JSON.stringify(key)}]`;
}
function serialize2(value, path5, ancestors) {
  if (value === null)
    return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "string":
      assertUnicodeScalarString2(value, path5);
      return JSON.stringify(value);
    case "number": {
      if (!Number.isFinite(value)) {
        throw new CanonicalJsonError2("INVALID_NUMBER", path5, "number must be finite");
      }
      return Object.is(value, -0) ? "0" : JSON.stringify(value);
    }
    case "object": {
      const object = value;
      if (ancestors.has(object)) {
        throw new CanonicalJsonError2("CYCLE", path5, "cyclic value");
      }
      ancestors.add(object);
      try {
        if (Array.isArray(value)) {
          const items = [];
          for (let index = 0; index < value.length; index += 1) {
            if (!Object.hasOwn(value, index)) {
              throw new CanonicalJsonError2("SPARSE_ARRAY", `${path5}[${index}]`, "array entries must be present");
            }
            items.push(serialize2(value[index], `${path5}[${index}]`, ancestors));
          }
          return `[${items.join(",")}]`;
        }
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
          throw new CanonicalJsonError2("INVALID_OBJECT", path5, "only ordinary or null-prototype objects are allowed");
        }
        const record = value;
        const keys = Object.keys(record).sort();
        const members = [];
        for (const key of keys) {
          assertUnicodeScalarString2(key, propertyPath2(path5, key));
          const childPath = propertyPath2(path5, key);
          members.push(`${JSON.stringify(key)}:${serialize2(record[key], childPath, ancestors)}`);
        }
        return `{${members.join(",")}}`;
      } finally {
        ancestors.delete(object);
      }
    }
    default:
      throw new CanonicalJsonError2("INVALID_TYPE", path5, `unsupported type ${typeof value}`);
  }
}
function canonicalize2(value) {
  return serialize2(value, "$", /* @__PURE__ */ new Set());
}
function encodeCanonical2(value) {
  return new TextEncoder().encode(canonicalize2(value));
}
async function canonicalSha2562(value, sha2563) {
  const digest6 = await sha2563(encodeCanonical2(value));
  if (!/^sha256:[a-f0-9]{64}$/.test(digest6)) {
    throw new TypeError("sha256 function returned an invalid digest");
  }
  return digest6;
}
function parseCanonicalJson2(text) {
  let offset = 0;
  const whitespace = () => {
    while (offset < text.length && /[\t\n\r ]/.test(text[offset] ?? ""))
      offset += 1;
  };
  const invalid = (message) => {
    throw new CanonicalJsonError2("INVALID_JSON", `$@${offset}`, message);
  };
  const stringValue = () => {
    if (text[offset] !== '"')
      return invalid("expected string");
    const start = offset;
    offset += 1;
    while (offset < text.length) {
      const character = text[offset];
      if (character === '"') {
        offset += 1;
        try {
          const value2 = JSON.parse(text.slice(start, offset));
          if (typeof value2 !== "string")
            return invalid("invalid string");
          assertUnicodeScalarString2(value2, `$@${start}`);
          return value2;
        } catch (error) {
          if (error instanceof CanonicalJsonError2)
            throw error;
          return invalid("invalid string escape");
        }
      }
      if (character === "\\") {
        offset += 2;
      } else {
        if ((character?.charCodeAt(0) ?? 0) < 32)
          return invalid("unescaped control character");
        offset += 1;
      }
    }
    return invalid("unterminated string");
  };
  const value = () => {
    whitespace();
    const character = text[offset];
    if (character === '"')
      return stringValue();
    if (character === "[") {
      offset += 1;
      whitespace();
      const output = [];
      if (text[offset] === "]") {
        offset += 1;
        return output;
      }
      while (true) {
        output.push(value());
        whitespace();
        if (text[offset] === "]") {
          offset += 1;
          return output;
        }
        if (text[offset] !== ",")
          return invalid("expected comma or closing bracket");
        offset += 1;
      }
    }
    if (character === "{") {
      offset += 1;
      whitespace();
      const output = {};
      const keys = /* @__PURE__ */ new Set();
      if (text[offset] === "}") {
        offset += 1;
        return output;
      }
      while (true) {
        whitespace();
        const keyOffset = offset;
        const key = stringValue();
        if (keys.has(key)) {
          throw new CanonicalJsonError2("DUPLICATE_KEY", `$@${keyOffset}`, `duplicate object key ${JSON.stringify(key)}`);
        }
        keys.add(key);
        whitespace();
        if (text[offset] !== ":")
          return invalid("expected colon");
        offset += 1;
        output[key] = value();
        whitespace();
        if (text[offset] === "}") {
          offset += 1;
          return output;
        }
        if (text[offset] !== ",")
          return invalid("expected comma or closing brace");
        offset += 1;
      }
    }
    for (const [token, parsed2] of [
      ["true", true],
      ["false", false],
      ["null", null]
    ]) {
      if (text.startsWith(token, offset)) {
        offset += token.length;
        return parsed2;
      }
    }
    const number = text.slice(offset).match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/);
    if (number) {
      offset += number[0].length;
      const parsed2 = Number(number[0]);
      if (!Number.isFinite(parsed2)) {
        throw new CanonicalJsonError2("INVALID_NUMBER", `$@${offset}`, "number must be finite");
      }
      return parsed2;
    }
    return invalid("expected JSON value");
  };
  const parsed = value();
  whitespace();
  if (offset !== text.length)
    invalid("trailing content");
  canonicalize2(parsed);
  return parsed;
}
var CanonicalJsonError2;
var init_canonical_json = __esm({
  "../../packages/contracts/dist/public/canonical-json.js"() {
    "use strict";
    CanonicalJsonError2 = class extends TypeError {
      code;
      path;
      constructor(code, path5, message) {
        super(`${code} at ${path5}: ${message}`);
        this.name = "CanonicalJsonError";
        this.code = code;
        this.path = path5;
      }
    };
  }
});

// ../../packages/contracts/dist/public/identity.js
function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}
function isNormalizedRelativePath(value) {
  return isNonEmptyString(value) && !value.startsWith("/") && !value.includes("\\") && (value === "." || value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== ".."));
}
function assertScope(value) {
  if (!isNonEmptyString(value.workspaceId) || !isNormalizedRelativePath(value.relativeRoot) || value.applicationId !== void 0 && !isNonEmptyString(value.applicationId)) {
    throw new TypeError("semantic identity scope is unavailable or ambiguous");
  }
}
function assertNaturalKey(request) {
  switch (request.kind) {
    case "workspace": {
      const key = request.naturalKey;
      if (key.source === "repository" && !isNonEmptyString(key.repositoryId) || key.source === "localVcs" && (!/^sha256:[a-f0-9]{64}$/.test(key.rootIdentityDigest) || !/^sha256:[a-f0-9]{64}$/.test(key.vcsIdentityDigest))) {
        throw new TypeError("workspace semantic identity signals are unavailable");
      }
      return;
    }
    case "application": {
      const key = request.naturalKey;
      if (!isNonEmptyString(key.workspaceId) || !isNormalizedRelativePath(key.root) || !isNonEmptyString(key.packageIdentity))
        throw new TypeError("application semantic identity is unavailable or ambiguous");
      return;
    }
    case "capability": {
      const key = request.naturalKey;
      if (!isNonEmptyString(key.applicationId) || !isNonEmptyString(key.capabilityType)) {
        throw new TypeError("capability semantic identity is unavailable");
      }
      assertScope(key.scope);
      return;
    }
    case "promise": {
      const key = request.naturalKey;
      if (!isNonEmptyString(key.subjectId) || !isNonEmptyString(key.predicateId)) {
        throw new TypeError("promise semantic identity is unavailable");
      }
      assertScope(key.scope);
      return;
    }
    case "proof": {
      const key = request.naturalKey;
      if (!isNonEmptyString(key.evaluatorId) || !isNonEmptyString(key.evaluatorVersion) || !/^sha256:[a-f0-9]{64}$/.test(key.predicateLanguageRevision) || !isNonEmptyString(key.evidenceRequirementIdentity))
        throw new TypeError("proof semantic identity is unavailable");
      return;
    }
    case "discoverySignal":
    case "discoveryFact": {
      const key = request.naturalKey;
      if (!isNonEmptyString(key.readerId) || !isNormalizedRelativePath(key.normalizedRelativeInput) || !isNonEmptyString(key.structuredPointer) || !isNonEmptyString(key.signalKind))
        throw new TypeError("discovery semantic identity is unavailable");
    }
  }
}
var CanonicalSemanticIdDeriver2;
var init_identity = __esm({
  "../../packages/contracts/dist/public/identity.js"() {
    "use strict";
    init_canonical_json();
    CanonicalSemanticIdDeriver2 = class {
      #sha256;
      constructor(sha2563) {
        this.#sha256 = sha2563;
      }
      async derive(request) {
        if (!Number.isSafeInteger(request.schemaVersion) || request.schemaVersion < 1) {
          throw new TypeError("semantic identity schemaVersion must be a positive safe integer");
        }
        assertNaturalKey(request);
        const digest6 = await canonicalSha2562({
          domain: "verification-platform/semantic-id",
          kind: request.kind,
          naturalKey: request.naturalKey,
          schemaVersion: request.schemaVersion
        }, this.#sha256);
        return `sid:${request.kind}:${digest6.slice("sha256:".length)}`;
      }
    };
  }
});

// ../../packages/contracts/dist/public/revisions.js
var domainObjectKinds, CanonicalRevisionDeriver2;
var init_revisions = __esm({
  "../../packages/contracts/dist/public/revisions.js"() {
    "use strict";
    init_canonical_json();
    domainObjectKinds = /* @__PURE__ */ new Set([
      "applicationModel",
      "application",
      "capability",
      "promise",
      "proof",
      "promiseProofBinding",
      "providerBinding",
      "repairKnowledge",
      "policy",
      "configuration",
      "executionContext",
      "executionPlan",
      "executionManifest",
      "evidence",
      "repair",
      "discoverySignal",
      "discoveryFact"
    ]);
    CanonicalRevisionDeriver2 = class {
      #sha256;
      constructor(sha2563) {
        this.#sha256 = sha2563;
      }
      async derive(request) {
        if (!Number.isSafeInteger(request.schemaVersion) || request.schemaVersion < 1) {
          throw new TypeError("revision schemaVersion must be a positive safe integer");
        }
        if (!domainObjectKinds.has(request.kind)) {
          throw new TypeError("revision kind is not a supported domain object kind");
        }
        return canonicalSha2562({
          domain: "verification-platform/revision",
          id: request.id,
          kind: request.kind,
          payload: request.payload,
          schemaVersion: request.schemaVersion
        }, this.#sha256);
      }
    };
  }
});

// ../../packages/contracts/dist/public/model.js
function refKey(ref3) {
  return `${ref3.kind}\0${ref3.id}\0${ref3.revision}\0${ref3.schemaVersion}`;
}
function assertValidApplicationModelGraph2(model, objects) {
  const modelPromiseRefs = new Set(model.promises.map(refKey));
  const modelProofRefs = new Set(model.proofs.map(refKey));
  const promises = new Set(objects.promises.map((item) => refKey({
    kind: "promise",
    id: item.id,
    revision: item.revision,
    schemaVersion: item.schemaVersion
  })));
  const proofs = new Map(objects.proofs.map((item) => [
    refKey({
      kind: "proof",
      id: item.id,
      revision: item.revision,
      schemaVersion: item.schemaVersion
    }),
    item
  ]));
  const bindings = new Map(objects.bindings.map((item) => [
    refKey({
      kind: "promiseProofBinding",
      id: item.id,
      revision: item.revision,
      schemaVersion: item.schemaVersion
    }),
    item
  ]));
  for (const bindingRef of model.promiseProofBindings) {
    if (bindingRef.kind !== "promiseProofBinding") {
      throw new ModelGraphError2("WRONG_REFERENCE_KIND", "model binding reference has the wrong kind");
    }
    if (!bindings.has(refKey(bindingRef))) {
      throw new ModelGraphError2("DANGLING_BINDING", "model references an unavailable binding revision");
    }
  }
  const associations = /* @__PURE__ */ new Set();
  const boundPromises = /* @__PURE__ */ new Set();
  for (const binding of objects.bindings) {
    if (binding.promise.kind !== "promise" || binding.proof.kind !== "proof") {
      throw new ModelGraphError2("WRONG_REFERENCE_KIND", "binding endpoints must be Promise and Proof");
    }
    if (binding.modelScope.workspaceId !== model.scope.workspaceId || binding.modelScope.applicationId !== model.scope.applicationId || binding.modelScope.relativeRoot !== model.scope.relativeRoot) {
      throw new ModelGraphError2("CROSS_SCOPE_BINDING", "binding scope differs from its model scope");
    }
    if (!modelPromiseRefs.has(refKey(binding.promise)) || !promises.has(refKey(binding.promise)) || !modelProofRefs.has(refKey(binding.proof)) || !proofs.has(refKey(binding.proof))) {
      throw new ModelGraphError2("DANGLING_BINDING", "binding endpoint is not sealed in the model");
    }
    const association = `${refKey(binding.promise)}\0${refKey(binding.proof)}`;
    if (associations.has(association)) {
      throw new ModelGraphError2("DUPLICATE_BINDING", "Promise-Proof association is duplicated");
    }
    associations.add(association);
    boundPromises.add(refKey(binding.promise));
  }
  for (const promiseRef of model.promises) {
    if (promiseRef.kind !== "promise") {
      throw new ModelGraphError2("WRONG_REFERENCE_KIND", "model Promise reference has the wrong kind");
    }
    if (!boundPromises.has(refKey(promiseRef))) {
      throw new ModelGraphError2("MISSING_PROMISE_BINDING", "model Promise has no applicable binding definition");
    }
  }
  const visiting = /* @__PURE__ */ new Set();
  const visited = /* @__PURE__ */ new Set();
  const visit = (proofKey) => {
    if (visiting.has(proofKey)) {
      throw new ModelGraphError2("CYCLIC_PROOF_DEPENDENCY", "Proof dependency cycle detected");
    }
    if (visited.has(proofKey))
      return;
    visiting.add(proofKey);
    const proof = proofs.get(proofKey);
    if (!proof) {
      throw new ModelGraphError2("DANGLING_BINDING", "Proof dependency is unavailable");
    }
    for (const dependency of proof.dependencies) {
      if (dependency.kind !== "proof") {
        throw new ModelGraphError2("WRONG_REFERENCE_KIND", "Proof dependency has the wrong kind");
      }
      const dependencyKey = refKey(dependency);
      if (!modelProofRefs.has(dependencyKey) || !proofs.has(dependencyKey)) {
        throw new ModelGraphError2("DANGLING_BINDING", "Proof dependency is not sealed in the model");
      }
      visit(dependencyKey);
    }
    visiting.delete(proofKey);
    visited.add(proofKey);
  };
  for (const proofKey of proofs.keys())
    visit(proofKey);
}
var ModelGraphError2;
var init_model = __esm({
  "../../packages/contracts/dist/public/model.js"() {
    "use strict";
    ModelGraphError2 = class extends TypeError {
      code;
      constructor(code, message) {
        super(`${code}: ${message}`);
        this.name = "ModelGraphError";
        this.code = code;
      }
    };
  }
});

// ../../packages/contracts/dist/public/index.js
var init_public = __esm({
  "../../packages/contracts/dist/public/index.js"() {
    "use strict";
    init_canonical_json();
    init_identity();
    init_revisions();
    init_model();
  }
});

// ../../packages/discovery/dist/public/strict-json.js
function parseJsonData(text) {
  try {
    return parseCanonicalJson2(text);
  } catch (error) {
    if (error instanceof CanonicalJsonError2) {
      throw new StructuredDataError(error.code === "DUPLICATE_KEY" ? "DUPLICATE_KEY" : "INVALID_JSON", error.message);
    }
    throw error;
  }
}
var StructuredDataError;
var init_strict_json = __esm({
  "../../packages/discovery/dist/public/strict-json.js"() {
    "use strict";
    init_public();
    StructuredDataError = class extends SyntaxError {
      code;
      constructor(code, message) {
        super(`${code}: ${message}`);
        this.name = "StructuredDataError";
        this.code = code;
      }
    };
  }
});

// ../../packages/discovery/dist/public/model-sealing.js
import { createHash } from "node:crypto";
function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
function canonical(value) {
  return JSON.parse(JSON.stringify(value));
}
async function revision(kind, id, payload) {
  return revisions.derive({
    kind,
    id,
    schemaVersion: 1,
    payload: canonical(payload)
  });
}
function ref(kind, object) {
  return { kind, id: object.id, revision: object.revision, schemaVersion: object.schemaVersion };
}
function provenance(method, inputs = []) {
  return [{ producer, method, inputs, details: [] }];
}
function predicateId(predicate) {
  return `predicate:${predicate}:v1`;
}
async function resolveAndSealWorkspaceModel(discovery, proofRegistry) {
  if (discovery.packageManagers.length === 0) {
    return {
      status: "not_evaluated",
      diagnostics: [{ code: "UNSUPPORTED_ECOSYSTEM", message: "No supported workspace ecosystem was discovered." }]
    };
  }
  if (discovery.completion !== "complete") {
    return {
      status: "invalid",
      diagnostics: [{ code: "INCOMPLETE_DISCOVERY", message: "Only complete discovery can be sealed." }]
    };
  }
  const workspaceManifests = discovery.manifests.filter((item) => item.workspaceMember);
  if (workspaceManifests.length === 0) {
    return {
      status: "invalid",
      diagnostics: [{
        code: "AMBIGUOUS_APPLICATION_IDENTITY",
        message: "The workspace has no bounded Application candidate."
      }]
    };
  }
  const registryByPredicate = new Map(proofRegistry.map((entry) => [entry.predicate, entry]));
  const predicates = [
    "manifest.structuralValidity",
    "workspace.uniqueMembership",
    "workspace.localDependencyReference",
    "workspace.singleLockfileOwnership"
  ];
  if (registryByPredicate.size !== predicates.length || predicates.some((predicate) => !registryByPredicate.has(predicate))) {
    return {
      status: "invalid",
      diagnostics: [{
        code: "INCOMPLETE_PROOF_REGISTRY",
        message: "All four exact MVP Proof definitions must exist before model sealing."
      }]
    };
  }
  const applications = [];
  for (const manifest of workspaceManifests) {
    const root = manifest.path === "package.json" ? "." : manifest.path.slice(0, -"/package.json".length);
    const packageIdentity = manifest.name;
    const identityKey = packageIdentity ?? `unnamed:${root}`;
    const id = await semanticIds.derive({
      kind: "application",
      schemaVersion: 1,
      naturalKey: {
        workspaceId: discovery.workspaceBinding,
        root,
        packageIdentity: identityKey
      }
    });
    const fields = {
      workspaceId: discovery.workspaceBinding,
      root,
      ...packageIdentity === void 0 ? {} : { packageIdentity },
      provenance: provenance("passive-package-manifest"),
      extensions: []
    };
    applications.push({
      id,
      revision: await revision("application", id, fields),
      schemaVersion: 1,
      ...fields
    });
  }
  applications.sort((left, right) => left.root < right.root ? -1 : left.root > right.root ? 1 : 0);
  const rootApplication = applications.find((item) => item.root === ".") ?? applications[0];
  if (!rootApplication)
    throw new TypeError("sealed model unexpectedly has no Application");
  const applicationRef = ref("application", rootApplication);
  const scope = {
    workspaceId: discovery.workspaceBinding,
    applicationId: rootApplication.id,
    relativeRoot: "."
  };
  const confidence = {
    value: 1,
    basis: "deterministic_rule",
    ruleId: "workspace.supported-ecosystem.v1",
    signalRefs: []
  };
  const capabilityId = await semanticIds.derive({
    kind: "capability",
    schemaVersion: 1,
    naturalKey: {
      applicationId: rootApplication.id,
      capabilityType: "workspace.dependencyIntegrity",
      scope
    }
  });
  const capabilityFields = {
    application: applicationRef,
    type: "workspace.dependencyIntegrity",
    scope,
    activation: "active",
    confidence,
    provenance: provenance("supported-workspace-rule", [applicationRef]),
    extensions: []
  };
  const capability = {
    id: capabilityId,
    revision: await revision("capability", capabilityId, capabilityFields),
    schemaVersion: 1,
    ...capabilityFields
  };
  const capabilityRef = ref("capability", capability);
  const applicability = {
    language: applicabilityLanguage,
    expression: true
  };
  const promises = [];
  const bindings = [];
  for (const [order, predicate] of predicates.entries()) {
    const proof = registryByPredicate.get(predicate)?.definition;
    if (!proof)
      throw new TypeError("Proof registry changed during model resolution");
    const proofRef = ref("proof", proof);
    const promiseId = await semanticIds.derive({
      kind: "promise",
      schemaVersion: 1,
      naturalKey: {
        subjectId: rootApplication.id,
        predicateId: predicateId(predicate),
        scope
      }
    });
    const promiseFields = {
      subject: applicationRef,
      capability: capabilityRef,
      predicate: {
        language: predicateLanguage,
        operator: predicate,
        arguments: []
      },
      expected: true,
      criticality: "required",
      provenanceKind: "discovered",
      applicability,
      provenance: provenance("mvp-workspace-promise-rule", [applicationRef, capabilityRef])
    };
    const promise = {
      id: promiseId,
      revision: await revision("promise", promiseId, promiseFields),
      schemaVersion: 1,
      ...promiseFields
    };
    promises.push(promise);
    const promiseRef = ref("promise", promise);
    const bindingId = `binding:${sha256(new TextEncoder().encode(canonicalize2(canonical({
      domain: "verification-platform/promise-proof-binding-id",
      promise: promiseRef,
      proof: proofRef,
      scope
    })))).slice("sha256:".length)}`;
    const bindingFields = {
      modelScope: scope,
      promise: promiseRef,
      proof: proofRef,
      requirement: "required",
      order,
      applicability,
      provenance: provenance("mvp-proof-registry-binding", [promiseRef, proofRef])
    };
    bindings.push({
      id: bindingId,
      revision: await revision("promiseProofBinding", bindingId, bindingFields),
      schemaVersion: 1,
      ...bindingFields
    });
  }
  const proofDefinitions = predicates.map((predicate) => registryByPredicate.get(predicate)?.definition);
  const modelId = `model:${discovery.workspaceBinding.slice("sha256:".length)}`;
  const modelFields = {
    scope,
    applications: applications.map((item) => ref("application", item)),
    capabilities: [capabilityRef],
    promises: promises.map((item) => ref("promise", item)),
    proofs: proofDefinitions.map((item) => ref("proof", item)),
    promiseProofBindings: bindings.map((item) => ref("promiseProofBinding", item)),
    providerBindings: [],
    repairKnowledge: [],
    provenance: provenance("passive-workspace-model-seal", [
      ...applications.map((item) => ref("application", item)),
      capabilityRef,
      ...promises.map((item) => ref("promise", item)),
      ...proofDefinitions.map((item) => ref("proof", item)),
      ...bindings.map((item) => ref("promiseProofBinding", item))
    ])
  };
  const model = {
    id: modelId,
    revision: await revision("applicationModel", modelId, modelFields),
    schemaVersion: 1,
    ...modelFields
  };
  assertValidApplicationModelGraph2(model, {
    promises,
    proofs: proofDefinitions,
    bindings
  });
  return {
    status: "sealed",
    graph: {
      model,
      applications,
      capabilities: [capability],
      promises,
      proofs: proofDefinitions,
      bindings
    },
    diagnostics: []
  };
}
var semanticIds, revisions, producer, predicateLanguage, applicabilityLanguage;
var init_model_sealing = __esm({
  "../../packages/discovery/dist/public/model-sealing.js"() {
    "use strict";
    init_public();
    semanticIds = new CanonicalSemanticIdDeriver2(sha256);
    revisions = new CanonicalRevisionDeriver2(sha256);
    producer = {
      id: "engine:passive-workspace-resolver",
      version: "1",
      artifactDigest: sha256(new TextEncoder().encode("passive-workspace-resolver:v1"))
    };
    predicateLanguage = {
      id: "predicate.workspace-integrity",
      schemaVersion: 1,
      revision: sha256(new TextEncoder().encode("predicate.workspace-integrity:v1"))
    };
    applicabilityLanguage = {
      id: "applicability.constant",
      schemaVersion: 1,
      revision: sha256(new TextEncoder().encode("applicability.constant:v1"))
    };
  }
});

// ../../packages/discovery/dist/public/index.js
import { createHash as createHash2 } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import path2 from "node:path";
function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
function digest(value) {
  return `sha256:${createHash2("sha256").update(value).digest("hex")}`;
}
function resolveDiscoveryLimits(requested) {
  const output = { ...DEFAULT_DISCOVERY_LIMITS };
  if (!requested)
    return output;
  for (const key of Object.keys(output)) {
    const value = requested[key];
    if (value === void 0)
      continue;
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(`discovery limit ${key} must be a positive integer`);
    }
    const maximum = DEFAULT_DISCOVERY_LIMITS[key] * 10;
    output[key] = Math.min(value, maximum);
  }
  return output;
}
function createDiscoveryPlan(workspaceRoot, requested) {
  if (typeof workspaceRoot !== "string" || workspaceRoot.length === 0) {
    throw new TypeError("workspace root is required");
  }
  return {
    schemaVersion: 1,
    workspaceRoot,
    limits: resolveDiscoveryLimits(requested),
    permissions: { network: false, write: false, process: false }
  };
}
function toPosix(value) {
  return value.split(path2.sep).join("/");
}
function globToRegExp(pattern) {
  const normalized = pattern.replace(/^\.\//, "").replace(/\/+$/, "");
  let source = "^";
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (character === "*") {
      if (normalized[index + 1] === "*") {
        index += 1;
        source += ".*";
      } else {
        source += "[^/]*";
      }
    } else if (character === "?") {
      source += "[^/]";
    } else {
      source += character?.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    }
  }
  return new RegExp(`${source}$`);
}
function isWorkspaceMember(directory, patterns) {
  if (directory === ".")
    return true;
  let included = false;
  for (const rawPattern of patterns) {
    const negative = rawPattern.startsWith("!");
    const pattern = negative ? rawPattern.slice(1) : rawPattern;
    if (globToRegExp(pattern).test(directory))
      included = !negative;
  }
  return included;
}
function parseWorkspacePatterns(value) {
  if (Array.isArray(value)) {
    return value.filter((item) => typeof item === "string");
  }
  if (value && typeof value === "object" && "packages" in value) {
    return parseWorkspacePatterns(value.packages);
  }
  return [];
}
function parsePnpmWorkspace(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const patterns = [];
  let inPackages = false;
  for (const line of lines) {
    if (/^packages\s*:\s*$/.test(line.trim())) {
      inPackages = true;
      continue;
    }
    if (inPackages && /^\S/.test(line) && !/^\s*-/.test(line))
      break;
    const match = inPackages ? line.match(/^\s*-\s*(?:"([^"]+)"|'([^']+)'|([^#\s][^#]*?))\s*(?:#.*)?$/) : null;
    const value = match?.[1] ?? match?.[2] ?? match?.[3]?.trim();
    if (value)
      patterns.push(value);
  }
  return patterns;
}
function isSafeWorkspacePattern(value) {
  const pattern = value.startsWith("!") ? value.slice(1) : value;
  return pattern.length > 0 && pattern === pattern.trim() && !pattern.startsWith("/") && !pattern.includes("\\") && !pattern.includes("\0") && pattern.split("/").every((segment) => segment !== "" && segment !== "..");
}
function dependenciesFromManifest(value) {
  const output = {};
  for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    const dependencies = value[field];
    if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies))
      continue;
    for (const [name, range] of Object.entries(dependencies)) {
      if (typeof range === "string")
        output[name] = range;
    }
  }
  return Object.fromEntries(Object.entries(output).sort(([left], [right]) => compareText(left, right)));
}
function safeManifestProjection(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("manifest root must be an object");
  }
  const manifest = value;
  const projected = {
    dependencies: dependenciesFromManifest(manifest),
    workspaces: parseWorkspacePatterns(manifest.workspaces)
  };
  if (typeof manifest.name === "string")
    projected.name = manifest.name;
  if (typeof manifest.version === "string")
    projected.version = manifest.version;
  if (typeof manifest.private === "boolean")
    projected.private = manifest.private;
  if (typeof manifest.packageManager === "string")
    projected.packageManager = manifest.packageManager;
  return projected;
}
function checkCancelled(signal) {
  if (signal?.aborted)
    throw new DOMException("discovery cancelled", "AbortError");
}
async function discoverWorkspace(workspaceRoot, policy = {}) {
  const plan = createDiscoveryPlan(workspaceRoot, policy.limits);
  const limits = plan.limits;
  const now = policy.now ?? Date.now;
  const started = now();
  const root = await realpath(workspaceRoot);
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory())
    throw new TypeError("workspace root must be a directory");
  const files = [];
  const skipped = [];
  const diagnostics = [];
  let inspectedFiles = 0;
  let inspectedBytes = 0;
  let completion = "complete";
  async function walk(directory, depth) {
    checkCancelled(policy.signal);
    if (now() - started > limits.timeoutMs) {
      completion = "bounded";
      return;
    }
    if (depth > limits.maxDepth || inspectedFiles >= limits.maxFiles) {
      completion = "bounded";
      return;
    }
    const directoryRealpath = await realpath(directory);
    if (directoryRealpath !== root && !directoryRealpath.startsWith(`${root}${path2.sep}`)) {
      skipped.push({ path: toPosix(path2.relative(root, directory)), reason: "outside_workspace" });
      return;
    }
    const directoryStat = await lstat(directory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
      skipped.push({ path: toPosix(path2.relative(root, directory)), reason: "not_ordinary_directory" });
      return;
    }
    const children = (await readdir(directory, { withFileTypes: true })).sort((left, right) => compareText(left.name, right.name));
    for (const child of children) {
      checkCancelled(policy.signal);
      if (now() - started > limits.timeoutMs) {
        completion = "bounded";
        return;
      }
      const absolute = path2.join(directory, child.name);
      const relative = toPosix(path2.relative(root, absolute));
      if (child.isSymbolicLink()) {
        skipped.push({ path: relative, reason: "symbolic_link" });
        continue;
      }
      if (child.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(child.name)) {
          skipped.push({ path: relative, reason: "ignored_directory" });
        } else {
          await walk(absolute, depth + 1);
        }
        if (completion !== "complete")
          return;
        continue;
      }
      if (!child.isFile()) {
        skipped.push({ path: relative, reason: "special_file" });
        continue;
      }
      inspectedFiles += 1;
      if (inspectedFiles > limits.maxFiles) {
        completion = "bounded";
        return;
      }
      if (INTERESTING_FILES.has(child.name))
        files.push(relative);
    }
  }
  try {
    await walk(root, 0);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      completion = "cancelled";
    } else {
      throw error;
    }
  }
  const textByPath = /* @__PURE__ */ new Map();
  for (const relative of files.sort()) {
    if (completion === "cancelled")
      break;
    if (policy.signal?.aborted) {
      completion = "cancelled";
      break;
    }
    if (now() - started > limits.timeoutMs) {
      completion = "bounded";
      break;
    }
    const absolute = path2.resolve(root, relative);
    if (absolute !== root && !absolute.startsWith(`${root}${path2.sep}`)) {
      skipped.push({ path: relative, reason: "outside_workspace" });
      continue;
    }
    const remaining = limits.maxInspectedBytes - inspectedBytes;
    const maximum = Math.min(limits.maxFileBytes, remaining);
    if (maximum <= 0) {
      skipped.push({ path: relative, reason: "size_limit" });
      completion = "bounded";
      continue;
    }
    let handle;
    try {
      handle = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const stat2 = await handle.stat();
      if (!stat2.isFile()) {
        skipped.push({ path: relative, reason: "not_ordinary_file" });
        continue;
      }
      if (stat2.size > maximum) {
        skipped.push({ path: relative, reason: "size_limit" });
        completion = "bounded";
        continue;
      }
      const bytes = new Uint8Array(maximum + 1);
      let offset = 0;
      while (offset < bytes.length) {
        const result = await handle.read(bytes, offset, bytes.length - offset, offset);
        if (result.bytesRead === 0)
          break;
        offset += result.bytesRead;
      }
      const finalStat = await handle.stat();
      if (finalStat.dev !== stat2.dev || finalStat.ino !== stat2.ino || finalStat.size !== stat2.size || finalStat.mtimeMs !== stat2.mtimeMs) {
        skipped.push({ path: relative, reason: "mutated_during_read" });
        completion = "bounded";
        continue;
      }
      if (offset > maximum) {
        skipped.push({ path: relative, reason: "size_limit" });
        completion = "bounded";
        continue;
      }
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, offset));
      inspectedBytes += offset;
      textByPath.set(relative, text);
    } catch (error) {
      skipped.push({
        path: relative,
        reason: error instanceof TypeError ? "invalid_utf8" : "unsafe_or_unreadable"
      });
    } finally {
      await handle?.close();
    }
  }
  const rootPackageText = textByPath.get("package.json");
  let rootManifest;
  if (rootPackageText !== void 0) {
    try {
      rootManifest = safeManifestProjection(parseJsonData(rootPackageText));
    } catch (error) {
      diagnostics.push({
        code: error instanceof Error && "code" in error && error.code === "DUPLICATE_KEY" ? "DUPLICATE_PACKAGE_JSON_KEY" : "INVALID_PACKAGE_JSON",
        path: "package.json",
        message: "root package.json is not valid unambiguous bounded JSON"
      });
    }
  }
  const pnpmWorkspaceText = textByPath.get("pnpm-workspace.yaml");
  const npmWorkspacePatterns = rootManifest?.workspaces ?? [];
  const pnpmWorkspacePatterns = pnpmWorkspaceText ? parsePnpmWorkspace(pnpmWorkspaceText) : [];
  const rawWorkspacePatterns = [
    ...npmWorkspacePatterns,
    ...pnpmWorkspacePatterns
  ];
  for (const pattern of rawWorkspacePatterns) {
    if (!isSafeWorkspacePattern(pattern)) {
      diagnostics.push({
        code: "INVALID_WORKSPACE_PATTERN",
        message: "workspace patterns must be normalized repository-relative globs"
      });
    }
  }
  const workspacePatterns = rawWorkspacePatterns.filter(isSafeWorkspacePattern).filter((value, index, values) => values.indexOf(value) === index);
  const packageManagers = [];
  const lockfiles = [...textByPath.keys()].filter((value) => /(?:^|\/)(?:package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock)$/.test(value)).sort(compareText);
  if (lockfiles.some((value) => /(?:^|\/)(?:package-lock\.json|npm-shrinkwrap\.json)$/.test(value))) {
    packageManagers.push("npm");
  }
  if (lockfiles.some((value) => /(?:^|\/)pnpm-lock\.yaml$/.test(value)) || textByPath.has("pnpm-workspace.yaml")) {
    packageManagers.push("pnpm");
  }
  if (lockfiles.some((value) => /(?:^|\/)yarn\.lock$/.test(value)) || rootManifest?.packageManager?.startsWith("yarn@")) {
    packageManagers.push("yarn");
  }
  if (rootManifest?.packageManager?.startsWith("npm@") && !packageManagers.includes("npm"))
    packageManagers.push("npm");
  if (rootManifest?.packageManager?.startsWith("pnpm@") && !packageManagers.includes("pnpm"))
    packageManagers.push("pnpm");
  if (packageManagers.length === 0 && rootPackageText !== void 0)
    packageManagers.push("npm");
  const selectedPackageManager = packageManagers.length === 1 ? packageManagers[0] : void 0;
  const conflicts = [];
  if (packageManagers.length > 1) {
    conflicts.push({
      code: "MULTIPLE_PACKAGE_MANAGERS",
      paths: lockfiles,
      message: `conflicting package-manager signals: ${packageManagers.join(", ")}`
    });
  }
  const manifests = [];
  for (const relative of files.filter((file) => path2.posix.basename(file) === "package.json").sort()) {
    if (manifests.length >= limits.maxManifests) {
      completion = "bounded";
      break;
    }
    const text = textByPath.get(relative);
    if (text === void 0)
      continue;
    try {
      const projected = safeManifestProjection(parseJsonData(text));
      const directory = path2.posix.dirname(relative);
      const observation = {
        path: relative,
        dependencies: projected.dependencies,
        workspaceMember: isWorkspaceMember(directory, workspacePatterns),
        contentDigest: digest(text)
      };
      if (projected.name !== void 0)
        Object.assign(observation, { name: projected.name });
      if (projected.version !== void 0)
        Object.assign(observation, { version: projected.version });
      if (projected.private !== void 0)
        Object.assign(observation, { private: projected.private });
      manifests.push(observation);
    } catch (error) {
      diagnostics.push({
        code: error instanceof Error && "code" in error && error.code === "DUPLICATE_KEY" ? "DUPLICATE_PACKAGE_JSON_KEY" : "INVALID_PACKAGE_JSON",
        path: relative,
        message: "package.json is not valid unambiguous bounded JSON"
      });
      const directory = path2.posix.dirname(relative);
      manifests.push({
        path: relative,
        dependencies: {},
        workspaceMember: isWorkspaceMember(directory, workspacePatterns),
        contentDigest: digest(text)
      });
    }
  }
  const rootIdentityDigest = digest(canonicalize2({
    domain: "verification-platform/local-root-identity",
    schemaVersion: 1,
    packageIdentity: rootManifest?.name ?? "anonymous-workspace",
    applications: manifests.map((item) => ({
      path: item.path,
      ...item.name === void 0 ? {} : { name: item.name }
    })),
    workspacePatterns
  }));
  const workspaceBinding = digest(canonicalize2({
    domain: "verification-platform/workspace-binding",
    schemaVersion: 1,
    source: "local-root-signals",
    rootIdentityDigest
  }));
  const signals = [];
  const signal = (readerId, inputPath, pointer, kind, value) => {
    const stable = { readerId, inputPath, pointer, kind, value };
    signals.push({ id: digest(canonicalize2(stable)), ...stable });
  };
  npmWorkspacePatterns.forEach((pattern, index) => signal("package-json:v1", "package.json", `/workspaces/${index}`, "workspace.pattern", pattern));
  pnpmWorkspacePatterns.forEach((pattern, index) => signal("pnpm-workspace:v1", "pnpm-workspace.yaml", `/packages/${index}`, "workspace.pattern", pattern));
  for (const lockfile of lockfiles) {
    const manager = lockfile.endsWith("pnpm-lock.yaml") ? "pnpm" : lockfile.endsWith("yarn.lock") ? "yarn" : "npm";
    signal(`${manager}-lockfile:v1`, lockfile, "/", "packageManager.lockfile", manager);
  }
  const facts = manifests.map((manifest) => {
    const stable = {
      readerId: "package-json:v1",
      inputPath: manifest.path,
      pointer: "/",
      kind: "workspace.manifest",
      value: JSON.parse(JSON.stringify({
        path: manifest.path,
        ...manifest.name === void 0 ? {} : { name: manifest.name },
        ...manifest.version === void 0 ? {} : { version: manifest.version },
        dependencies: manifest.dependencies,
        workspaceMember: manifest.workspaceMember,
        contentDigest: manifest.contentDigest
      }))
    };
    return { id: digest(canonicalize2(stable)), ...stable };
  });
  const candidates = manifests.filter((manifest) => manifest.workspaceMember && typeof manifest.name === "string").map((manifest) => ({
    kind: "application",
    relativeRoot: manifest.path === "package.json" ? "." : manifest.path.slice(0, -"/package.json".length),
    packageIdentity: manifest.name,
    sourceFactIds: facts.filter((fact) => fact.inputPath === manifest.path).map((fact) => fact.id)
  }));
  const semantic = {
    schemaVersion: 1,
    workspaceBinding,
    packageManagers,
    ...selectedPackageManager ? { selectedPackageManager } : {},
    workspacePatterns,
    manifests,
    lockfiles,
    conflicts,
    diagnostics,
    signals,
    facts,
    candidates,
    completion
  };
  return {
    schemaVersion: 1,
    workspaceRoot: root,
    workspaceBinding,
    completion,
    packageManagers,
    ...selectedPackageManager ? { selectedPackageManager } : {},
    workspacePatterns,
    manifests,
    lockfiles,
    inspectedFiles,
    inspectedBytes,
    skipped: skipped.sort((left, right) => compareText(left.path, right.path)),
    conflicts,
    diagnostics,
    signals,
    facts,
    candidates,
    modelRevision: digest(canonicalize2(JSON.parse(JSON.stringify(semantic))))
  };
}
var DEFAULT_DISCOVERY_LIMITS, SKIPPED_DIRECTORIES, INTERESTING_FILES;
var init_public2 = __esm({
  "../../packages/discovery/dist/public/index.js"() {
    "use strict";
    init_public();
    init_strict_json();
    init_strict_json();
    init_model_sealing();
    DEFAULT_DISCOVERY_LIMITS = Object.freeze({
      maxFiles: 1e5,
      maxInspectedBytes: 256 * 1024 * 1024,
      maxFileBytes: 2 * 1024 * 1024,
      maxManifests: 1e4,
      maxDepth: 64,
      timeoutMs: 3e4
    });
    SKIPPED_DIRECTORIES = /* @__PURE__ */ new Set([
      ".git",
      ".hg",
      ".svn",
      ".verify",
      "node_modules",
      "coverage",
      "dist",
      "build",
      "out",
      ".next"
    ]);
    INTERESTING_FILES = /* @__PURE__ */ new Set([
      "package.json",
      "package-lock.json",
      "npm-shrinkwrap.json",
      "pnpm-workspace.yaml",
      "pnpm-lock.yaml",
      "yarn.lock"
    ]);
  }
});

// lib/bin/run.js
import { appendFile } from "node:fs/promises";

// lib/public/action.js
import { join as join3 } from "node:path";

// ../../packages/adapter-core/src/public/dispatcher.ts
import { randomUUID as randomUUID4 } from "node:crypto";
import { resolve } from "node:path";

// ../../packages/contracts/src/public/canonical-json.ts
var CanonicalJsonError = class extends TypeError {
  code;
  path;
  constructor(code, path5, message) {
    super(`${code} at ${path5}: ${message}`);
    this.name = "CanonicalJsonError";
    this.code = code;
    this.path = path5;
  }
};
function assertUnicodeScalarString(value, path5) {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 55296 && unit <= 56319) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 56320 && next <= 57343)) {
        throw new CanonicalJsonError(
          "INVALID_STRING",
          path5,
          "unpaired high surrogate"
        );
      }
      index += 1;
    } else if (unit >= 56320 && unit <= 57343) {
      throw new CanonicalJsonError(
        "INVALID_STRING",
        path5,
        "unpaired low surrogate"
      );
    }
  }
}
function propertyPath(parent, key) {
  return `${parent}[${JSON.stringify(key)}]`;
}
function serialize(value, path5, ancestors) {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "string":
      assertUnicodeScalarString(value, path5);
      return JSON.stringify(value);
    case "number": {
      if (!Number.isFinite(value)) {
        throw new CanonicalJsonError(
          "INVALID_NUMBER",
          path5,
          "number must be finite"
        );
      }
      return Object.is(value, -0) ? "0" : JSON.stringify(value);
    }
    case "object": {
      const object = value;
      if (ancestors.has(object)) {
        throw new CanonicalJsonError("CYCLE", path5, "cyclic value");
      }
      ancestors.add(object);
      try {
        if (Array.isArray(value)) {
          const items = [];
          for (let index = 0; index < value.length; index += 1) {
            if (!Object.hasOwn(value, index)) {
              throw new CanonicalJsonError(
                "SPARSE_ARRAY",
                `${path5}[${index}]`,
                "array entries must be present"
              );
            }
            items.push(serialize(value[index], `${path5}[${index}]`, ancestors));
          }
          return `[${items.join(",")}]`;
        }
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
          throw new CanonicalJsonError(
            "INVALID_OBJECT",
            path5,
            "only ordinary or null-prototype objects are allowed"
          );
        }
        const record = value;
        const keys = Object.keys(record).sort();
        const members = [];
        for (const key of keys) {
          assertUnicodeScalarString(key, propertyPath(path5, key));
          const childPath = propertyPath(path5, key);
          members.push(
            `${JSON.stringify(key)}:${serialize(record[key], childPath, ancestors)}`
          );
        }
        return `{${members.join(",")}}`;
      } finally {
        ancestors.delete(object);
      }
    }
    default:
      throw new CanonicalJsonError(
        "INVALID_TYPE",
        path5,
        `unsupported type ${typeof value}`
      );
  }
}
function canonicalize(value) {
  return serialize(value, "$", /* @__PURE__ */ new Set());
}

// ../../packages/engine/src/public/index.ts
import { createHash as createHash11, randomUUID as randomUUID3 } from "node:crypto";

// ../../packages/auth/dist/public/index.js
import path from "node:path";
function normalizedRoot(value) {
  return path.resolve(value);
}
function inScope(root, allowed) {
  const target = normalizedRoot(root);
  return allowed.some((item) => {
    const boundary = normalizedRoot(item);
    return target === boundary || target.startsWith(`${boundary}${path.sep}`);
  });
}
function authorize(principal, request, policy) {
  if (!principal.authenticated) {
    return {
      allowed: false,
      granted: [],
      denied: [...request.permissions],
      reasonCode: "UNAUTHENTICATED"
    };
  }
  if (!policy || policy.principalId !== principal.id) {
    return {
      allowed: false,
      granted: [],
      denied: [...request.permissions],
      reasonCode: "NO_EXTERNAL_GRANT"
    };
  }
  if (request.workspaceRoot && !inScope(request.workspaceRoot, policy.workspaceRoots)) {
    return {
      allowed: false,
      granted: [],
      denied: [...request.permissions],
      reasonCode: "WORKSPACE_OUT_OF_SCOPE"
    };
  }
  const granted = request.permissions.filter((permission) => policy.grants.includes(permission));
  const denied = request.permissions.filter((permission) => !policy.grants.includes(permission));
  return {
    allowed: denied.length === 0,
    granted,
    denied,
    reasonCode: denied.length === 0 ? "AUTHORIZED" : "NO_EXTERNAL_GRANT"
  };
}
function passiveCliPolicy(principal, workspaceRoot) {
  if (!principal.authenticated)
    throw new TypeError("cannot bind policy to unauthenticated principal");
  return {
    source: "cli-boundary",
    principalId: principal.id,
    workspaceRoots: [normalizedRoot(workspaceRoot)],
    grants: ["workspace.read", "history.read", "cache.read", "cache.clear"]
  };
}
function repairApplyCliPolicy(principal, workspaceRoot) {
  if (!principal.authenticated) {
    throw new TypeError("cannot bind policy to unauthenticated principal");
  }
  return {
    source: "cli-boundary",
    principalId: principal.id,
    workspaceRoots: [normalizedRoot(workspaceRoot)],
    grants: ["workspace.read", "history.read", "workspace.write"]
  };
}

// ../../packages/engine/src/public/index.ts
init_public();
init_public2();

// ../../packages/evidence/dist/public/index.js
init_public();
import { createHash as createHash3 } from "node:crypto";
var MAX_EVIDENCE_BYTES = 2 * 1024 * 1024;
var SECRET_NAME = /(?:^|[_-])(token|secret|password|passwd|api[_-]?key|private[_-]?key)(?:$|[_-])/i;
var SECRET_VALUE = /(?:bearer\s+[a-z0-9._~-]+|-----BEGIN [A-Z ]+PRIVATE KEY-----|(?:gh[opsu]_|sk-)[a-z0-9_-]{8,})/i;
function digestText(text) {
  return `sha256:${createHash3("sha256").update(text).digest("hex")}`;
}
function redact(value) {
  if (typeof value === "string") {
    return SECRET_VALUE.test(value) ? { value: "[REDACTED]", count: 1 } : { value, count: 0 };
  }
  if (value === null || typeof value !== "object")
    return { value, count: 0 };
  if (Array.isArray(value)) {
    let count2 = 0;
    const output2 = value.map((item) => {
      const result = redact(item);
      count2 += result.count;
      return result.value;
    });
    return { value: output2, count: count2 };
  }
  let count = 0;
  const output = {};
  for (const [key, item] of Object.entries(value).sort(([left], [right]) => left.localeCompare(right))) {
    if (SECRET_NAME.test(key)) {
      output[key] = "[REDACTED]";
      count += 1;
    } else {
      const result = redact(item);
      output[key] = result.value;
      count += result.count;
    }
  }
  return { value: output, count };
}
function normalizeRelativePath(value) {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\/+/, "");
  if (normalized.includes("\0") || normalized.startsWith("/") || normalized === ".." || normalized.startsWith("../") || normalized !== "." && normalized.split("/").some((segment) => segment === "" || segment === ".." || segment === ".") || /^[A-Za-z]:\//.test(normalized)) {
    throw new TypeError("Evidence paths must be workspace-relative");
  }
  return normalized || ".";
}
function assertDigest(value, field) {
  if (!/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new TypeError(`${field} must be an exact SHA-256 content identity`);
  }
}
function revisionDocument(evidence) {
  return {
    schemaVersion: 1,
    evidenceType: evidence.evidenceType,
    workspaceBinding: evidence.workspaceBinding,
    contentDigest: evidence.contentDigest,
    id: evidence.id,
    mediaType: evidence.mediaType,
    byteSize: evidence.byteSize,
    classification: evidence.classification,
    redactions: evidence.redactions
  };
}
function normalizeWorkspaceEvidence(candidate) {
  if (!["complete", "bounded", "cancelled", "error"].includes(candidate.completion)) {
    throw new TypeError("Evidence completion is not a supported control-flow value");
  }
  if (candidate.packageManagers.some((value) => !["npm", "pnpm", "yarn"].includes(value)) || new Set(candidate.packageManagers).size !== candidate.packageManagers.length) {
    throw new TypeError("Evidence package-manager facts must be unique supported values");
  }
  if (new Set(candidate.lockfiles).size !== candidate.lockfiles.length) {
    throw new TypeError("Evidence lockfile facts must be unique");
  }
  for (const observation of candidate.observations) {
    assertDigest(observation.contentDigest, "observation contentDigest");
  }
  const normalizedObservationPaths = candidate.observations.map((item) => normalizeRelativePath(item.path));
  if (new Set(normalizedObservationPaths).size !== normalizedObservationPaths.length) {
    throw new TypeError("Evidence observation paths must be unique");
  }
  const body = {
    schemaVersion: 1,
    workspaceBinding: candidate.workspaceBinding,
    observations: candidate.observations.map((observation) => ({
      path: normalizeRelativePath(observation.path),
      ...observation.name === void 0 ? {} : { name: observation.name },
      ...observation.version === void 0 ? {} : { version: observation.version },
      dependencies: Object.fromEntries(Object.entries(observation.dependencies).sort(([left], [right]) => left.localeCompare(right))),
      workspaceMember: observation.workspaceMember,
      contentDigest: observation.contentDigest
    })).sort((left, right) => left.path.localeCompare(right.path)),
    lockfiles: [...candidate.lockfiles].map(normalizeRelativePath).sort(),
    packageManagers: [...candidate.packageManagers].sort(),
    completion: candidate.completion,
    diagnostics: candidate.diagnostics.map((item) => ({
      code: item.code,
      ...item.path === void 0 ? {} : { path: normalizeRelativePath(item.path) }
    })).sort((left, right) => left.code.localeCompare(right.code) || (left.path ?? "").localeCompare(right.path ?? ""))
  };
  const redacted = redact(body);
  const canonicalBody = canonicalize2(redacted.value);
  const byteSize = Buffer.byteLength(canonicalBody);
  if (byteSize > MAX_EVIDENCE_BYTES)
    throw new RangeError("normalized Evidence exceeds the per-object limit");
  const contentDigest = digestText(canonicalBody);
  const identity = {
    schemaVersion: 1,
    evidenceType: candidate.evidenceType,
    workspaceBinding: candidate.workspaceBinding,
    contentDigest
  };
  const id = `evidence:${digestText(canonicalize2(identity)).slice("sha256:".length)}`;
  const sealedRevisionDocument = revisionDocument({
    id,
    evidenceType: candidate.evidenceType,
    mediaType: candidate.mediaType,
    contentDigest,
    byteSize,
    classification: "SENSITIVE_EVIDENCE",
    redactions: redacted.count,
    workspaceBinding: candidate.workspaceBinding
  });
  return {
    schemaVersion: 1,
    id,
    revision: digestText(canonicalize2(sealedRevisionDocument)),
    evidenceType: candidate.evidenceType,
    mediaType: candidate.mediaType,
    contentDigest,
    byteSize,
    classification: "SENSITIVE_EVIDENCE",
    body: redacted.value,
    redactions: redacted.count
  };
}
function validateEvidence(evidence) {
  const reasons = [];
  let canonicalBody;
  try {
    canonicalBody = canonicalize2(evidence.body);
  } catch {
    reasons.push("BODY_NOT_CANONICAL");
  }
  if (canonicalBody !== void 0) {
    if (digestText(canonicalBody) !== evidence.contentDigest)
      reasons.push("CONTENT_DIGEST_MISMATCH");
    if (Buffer.byteLength(canonicalBody) !== evidence.byteSize)
      reasons.push("BYTE_SIZE_MISMATCH");
    if (SECRET_VALUE.test(canonicalBody))
      reasons.push("SECRET_CANARY_PRESENT");
  }
  const body = evidence.body !== null && typeof evidence.body === "object" && !Array.isArray(evidence.body) ? evidence.body : {};
  if (!("workspaceBinding" in body))
    reasons.push("BODY_SHAPE_INVALID");
  if (typeof body.workspaceBinding !== "string")
    reasons.push("WORKSPACE_BINDING_MISSING");
  const observations = Array.isArray(body.observations) ? body.observations : [];
  if (!Array.isArray(body.observations))
    reasons.push("OBSERVATIONS_INVALID");
  for (const observation of observations) {
    if (typeof observation.contentDigest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(observation.contentDigest))
      reasons.push("OBSERVATION_DIGEST_INVALID");
  }
  if (typeof body.workspaceBinding === "string") {
    const identity = {
      schemaVersion: 1,
      evidenceType: evidence.evidenceType,
      workspaceBinding: body.workspaceBinding,
      contentDigest: evidence.contentDigest
    };
    const expectedId = `evidence:${digestText(canonicalize2(identity)).slice("sha256:".length)}`;
    if (evidence.id !== expectedId)
      reasons.push("EVIDENCE_ID_MISMATCH");
    const expectedRevision = digestText(canonicalize2(revisionDocument({
      id: evidence.id,
      evidenceType: evidence.evidenceType,
      mediaType: evidence.mediaType,
      contentDigest: evidence.contentDigest,
      byteSize: evidence.byteSize,
      classification: evidence.classification,
      redactions: evidence.redactions,
      workspaceBinding: body.workspaceBinding
    })));
    if (evidence.revision !== expectedRevision)
      reasons.push("EVIDENCE_REVISION_MISMATCH");
  }
  reasons.sort();
  const state = reasons.length === 0 ? "valid" : "rejected";
  const stable = {
    schemaVersion: 1,
    evidenceRevision: evidence.revision,
    state,
    reasonCodes: reasons
  };
  return {
    schemaVersion: 1,
    evidenceRevision: evidence.revision,
    state,
    reasonCodes: reasons,
    validationDigest: digestText(canonicalize2(stable))
  };
}

// ../../packages/proofs/dist/public/index.js
init_public();
import { createHash as createHash4 } from "node:crypto";

// ../../packages/proofs/dist/public/aggregation.js
init_public();

// ../../packages/proofs/dist/public/index.js
function digest2(value) {
  return `sha256:${createHash4("sha256").update(canonicalize2(value)).digest("hex")}`;
}
function definition(proofId, promiseId, predicate, order) {
  const proofDefinitionId = proofId;
  const evaluator = {
    id: `evaluator:${predicate}`,
    version: "1",
    artifactDigest: digest2({ domain: "verification-platform/mvp-evaluator", predicate, version: 1 })
  };
  const applicabilityRevision = digest2({
    domain: "verification-platform/applicability-language",
    id: "applicability.constant",
    schemaVersion: 1
  });
  const fields = {
    evaluator,
    predicateLanguage: {
      id: "predicate.workspace-integrity",
      schemaVersion: 1,
      revision: digest2({
        domain: "verification-platform/predicate-language",
        id: "predicate.workspace-integrity",
        schemaVersion: 1
      })
    },
    inputs: [{
      name: "workspace.observations",
      sourceType: "validatedEvidence",
      schema: {
        id: "workspace.manifest-observations",
        schemaVersion: 1,
        revision: digest2({
          domain: "verification-platform/evidence-schema",
          id: "workspace.manifest-observations",
          schemaVersion: 1
        })
      },
      required: true
    }],
    evidenceRequirements: [{
      identity: "workspace.manifest-observations:v1",
      evidenceType: "workspace.manifest-observations",
      mediaTypes: ["application/vnd.verify.workspace-observations+json"],
      minimumCount: 1,
      validationSchema: {
        id: "workspace.manifest-observations",
        schemaVersion: 1,
        revision: digest2({
          domain: "verification-platform/evidence-schema",
          id: "workspace.manifest-observations",
          schemaVersion: 1
        })
      }
    }],
    dependencies: [],
    permissions: {
      filesystem: [],
      network: [],
      subprocess: false,
      secrets: []
    },
    reproducibility: "hermetic",
    cachePolicy: { mode: "content_addressed" },
    timeoutMs: 1e3,
    retryPolicy: { maximumAttempts: 1, retryableOperations: [] },
    applicability: {
      language: {
        id: "applicability.constant",
        schemaVersion: 1,
        revision: applicabilityRevision
      },
      expression: true
    },
    provenance: []
  };
  const revision2 = digest2({
    domain: "verification-platform/revision",
    id: proofId,
    kind: "proof",
    payload: fields,
    schemaVersion: 1
  });
  const exactDefinition = {
    id: proofDefinitionId,
    revision: revision2,
    schemaVersion: 1,
    ...fields
  };
  return {
    proofId,
    promiseId,
    predicate,
    order,
    required: true,
    revision: revision2,
    predicateAst: {
      schemaVersion: 1,
      operator: predicate,
      arguments: []
    },
    definition: exactDefinition
  };
}
var MVP_PROOF_REGISTRY = Object.freeze([
  definition("proof:manifest-structural-v1", "promise:manifest-structural", "manifest.structuralValidity", 0),
  definition("proof:workspace-unique-v1", "promise:workspace-unique", "workspace.uniqueMembership", 1),
  definition("proof:local-dependency-v1", "promise:local-dependency", "workspace.localDependencyReference", 2),
  definition("proof:lockfile-ownership-v1", "promise:lockfile-ownership", "workspace.singleLockfileOwnership", 3)
]);
function finish(definitionValue, status, reasonCodes, evidence, details = []) {
  const stable = {
    schemaVersion: 1,
    proofId: definitionValue.proofId,
    promiseId: definitionValue.promiseId,
    status,
    reasonCodes: [...reasonCodes].sort(),
    evidence: [...evidence].sort(),
    details: [...details].sort((left, right) => left.path.localeCompare(right.path) || left.message.localeCompare(right.message))
  };
  return {
    proofId: definitionValue.proofId,
    promiseId: definitionValue.promiseId,
    status,
    reasonCodes: stable.reasonCodes,
    evidence: stable.evidence,
    details: stable.details,
    resultDigest: digest2(stable)
  };
}
function manifestStructural(input, proof) {
  const invalidDiagnostics = input.diagnostics.filter((item) => item.code === "INVALID_PACKAGE_JSON" || item.code === "DUPLICATE_PACKAGE_JSON_KEY" || item.code === "INVALID_WORKSPACE_PATTERN");
  const invalid = invalidDiagnostics.map((item) => ({
    path: item.path ?? ".",
    message: item.code === "INVALID_WORKSPACE_PATTERN" ? "workspace declaration contains an unsafe or non-normalized pattern" : "manifest is not valid unambiguous structured data"
  }));
  return invalid.length > 0 ? finish(proof, "failed", [...new Set(invalidDiagnostics.map((item) => item.code))], input.validatedEvidence, invalid) : finish(proof, "passed", [], input.validatedEvidence);
}
function uniqueWorkspace(input, proof) {
  const byName = /* @__PURE__ */ new Map();
  const details = [];
  for (const manifest of input.manifests.filter((item) => item.workspaceMember)) {
    if (!manifest.name) {
      details.push({ path: manifest.path, message: "workspace manifest has no package name" });
      continue;
    }
    const paths = byName.get(manifest.name) ?? [];
    paths.push(manifest.path);
    byName.set(manifest.name, paths);
  }
  for (const [name, paths] of [...byName.entries()].sort()) {
    if (paths.length > 1) {
      for (const manifestPath of paths.sort()) {
        details.push({ path: manifestPath, message: `workspace name ${name} is duplicated` });
      }
    }
  }
  const reasons = [
    ...details.some((item) => item.message.includes("duplicated")) ? ["DUPLICATE_WORKSPACE_NAME"] : [],
    ...details.some((item) => item.message.includes("no package name")) ? ["MISSING_WORKSPACE_NAME"] : []
  ];
  return reasons.length > 0 ? finish(proof, "failed", reasons, input.validatedEvidence, details) : finish(proof, "passed", [], input.validatedEvidence);
}
function unambiguousRange(range, localVersion) {
  if (range.startsWith("workspace:")) {
    const selector = range.slice("workspace:".length);
    return selector === "*" || selector === "^" || selector === "~" || selector === localVersion || selector === `^${localVersion}` || selector === `~${localVersion}`;
  }
  if (!localVersion)
    return false;
  if (range === "*" || range === localVersion)
    return true;
  if ((range.startsWith("^") || range.startsWith("~")) && range.slice(1) === localVersion)
    return true;
  return false;
}
function localDependencies(input, proof) {
  const local = new Map(input.manifests.filter((item) => item.workspaceMember && Boolean(item.name)).map((item) => [item.name, item]));
  const details = [];
  for (const manifest of input.manifests.filter((item) => item.workspaceMember)) {
    for (const [name, range] of Object.entries(manifest.dependencies).sort()) {
      const target = local.get(name);
      if (!target && range.startsWith("workspace:")) {
        details.push({
          path: manifest.path,
          message: `${name} uses a workspace range but has no in-boundary workspace target`
        });
      } else if (target && (range.startsWith("file:") || range.startsWith("link:"))) {
        const sourceDirectory = manifest.path === "package.json" ? "." : manifest.path.slice(0, -"/package.json".length);
        const rawTarget = range.slice(range.indexOf(":") + 1).replaceAll("\\", "/");
        const resolved = normalizeRelative(`${sourceDirectory}/${rawTarget}`);
        const targetDirectory = target.path === "package.json" ? "." : target.path.slice(0, -"/package.json".length);
        if (resolved === void 0 || resolved !== targetDirectory) {
          details.push({
            path: manifest.path,
            message: `${name} path reference does not resolve to its in-boundary workspace target`
          });
        }
      } else if (target && !unambiguousRange(range, target.version)) {
        details.push({
          path: manifest.path,
          message: `${name} range ${range} does not unambiguously select local ${target.version ?? "package"}`
        });
      }
    }
  }
  return details.length > 0 ? finish(proof, "failed", [...new Set(details.map((item) => item.message.includes("no in-boundary") ? "LOCAL_DEPENDENCY_TARGET_MISSING" : "AMBIGUOUS_LOCAL_DEPENDENCY"))], input.validatedEvidence, details) : finish(proof, "passed", [], input.validatedEvidence);
}
function normalizeRelative(value) {
  const parts = [];
  for (const part of value.split("/")) {
    if (part === "" || part === ".")
      continue;
    if (part === "..") {
      if (parts.length === 0)
        return void 0;
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join("/") || ".";
}
function lockfileOwnership(input, proof) {
  if (input.conflicts.some((conflict) => conflict.code === "MULTIPLE_PACKAGE_MANAGERS")) {
    return finish(proof, "failed", ["MULTIPLE_PACKAGE_MANAGERS"], input.validatedEvidence);
  }
  if (input.lockfiles.length === 0) {
    return finish(proof, "failed", ["LOCKFILE_MISSING"], input.validatedEvidence);
  }
  if (input.lockfiles.length > 1 || input.packageManagers.length !== 1) {
    return finish(proof, "failed", ["LOCKFILE_OWNERSHIP_AMBIGUOUS"], input.validatedEvidence);
  }
  if (input.lockfiles[0]?.includes("/")) {
    return finish(proof, "failed", ["LOCKFILE_OUTSIDE_WORKSPACE_ROOT"], input.validatedEvidence);
  }
  return finish(proof, "passed", [], input.validatedEvidence);
}
function evaluateWorkspaceProofs(input) {
  if (!input.supported) {
    const stable2 = {
      schemaVersion: 1,
      evaluations: [],
      outcome: "not_evaluated",
      reasonCodes: ["UNSUPPORTED_ECOSYSTEM"]
    };
    return {
      evaluations: [],
      outcome: "not_evaluated",
      reasonCodes: ["UNSUPPORTED_ECOSYSTEM"],
      resultDigest: digest2(stable2)
    };
  }
  if (input.validatedEvidence.length === 0) {
    const evaluations2 = MVP_PROOF_REGISTRY.map((proof) => finish(proof, "indeterminate", ["VALIDATED_EVIDENCE_REQUIRED"], []));
    const stable2 = {
      schemaVersion: 1,
      evaluations: evaluations2.map((item) => ({
        proofId: item.proofId,
        status: item.status,
        reasonCodes: item.reasonCodes,
        resultDigest: item.resultDigest
      })),
      outcome: "indeterminate",
      reasonCodes: ["VALIDATED_EVIDENCE_REQUIRED"]
    };
    return { evaluations: evaluations2, outcome: "indeterminate", reasonCodes: stable2.reasonCodes, resultDigest: digest2(stable2) };
  }
  const evaluations = MVP_PROOF_REGISTRY.map((proof) => {
    switch (proof.predicate) {
      case "manifest.structuralValidity":
        return manifestStructural(input, proof);
      case "workspace.uniqueMembership":
        return uniqueWorkspace(input, proof);
      case "workspace.localDependencyReference":
        return localDependencies(input, proof);
      case "workspace.singleLockfileOwnership":
        return lockfileOwnership(input, proof);
    }
  });
  const outcome = evaluations.some((item) => item.status === "failed") ? "violated" : evaluations.every((item) => item.status === "passed") ? "satisfied" : "indeterminate";
  const reasonCodes = [...new Set(evaluations.flatMap((item) => item.reasonCodes))].sort();
  const stable = {
    schemaVersion: 1,
    evaluations: evaluations.map((item) => ({
      proofId: item.proofId,
      promiseId: item.promiseId,
      status: item.status,
      reasonCodes: item.reasonCodes,
      evidence: item.evidence,
      details: item.details,
      resultDigest: item.resultDigest
    })),
    outcome,
    reasonCodes
  };
  return { evaluations, outcome, reasonCodes, resultDigest: digest2(stable) };
}

// ../../packages/repair/dist/public/index.js
init_public();
import { createHash as createHash6 } from "node:crypto";

// ../../packages/repair/dist/public/apply.js
init_public();
import { createHash as createHash5, randomUUID } from "node:crypto";
import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path3 from "node:path";
var RepairApplyConflict = class extends Error {
  code;
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "RepairApplyConflict";
    this.code = code;
  }
};
function digest3(bytes) {
  return `sha256:${createHash5("sha256").update(bytes).digest("hex")}`;
}
function repairRef(repair) {
  return {
    kind: "repair",
    id: repair.id,
    revision: repair.revision,
    schemaVersion: repair.schemaVersion
  };
}
function decodePointer(pointer) {
  if (pointer === "")
    return [];
  if (!pointer.startsWith("/")) {
    throw new RepairApplyConflict("INVALID_JSON_PATCH", `JSON Pointer must start with '/': ${pointer}`);
  }
  return pointer.slice(1).split("/").map((segment) => {
    if (/~(?:[^01]|$)/.test(segment)) {
      throw new RepairApplyConflict("INVALID_JSON_PATCH", `invalid JSON Pointer escape: ${pointer}`);
    }
    return segment.replace(/~1/g, "/").replace(/~0/g, "~");
  });
}
function arrayIndex(segment, length, allowEnd) {
  if (!/^(0|[1-9][0-9]*)$/.test(segment)) {
    throw new RepairApplyConflict("INVALID_JSON_PATCH", "invalid array index");
  }
  const index = Number(segment);
  if (!Number.isSafeInteger(index) || index > length || !allowEnd && index === length) {
    throw new RepairApplyConflict("INVALID_JSON_PATCH", "array index is out of range");
  }
  return index;
}
function applyOperation(document2, operation) {
  const segments = decodePointer(operation.pointer);
  if (segments.length === 0) {
    if (operation.operation === "remove" || operation.value === void 0) {
      throw new RepairApplyConflict("INVALID_JSON_PATCH", "root removal is not supported");
    }
    return structuredClone(operation.value);
  }
  const output = structuredClone(document2);
  let parent = output;
  for (const segment of segments.slice(0, -1)) {
    if (Array.isArray(parent)) {
      parent = parent[arrayIndex(segment, parent.length, false)];
    } else if (typeof parent === "object" && parent !== null) {
      if (!(segment in parent)) {
        throw new RepairApplyConflict("INVALID_JSON_PATCH", "pointer parent does not exist");
      }
      parent = parent[segment];
    } else {
      throw new RepairApplyConflict("INVALID_JSON_PATCH", "pointer crosses a scalar");
    }
  }
  const leaf = segments.at(-1);
  if (Array.isArray(parent)) {
    const index = arrayIndex(leaf, parent.length, operation.operation === "add");
    if (operation.operation === "remove")
      parent.splice(index, 1);
    else if (operation.operation === "add") {
      if (operation.value === void 0) {
        throw new RepairApplyConflict("INVALID_JSON_PATCH", "add requires a value");
      }
      parent.splice(index, 0, structuredClone(operation.value));
    } else {
      if (operation.value === void 0) {
        throw new RepairApplyConflict("INVALID_JSON_PATCH", "replace requires a value");
      }
      parent[index] = structuredClone(operation.value);
    }
    return output;
  }
  if (typeof parent !== "object" || parent === null) {
    throw new RepairApplyConflict("INVALID_JSON_PATCH", "pointer parent is not a container");
  }
  const record = parent;
  if (operation.operation !== "add" && !(leaf in record)) {
    throw new RepairApplyConflict("INVALID_JSON_PATCH", "patch target does not exist");
  }
  if (operation.operation === "remove")
    delete record[leaf];
  else {
    if (operation.value === void 0) {
      throw new RepairApplyConflict("INVALID_JSON_PATCH", `${operation.operation} requires a value`);
    }
    record[leaf] = structuredClone(operation.value);
  }
  return output;
}
function targetPath(workspaceRoot, target) {
  if (target === "" || path3.isAbsolute(target)) {
    throw new RepairApplyConflict("INVALID_TARGET", "target must be workspace-relative");
  }
  const root = realpathSync(workspaceRoot);
  const candidate = path3.resolve(root, target);
  if (candidate !== root && !candidate.startsWith(`${root}${path3.sep}`)) {
    throw new RepairApplyConflict("INVALID_TARGET", "target escapes the workspace");
  }
  const parent = realpathSync(path3.dirname(candidate));
  if (parent !== root && !parent.startsWith(`${root}${path3.sep}`)) {
    throw new RepairApplyConflict("INVALID_TARGET", "target parent escapes the workspace");
  }
  const stat2 = lstatSync(candidate);
  if (!stat2.isFile() || stat2.isSymbolicLink()) {
    throw new RepairApplyConflict("TARGET_NOT_REGULAR_FILE", "target must be an existing ordinary file");
  }
  return candidate;
}
function previewRepairPatch(repair, workspaceRoot) {
  if (repair.action.kind !== "jsonPatch") {
    throw new RepairApplyConflict("INVALID_REPAIR_ACTION", "only deterministic JSON Patch Repairs can be applied");
  }
  const target = targetPath(workspaceRoot, repair.action.target);
  const bytes = readFileSync(target);
  const currentContentDigest = digest3(bytes);
  if (currentContentDigest !== repair.action.expectedContentDigest) {
    throw new RepairApplyConflict("STALE_TARGET", `target digest ${currentContentDigest} does not match the retained Repair`);
  }
  const before = parseCanonicalJson2(bytes.toString("utf8"));
  const after = repair.action.operations.reduce((document2, operation) => applyOperation(document2, operation), before);
  const patched = `${JSON.stringify(after, null, 2)}
`;
  return {
    schemaVersion: 1,
    kind: "repairPatchPreview",
    repair: repairRef(repair),
    target: repair.action.target,
    expectedContentDigest: repair.action.expectedContentDigest,
    currentContentDigest,
    patchedContentDigest: digest3(patched),
    operations: repair.action.operations,
    before,
    after
  };
}
function applyRepairPatch(repair, workspaceRoot) {
  const preview = previewRepairPatch(repair, workspaceRoot);
  const target = targetPath(workspaceRoot, preview.target);
  const mode = lstatSync(target).mode & 511;
  const temporary = path3.join(path3.dirname(target), `.${path3.basename(target)}.verify-${randomUUID()}.tmp`);
  let descriptor;
  try {
    writeFileSync(temporary, `${JSON.stringify(preview.after, null, 2)}
`, {
      encoding: "utf8",
      flag: "wx",
      mode
    });
    descriptor = openSync(temporary, "r");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = void 0;
    if (digest3(readFileSync(target)) !== preview.currentContentDigest) {
      throw new RepairApplyConflict("STALE_TARGET", "target changed after preview and before atomic replacement");
    }
    targetPath(workspaceRoot, preview.target);
    renameSync(temporary, target);
    const directory = openSync(path3.dirname(target), "r");
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
    return preview;
  } finally {
    if (descriptor !== void 0)
      closeSync(descriptor);
    rmSync(temporary, { force: true });
  }
}

// ../../packages/repair/dist/public/index.js
function sha(value) {
  return `sha256:${createHash6("sha256").update(canonicalize2(value)).digest("hex")}`;
}
function makeRepair(proof, modelRevision, ordinal) {
  const reason = proof.reasonCodes[0];
  if (!reason)
    return void 0;
  let action;
  let expectedEffect;
  let assumptions;
  switch (reason) {
    case "AMBIGUOUS_LOCAL_DEPENDENCY": {
      const target = proof.details[0]?.path ?? "package.json";
      action = {
        kind: "manual",
        target,
        operations: [],
        instruction: "Replace the ambiguous local dependency range with an explicit workspace: range."
      };
      expectedEffect = "The dependency resolves to exactly one in-boundary workspace package.";
      assumptions = ["The referenced package is intended to be local."];
      break;
    }
    case "DUPLICATE_WORKSPACE_NAME": {
      const target = proof.details[1]?.path ?? proof.details[0]?.path ?? "package.json";
      action = {
        kind: "json_patch",
        target,
        operations: [{ op: "replace", path: "/name", value: `replace-with-unique-name-${ordinal}` }]
      };
      expectedEffect = "Every workspace member has a unique package name.";
      assumptions = ["The selected duplicate is safe to rename and downstream references will be updated."];
      break;
    }
    case "MISSING_WORKSPACE_NAME": {
      const target = proof.details[0]?.path ?? "package.json";
      action = {
        kind: "json_patch",
        target,
        operations: [{ op: "add", path: "/name", value: `replace-with-package-name-${ordinal}` }]
      };
      expectedEffect = "The workspace member has an explicit unique package name.";
      assumptions = ["The placeholder will be replaced with the intended package name."];
      break;
    }
    case "LOCKFILE_MISSING":
      action = {
        kind: "manual",
        target: ".",
        operations: [],
        instruction: "Generate and commit exactly one lockfile using the repository's selected package manager."
      };
      expectedEffect = "The workspace has one declared lockfile ownership scope.";
      assumptions = ["A package manager is selected outside the verifier."];
      break;
    case "MULTIPLE_PACKAGE_MANAGERS":
    case "LOCKFILE_OWNERSHIP_AMBIGUOUS":
      action = {
        kind: "manual",
        target: ".",
        operations: [],
        instruction: "Retain one package-manager lockfile and remove conflicting ownership metadata."
      };
      expectedEffect = "The workspace has one unambiguous lockfile owner.";
      assumptions = ["The repository owner selects the authoritative package manager."];
      break;
    default:
      return void 0;
  }
  const preimage = {
    schemaVersion: 1,
    motivatingPromise: proof.promiseId,
    motivatingProof: proof.proofId,
    reason,
    evidence: [...proof.evidence].sort(),
    action,
    modelRevision
  };
  const revision2 = sha(preimage);
  return {
    schemaVersion: 1,
    id: `repair:${revision2.slice("sha256:".length)}`,
    revision: revision2,
    motivatingPromise: proof.promiseId,
    motivatingProof: proof.proofId,
    evidence: [...proof.evidence].sort(),
    action,
    expectedEffect,
    assumptions,
    requiredPermissions: ["workspace.write"],
    verificationPlan: { proofId: proof.proofId, promiseId: proof.promiseId, modelRevision },
    state: "suggested"
  };
}
function suggestRepairs(evaluations, modelRevision) {
  return evaluations.filter((proof) => proof.status === "failed").flatMap((proof, index) => {
    const repair = makeRepair(proof, modelRevision, index + 1);
    return repair ? [repair] : [];
  }).sort((left, right) => left.id.localeCompare(right.id));
}

// ../../packages/engine/src/public/canonical-runtime.ts
init_public();
import { createHash as createHash7 } from "node:crypto";
import { arch, platform } from "node:os";
function digest4(value) {
  return `sha256:${createHash7("sha256").update(canonicalize2(value)).digest("hex")}`;
}
function canonical2(value) {
  return JSON.parse(JSON.stringify(value));
}
function ref2(kind, value) {
  return {
    kind,
    id: value.id,
    revision: value.revision,
    schemaVersion: value.schemaVersion
  };
}
function document(kind, id, payload) {
  return {
    kind,
    id,
    revision: digest4({
      domain: "verification-platform/revision",
      id,
      kind,
      payload,
      schemaVersion: 1
    }),
    schemaVersion: 1,
    payload
  };
}
function existingDocument(kind, value) {
  const {
    id: _id,
    revision: _revision,
    schemaVersion: _schemaVersion,
    ...payload
  } = value;
  return {
    kind,
    id: value.id,
    revision: value.revision,
    schemaVersion: value.schemaVersion,
    payload: canonical2(payload)
  };
}
function graphDocuments(graph) {
  return [
    ...graph.applications.map((value) => existingDocument("application", value)),
    ...graph.capabilities.map((value) => existingDocument("capability", value)),
    ...graph.promises.map((value) => existingDocument("promise", value)),
    ...graph.proofs.map((value) => existingDocument("proof", value)),
    ...graph.bindings.map(
      (value) => existingDocument("promiseProofBinding", value)
    ),
    existingDocument("applicationModel", graph.model)
  ];
}
function isApplicable(expression) {
  return expression === true;
}
function sameRevision(left, right) {
  return left.kind === right.kind && left.id === right.id && left.revision === right.revision && left.schemaVersion === right.schemaVersion;
}
function uniqueRefs(values, key) {
  const seen = /* @__PURE__ */ new Set();
  return values.filter((value) => {
    const identity = key(value);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}
function derivePromiseResults(graph, executions) {
  return graph.promises.map((promise) => {
    const promiseRef = ref2("promise", promise);
    const applicableBindings = graph.bindings.filter(
      (binding) => sameRevision(binding.promise, promiseRef) && isApplicable(binding.applicability.expression)
    );
    const requiredBindings = applicableBindings.filter(
      (binding) => binding.requirement === "required"
    );
    const applicableExecutions = executions.filter(
      (execution) => execution.effective && sameRevision(execution.promise, promiseRef) && applicableBindings.some(
        (binding) => sameRevision(binding.proof, execution.proof)
      )
    );
    const requiredExecutions = applicableExecutions.filter(
      (execution) => requiredBindings.some(
        (binding) => sameRevision(binding.proof, execution.proof)
      )
    );
    const reasonCodes = [];
    const addReason = (reason) => {
      if (!reasonCodes.includes(reason)) reasonCodes.push(reason);
    };
    let status;
    if (!isApplicable(promise.applicability.expression)) {
      status = "indeterminate";
      addReason("PROMISE_NOT_APPLICABLE");
    } else if (requiredBindings.length === 0) {
      status = "indeterminate";
      addReason("NO_APPLICABLE_REQUIRED_PROOF");
    } else if (requiredExecutions.some(
      (execution) => execution.result.status === "failed"
    )) {
      status = "violated";
    } else if (requiredExecutions.length === requiredBindings.length && requiredExecutions.every(
      (execution) => execution.result.status === "passed"
    )) {
      status = "satisfied";
    } else {
      status = "indeterminate";
      if (requiredExecutions.length < requiredBindings.length) {
        addReason("REQUIRED_PROOF_NOT_EXECUTED");
      }
    }
    for (const execution of requiredExecutions) {
      switch (execution.result.status) {
        case "failed":
        case "indeterminate":
          for (const reason of execution.result.reasonCodes) addReason(reason);
          break;
        case "error":
          addReason(execution.result.error.code);
          break;
        case "cancelled":
          addReason(`PROOF_CANCELLED_${execution.result.reason.toUpperCase()}`);
          break;
        case "passed":
          break;
      }
    }
    return {
      promise: promiseRef,
      status,
      proofAttempts: uniqueRefs(
        applicableExecutions.map((execution) => execution.attemptRef),
        (attempt) => `${attempt.attemptId}\0${attempt.proof.revision}\0${attempt.invocationId}`
      ),
      evidence: uniqueRefs(
        applicableExecutions.flatMap((execution) => execution.evidence),
        (evidence) => `${evidence.kind}\0${evidence.id}\0${evidence.revision}\0${evidence.schemaVersion}`
      ),
      reasonCodes
    };
  });
}
function promiseSummary(graph, results) {
  return {
    requiredPromiseCount: graph.promises.filter(
      (promise) => promise.criticality === "required"
    ).length,
    advisoryPromiseCount: graph.promises.filter(
      (promise) => promise.criticality === "advisory"
    ).length,
    satisfiedCount: results.filter(
      (result) => result.status === "satisfied"
    ).length,
    violatedCount: results.filter(
      (result) => result.status === "violated"
    ).length,
    indeterminateCount: results.filter(
      (result) => result.status === "indeterminate"
    ).length
  };
}
function verificationOutcome(graph, results) {
  const required = results.filter(
    (result) => graph.promises.some(
      (promise) => promise.criticality === "required" && sameRevision(ref2("promise", promise), result.promise)
    )
  );
  if (required.some((result) => result.status === "violated")) {
    return "violated";
  }
  if (required.length > 0 && required.every((result) => result.status === "satisfied")) {
    return "satisfied";
  }
  return "indeterminate";
}
function deriveCanonicalPromiseEvaluation(graph, executions) {
  const promises = derivePromiseResults(graph, executions);
  return {
    promises,
    summary: promiseSummary(graph, promises),
    outcome: verificationOutcome(graph, promises)
  };
}
function proofResult(status, evidence, reasonCodes) {
  switch (status) {
    case "passed":
      return { status, evidence };
    case "failed":
    case "indeterminate":
      return { status, evidence, reasonCodes };
    case "error":
      return {
        status,
        error: {
          code: reasonCodes[0] ?? "PROOF_EXECUTION_ERROR",
          message: "The Proof evaluator could not complete safely."
        }
      };
    case "cancelled":
      return { status, reason: "caller" };
  }
}
function repairAction(repair, evidence, manifestContentDigest) {
  if (repair.action.kind === "json_patch") {
    if (manifestContentDigest === void 0) {
      return {
        kind: "advisoryInstruction",
        instructionCode: "VERIFY_REPAIR_TARGET_NOT_SEALED",
        parameters: { target: repair.action.target }
      };
    }
    return {
      kind: "jsonPatch",
      target: repair.action.target,
      expectedContentDigest: manifestContentDigest,
      operations: repair.action.operations.map((operation) => ({
        operation: operation.op,
        pointer: operation.path,
        ...operation.value === void 0 ? {} : { value: operation.value }
      }))
    };
  }
  return {
    kind: "advisoryInstruction",
    instructionCode: "VERIFY_MANUAL_REPAIR",
    parameters: {
      target: repair.action.target,
      instruction: repair.action.instruction ?? "Review the failed Proof and its Evidence."
    }
  };
}
function buildCanonicalRuntimeRecords(input) {
  const modelRef = ref2("applicationModel", input.graph.model);
  const discoveryOutputDigest = digest4(canonical2({
    workspaceBinding: input.discovery.workspaceBinding,
    modelRevision: input.discovery.modelRevision,
    manifests: input.discovery.manifests,
    lockfiles: input.discovery.lockfiles,
    packageManagers: input.discovery.packageManagers,
    conflicts: input.discovery.conflicts,
    completion: input.discovery.completion
  }));
  const contextId = `context:${digest4(canonical2({
    domain: "verification-platform/local-execution-context",
    model: modelRef,
    policy: "passive-offline-v1"
  })).slice("sha256:".length)}`;
  const contextDocument = document("executionContext", contextId, {
    applicationModel: modelRef,
    authority: "local-os-principal",
    isolationProfile: "passive-offline-v1",
    offline: true
  });
  const contextRef = ref2("executionContext", contextDocument);
  const plannedProofs = input.graph.bindings.map((binding) => ({
    binding: ref2("promiseProofBinding", binding),
    promise: binding.promise,
    proof: binding.proof,
    requirement: binding.requirement,
    order: binding.order,
    dependencyProofs: input.graph.proofs.find((proof) => proof.id === binding.proof.id)?.dependencies ?? []
  }));
  const planId = `plan:${digest4(canonical2({
    domain: "verification-platform/execution-plan-id",
    applicationModel: modelRef,
    executionContext: contextRef,
    proofs: plannedProofs,
    discoveryOutputDigest
  })).slice("sha256:".length)}`;
  const planFields = {
    applicationModel: modelRef,
    executionContext: contextRef,
    proofs: plannedProofs,
    discoveryOutputDigest
  };
  const planDocument = document(
    "executionPlan",
    planId,
    canonical2(planFields)
  );
  const executionPlan = {
    id: planDocument.id,
    revision: planDocument.revision,
    schemaVersion: 1,
    ...planFields
  };
  const planRef = ref2("executionPlan", planDocument);
  const configurationDigest = digest4({
    domain: "verification-platform/configuration",
    profile: "mvp-default"
  });
  const policyDigest = digest4({
    domain: "verification-platform/policy",
    profile: "passive-offline-v1"
  });
  const runtimeIdentity = {
    id: "node",
    version: process.version,
    artifactDigest: digest4({
      domain: "verification-platform/runtime",
      id: "node",
      version: process.version
    })
  };
  const evidenceRecords = [];
  const executionManifests = [];
  const manifestDocuments = [];
  const evidenceDocuments = [];
  const proofExecutions = [];
  for (const [index, evaluation] of input.evaluations.entries()) {
    const binding = input.graph.bindings.find(
      (candidate) => candidate.proof.id === evaluation.proofId
    ) ?? input.graph.bindings[index];
    if (binding === void 0) continue;
    const proofRef = binding.proof;
    const promiseRef = binding.promise;
    const attemptId = `attempt:${digest4(canonical2({
      domain: "verification-platform/proof-attempt",
      invocationId: input.invocationId,
      proof: proofRef,
      ordinal: index
    })).slice("sha256:".length)}`;
    const attemptRef = {
      attemptId,
      proof: proofRef,
      invocationId: input.invocationId
    };
    const reusedEvidence = input.cachedProvenance?.evidenceRecords.find(
      (candidate) => candidate.attempt.proof.id === proofRef.id && candidate.attempt.proof.revision === proofRef.revision
    );
    let evidenceRecord;
    let evidenceDocument;
    if (reusedEvidence !== void 0) {
      evidenceRecord = reusedEvidence;
      evidenceDocument = existingDocument("evidence", reusedEvidence);
    } else {
      const evidenceId = `evidence:${digest4(canonical2({
        domain: "verification-platform/attempt-evidence-id",
        attempt: attemptRef,
        contentDigest: input.evidence.contentDigest
      })).slice("sha256:".length)}`;
      const evidenceFields = {
        evidenceType: input.evidence.evidenceType,
        mediaType: input.evidence.mediaType,
        producer: input.engine,
        captureMethod: "engine-native-passive-workspace-observation",
        capturedAt: input.occurredAt,
        attempt: attemptRef,
        subjects: input.graph.model.applications,
        inputRefs: [modelRef],
        contentDigest: input.evidence.contentDigest,
        byteSize: input.evidence.byteSize,
        classification: input.evidence.classification,
        chainOfCustody: [
          {
            sequence: 0,
            action: "captured",
            actor: input.engine,
            outputDigest: input.evidence.contentDigest,
            occurredAt: input.occurredAt
          },
          {
            sequence: 1,
            action: "normalized",
            actor: input.engine,
            inputDigest: input.evidence.contentDigest,
            outputDigest: input.evidence.contentDigest,
            occurredAt: input.occurredAt
          },
          {
            sequence: 2,
            action: "classified",
            actor: input.engine,
            inputDigest: input.evidence.contentDigest,
            outputDigest: input.evidence.contentDigest,
            occurredAt: input.occurredAt
          },
          {
            sequence: 3,
            action: "redacted",
            actor: input.engine,
            inputDigest: input.evidence.contentDigest,
            outputDigest: input.evidence.contentDigest,
            occurredAt: input.occurredAt
          },
          {
            sequence: 4,
            action: "persisted",
            actor: input.engine,
            inputDigest: input.evidence.contentDigest,
            outputDigest: input.evidence.contentDigest,
            occurredAt: input.occurredAt
          }
        ],
        supersedes: []
      };
      evidenceDocument = document(
        "evidence",
        evidenceId,
        canonical2(evidenceFields)
      );
      evidenceRecord = {
        id: evidenceDocument.id,
        revision: evidenceDocument.revision,
        schemaVersion: 1,
        ...evidenceFields
      };
    }
    const evidenceRef = ref2("evidence", evidenceDocument);
    evidenceRecords.push(evidenceRecord);
    evidenceDocuments.push(evidenceDocument);
    const planKey = digest4(canonical2({
      domain: "verification-platform/proof-plan-key",
      executionPlan: planRef,
      proof: proofRef,
      model: modelRef,
      evidenceContentDigest: input.evidence.contentDigest
    }));
    const manifestId = `manifest:${attemptId.slice("attempt:".length)}`;
    const manifestFields = {
      engine: input.engine,
      applicationModel: modelRef,
      promises: [promiseRef],
      proof: proofRef,
      pluginsAndTools: [],
      source: {
        inputDigest: input.evidence.contentDigest,
        repositoryState: "unknown"
      },
      configurationDigest,
      policyDigest,
      platform: {
        operatingSystem: platform(),
        architecture: arch(),
        runtimeVersions: [runtimeIdentity],
        toolchainVersions: []
      },
      authenticationBindingIds: [],
      isolation: {
        filesystem: { mode: "read-only", boundary: input.discovery.workspaceBinding },
        network: { mode: "denied" },
        clock: { mode: "observed", capturedAt: input.occurredAt },
        randomness: { mode: "engine-owned-identifiers" },
        enforcementTier: "engine-native-passive"
      },
      discoveryOutputDigest,
      executionPlan: planRef,
      executionPlanDigest: planDocument.revision
    };
    const manifestDocument = document(
      "executionManifest",
      manifestId,
      canonical2(manifestFields)
    );
    const executionManifest = {
      id: manifestDocument.id,
      revision: manifestDocument.revision,
      schemaVersion: 1,
      ...manifestFields
    };
    executionManifests.push(executionManifest);
    manifestDocuments.push(manifestDocument);
    const result = proofResult(
      evaluation.status,
      [evidenceRef],
      evaluation.reasonCodes
    );
    const resultDigest = digest4(canonical2({
      domain: "verification-platform/proof-result",
      proof: proofRef,
      promise: promiseRef,
      model: modelRef,
      result
    }));
    const cachedFromExecution = reusedEvidence?.attempt.attemptId ?? input.cachedProvenance?.proofExecutions.find(
      (candidate) => candidate.proof.id === proofRef.id && candidate.proof.revision === proofRef.revision
    )?.attemptId;
    const recordWithoutDigest = {
      attemptId,
      attemptRef,
      promise: promiseRef,
      proof: proofRef,
      model: modelRef,
      executionContext: contextRef,
      executionManifest: ref2("executionManifest", manifestDocument),
      planKey,
      state: evaluation.status,
      effective: true,
      startedAt: input.occurredAt,
      completedAt: input.occurredAt,
      evidence: [evidenceRef],
      result,
      resultDigest,
      ...cachedFromExecution === void 0 ? {} : { cachedFromExecution },
      validationEventIds: input.cachedProvenance?.validationEventIds[index] === void 0 ? [] : [input.cachedProvenance.validationEventIds[index]]
    };
    proofExecutions.push({
      ...recordWithoutDigest,
      attemptRecordDigest: digest4(canonical2({
        domain: "verification-platform/proof-attempt-record",
        ...recordWithoutDigest
      }))
    });
  }
  const repairRecords = [];
  const repairDocuments = [];
  const verificationPlanDocuments = [];
  for (const legacyRepair of input.repairs) {
    const execution = proofExecutions.find(
      (candidate) => candidate.proof.id === legacyRepair.motivatingProof
    );
    if (execution === void 0) continue;
    const motivatingEvidence = evidenceRecords.find(
      (candidate) => candidate.attempt.attemptId === execution.attemptId
    );
    if (motivatingEvidence === void 0) continue;
    const motivatingEvidenceRef = ref2("evidence", motivatingEvidence);
    const verificationPlanId = `plan:repair:${legacyRepair.id.slice("repair:".length)}`;
    const verificationPlanFields = {
      applicationModel: modelRef,
      executionContext: contextRef,
      proofs: plannedProofs.filter(
        (planned) => planned.proof.id === execution.proof.id
      ),
      discoveryOutputDigest
    };
    const verificationPlanDocument = document(
      "executionPlan",
      verificationPlanId,
      canonical2(verificationPlanFields)
    );
    verificationPlanDocuments.push(verificationPlanDocument);
    const permissions = {
      filesystem: [{
        mode: "write",
        root: legacyRepair.action.target
      }],
      network: [],
      subprocess: false,
      secrets: []
    };
    const confidence = {
      value: 1,
      basis: "deterministic_rule",
      ruleId: `repair:${legacyRepair.action.kind}:v1`,
      signalRefs: []
    };
    const repairFields = {
      motivatingPromise: execution.promise,
      motivatingExecution: execution.attemptRef,
      evidence: [motivatingEvidenceRef],
      generator: input.engine,
      action: repairAction(
        legacyRepair,
        motivatingEvidence,
        input.discovery.manifests.find(
          (manifest) => manifest.path === legacyRepair.action.target
        )?.contentDigest
      ),
      assumptions: legacyRepair.assumptions,
      requiredPermissions: permissions,
      expectedEffect: legacyRepair.expectedEffect,
      confidence,
      verificationPlan: ref2("executionPlan", verificationPlanDocument)
    };
    const repairDocument = document(
      "repair",
      legacyRepair.id,
      canonical2(repairFields)
    );
    repairDocuments.push(repairDocument);
    repairRecords.push({
      id: repairDocument.id,
      revision: repairDocument.revision,
      schemaVersion: 1,
      ...repairFields
    });
  }
  const promiseEvaluation = deriveCanonicalPromiseEvaluation(
    input.graph,
    proofExecutions
  );
  return {
    ...promiseEvaluation,
    proofExecutions,
    evidenceRecords,
    repairRecords,
    executionManifests,
    revisionDocuments: [
      ...graphDocuments(input.graph),
      contextDocument,
      planDocument,
      ...verificationPlanDocuments,
      ...manifestDocuments,
      ...evidenceDocuments,
      ...repairDocuments
    ],
    executionPlan,
    executionContext: contextRef
  };
}

// ../../packages/plugin-runtime/dist/public/broker.js
init_public();

// ../../packages/plugin-sdk/dist/public/manifest.js
init_public();
var PLUGIN_MANIFEST_MAX_BYTES = 256 * 1024;

// ../../packages/plugin-sdk/dist/public/protocol.js
init_public();
var CURRENT_PLUGIN_CONTRACT = Object.freeze({
  major: 1,
  minor: 0
});
var PLUGIN_MESSAGE_MAX_BYTES = 1024 * 1024;
var PLUGIN_STDERR_MAX_BYTES = 64 * 1024;

// ../../packages/plugin-runtime/dist/public/macos-sandbox.js
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
var executeFile = promisify(execFile);

// ../../packages/plugin-runtime/dist/public/windows-sandbox.js
import { execFile as execFile2, spawn as spawn2 } from "node:child_process";
import { promisify as promisify2 } from "node:util";
var executeFile2 = promisify2(execFile2);

// ../../packages/plugin-runtime/dist/public/runtime.js
init_public();

// ../../packages/engine/src/public/local-runtime.ts
init_public();
import { createHash as createHash10, randomUUID as randomUUID2 } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  readFileSync as readFileSync2,
  renameSync as renameSync2,
  rmSync as rmSync2,
  writeFileSync as writeFileSync2
} from "node:fs";
import path4 from "node:path";

// ../../packages/events/dist/public/unit-of-work.js
var EngineUnitOfWorkConflict = class extends Error {
  code;
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "EngineUnitOfWorkConflict";
    this.code = code;
  }
};

// ../../packages/execution/dist/public/sqlite-unit-of-work.js
init_public();
import { DatabaseSync } from "node:sqlite";
function json(value) {
  return canonicalize2(value);
}
function revisionKey(ref3) {
  return json({
    kind: ref3.kind,
    id: ref3.id,
    revision: ref3.revision,
    schemaVersion: ref3.schemaVersion
  });
}
function documentRef(document2) {
  return {
    kind: document2.kind,
    id: document2.id,
    revision: document2.revision,
    schemaVersion: document2.schemaVersion
  };
}
function sameRef(left, right) {
  return left === null ? right === null : right !== null && revisionKey(left) === revisionKey(right);
}
var SqliteEngineUnitOfWork = class {
  #database;
  #fault;
  constructor(path5, fault) {
    this.#database = new DatabaseSync(path5);
    this.#fault = fault;
    this.#database.exec("PRAGMA journal_mode = WAL");
    this.#database.exec("PRAGMA foreign_keys = ON");
    this.#database.exec("PRAGMA busy_timeout = 5000");
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS revisions (
        revision_key TEXT PRIMARY KEY,
        document_json TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS events (
        event_id TEXT PRIMARY KEY,
        invocation_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        envelope_json TEXT NOT NULL,
        UNIQUE(invocation_id, sequence)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS reference_edges (
        source_key TEXT NOT NULL,
        relation TEXT NOT NULL,
        target_key TEXT NOT NULL,
        PRIMARY KEY(source_key, relation, target_key)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS current_revisions (
        slot TEXT PRIMARY KEY,
        ref_json TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS accepted_commits (
        idempotency_key TEXT PRIMARY KEY,
        request_json TEXT NOT NULL,
        receipt_json TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS tombstones (
        object_key TEXT PRIMARY KEY,
        tombstone_json TEXT NOT NULL
      ) STRICT;
    `);
  }
  get journalMode() {
    const row = this.#database.prepare("PRAGMA journal_mode").get();
    return row?.journal_mode ?? "unknown";
  }
  close() {
    this.#database.close();
  }
  async commit(unit) {
    const requestJson = json(unit);
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const prior = this.#database.prepare("SELECT request_json, receipt_json FROM accepted_commits WHERE idempotency_key = ?").get(unit.idempotencyKey);
      if (prior !== void 0) {
        if (prior.request_json !== requestJson) {
          throw new EngineUnitOfWorkConflict("IDEMPOTENCY_CONFLICT", `idempotency key ${unit.idempotencyKey} was already used`);
        }
        const receipt2 = JSON.parse(prior.receipt_json);
        this.#database.exec("COMMIT");
        return receipt2;
      }
      if (!Number.isSafeInteger(unit.expectedNextSequence) || unit.expectedNextSequence < 1) {
        throw new EngineUnitOfWorkConflict("INVALID_EVENT_SEQUENCE", "expectedNextSequence must be a positive safe integer");
      }
      const sequenceRow = this.#database.prepare("SELECT MAX(sequence) AS maximum FROM events WHERE invocation_id = ?").get(unit.invocationId);
      const actualNext = (sequenceRow.maximum ?? 0) + 1;
      if (unit.expectedNextSequence !== actualNext) {
        throw new EngineUnitOfWorkConflict("SEQUENCE_CONFLICT", `expected ${unit.expectedNextSequence}; actual ${actualNext}`);
      }
      const insertRevision = this.#database.prepare("INSERT OR IGNORE INTO revisions(revision_key, document_json) VALUES (?, ?)");
      const readRevision = this.#database.prepare("SELECT document_json FROM revisions WHERE revision_key = ?");
      for (const document2 of unit.revisions) {
        const key = revisionKey(documentRef(document2));
        const documentJson = json(document2);
        insertRevision.run(key, documentJson);
        const stored = readRevision.get(key);
        if (stored.document_json !== documentJson) {
          throw new EngineUnitOfWorkConflict("DUPLICATE_REVISION", `revision ${key} has conflicting content`);
        }
      }
      this.#fault?.("after-revisions");
      const revisionExists = this.#database.prepare("SELECT 1 AS present FROM revisions WHERE revision_key = ?");
      const insertEvent = this.#database.prepare("INSERT INTO events(event_id, invocation_id, sequence, envelope_json) VALUES (?, ?, ?, ?)");
      for (const [index, event2] of unit.events.entries()) {
        const expected = unit.expectedNextSequence + index;
        if (event2.invocationId !== unit.invocationId || event2.sequence !== expected || !Number.isSafeInteger(event2.sequence)) {
          throw new EngineUnitOfWorkConflict("INVALID_EVENT_SEQUENCE", `event ${event2.eventId} must use sequence ${expected}`);
        }
        if (event2.subject !== void 0 && revisionExists.get(revisionKey(event2.subject)) === void 0) {
          throw new EngineUnitOfWorkConflict("MISSING_REVISION", `event ${event2.eventId} subject is unavailable`);
        }
        try {
          insertEvent.run(event2.eventId, event2.invocationId, event2.sequence, json(event2));
        } catch {
          throw new EngineUnitOfWorkConflict("DUPLICATE_EVENT_ID", `event ${event2.eventId} or its sequence already exists`);
        }
      }
      this.#fault?.("after-events");
      const insertEdge = this.#database.prepare("INSERT OR IGNORE INTO reference_edges(source_key, relation, target_key) VALUES (?, ?, ?)");
      for (const edge of unit.referenceEdges) {
        const source = revisionKey(edge.source);
        const target = revisionKey(edge.target);
        if (revisionExists.get(source) === void 0 || revisionExists.get(target) === void 0) {
          throw new EngineUnitOfWorkConflict("INVALID_REFERENCE_EDGE", `edge ${edge.relation} references an unavailable revision`);
        }
        insertEdge.run(source, edge.relation, target);
      }
      this.#fault?.("after-reference-edges");
      const readCurrent = this.#database.prepare("SELECT ref_json FROM current_revisions WHERE slot = ?");
      const upsertCurrent = this.#database.prepare(`INSERT INTO current_revisions(slot, ref_json) VALUES (?, ?)
         ON CONFLICT(slot) DO UPDATE SET ref_json = excluded.ref_json`);
      const seenSlots = /* @__PURE__ */ new Set();
      for (const mutation of unit.currentRevisionMutations) {
        if (seenSlots.has(mutation.slot)) {
          throw new EngineUnitOfWorkConflict("CURRENT_REVISION_CONFLICT", `slot ${mutation.slot} is mutated twice`);
        }
        seenSlots.add(mutation.slot);
        const row = readCurrent.get(mutation.slot);
        const actual = row === void 0 ? null : JSON.parse(row.ref_json);
        if (!sameRef(actual, mutation.expectedCurrent)) {
          throw new EngineUnitOfWorkConflict("CURRENT_REVISION_CONFLICT", `slot ${mutation.slot} did not match expected current revision`);
        }
        if (revisionExists.get(revisionKey(mutation.nextCurrent)) === void 0) {
          throw new EngineUnitOfWorkConflict("MISSING_REVISION", `slot ${mutation.slot} points to an unavailable revision`);
        }
        upsertCurrent.run(mutation.slot, json(mutation.nextCurrent));
      }
      this.#fault?.("after-current-revisions");
      const receipt = {
        idempotencyKey: unit.idempotencyKey,
        invocationId: unit.invocationId,
        firstSequence: unit.expectedNextSequence,
        lastSequence: unit.expectedNextSequence + unit.events.length - 1,
        revisionCount: unit.revisions.length,
        eventCount: unit.events.length,
        referenceEdgeCount: unit.referenceEdges.length
      };
      this.#database.prepare("INSERT INTO accepted_commits(idempotency_key, request_json, receipt_json) VALUES (?, ?, ?)").run(unit.idempotencyKey, requestJson, json(receipt));
      this.#fault?.("before-commit");
      this.#database.exec("COMMIT");
      return receipt;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }
  readRevision(ref3) {
    const row = this.#database.prepare("SELECT document_json FROM revisions WHERE revision_key = ?").get(revisionKey(ref3));
    return row === void 0 ? void 0 : JSON.parse(row.document_json);
  }
  readInvocation(invocationId) {
    const rows = this.#database.prepare("SELECT envelope_json FROM events WHERE invocation_id = ? ORDER BY sequence").all(invocationId);
    return rows.map(({ envelope_json }) => JSON.parse(envelope_json));
  }
  listInvocationIds() {
    const rows = this.#database.prepare("SELECT DISTINCT invocation_id FROM events ORDER BY invocation_id").all();
    return rows.map(({ invocation_id }) => invocation_id);
  }
  readEvent(eventId) {
    const row = this.#database.prepare("SELECT envelope_json FROM events WHERE event_id = ?").get(eventId);
    return row === void 0 ? void 0 : JSON.parse(row.envelope_json);
  }
  readCurrentRevision(slot) {
    const row = this.#database.prepare("SELECT ref_json FROM current_revisions WHERE slot = ?").get(slot);
    return row === void 0 ? null : JSON.parse(row.ref_json);
  }
  readAcceptedCommit(idempotencyKey) {
    const row = this.#database.prepare("SELECT request_json FROM accepted_commits WHERE idempotency_key = ?").get(idempotencyKey);
    return row === void 0 ? void 0 : JSON.parse(row.request_json);
  }
  readReferenceEdges() {
    const rows = this.#database.prepare("SELECT source_key, relation, target_key FROM reference_edges ORDER BY source_key, relation, target_key").all();
    const parseKey = (key) => {
      return JSON.parse(key);
    };
    return rows.map((row) => ({
      source: parseKey(row.source_key),
      relation: row.relation,
      target: parseKey(row.target_key)
    }));
  }
};

// ../../packages/execution/dist/public/evidence-blob-store.js
import { createHash as createHash8 } from "node:crypto";
import { mkdir, open as open2, readFile, readdir as readdir2, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
var EvidenceBlobIntegrityError = class extends Error {
  digest;
  constructor(digest6, message) {
    super(`Evidence blob ${digest6}: ${message}`);
    this.name = "EvidenceBlobIntegrityError";
    this.digest = digest6;
  }
};
function digestBytes(bytes) {
  return `sha256:${createHash8("sha256").update(bytes).digest("hex")}`;
}
function digestHex(digest6) {
  if (!/^sha256:[a-f0-9]{64}$/.test(digest6)) {
    throw new TypeError("invalid SHA-256 digest");
  }
  return digest6.slice(7);
}
var EvidenceBlobStore = class {
  #root;
  #fault;
  constructor(root, fault) {
    this.#root = root;
    this.#fault = fault;
  }
  stagingPath(stagingId) {
    if (!/^[A-Za-z0-9._-]{1,160}$/.test(stagingId)) {
      throw new TypeError("stagingId contains unsafe characters");
    }
    return join(this.#root, "stage", `${stagingId}.blob`);
  }
  pathFor(digest6) {
    const hex = digestHex(digest6);
    return join(this.#root, "blobs", hex.slice(0, 2), hex);
  }
  async stage(bytes, stagingId) {
    const path5 = this.stagingPath(stagingId);
    await mkdir(dirname(path5), { recursive: true, mode: 448 });
    const handle = await open2(path5, "wx", 384);
    try {
      await handle.writeFile(bytes);
      this.#fault?.("after-stage-write");
      await handle.sync();
      this.#fault?.("after-stage-sync");
    } catch (error) {
      await handle.close();
      await rm(path5, { force: true });
      throw error;
    }
    await handle.close();
    return {
      stagingId,
      path: path5,
      digest: digestBytes(bytes),
      byteSize: bytes.byteLength
    };
  }
  async commit(staged) {
    const bytes = await readFile(staged.path);
    if (digestBytes(bytes) !== staged.digest || bytes.byteLength !== staged.byteSize) {
      throw new EvidenceBlobIntegrityError(staged.digest, "staged content failed integrity validation");
    }
    const destination = this.pathFor(staged.digest);
    await mkdir(dirname(destination), { recursive: true, mode: 448 });
    this.#fault?.("before-publish");
    try {
      await rename(staged.path, destination);
    } catch (error) {
      if (error.code !== "EEXIST")
        throw error;
      await this.read(staged.digest);
      await rm(staged.path, { force: true });
    }
    this.#fault?.("after-publish");
    await this.read(staged.digest);
    return destination;
  }
  async discard(staged) {
    await rm(staged.path, { force: true });
  }
  async read(digest6) {
    let bytes;
    try {
      bytes = await readFile(this.pathFor(digest6));
    } catch (error) {
      if (error.code === "ENOENT") {
        throw new EvidenceBlobIntegrityError(digest6, "missing");
      }
      throw error;
    }
    if (digestBytes(bytes) !== digest6) {
      throw new EvidenceBlobIntegrityError(digest6, "digest mismatch");
    }
    return bytes;
  }
  async recover(referencedDigests) {
    const removedStagingFiles = [];
    const stageDirectory = join(this.#root, "stage");
    try {
      for (const entry of await readdir2(stageDirectory)) {
        const path5 = join(stageDirectory, entry);
        if ((await stat(path5)).isFile()) {
          await rm(path5, { force: true });
          removedStagingFiles.push(entry);
        }
      }
    } catch (error) {
      if (error.code !== "ENOENT")
        throw error;
    }
    const corruptBlobDigests = [];
    const removedOrphanBlobDigests = [];
    const blobDirectory = join(this.#root, "blobs");
    try {
      for (const prefix of await readdir2(blobDirectory)) {
        const prefixPath = join(blobDirectory, prefix);
        if (!(await stat(prefixPath)).isDirectory())
          continue;
        for (const name of await readdir2(prefixPath)) {
          if (!/^[a-f0-9]{64}$/.test(name))
            continue;
          const expected = `sha256:${name}`;
          try {
            await this.read(expected);
            if (referencedDigests !== void 0 && !referencedDigests.has(expected)) {
              await rm(join(prefixPath, name), { force: true });
              removedOrphanBlobDigests.push(expected);
            }
          } catch (error) {
            if (error instanceof EvidenceBlobIntegrityError) {
              corruptBlobDigests.push(expected);
            } else {
              throw error;
            }
          }
        }
      }
    } catch (error) {
      if (error.code !== "ENOENT")
        throw error;
    }
    return {
      removedStagingFiles: removedStagingFiles.sort(),
      corruptBlobDigests: corruptBlobDigests.sort(),
      removedOrphanBlobDigests: removedOrphanBlobDigests.sort()
    };
  }
};

// ../../packages/execution/dist/public/cache.js
init_public();
import { createHash as createHash9 } from "node:crypto";
import { link, mkdir as mkdir2, open as open3, readFile as readFile2, readdir as readdir3, rm as rm2, unlink } from "node:fs/promises";
import { dirname as dirname2, join as join2 } from "node:path";
function sha2562(bytes) {
  return `sha256:${createHash9("sha256").update(bytes).digest("hex")}`;
}
function entryIntegrity(entry) {
  const preimage = {
    ...entry
  };
  delete preimage.integrityDigest;
  return sha2562(new TextEncoder().encode(canonicalize2(preimage)));
}
function planKeyHex(planKey) {
  if (!/^sha256:[a-f0-9]{64}$/.test(planKey)) {
    throw new TypeError("invalid cache plan key");
  }
  return planKey.slice(7);
}
var LocalCacheStore = class {
  #root;
  constructor(root) {
    this.#root = root;
  }
  entryPath(planKey) {
    const hex = planKeyHex(planKey);
    return join2(this.#root, "entries", hex.slice(0, 2), `${hex}.json`);
  }
  async lookup(planKey, referencesValid) {
    let raw;
    try {
      raw = await readFile2(this.entryPath(planKey));
    } catch (error) {
      if (error.code === "ENOENT") {
        return { disposition: "miss", reasonCode: "not_found" };
      }
      throw error;
    }
    let entry;
    try {
      entry = JSON.parse(new TextDecoder().decode(raw));
      if (entry.schemaVersion !== 1 || entry.planKey !== planKey || entryIntegrity(entry) !== entry.integrityDigest) {
        return { disposition: "miss", reasonCode: "corrupt" };
      }
    } catch {
      return { disposition: "miss", reasonCode: "corrupt" };
    }
    if (!await referencesValid(entry)) {
      return { disposition: "miss", reasonCode: "missing_reference" };
    }
    return { disposition: "hit", entry };
  }
  async publish(entry, publicationToken, cancellation) {
    if (!/^[A-Za-z0-9._-]{1,160}$/.test(publicationToken)) {
      throw new TypeError("publicationToken contains unsafe characters");
    }
    cancellation?.throwIfCancelled();
    const stored = {
      ...entry,
      integrityDigest: entryIntegrity(entry)
    };
    const bytes = new TextEncoder().encode(canonicalize2(stored));
    const temporary = join2(this.#root, "stage", `${publicationToken}.json`);
    const destination = this.entryPath(entry.planKey);
    await mkdir2(dirname2(temporary), { recursive: true, mode: 448 });
    await mkdir2(dirname2(destination), { recursive: true, mode: 448 });
    const handle = await open3(temporary, "wx", 384);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      cancellation?.throwIfCancelled();
    } catch (error) {
      await rm2(temporary, { force: true });
      throw error;
    }
    let wonPublication = false;
    try {
      await link(temporary, destination);
      wonPublication = true;
    } catch (error) {
      if (error.code !== "EEXIST") {
        await rm2(temporary, { force: true });
        throw error;
      }
    }
    await unlink(temporary);
    const winner = await this.lookup(entry.planKey, () => true);
    if (winner.disposition !== "hit") {
      return {
        disposition: "miss",
        wonPublication: false,
        reasonCode: winner.reasonCode
      };
    }
    return {
      disposition: wonPublication ? "published" : "reused",
      wonPublication,
      entry: winner.entry
    };
  }
  async clear() {
    await rm2(join2(this.#root, "entries"), { recursive: true, force: true });
  }
  async recover() {
    const stage = join2(this.#root, "stage");
    let names;
    try {
      names = await readdir3(stage);
    } catch (error) {
      if (error.code === "ENOENT")
        return [];
      throw error;
    }
    for (const name of names) {
      await rm2(join2(stage, name), { recursive: true, force: true });
    }
    return names.sort();
  }
};

// ../../packages/execution/dist/public/local-projections.js
init_public();
import { DatabaseSync as DatabaseSync2 } from "node:sqlite";
var LocalProjectionConflict = class extends Error {
  constructor(message) {
    super(message);
    this.name = "LocalProjectionConflict";
  }
};
var LocalProjectionRepository = class {
  #database;
  #evidenceBlobs;
  constructor(path5, evidenceBlobs) {
    this.#database = new DatabaseSync2(path5);
    this.#evidenceBlobs = evidenceBlobs;
    this.#database.exec("PRAGMA journal_mode = WAL");
    this.#database.exec("PRAGMA busy_timeout = 5000");
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS run_projections (
        invocation_id TEXT PRIMARY KEY,
        result_json TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS cache_metadata (
        plan_key TEXT PRIMARY KEY,
        metadata_json TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS deletion_tombstones (
        revision_key TEXT PRIMARY KEY,
        tombstone_json TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS evidence_projections (
        evidence_id TEXT PRIMARY KEY,
        metadata_json TEXT NOT NULL,
        body_digest TEXT NOT NULL
      ) STRICT;
    `);
  }
  close() {
    this.#database.close();
  }
  appendRun(run) {
    const resultJson = canonicalize2(run.result);
    this.#database.prepare("INSERT OR IGNORE INTO run_projections(invocation_id, result_json) VALUES (?, ?)").run(run.invocationId, resultJson);
    const row = this.#database.prepare("SELECT result_json FROM run_projections WHERE invocation_id = ?").get(run.invocationId);
    if (row.result_json !== resultJson) {
      throw new LocalProjectionConflict(`invocation ${run.invocationId} already has a different result`);
    }
  }
  readRun(invocationId) {
    const row = this.#database.prepare("SELECT result_json FROM run_projections WHERE invocation_id = ?").get(invocationId);
    return row === void 0 ? void 0 : {
      invocationId,
      result: JSON.parse(row.result_json)
    };
  }
  putCacheMetadata(metadata) {
    const metadataJson = canonicalize2(metadata);
    this.#database.prepare(`INSERT INTO cache_metadata(plan_key, metadata_json) VALUES (?, ?)
       ON CONFLICT(plan_key) DO UPDATE SET metadata_json = excluded.metadata_json`).run(metadata.planKey, metadataJson);
  }
  readCacheMetadata(planKey) {
    const row = this.#database.prepare("SELECT metadata_json FROM cache_metadata WHERE plan_key = ?").get(planKey);
    return row === void 0 ? void 0 : JSON.parse(row.metadata_json);
  }
  listCacheMetadata() {
    const rows = this.#database.prepare("SELECT metadata_json FROM cache_metadata ORDER BY plan_key").all();
    return rows.map(({ metadata_json }) => JSON.parse(metadata_json));
  }
  clearCacheMetadata() {
    this.#database.exec("DELETE FROM cache_metadata");
  }
  putTombstone(tombstone) {
    const key = canonicalize2(tombstone.ref);
    const value = canonicalize2(tombstone);
    this.#database.prepare(`INSERT INTO deletion_tombstones(revision_key, tombstone_json)
       VALUES (?, ?)
       ON CONFLICT(revision_key) DO UPDATE SET tombstone_json = excluded.tombstone_json`).run(key, value);
  }
  readTombstone(ref3) {
    const key = canonicalize2(ref3);
    const row = this.#database.prepare("SELECT tombstone_json FROM deletion_tombstones WHERE revision_key = ?").get(key);
    return row === void 0 ? void 0 : JSON.parse(row.tombstone_json);
  }
  async appendEvidence(evidence, stagingId) {
    if (this.#evidenceBlobs === void 0) {
      throw new TypeError("Evidence blob store is not configured");
    }
    const metadataJson = canonicalize2(evidence.metadata);
    const bodyJson = canonicalize2(evidence.body);
    const staged = await this.#evidenceBlobs.stage(new TextEncoder().encode(bodyJson), stagingId);
    const existing = this.#database.prepare("SELECT metadata_json, body_digest FROM evidence_projections WHERE evidence_id = ?").get(evidence.evidenceId);
    if (existing !== void 0) {
      await this.#evidenceBlobs.discard(staged);
      if (existing.metadata_json !== metadataJson || existing.body_digest !== staged.digest) {
        throw new LocalProjectionConflict(`Evidence ${evidence.evidenceId} already has different content`);
      }
      return {
        ...evidence,
        bodyDigest: existing.body_digest
      };
    }
    await this.#evidenceBlobs.commit(staged);
    this.#database.prepare("INSERT OR IGNORE INTO evidence_projections(evidence_id, metadata_json, body_digest) VALUES (?, ?, ?)").run(evidence.evidenceId, metadataJson, staged.digest);
    const accepted = this.#database.prepare("SELECT metadata_json, body_digest FROM evidence_projections WHERE evidence_id = ?").get(evidence.evidenceId);
    if (accepted.metadata_json !== metadataJson || accepted.body_digest !== staged.digest) {
      throw new LocalProjectionConflict(`Evidence ${evidence.evidenceId} already has different content`);
    }
    return {
      ...evidence,
      bodyDigest: staged.digest
    };
  }
  async readEvidence(evidenceId) {
    if (this.#evidenceBlobs === void 0) {
      throw new TypeError("Evidence blob store is not configured");
    }
    const row = this.#database.prepare("SELECT metadata_json, body_digest FROM evidence_projections WHERE evidence_id = ?").get(evidenceId);
    if (row === void 0)
      return void 0;
    const bytes = await this.#evidenceBlobs.read(row.body_digest);
    return {
      evidenceId,
      metadata: JSON.parse(row.metadata_json),
      body: JSON.parse(new TextDecoder().decode(bytes)),
      bodyDigest: row.body_digest
    };
  }
};

// ../../packages/engine/src/public/local-runtime.ts
var DEFAULT_LOCAL_RUNTIME_OWNER_LEASE_MS = 5 * 60 * 1e3;
var DEFAULT_LOCAL_RUNTIME_HEARTBEAT_INTERVAL_MS = 60 * 1e3;
var knownLocalOwnerTokens = /* @__PURE__ */ new Set();
var activeLocalOwnerTokens = /* @__PURE__ */ new Set();
function processIsLive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return typeof error === "object" && error !== null && "code" in error && error.code === "EPERM";
  }
}
function canonical3(value) {
  return JSON.parse(JSON.stringify(value));
}
function refKey2(ref3) {
  return `${ref3.kind}\0${ref3.id}\0${ref3.revision}\0${ref3.schemaVersion}`;
}
function terminalHistoryEvents(result, occurredAt, normalizedEvidence, sequence) {
  return [{
    schemaVersion: 1,
    eventId: `${result.invocationId}:unit:11-invocation-terminal:1`,
    eventType: "VerificationInvocationCompleted",
    occurredAt,
    invocationId: result.invocationId,
    correlationId: result.invocationId,
    sequence,
    producer: {
      id: "@verify-internal/engine",
      version: result.engineVersion,
      artifactDigest: `sha256:${createHash10("sha256").update(`@verify-internal/engine@${result.engineVersion}`).digest("hex")}`
    },
    dataClassification: "LOCAL_SOURCE",
    payload: canonical3({
      result,
      projectionEvidence: normalizedEvidence === void 0 ? null : {
        evidenceId: normalizedEvidence.id,
        metadata: {
          schemaVersion: normalizedEvidence.schemaVersion,
          id: normalizedEvidence.id,
          revision: normalizedEvidence.revision,
          evidenceType: normalizedEvidence.evidenceType,
          mediaType: normalizedEvidence.mediaType,
          contentDigest: normalizedEvidence.contentDigest,
          byteSize: normalizedEvidence.byteSize,
          classification: normalizedEvidence.classification,
          redactions: normalizedEvidence.redactions
        },
        body: normalizedEvidence.body
      }
    })
  }];
}
var LocalVerificationRuntime = class {
  #cache;
  #projections;
  #unitOfWork;
  #engine;
  #now;
  #projectionFault;
  #checkpointFault;
  #recovery;
  #ownerToken;
  #ownerDirectory;
  #ownerLeaseMs;
  #ownerHeartbeat;
  #closed = false;
  constructor(stateRoot, options = {}) {
    this.#ownerToken = randomUUID2();
    knownLocalOwnerTokens.add(this.#ownerToken);
    activeLocalOwnerTokens.add(this.#ownerToken);
    mkdirSync(stateRoot, { recursive: true, mode: 448 });
    this.#ownerDirectory = path4.join(stateRoot, ".runtime-owners");
    mkdirSync(this.#ownerDirectory, { recursive: true, mode: 448 });
    chmodSync(this.#ownerDirectory, 448);
    this.#ownerLeaseMs = options.ownerLeaseMs ?? DEFAULT_LOCAL_RUNTIME_OWNER_LEASE_MS;
    const heartbeatInterval = options.ownerHeartbeatIntervalMs ?? DEFAULT_LOCAL_RUNTIME_HEARTBEAT_INTERVAL_MS;
    if (!Number.isSafeInteger(this.#ownerLeaseMs) || this.#ownerLeaseMs <= 0 || !Number.isSafeInteger(heartbeatInterval) || heartbeatInterval <= 0 || heartbeatInterval >= this.#ownerLeaseMs) {
      throw new TypeError(
        "owner heartbeat interval must be positive and shorter than the owner lease"
      );
    }
    const evidenceBlobs = new EvidenceBlobStore(path4.join(stateRoot, "evidence"));
    this.#cache = new LocalCacheStore(path4.join(stateRoot, "cache"));
    const historyPath = path4.join(stateRoot, "history.sqlite");
    this.#projections = new LocalProjectionRepository(
      historyPath,
      evidenceBlobs
    );
    this.#unitOfWork = new SqliteEngineUnitOfWork(
      historyPath,
      options.commitFault
    );
    this.#now = options.now ?? (() => /* @__PURE__ */ new Date());
    this.#writeOwnerHeartbeat();
    this.#ownerHeartbeat = setInterval(() => {
      try {
        this.#writeOwnerHeartbeat();
      } catch {
      }
    }, heartbeatInterval);
    this.#ownerHeartbeat.unref();
    this.#projectionFault = options.projectionFault;
    this.#checkpointFault = options.checkpointFault;
    this.#reconcileRunProjections();
    this.#recovery = this.#recoverAbandonedInvocations();
    this.#engine = new VerificationEngine({
      cache: this,
      history: this,
      now: this.#now
    });
  }
  async verify(request, disableCache = false) {
    await this.#recovery;
    if (!disableCache) return this.#engine.verify(request);
    return new VerificationEngine({
      history: this,
      now: this.#now
    }).verify(request);
  }
  #retainedRepair(sourceInvocationId, repairId) {
    const retained = this.readRun(sourceInvocationId);
    if (retained === void 0) {
      throw new RepairApplyConflict(
        "INVALID_REPAIR_ACTION",
        `source run not found: ${sourceInvocationId}`
      );
    }
    const matches = (retained.repairRecords ?? []).filter(
      (repair) => repair.id === repairId
    );
    if (matches.length !== 1) {
      throw new RepairApplyConflict(
        "INVALID_REPAIR_ACTION",
        `exact retained Repair not found: ${repairId}`
      );
    }
    return matches[0];
  }
  previewRepair(sourceInvocationId, repairId, workspace) {
    const preview = previewRepairPatch(
      this.#retainedRepair(sourceInvocationId, repairId),
      workspace
    );
    return {
      document: canonical3({
        schemaVersion: 1,
        kind: "repairPreview",
        sourceInvocationId,
        writeAuthorized: false,
        writePerformed: false,
        preview
      })
    };
  }
  async applyRepair(applicationInvocationId, sourceInvocationId, repairId, workspace, writeGranted, signal) {
    if (!writeGranted) {
      throw new RepairApplyConflict(
        "INVALID_REPAIR_ACTION",
        "an explicit workspace write grant is required"
      );
    }
    const principal = {
      kind: "local-user",
      id: `local-user:${process.getuid?.() ?? "unknown"}`,
      authenticated: true
    };
    const decision = authorize(
      principal,
      {
        operation: "applyRepair",
        workspaceRoot: workspace,
        permissions: ["workspace.write"]
      },
      repairApplyCliPolicy(principal, workspace)
    );
    if (!decision.allowed) {
      throw new RepairApplyConflict(
        "INVALID_REPAIR_ACTION",
        `workspace write was denied: ${decision.reasonCode}`
      );
    }
    const repair = this.#retainedRepair(sourceInvocationId, repairId);
    const preview = applyRepairPatch(repair, workspace);
    const repairRef2 = {
      kind: "repair",
      id: repair.id,
      revision: repair.revision,
      schemaVersion: repair.schemaVersion
    };
    await this.recordRepairApplied({
      applicationInvocationId,
      sourceInvocationId,
      repair: repairRef2,
      target: preview.target,
      beforeDigest: preview.currentContentDigest,
      afterDigest: preview.patchedContentDigest,
      principalId: principal.id
    });
    const verifyingInvocationId = `${applicationInvocationId}:verification`;
    const verification = await this.verify({
      schemaVersion: 1,
      workspaceRoot: workspace,
      invocationId: verifyingInvocationId,
      signal
    }, true);
    const exact = verification.proofExecutions.find(
      (execution) => refKey2(execution.proof) === refKey2(repair.motivatingExecution.proof)
    );
    const passed = exact?.result?.status === "passed";
    await this.recordRepairVerification({
      applicationInvocationId,
      repair: repairRef2,
      verifyingInvocationId,
      verifyingProof: repair.motivatingExecution.proof,
      ...exact === void 0 ? {} : {
        verifyingAttemptId: exact.attemptId,
        ...exact.resultDigest === void 0 ? {} : { resultDigest: exact.resultDigest }
      },
      passed
    });
    return {
      passed,
      document: canonical3({
        schemaVersion: 1,
        kind: "repairApply",
        applicationInvocationId,
        sourceInvocationId,
        repair: repairRef2,
        writeAuthorized: true,
        writePerformed: true,
        preview,
        lifecycle: [
          "accepted",
          "applied",
          passed ? "verified" : "verification_failed"
        ],
        verification: {
          invocationId: verification.invocationId,
          outcome: verification.outcome,
          proof: repair.motivatingExecution.proof,
          status: exact?.result?.status ?? "not_evaluated",
          ...exact?.resultDigest === void 0 ? {} : { resultDigest: exact.resultDigest }
        }
      })
    };
  }
  async recordRepairApplied(record) {
    await this.#recovery;
    const occurredAt = this.#now().toISOString();
    const producer2 = {
      id: "@verify-internal/engine",
      version: "0.2.0",
      artifactDigest: `sha256:${createHash10("sha256").update("@verify-internal/engine@0.2.0").digest("hex")}`
    };
    await this.#unitOfWork.commit({
      idempotencyKey: `repair-application:${record.applicationInvocationId}:applied`,
      invocationId: record.applicationInvocationId,
      expectedNextSequence: 1,
      revisions: [],
      events: [
        {
          schemaVersion: 1,
          eventId: `${record.applicationInvocationId}:repair:accepted`,
          eventType: "RepairAccepted",
          occurredAt,
          invocationId: record.applicationInvocationId,
          subject: record.repair,
          correlationId: record.sourceInvocationId,
          sequence: 1,
          producer: producer2,
          dataClassification: "MINIMAL_METADATA",
          payload: canonical3({
            repair: record.repair,
            from: "proposed",
            to: "accepted",
            actorRef: record.principalId,
            reasonCode: "EXPLICIT_CLI_WRITE_GRANT"
          })
        },
        {
          schemaVersion: 1,
          eventId: `${record.applicationInvocationId}:repair:applied`,
          eventType: "RepairApplied",
          occurredAt,
          invocationId: record.applicationInvocationId,
          subject: record.repair,
          correlationId: record.sourceInvocationId,
          sequence: 2,
          producer: producer2,
          dataClassification: "LOCAL_SOURCE",
          payload: canonical3({
            repair: record.repair,
            from: "accepted",
            to: "applied",
            actorRef: record.principalId,
            authorizationDecisionRef: `${record.applicationInvocationId}:workspace-write`,
            reasonCode: "ATOMIC_PATCH_APPLIED",
            target: record.target,
            beforeDigest: record.beforeDigest,
            afterDigest: record.afterDigest
          })
        }
      ],
      referenceEdges: [],
      currentRevisionMutations: []
    });
  }
  async recordRepairVerification(record) {
    await this.#recovery;
    const occurredAt = this.#now().toISOString();
    await this.#unitOfWork.commit({
      idempotencyKey: `repair-application:${record.applicationInvocationId}:verification`,
      invocationId: record.applicationInvocationId,
      expectedNextSequence: 3,
      revisions: [],
      events: [{
        schemaVersion: 1,
        eventId: `${record.applicationInvocationId}:repair:verification`,
        eventType: record.passed ? "RepairVerified" : "RepairVerificationFailed",
        occurredAt,
        invocationId: record.applicationInvocationId,
        subject: record.repair,
        correlationId: record.verifyingInvocationId,
        sequence: 3,
        producer: {
          id: "@verify-internal/engine",
          version: "0.2.0",
          artifactDigest: `sha256:${createHash10("sha256").update("@verify-internal/engine@0.2.0").digest("hex")}`
        },
        dataClassification: "MINIMAL_METADATA",
        payload: canonical3({
          repair: record.repair,
          from: "applied",
          to: record.passed ? "verified" : "verification_failed",
          actorRef: "@verify-internal/engine",
          reasonCode: record.passed ? "LATER_EXACT_PROOF_PASSED" : "LATER_EXACT_PROOF_DID_NOT_PASS",
          verifyingInvocationId: record.verifyingInvocationId,
          verifyingProof: record.verifyingProof,
          ...record.verifyingAttemptId === void 0 ? {} : { verifyingAttemptId: record.verifyingAttemptId },
          ...record.resultDigest === void 0 ? {} : { resultDigest: record.resultDigest }
        })
      }],
      referenceEdges: [{
        source: record.repair,
        relation: record.passed ? "verified-by-proof" : "verification-attempted-by-proof",
        target: record.verifyingProof
      }],
      currentRevisionMutations: []
    });
  }
  async admit(invocationId, workspaceRoot) {
    await this.#recovery;
    const occurredAt = this.#now().toISOString();
    const id = invocationId;
    const idempotencyKey = `history:${invocationId}:admission`;
    const workspaceBinding = `sha256:${createHash10("sha256").update(path4.resolve(workspaceRoot)).digest("hex")}`;
    const owner = this.#ownerIdentity();
    const retainedHistory = this.#unitOfWork.readInvocation(id);
    const retainedTerminal = retainedHistory.find(
      (event2) => event2.eventType === "VerificationInvocationCompleted" || event2.eventType === "VerificationInvocationAbandoned"
    );
    if (retainedTerminal !== void 0) {
      throw new EngineUnitOfWorkConflict(
        "IDEMPOTENCY_CONFLICT",
        `invocation ${invocationId} is already terminal as ${retainedTerminal.eventType}`
      );
    }
    const acceptedAdmission = this.#unitOfWork.readAcceptedCommit(idempotencyKey);
    if (acceptedAdmission !== void 0) {
      const retainedBinding = acceptedAdmission.events[0]?.payload?.workspaceBinding;
      const retainedOwner = acceptedAdmission.events[0]?.payload?.owner;
      if (retainedBinding !== workspaceBinding || retainedOwner?.ownerToken !== this.#ownerToken) {
        throw new EngineUnitOfWorkConflict(
          "IDEMPOTENCY_CONFLICT",
          `invocation ${invocationId} was admitted for another workspace or owner`
        );
      }
      return;
    }
    await this.#unitOfWork.commit({
      idempotencyKey,
      invocationId: id,
      expectedNextSequence: 1,
      revisions: [],
      events: [{
        schemaVersion: 1,
        eventId: `${invocationId}:history:1`,
        eventType: "VerificationInvocationAdmitted",
        occurredAt,
        invocationId: id,
        correlationId: id,
        sequence: 1,
        producer: {
          id: "@verify-internal/engine",
          version: "0.2.0",
          artifactDigest: `sha256:${createHash10("sha256").update("@verify-internal/engine@0.2.0").digest("hex")}`
        },
        dataClassification: "LOCAL_SOURCE",
        payload: canonical3({
          workspaceBinding,
          owner,
          state: "admitted"
        })
      }],
      referenceEdges: [],
      currentRevisionMutations: []
    });
  }
  async checkpoint(checkpoint) {
    await this.#recovery;
    const idempotencyKey = `history:${checkpoint.invocationId}:unit:${checkpoint.unit}`;
    const accepted = this.#unitOfWork.readAcceptedCommit(idempotencyKey);
    if (accepted !== void 0) {
      const retainedEvents = accepted.events.map((event2) => ({
        eventType: event2.eventType,
        ...event2.subject === void 0 ? {} : { subject: event2.subject },
        dataClassification: event2.dataClassification,
        payload: event2.payload
      }));
      const requestedCurrent = checkpoint.currentRevision?.next;
      const retainedMutation = accepted.currentRevisionMutations[0];
      const retainedCurrent = retainedMutation?.nextCurrent;
      const retainedEdges = accepted.referenceEdges.filter(
        (edge) => !(edge.relation === "superseded-by" && retainedMutation?.expectedCurrent !== null && retainedMutation?.expectedCurrent !== void 0 && refKey2(edge.source) === refKey2(retainedMutation.expectedCurrent) && refKey2(edge.target) === refKey2(retainedMutation.nextCurrent))
      );
      if (canonicalize2(accepted.revisions) !== canonicalize2(checkpoint.revisions) || canonicalize2(
        retainedEdges
      ) !== canonicalize2(checkpoint.referenceEdges) || canonicalize2(retainedEvents) !== canonicalize2(checkpoint.events) || (requestedCurrent === void 0 ? retainedCurrent !== void 0 : retainedCurrent === void 0 || refKey2(requestedCurrent) !== refKey2(retainedCurrent))) {
        throw new EngineUnitOfWorkConflict(
          "IDEMPOTENCY_CONFLICT",
          `checkpoint ${checkpoint.unit} was already committed differently`
        );
      }
      return;
    }
    const prior = this.#unitOfWork.readInvocation(checkpoint.invocationId);
    const retainedTerminal = prior.find(
      (event2) => event2.eventType === "VerificationInvocationCompleted" || event2.eventType === "VerificationInvocationAbandoned"
    );
    if (retainedTerminal !== void 0) {
      throw new EngineUnitOfWorkConflict(
        "IDEMPOTENCY_CONFLICT",
        `invocation ${checkpoint.invocationId} is already terminal as ${retainedTerminal.eventType}`
      );
    }
    const firstSequence = prior.length + 1;
    const events = checkpoint.events.map((event2, index) => ({
      schemaVersion: 1,
      eventId: `${checkpoint.invocationId}:unit:${checkpoint.unit}:${index + 1}`,
      eventType: event2.eventType,
      occurredAt: checkpoint.occurredAt,
      invocationId: checkpoint.invocationId,
      ...event2.subject === void 0 ? {} : { subject: event2.subject },
      correlationId: checkpoint.invocationId,
      sequence: firstSequence + index,
      producer: {
        id: "@verify-internal/engine",
        version: "0.2.0",
        artifactDigest: `sha256:${createHash10("sha256").update("@verify-internal/engine@0.2.0").digest("hex")}`
      },
      dataClassification: event2.dataClassification,
      payload: event2.payload
    }));
    const priorCurrent = checkpoint.currentRevision === void 0 ? null : this.#unitOfWork.readCurrentRevision(
      checkpoint.currentRevision.slot
    );
    const currentRevisionMutations = checkpoint.currentRevision === void 0 ? [] : [{
      slot: checkpoint.currentRevision.slot,
      expectedCurrent: priorCurrent,
      nextCurrent: checkpoint.currentRevision.next
    }];
    const referenceEdges = [
      ...checkpoint.referenceEdges,
      ...checkpoint.currentRevision !== void 0 && priorCurrent !== null && refKey2(priorCurrent) !== refKey2(checkpoint.currentRevision.next) ? [{
        source: priorCurrent,
        relation: "superseded-by",
        target: checkpoint.currentRevision.next
      }] : []
    ];
    await this.#unitOfWork.commit({
      idempotencyKey,
      invocationId: checkpoint.invocationId,
      expectedNextSequence: firstSequence,
      revisions: checkpoint.revisions,
      events,
      referenceEdges,
      currentRevisionMutations
    });
    this.#checkpointFault?.(checkpoint.unit);
  }
  async #recoverAbandonedInvocations() {
    for (const invocationId of this.#unitOfWork.listInvocationIds()) {
      const events = this.#unitOfWork.readInvocation(invocationId);
      const admission = events.find(
        (event2) => event2.eventType === "VerificationInvocationAdmitted"
      );
      if (admission === void 0 || events.some(
        (event2) => event2.eventType === "VerificationInvocationCompleted" || event2.eventType === "VerificationInvocationAbandoned"
      )) {
        continue;
      }
      const owner = admission.payload.owner;
      if (this.#admissionOwnerIsLive(owner)) continue;
      const sequence = events.length + 1;
      const occurredAt = this.#now().toISOString();
      await this.#unitOfWork.commit({
        idempotencyKey: `history:${invocationId}:abandoned`,
        invocationId,
        expectedNextSequence: sequence,
        revisions: [],
        events: [{
          schemaVersion: 1,
          eventId: `${invocationId}:history:${sequence}`,
          eventType: "VerificationInvocationAbandoned",
          occurredAt,
          invocationId,
          correlationId: invocationId,
          sequence,
          producer: {
            id: "@verify-internal/engine",
            version: "0.2.0",
            artifactDigest: `sha256:${createHash10("sha256").update("@verify-internal/engine@0.2.0").digest("hex")}`
          },
          dataClassification: "MINIMAL_METADATA",
          payload: canonical3({
            state: "abandoned",
            reasonCode: "PROCESS_INTERRUPTED",
            semanticOutcome: null
          })
        }],
        referenceEdges: [],
        currentRevisionMutations: []
      });
    }
  }
  #admissionOwnerIsLive(owner) {
    if (owner === void 0 || typeof owner.ownerToken !== "string" || typeof owner.leaseUntil !== "string") {
      return false;
    }
    if (knownLocalOwnerTokens.has(owner.ownerToken)) {
      return activeLocalOwnerTokens.has(owner.ownerToken);
    }
    if (!processIsLive(owner.ownerPid)) return false;
    const heartbeat = this.#readOwnerHeartbeat(owner.ownerToken);
    if (heartbeat === void 0 || heartbeat.ownerToken !== owner.ownerToken || heartbeat.ownerPid !== owner.ownerPid) {
      return false;
    }
    const leaseExpiry = Date.parse(heartbeat.leaseUntil);
    return Number.isFinite(leaseExpiry) && leaseExpiry > Date.now();
  }
  #ownerIdentity() {
    return {
      ownerToken: this.#ownerToken,
      ownerPid: process.pid,
      leaseUntil: new Date(
        Date.now() + this.#ownerLeaseMs
      ).toISOString()
    };
  }
  #ownerHeartbeatPath(ownerToken) {
    const filename = createHash10("sha256").update(ownerToken).digest("hex");
    return path4.join(this.#ownerDirectory, `${filename}.json`);
  }
  #writeOwnerHeartbeat() {
    const refreshedAt = (/* @__PURE__ */ new Date()).toISOString();
    const heartbeat = {
      schemaVersion: 1,
      ...this.#ownerIdentity(),
      refreshedAt
    };
    const target = this.#ownerHeartbeatPath(this.#ownerToken);
    const temporary = path4.join(
      this.#ownerDirectory,
      `.${path4.basename(target)}.${randomUUID2()}.tmp`
    );
    try {
      writeFileSync2(temporary, JSON.stringify(heartbeat), {
        encoding: "utf8",
        flag: "wx",
        mode: 384
      });
      renameSync2(temporary, target);
      chmodSync(target, 384);
    } finally {
      rmSync2(temporary, { force: true });
    }
  }
  #readOwnerHeartbeat(ownerToken) {
    try {
      const value = JSON.parse(
        readFileSync2(this.#ownerHeartbeatPath(ownerToken), "utf8")
      );
      if (value.schemaVersion !== 1 || typeof value.ownerToken !== "string" || !Number.isSafeInteger(value.ownerPid) || typeof value.leaseUntil !== "string" || typeof value.refreshedAt !== "string") {
        return void 0;
      }
      return value;
    } catch {
      return void 0;
    }
  }
  async get(key) {
    await this.#recovery;
    const lookup = await this.#cache.lookup(
      key,
      (entry) => this.#cacheReferencesValid(entry)
    );
    if (lookup.disposition !== "hit") return void 0;
    return lookup.entry.value;
  }
  #cacheReferencesValid(entry) {
    const value = entry.value;
    const provenance2 = value.provenance;
    if (provenance2 === void 0 || refKey2(entry.model) !== refKey2(provenance2.model) || provenance2.proofExecutions.length === 0 || entry.originatingExecutionId !== provenance2.proofExecutions[0]?.attemptId || provenance2.proofs.length === 0 || provenance2.proofs.length !== provenance2.proofExecutions.length || provenance2.proofExecutions.some(
      (execution) => !provenance2.proofs.some(
        (proof) => refKey2(proof) === refKey2(execution.proof)
      )
    ) || !provenance2.proofs.some(
      (proof) => refKey2(proof) === refKey2(entry.proof)
    )) {
      return false;
    }
    const evidenceRefs = provenance2.evidenceRecords.map((evidence) => ({
      kind: "evidence",
      id: evidence.id,
      revision: evidence.revision,
      schemaVersion: evidence.schemaVersion
    }));
    if (evidenceRefs.length === 0 || provenance2.proofExecutions.some(
      (execution) => execution.evidence.some(
        (reference) => !evidenceRefs.some(
          (candidate) => refKey2(candidate) === refKey2(reference)
        )
      )
    ) || entry.evidenceRefs.length !== evidenceRefs.length || entry.validationEventIds.length !== provenance2.validationEventIds.length || entry.evidenceRefs.some(
      (reference) => !evidenceRefs.some(
        (candidate) => refKey2(candidate) === refKey2(reference)
      )
    ) || entry.validationEventIds.some(
      (eventId) => !provenance2.validationEventIds.includes(eventId)
    )) {
      return false;
    }
    const revisionRefs = [
      provenance2.model,
      ...provenance2.proofs,
      ...evidenceRefs
    ];
    if (revisionRefs.some(
      (reference) => this.#unitOfWork.readRevision(reference) === void 0
    )) {
      return false;
    }
    const evidenceKeys = new Set(evidenceRefs.map(refKey2));
    for (const eventId of provenance2.validationEventIds) {
      const event2 = this.#unitOfWork.readEvent(eventId);
      if (event2?.eventType !== "EvidenceValidated" || event2.subject === void 0 || !evidenceKeys.has(refKey2(event2.subject))) {
        return false;
      }
    }
    const originatingEvents = this.#unitOfWork.readInvocation(
      provenance2.originatingInvocationId
    );
    if (!originatingEvents.some(
      (event2) => event2.eventType === "VerificationInvocationCompleted"
    )) {
      return false;
    }
    for (const execution of provenance2.proofExecutions) {
      const retained = originatingEvents.find(
        (event2) => event2.eventType === "ProofExecutionCompleted" && event2.payload.attemptId === execution.attemptId
      );
      if (retained === void 0 || canonicalize2(retained.payload) !== canonicalize2(execution)) {
        return false;
      }
    }
    return true;
  }
  async publish(key, value) {
    const provenance2 = value.provenance;
    if (provenance2 === void 0 || provenance2.proofs.length === 0 || provenance2.proofExecutions.length === 0) {
      throw new TypeError(
        "cache publication requires exact canonical provenance"
      );
    }
    const events = this.#unitOfWork.readInvocation(
      provenance2.originatingInvocationId
    );
    const evidenceRefs = provenance2.evidenceRecords.map((evidence) => ({
      kind: "evidence",
      id: evidence.id,
      revision: evidence.revision,
      schemaVersion: evidence.schemaVersion
    }));
    const evidenceKeys = new Set(evidenceRefs.map(refKey2));
    const validationEventIds = events.filter(
      (event2) => event2.eventType === "EvidenceValidated" && event2.subject !== void 0 && evidenceKeys.has(refKey2(event2.subject))
    ).map((event2) => event2.eventId);
    if (evidenceRefs.length === 0 || validationEventIds.length !== evidenceRefs.length) {
      throw new TypeError(
        "cache publication requires validated canonical Evidence"
      );
    }
    const enrichedValue = {
      ...value,
      provenance: {
        ...provenance2,
        validationEventIds
      }
    };
    const entry = {
      schemaVersion: 1,
      planKey: key,
      proof: provenance2.proofs[0],
      model: provenance2.model,
      originatingExecutionId: provenance2.proofExecutions[0].attemptId,
      originatingResultDigest: value.proofSuite.resultDigest,
      evidenceRefs,
      validationEventIds,
      reproducibility: "replayable",
      value: enrichedValue
    };
    const published = await this.#cache.publish(entry, randomUUID2());
    const createdAt = this.#now().toISOString();
    this.#projections.putCacheMetadata({
      planKey: key,
      originatingExecutionId: entry.originatingExecutionId,
      byteSize: Buffer.byteLength(canonicalize2(entry.value)),
      createdAt
    });
    return published.wonPublication ? "published" : "existing";
  }
  async append(result, evidence) {
    await this.#recovery;
    const retainedHistory = this.#unitOfWork.readInvocation(
      result.invocationId
    );
    if (retainedHistory.some(
      (event2) => event2.eventType === "VerificationInvocationAbandoned"
    )) {
      throw new EngineUnitOfWorkConflict(
        "IDEMPOTENCY_CONFLICT",
        `abandoned invocation ${result.invocationId} cannot be completed`
      );
    }
    const occurredAt = this.#now().toISOString();
    const terminalKey = `history:${result.invocationId}:terminal`;
    const acceptedTerminal = this.#unitOfWork.readAcceptedCommit(terminalKey);
    if (acceptedTerminal === void 0 && retainedHistory.some(
      (event2) => event2.eventType === "VerificationInvocationCompleted"
    )) {
      throw new EngineUnitOfWorkConflict(
        "IDEMPOTENCY_CONFLICT",
        `invocation ${result.invocationId} already has an unrecognized terminal event`
      );
    }
    const firstSequence = acceptedTerminal?.expectedNextSequence ?? retainedHistory.length + 1;
    const events = terminalHistoryEvents(
      result,
      occurredAt,
      evidence,
      firstSequence
    );
    const unit = {
      idempotencyKey: terminalKey,
      invocationId: result.invocationId,
      expectedNextSequence: firstSequence,
      revisions: [],
      events,
      referenceEdges: [],
      currentRevisionMutations: []
    };
    if (acceptedTerminal === void 0) {
      await this.#unitOfWork.commit(unit);
      this.#projectionFault?.("after-canonical-commit");
    } else {
      const retainedTerminal = acceptedTerminal.events[0];
      if (retainedTerminal === void 0 || canonicalize2(retainedTerminal.payload) !== canonicalize2(events[0]?.payload)) {
        throw new EngineUnitOfWorkConflict(
          "IDEMPOTENCY_CONFLICT",
          `terminal result ${result.invocationId} changed`
        );
      }
    }
    if (evidence !== void 0) {
      this.#projectionFault?.("before-legacy-evidence-projection");
      await this.#projections.appendEvidence({
        evidenceId: evidence.id,
        metadata: {
          schemaVersion: evidence.schemaVersion,
          id: evidence.id,
          revision: evidence.revision,
          evidenceType: evidence.evidenceType,
          mediaType: evidence.mediaType,
          contentDigest: evidence.contentDigest,
          byteSize: evidence.byteSize,
          classification: evidence.classification,
          redactions: evidence.redactions
        },
        body: evidence.body
      }, `evidence-${randomUUID2()}`);
      for (const record of result.evidenceRecords) {
        this.#projectionFault?.("before-canonical-evidence-projection");
        await this.#projections.appendEvidence({
          evidenceId: record.id,
          metadata: canonical3(record),
          body: evidence.body
        }, `canonical-evidence-${randomUUID2()}`);
      }
    }
    this.#projectionFault?.("before-run-projection");
    this.#projections.appendRun({
      invocationId: result.invocationId,
      result
    });
  }
  readRun(invocationId) {
    const id = invocationId;
    const projected = this.#projections.readRun(id)?.result;
    if (projected !== void 0) return projected;
    this.#reconcileRunProjection(id);
    return this.#projections.readRun(id)?.result;
  }
  #terminalEvent(invocationId) {
    return this.#unitOfWork.readInvocation(invocationId).find(
      (event2) => event2.eventType === "VerificationInvocationCompleted"
    );
  }
  #reconcileRunProjection(invocationId) {
    const terminal = this.#terminalEvent(invocationId);
    if (terminal === void 0) return;
    const payload = terminal.payload;
    if (payload.result === void 0) return;
    this.#projections.appendRun({
      invocationId,
      result: payload.result
    });
  }
  #reconcileRunProjections() {
    for (const invocationId of this.#unitOfWork.listInvocationIds()) {
      if (this.#projections.readRun(invocationId) === void 0) {
        this.#reconcileRunProjection(invocationId);
      }
    }
  }
  readHistoryEvents(invocationId) {
    return this.#unitOfWork.readInvocation(invocationId);
  }
  readCanonicalRevision(reference) {
    return this.#unitOfWork.readRevision(reference);
  }
  readHistoryEdges() {
    return this.#unitOfWork.readReferenceEdges();
  }
  readCurrentRevision(slot) {
    return this.#unitOfWork.readCurrentRevision(slot);
  }
  async readEvidence(evidenceId) {
    await this.#recovery;
    const id = evidenceId;
    let projection = await this.#projections.readEvidence(id);
    if (projection === void 0) {
      await this.#reconcileEvidenceProjection(id);
      projection = await this.#projections.readEvidence(id);
    }
    return projection;
  }
  async #reconcileEvidenceProjection(evidenceId) {
    for (const invocationId of this.#unitOfWork.listInvocationIds()) {
      for (const event2 of this.#unitOfWork.readInvocation(invocationId)) {
        if (event2.eventType === "EvidenceCaptured") {
          const payload = event2.payload;
          if (payload.record?.id === evidenceId && payload.body !== void 0 && payload.body !== null) {
            await this.#projections.appendEvidence({
              evidenceId,
              metadata: canonical3(payload.record),
              body: payload.body
            }, `reconcile-canonical-${randomUUID2()}`);
            return;
          }
        }
        if (event2.eventType === "VerificationInvocationCompleted") {
          const payload = event2.payload;
          const retained = payload.projectionEvidence;
          if (retained?.evidenceId === evidenceId && retained.metadata !== void 0 && retained.body !== void 0) {
            await this.#projections.appendEvidence({
              evidenceId,
              metadata: retained.metadata,
              body: retained.body
            }, `reconcile-legacy-${randomUUID2()}`);
            return;
          }
        }
      }
    }
  }
  inspectCache() {
    return {
      schemaVersion: 1,
      entries: this.#projections.listCacheMetadata()
    };
  }
  async clearCache() {
    const before = this.#projections.listCacheMetadata().length;
    await this.#cache.clear();
    this.#projections.clearCacheMetadata();
    return {
      schemaVersion: 1,
      clearedEntries: before,
      historyPreserved: true
    };
  }
  close() {
    if (this.#closed) return;
    this.#closed = true;
    clearInterval(this.#ownerHeartbeat);
    activeLocalOwnerTokens.delete(this.#ownerToken);
    rmSync2(this.#ownerHeartbeatPath(this.#ownerToken), { force: true });
    this.#unitOfWork.close();
    this.#projections.close();
  }
};

// ../../packages/engine/src/public/index.ts
var ENGINE_VERSION = "0.2.0";
var ENGINE_ARTIFACT_DIGEST = `sha256:${createHash11("sha256").update(`@verify-internal/engine@${ENGINE_VERSION}`).digest("hex")}`;
var ENGINE_PRODUCER = {
  id: "@verify-internal/engine",
  version: ENGINE_VERSION,
  artifactDigest: ENGINE_ARTIFACT_DIGEST
};
var Lifecycle = class {
  events = [];
  add(stage, status, reasonCode) {
    this.events.push({
      sequence: this.events.length + 1,
      type: `engine.${stage}.${status}`,
      stage,
      status,
      ...reasonCode === void 0 ? {} : { reasonCode }
    });
  }
};
function digest5(value) {
  return `sha256:${createHash11("sha256").update(canonicalize2(value)).digest("hex")}`;
}
function stableResultDigest(input) {
  const value = JSON.parse(JSON.stringify({
    schemaVersion: 1,
    engineVersion: ENGINE_VERSION,
    operationalStatus: input.operationalStatus,
    outcome: input.outcome,
    workspace: input.workspace,
    ...input.applicationModel === void 0 ? {} : { applicationModel: input.applicationModel },
    proofs: input.proofs.map((proof) => ({
      proofId: proof.proofId,
      promiseId: proof.promiseId,
      status: proof.status,
      reasonCodes: proof.reasonCodes,
      details: proof.details,
      resultDigest: proof.resultDigest
    })),
    promises: input.promises.map((promise) => ({
      promise: promise.promise,
      status: promise.status,
      reasonCodes: promise.reasonCodes
    })),
    repairs: input.repairs.map((repair) => ({
      revision: repair.revision,
      motivatingPromise: repair.motivatingPromise,
      motivatingProof: repair.motivatingProof,
      action: repair.action,
      expectedEffect: repair.expectedEffect,
      verificationPlan: repair.verificationPlan
    })),
    reasonCodes: [...input.reasonCodes].sort(),
    diagnostics: input.diagnostics
  }));
  return digest5(value);
}
function cacheKey(discovery, modelRevision, evidence) {
  return digest5({
    domain: "verification-platform/evaluation-cache",
    schemaVersion: 1,
    engineVersion: ENGINE_VERSION,
    modelRevision,
    evidenceContentDigest: evidence.contentDigest,
    proofRevisions: MVP_PROOF_REGISTRY.map((proof) => proof.revision),
    executionPolicy: "passive-offline-v1"
  });
}
function terminalResult(invocationId, lifecycle, input) {
  const workspace = input.workspace ?? {};
  const proofs = input.proofs ?? [];
  const repairs = input.repairs ?? [];
  const promises = input.promises ?? [];
  const reasonCodes = [...input.reasonCodes ?? []].sort();
  const diagnostics = input.diagnostics ?? [];
  const summary = input.summary ?? {
    requiredPromiseCount: proofs.length,
    advisoryPromiseCount: 0,
    satisfiedCount: proofs.filter((proof) => proof.status === "passed").length,
    violatedCount: proofs.filter((proof) => proof.status === "failed").length,
    indeterminateCount: proofs.filter((proof) => proof.status !== "passed" && proof.status !== "failed").length
  };
  return {
    kind: "verify",
    schemaVersion: 1,
    engineVersion: ENGINE_VERSION,
    invocationId,
    operationalStatus: input.operationalStatus,
    outcome: input.outcome,
    workspace,
    ...input.applicationModel === void 0 ? {} : { applicationModel: input.applicationModel },
    summary,
    promises,
    proofExecutions: [],
    proofs,
    evidenceRecords: [],
    evidence: input.evidence ?? [],
    repairRecords: [],
    repairs,
    executionManifests: [],
    revisionDocuments: [],
    reasonCodes,
    diagnostics,
    cache: input.cache ?? { status: "bypass" },
    events: lifecycle.events,
    resultDigest: stableResultDigest({
      operationalStatus: input.operationalStatus,
      outcome: input.outcome,
      workspace,
      ...input.applicationModel === void 0 ? {} : { applicationModel: input.applicationModel },
      proofs,
      promises,
      repairs,
      reasonCodes,
      diagnostics
    })
  };
}
function evidenceProjection(evidence, validation) {
  return [{
    id: evidence.id,
    revision: evidence.revision,
    evidenceType: evidence.evidenceType,
    classification: evidence.classification,
    byteSize: evidence.byteSize,
    validation
  }];
}
function revisionRef(document2) {
  return {
    kind: document2.kind,
    id: document2.id,
    revision: document2.revision,
    schemaVersion: document2.schemaVersion
  };
}
function revisionDocument2(kind, id, payload) {
  return {
    kind,
    id,
    revision: digest5({
      domain: "verification-platform/revision",
      id,
      kind,
      payload,
      schemaVersion: 1
    }),
    schemaVersion: 1,
    payload
  };
}
function discoveryDocuments(discovery) {
  return [
    ...discovery.signals.map(
      (signal) => revisionDocument2(
        "discoverySignal",
        `signal:${signal.id.slice("sha256:".length)}`,
        JSON.parse(JSON.stringify({
          readerId: signal.readerId,
          inputPath: signal.inputPath,
          pointer: signal.pointer,
          kind: signal.kind,
          value: signal.value
        }))
      )
    ),
    ...discovery.facts.map(
      (fact) => revisionDocument2(
        "discoveryFact",
        `fact:${fact.id.slice("sha256:".length)}`,
        JSON.parse(JSON.stringify({
          readerId: fact.readerId,
          inputPath: fact.inputPath,
          pointer: fact.pointer,
          kind: fact.kind,
          value: fact.value
        }))
      )
    )
  ];
}
function scaffoldEvaluations() {
  return MVP_PROOF_REGISTRY.map((proof) => ({
    proofId: proof.proofId,
    promiseId: proof.promiseId,
    status: "indeterminate",
    reasonCodes: ["EXECUTION_PENDING"],
    evidence: [],
    details: [],
    resultDigest: digest5({
      domain: "verification-platform/pending-proof-scaffold",
      proofId: proof.proofId,
      revision: proof.revision
    })
  }));
}
function edgesForDocuments(documents, availableDocuments = documents) {
  const available = new Set(availableDocuments.map(
    (document2) => `${document2.kind}\0${document2.id}\0${document2.revision}\0${document2.schemaVersion}`
  ));
  const edges = [];
  const add = (source, relation, target) => {
    const targetKey = `${target.kind}\0${target.id}\0${target.revision}\0${target.schemaVersion}`;
    if (available.has(targetKey)) edges.push({ source, relation, target });
  };
  for (const document2 of documents) {
    const source = revisionRef(document2);
    const payload = document2.payload;
    for (const [field, value] of Object.entries(payload)) {
      if (typeof value === "object" && value !== null && !Array.isArray(value) && "kind" in value && "id" in value && "revision" in value && "schemaVersion" in value) {
        add(source, field, value);
      } else if (Array.isArray(value)) {
        for (const candidate of value) {
          if (typeof candidate === "object" && candidate !== null && "kind" in candidate && "id" in candidate && "revision" in candidate && "schemaVersion" in candidate) {
            add(source, field, candidate);
          }
        }
      }
    }
  }
  return edges;
}
function selectedDocuments(records, predicate) {
  return records.revisionDocuments.filter(predicate);
}
function event(eventType, payload, subject, dataClassification = "MINIMAL_METADATA") {
  return {
    eventType,
    ...subject === void 0 ? {} : { subject },
    dataClassification,
    payload: JSON.parse(JSON.stringify(payload))
  };
}
var VerificationEngine = class {
  #ports;
  constructor(ports = {}) {
    this.#ports = ports;
  }
  async verify(request) {
    const invocationId = request.invocationId ?? this.#ports.createInvocationId?.() ?? `invocation:${randomUUID3()}`;
    const lifecycle = new Lifecycle();
    const occurredAt = (this.#ports.now?.() ?? /* @__PURE__ */ new Date()).toISOString();
    await this.#ports.history?.admit?.(invocationId, request.workspaceRoot);
    const principal = request.principal ?? {
      kind: "local-user",
      id: `local:${typeof process.getuid === "function" ? process.getuid() : "user"}`,
      authenticated: true
    };
    const policy = request.authorityPolicy ?? passiveCliPolicy(principal, request.workspaceRoot);
    lifecycle.add("preflight", "started");
    const decision = authorize(principal, {
      operation: "verify",
      workspaceRoot: request.workspaceRoot,
      permissions: ["workspace.read"]
    }, policy);
    if (!decision.allowed) {
      lifecycle.add("preflight", "failed", decision.reasonCode);
      await this.#ports.history?.checkpoint?.({
        unit: "01-discovery-plan",
        invocationId,
        occurredAt,
        revisions: [],
        events: [event("DiscoveryPlanAuthorizationDenied", {
          operation: "verify",
          permission: "workspace.read",
          reasonCode: decision.reasonCode
        })],
        referenceEdges: []
      });
      lifecycle.add("report", "completed");
      const result2 = terminalResult(invocationId, lifecycle, {
        operationalStatus: "blocked",
        outcome: "indeterminate",
        reasonCodes: [decision.reasonCode],
        diagnostics: [{ code: decision.reasonCode, message: "Verification was not authorized for this workspace." }]
      });
      await this.#ports.history?.append(result2, void 0);
      return result2;
    }
    lifecycle.add("preflight", "completed");
    lifecycle.add("discovery_plan", "started");
    const controller2 = new AbortController();
    const abortFromCaller = () => controller2.abort(request.signal?.reason);
    if (request.signal?.aborted) abortFromCaller();
    else request.signal?.addEventListener("abort", abortFromCaller, { once: true });
    const deadlineMs = request.deadlineMs ?? 3e4;
    const deadline = setTimeout(() => controller2.abort(), Math.max(1, deadlineMs));
    deadline.unref();
    const clearCancellation = () => {
      clearTimeout(deadline);
      request.signal?.removeEventListener("abort", abortFromCaller);
    };
    lifecycle.add("discovery_plan", "completed");
    await this.#ports.history?.checkpoint?.({
      unit: "01-discovery-plan",
      invocationId,
      occurredAt,
      revisions: [],
      events: [event("DiscoveryPlanAuthorized", {
        operation: "verify",
        permissions: {
          filesystem: "read-only-workspace",
          network: false,
          process: false,
          write: false
        },
        deadlineMs
      })],
      referenceEdges: []
    });
    let discovery;
    try {
      lifecycle.add("discover", "started");
      discovery = await discoverWorkspace(request.workspaceRoot, {
        ...request.discoveryLimits === void 0 ? {} : { limits: request.discoveryLimits },
        signal: controller2.signal
      });
      lifecycle.add("discover", "completed");
    } catch (error) {
      clearCancellation();
      lifecycle.add("discover", "failed", "DISCOVERY_ERROR");
      await this.#ports.history?.checkpoint?.({
        unit: "02-discovery",
        invocationId,
        occurredAt,
        revisions: [],
        events: [event("DiscoveryFailed", {
          reasonCode: "DISCOVERY_ERROR"
        })],
        referenceEdges: []
      });
      lifecycle.add("report", "completed");
      const message = error instanceof Error ? error.message : "Unknown discovery error";
      const result2 = terminalResult(invocationId, lifecycle, {
        operationalStatus: error instanceof TypeError ? "invalid" : "internal_error",
        outcome: "indeterminate",
        reasonCodes: ["DISCOVERY_ERROR"],
        diagnostics: [{ code: "DISCOVERY_ERROR", message }]
      });
      await this.#ports.history?.append(result2, void 0);
      return result2;
    }
    const discoveredDocuments = discoveryDocuments(discovery);
    await this.#ports.history?.checkpoint?.({
      unit: "02-discovery",
      invocationId,
      occurredAt,
      revisions: discoveredDocuments,
      events: [event("DiscoveryCompleted", {
        completion: discovery.completion,
        inspectedFiles: discovery.inspectedFiles,
        inspectedBytes: discovery.inspectedBytes,
        signals: discoveredDocuments.filter((document2) => document2.kind === "discoverySignal").map(revisionRef),
        facts: discoveredDocuments.filter((document2) => document2.kind === "discoveryFact").map(revisionRef)
      }, void 0, "LOCAL_SOURCE")],
      referenceEdges: []
    });
    lifecycle.add("resolve", "started");
    const supported = discovery.packageManagers.length > 0;
    const modelResolution = await resolveAndSealWorkspaceModel(
      discovery,
      MVP_PROOF_REGISTRY
    );
    lifecycle.add("resolve", "completed");
    const sealedModel = modelResolution.status === "sealed" ? modelResolution.graph.model : void 0;
    const effectiveModelRevision = sealedModel?.revision ?? discovery.modelRevision;
    const workspace = {
      binding: discovery.workspaceBinding,
      ...discovery.selectedPackageManager ? { packageManager: discovery.selectedPackageManager } : {},
      modelRevision: effectiveModelRevision
    };
    const applicationModel = {
      kind: "applicationModel",
      id: sealedModel?.id ?? `model:${discovery.workspaceBinding.slice("sha256:".length)}`,
      revision: effectiveModelRevision,
      schemaVersion: 1
    };
    const sealedGraph = modelResolution.status === "sealed" ? modelResolution.graph : void 0;
    const modelDocuments = sealedGraph === void 0 ? [] : [
      ...sealedGraph.applications.map(
        (value) => revisionDocument2(
          "application",
          value.id,
          JSON.parse(JSON.stringify(
            Object.fromEntries(
              Object.entries(value).filter(
                ([key2]) => !["id", "revision", "schemaVersion"].includes(key2)
              )
            )
          ))
        )
      ),
      ...sealedGraph.capabilities.map(
        (value) => revisionDocument2(
          "capability",
          value.id,
          JSON.parse(JSON.stringify(
            Object.fromEntries(
              Object.entries(value).filter(
                ([key2]) => !["id", "revision", "schemaVersion"].includes(key2)
              )
            )
          ))
        )
      ),
      ...sealedGraph.promises.map(
        (value) => revisionDocument2(
          "promise",
          value.id,
          JSON.parse(JSON.stringify(
            Object.fromEntries(
              Object.entries(value).filter(
                ([key2]) => !["id", "revision", "schemaVersion"].includes(key2)
              )
            )
          ))
        )
      ),
      ...sealedGraph.proofs.map(
        (value) => revisionDocument2(
          "proof",
          value.id,
          JSON.parse(JSON.stringify(
            Object.fromEntries(
              Object.entries(value).filter(
                ([key2]) => !["id", "revision", "schemaVersion"].includes(key2)
              )
            )
          ))
        )
      ),
      ...sealedGraph.bindings.map(
        (value) => revisionDocument2(
          "promiseProofBinding",
          value.id,
          JSON.parse(JSON.stringify(
            Object.fromEntries(
              Object.entries(value).filter(
                ([key2]) => !["id", "revision", "schemaVersion"].includes(key2)
              )
            )
          ))
        )
      ),
      revisionDocument2(
        "applicationModel",
        sealedGraph.model.id,
        JSON.parse(JSON.stringify(
          Object.fromEntries(
            Object.entries(sealedGraph.model).filter(
              ([key2]) => !["id", "revision", "schemaVersion"].includes(key2)
            )
          )
        ))
      )
    ];
    if (sealedGraph !== void 0 && modelDocuments.some(
      (document2, index) => document2.revision !== [
        ...sealedGraph.applications,
        ...sealedGraph.capabilities,
        ...sealedGraph.promises,
        ...sealedGraph.proofs,
        ...sealedGraph.bindings,
        sealedGraph.model
      ][index]?.revision
    )) {
      throw new TypeError("canonical model checkpoint revision drift");
    }
    const modelRef = sealedGraph === void 0 ? void 0 : {
      kind: "applicationModel",
      id: sealedGraph.model.id,
      revision: sealedGraph.model.revision,
      schemaVersion: sealedGraph.model.schemaVersion
    };
    await this.#ports.history?.checkpoint?.({
      unit: "03-model-seal",
      invocationId,
      occurredAt,
      revisions: modelDocuments,
      events: [event(
        sealedGraph === void 0 ? "ApplicationModelNotSealed" : "ApplicationModelSealed",
        sealedGraph === void 0 ? { status: modelResolution.status, diagnostics: modelResolution.diagnostics } : { applicationModel: modelRef },
        modelRef
      )],
      referenceEdges: edgesForDocuments(modelDocuments),
      ...modelRef === void 0 ? {} : {
        currentRevision: {
          slot: `current-model:${discovery.workspaceBinding}`,
          next: modelRef
        }
      }
    });
    if (discovery.completion === "cancelled") {
      clearCancellation();
      lifecycle.add("seal", "skipped", "CANCELLED");
      lifecycle.add("plan", "skipped", "CANCELLED");
      lifecycle.add("authorize", "skipped", "CANCELLED");
      lifecycle.add("execute", "skipped", "CANCELLED");
      lifecycle.add("capture", "skipped", "CANCELLED");
      lifecycle.add("evaluate", "skipped", "CANCELLED");
      lifecycle.add("repair", "skipped", "CANCELLED");
      lifecycle.add("report", "completed");
      const result2 = terminalResult(invocationId, lifecycle, {
        operationalStatus: "cancelled",
        outcome: "indeterminate",
        workspace,
        applicationModel,
        reasonCodes: ["CANCELLED"]
      });
      await this.#ports.history?.append(result2, void 0);
      return result2;
    }
    lifecycle.add("seal", "started");
    lifecycle.add("seal", "completed");
    const evidence = normalizeWorkspaceEvidence({
      workspaceBinding: discovery.workspaceBinding,
      evidenceType: "workspace.manifest-observations",
      mediaType: "application/vnd.verify.workspace-observations+json",
      observations: discovery.manifests,
      lockfiles: discovery.lockfiles,
      packageManagers: discovery.packageManagers,
      completion: discovery.completion,
      diagnostics: discovery.diagnostics
    });
    const validation = validateEvidence(evidence);
    const key = cacheKey(discovery, effectiveModelRevision, evidence);
    const cached = validation.state === "valid" && discovery.completion === "complete" && sealedGraph !== void 0 ? await this.#ports.cache?.get(key) : void 0;
    const cacheStatus = cached !== void 0 && cached.evidenceRevision === evidence.revision ? "hit" : this.#ports.cache === void 0 ? "bypass" : "miss";
    const scaffold = sealedGraph === void 0 ? void 0 : buildCanonicalRuntimeRecords({
      invocationId,
      occurredAt,
      graph: sealedGraph,
      discovery,
      evidence,
      evaluations: scaffoldEvaluations(),
      repairs: [],
      engine: ENGINE_PRODUCER,
      ...cacheStatus === "hit" && cached?.provenance !== void 0 ? { cachedProvenance: cached.provenance } : {}
    });
    const executionScaffold = validation.state === "valid" && discovery.completion === "complete" ? scaffold : void 0;
    lifecycle.add("plan", "started");
    lifecycle.add("plan", "completed");
    lifecycle.add("authorize", "started");
    lifecycle.add("authorize", "completed");
    const planDocuments = scaffold === void 0 ? [] : selectedDocuments(
      scaffold,
      (document2) => document2.kind === "executionContext" || document2.kind === "executionPlan" && document2.id === scaffold.executionPlan?.id
    );
    const planRef = planDocuments.find(
      (document2) => document2.kind === "executionPlan"
    );
    await this.#ports.history?.checkpoint?.({
      unit: "04-execution-plan",
      invocationId,
      occurredAt,
      revisions: planDocuments,
      events: [event(
        planRef === void 0 ? "ExecutionPlanNotCreated" : "ExecutionPlanAuthorized",
        planRef === void 0 ? { reasonCode: "MODEL_NOT_SEALED" } : {
          executionPlan: revisionRef(planRef),
          permissions: "passive-offline-v1"
        },
        planRef === void 0 ? void 0 : revisionRef(planRef)
      )],
      referenceEdges: edgesForDocuments(
        planDocuments,
        [...modelDocuments, ...planDocuments]
      )
    });
    const manifestDocuments = executionScaffold === void 0 ? [] : selectedDocuments(
      executionScaffold,
      (document2) => document2.kind === "executionManifest"
    );
    await this.#ports.history?.checkpoint?.({
      unit: "05-attempt-start",
      invocationId,
      occurredAt,
      revisions: manifestDocuments,
      events: executionScaffold === void 0 ? [event("ProofAttemptsNotStarted", {
        reasonCode: "EXECUTION_PLAN_UNAVAILABLE"
      })] : executionScaffold.proofExecutions.map(
        (execution) => event(
          "ProofExecutionStarted",
          {
            attempt: execution.attemptRef,
            planKey: execution.planKey,
            executionManifest: execution.executionManifest
          },
          execution.executionManifest
        )
      ),
      referenceEdges: edgesForDocuments(
        manifestDocuments,
        [...modelDocuments, ...planDocuments, ...manifestDocuments]
      )
    });
    lifecycle.add("execute", "started");
    lifecycle.add("execute", "completed");
    lifecycle.add("capture", "started");
    lifecycle.add(
      "capture",
      validation.state === "valid" ? "completed" : "failed",
      validation.state === "valid" ? void 0 : "EVIDENCE_REJECTED"
    );
    const evidenceDocuments = executionScaffold === void 0 ? [] : selectedDocuments(
      executionScaffold,
      (document2) => document2.kind === "evidence" && executionScaffold.evidenceRecords.some(
        (record) => record.id === document2.id && record.attempt.invocationId === invocationId
      )
    );
    const captureEdges = [];
    if (executionScaffold !== void 0) {
      for (const execution of executionScaffold.proofExecutions) {
        for (const evidenceRef of execution.evidence) {
          captureEdges.push({
            source: execution.executionManifest,
            relation: `attempt:${execution.attemptId}:evidence`,
            target: evidenceRef
          });
          captureEdges.push({
            source: evidenceRef,
            relation: `captured-for:${execution.attemptId}`,
            target: execution.proof
          });
        }
      }
    }
    await this.#ports.history?.checkpoint?.({
      unit: "06-evidence-capture",
      invocationId,
      occurredAt,
      revisions: evidenceDocuments,
      events: executionScaffold === void 0 ? [event("EvidenceCaptureUnavailable", {
        reasonCode: "NO_PROOF_ATTEMPTS"
      })] : executionScaffold.evidenceRecords.map(
        (record) => record.attempt.invocationId === invocationId ? event(
          "EvidenceCaptured",
          { record, body: evidence.body },
          {
            kind: "evidence",
            id: record.id,
            revision: record.revision,
            schemaVersion: record.schemaVersion
          },
          "LOCAL_SOURCE"
        ) : event(
          "EvidenceReused",
          {
            evidence: {
              kind: "evidence",
              id: record.id,
              revision: record.revision,
              schemaVersion: record.schemaVersion
            },
            originatingAttempt: record.attempt
          },
          {
            kind: "evidence",
            id: record.id,
            revision: record.revision,
            schemaVersion: record.schemaVersion
          }
        )
      ),
      referenceEdges: captureEdges
    });
    await this.#ports.history?.checkpoint?.({
      unit: "07-evidence-validation",
      invocationId,
      occurredAt,
      revisions: [],
      events: executionScaffold === void 0 ? [event(
        validation.state === "valid" ? "EvidenceValidationUnavailable" : "EvidenceRejected",
        {
          state: validation.state,
          reasonCodes: validation.reasonCodes
        }
      )] : executionScaffold.evidenceRecords.map(
        (record, index) => record.attempt.invocationId === invocationId ? event(
          validation.state === "valid" ? "EvidenceValidated" : "EvidenceRejected",
          {
            state: validation.state,
            reasonCodes: validation.reasonCodes,
            evidenceRevision: record.revision
          },
          {
            kind: "evidence",
            id: record.id,
            revision: record.revision,
            schemaVersion: record.schemaVersion
          }
        ) : event(
          "EvidenceValidationReused",
          {
            evidenceRevision: record.revision,
            validationEventId: cached?.provenance?.validationEventIds[index] ?? null
          },
          {
            kind: "evidence",
            id: record.id,
            revision: record.revision,
            schemaVersion: record.schemaVersion
          }
        )
      ),
      referenceEdges: []
    });
    if (validation.state !== "valid") {
      clearCancellation();
      lifecycle.add("evaluate", "skipped", "EVIDENCE_REJECTED");
      lifecycle.add("repair", "skipped", "EVIDENCE_REJECTED");
      lifecycle.add("report", "completed");
      const result2 = terminalResult(invocationId, lifecycle, {
        operationalStatus: "blocked",
        outcome: "indeterminate",
        workspace,
        applicationModel,
        evidence: evidenceProjection(evidence, "rejected"),
        reasonCodes: ["EVIDENCE_REJECTED", ...validation.reasonCodes]
      });
      await this.#ports.history?.append(result2, evidence);
      return result2;
    }
    if (discovery.completion === "bounded") {
      clearCancellation();
      lifecycle.add("evaluate", "skipped", "DISCOVERY_BOUNDED");
      lifecycle.add("repair", "skipped", "DISCOVERY_BOUNDED");
      lifecycle.add("report", "completed");
      const result2 = terminalResult(invocationId, lifecycle, {
        operationalStatus: "completed",
        outcome: "indeterminate",
        workspace,
        applicationModel,
        evidence: evidenceProjection(evidence, "valid"),
        reasonCodes: ["DISCOVERY_BOUNDED"]
      });
      await this.#ports.history?.append(result2, evidence);
      return result2;
    }
    let proofSuite;
    let cacheCandidate;
    lifecycle.add("evaluate", "started");
    if (cacheStatus === "hit" && cached !== void 0 && cached.evidenceRevision === evidence.revision) {
      proofSuite = cached.proofSuite;
    } else {
      proofSuite = evaluateWorkspaceProofs({
        supported,
        manifests: discovery.manifests,
        lockfiles: discovery.lockfiles,
        packageManagers: discovery.packageManagers,
        conflicts: discovery.conflicts,
        diagnostics: discovery.diagnostics,
        validatedEvidence: [evidence.revision]
      });
      if (this.#ports.cache) {
        cacheCandidate = {
          proofSuite,
          evidenceRevision: evidence.revision
        };
      }
    }
    lifecycle.add("evaluate", "completed");
    const evaluatedRecords = sealedGraph === void 0 ? void 0 : buildCanonicalRuntimeRecords({
      invocationId,
      occurredAt,
      graph: sealedGraph,
      discovery,
      evidence,
      evaluations: proofSuite.evaluations,
      repairs: [],
      engine: ENGINE_PRODUCER,
      ...cacheStatus === "hit" && cached?.provenance !== void 0 ? { cachedProvenance: cached.provenance } : {}
    });
    await this.#ports.history?.checkpoint?.({
      unit: "08-proof-terminal",
      invocationId,
      occurredAt,
      revisions: [],
      events: evaluatedRecords === void 0 ? [event("ProofEvaluationUnavailable", {
        reasonCodes: proofSuite.reasonCodes
      })] : evaluatedRecords.proofExecutions.map(
        (execution) => event(
          "ProofExecutionCompleted",
          execution,
          execution.executionManifest
        )
      ),
      referenceEdges: []
    });
    await this.#ports.history?.checkpoint?.({
      unit: "09-promise-aggregation",
      invocationId,
      occurredAt,
      revisions: [],
      events: [event("PromisesAggregated", {
        promises: evaluatedRecords?.promises ?? [],
        outcome: evaluatedRecords?.outcome ?? proofSuite.outcome,
        summary: evaluatedRecords?.summary ?? null
      })],
      referenceEdges: evaluatedRecords === void 0 ? [] : evaluatedRecords.proofExecutions.flatMap((execution) => [
        {
          source: execution.promise,
          relation: "aggregation:effective-proof",
          target: execution.proof
        },
        ...execution.evidence.map((evidenceRef) => ({
          source: execution.promise,
          relation: "aggregation:evidence",
          target: evidenceRef
        }))
      ])
    });
    lifecycle.add("repair", "started");
    const repairs = suggestRepairs(proofSuite.evaluations, effectiveModelRevision);
    lifecycle.add("repair", "completed");
    lifecycle.add("report", "completed");
    clearCancellation();
    const diagnostics = discovery.diagnostics.map((item) => ({
      code: item.code,
      message: item.message,
      ...item.path === void 0 ? {} : { path: item.path }
    }));
    const records = sealedModel === void 0 ? void 0 : buildCanonicalRuntimeRecords({
      invocationId,
      occurredAt,
      graph: modelResolution.status === "sealed" ? modelResolution.graph : (() => {
        throw new TypeError("sealed model graph disappeared");
      })(),
      discovery,
      evidence,
      evaluations: proofSuite.evaluations,
      repairs,
      engine: ENGINE_PRODUCER,
      ...cacheStatus === "hit" && cached?.provenance !== void 0 ? { cachedProvenance: cached.provenance } : {}
    });
    const priorDocumentKeys = new Set(
      evaluatedRecords?.revisionDocuments.map(
        (document2) => `${document2.kind}\0${document2.id}\0${document2.revision}\0${document2.schemaVersion}`
      ) ?? []
    );
    const repairDocuments = records === void 0 ? [] : records.revisionDocuments.filter(
      (document2) => !priorDocumentKeys.has(
        `${document2.kind}\0${document2.id}\0${document2.revision}\0${document2.schemaVersion}`
      )
    );
    await this.#ports.history?.checkpoint?.({
      unit: "10-repair-proposal",
      invocationId,
      occurredAt,
      revisions: repairDocuments,
      events: records === void 0 || records.repairRecords.length === 0 ? [event("RepairsNotProposed", { count: 0 })] : records.repairRecords.map(
        (repair) => event(
          "RepairProposed",
          repair,
          {
            kind: "repair",
            id: repair.id,
            revision: repair.revision,
            schemaVersion: repair.schemaVersion
          }
        )
      ),
      referenceEdges: edgesForDocuments(
        repairDocuments,
        records?.revisionDocuments ?? repairDocuments
      )
    });
    const legacyResult = terminalResult(invocationId, lifecycle, {
      operationalStatus: "completed",
      outcome: records?.outcome ?? proofSuite.outcome,
      workspace,
      applicationModel,
      proofs: proofSuite.evaluations,
      ...records === void 0 ? {} : { promises: records.promises, summary: records.summary },
      evidence: evidenceProjection(evidence, "valid"),
      repairs,
      reasonCodes: proofSuite.reasonCodes,
      diagnostics,
      cache: { key, status: cacheStatus }
    });
    const result = records === void 0 ? legacyResult : {
      ...legacyResult,
      proofExecutions: records.proofExecutions,
      evidenceRecords: records.evidenceRecords,
      repairRecords: records.repairRecords,
      executionManifests: records.executionManifests,
      revisionDocuments: records.revisionDocuments,
      ...records.executionPlan === void 0 ? {} : { executionPlan: records.executionPlan },
      ...records.executionContext === void 0 ? {} : { executionContext: records.executionContext }
    };
    await this.#ports.history?.append(result, evidence);
    if (cacheCandidate !== void 0) {
      const canonicalModel = result.applicationModel === void 0 ? void 0 : {
        kind: "applicationModel",
        id: result.applicationModel.id,
        revision: result.applicationModel.revision,
        schemaVersion: result.applicationModel.schemaVersion
      };
      await this.#ports.cache?.publish(
        key,
        canonicalModel === void 0 ? cacheCandidate : {
          ...cacheCandidate,
          provenance: {
            originatingInvocationId: result.invocationId,
            model: canonicalModel,
            proofs: result.proofExecutions.map(
              (execution) => execution.proof
            ),
            proofExecutions: result.proofExecutions,
            evidenceRecords: result.evidenceRecords,
            validationEventIds: []
          }
        }
      );
    }
    return result;
  }
};

// ../../packages/adapter-core/src/public/protocol-bridge.ts
function diagnosticCode(code) {
  let normalized = "";
  let separatorPending = false;
  for (const character of code.toUpperCase().slice(0, 256)) {
    const codePoint = character.charCodeAt(0);
    const allowed = codePoint >= 65 && codePoint <= 90 || codePoint >= 48 && codePoint <= 57;
    if (allowed) {
      if (separatorPending && normalized.length > 0) normalized += "_";
      normalized += character;
      separatorPending = false;
    } else if (normalized.length > 0) {
      separatorPending = true;
    }
  }
  return `VFY_ENGINE_${normalized || "DIAGNOSTIC"}`;
}
function diagnosticsFor(result) {
  const category = result.operationalStatus === "invalid" ? "invalid" : result.operationalStatus === "internal_error" ? "internal" : "environment";
  return result.diagnostics.map((diagnostic) => ({
    code: diagnosticCode(diagnostic.code),
    category,
    retryability: "never",
    message: diagnostic.message,
    component: "@verify-internal/engine",
    operation: "verify",
    blocksRequiredProof: result.operationalStatus !== "completed",
    causes: [],
    diagnosticRefs: [],
    ...diagnostic.path === void 0 ? {} : { details: { path: diagnostic.path } }
  }));
}
function verifyProtocolResult(result, workspaceBinding) {
  if (result.applicationModel === void 0) return null;
  if (result.operationalStatus !== "completed" && result.operationalStatus !== "blocked") {
    return null;
  }
  const enriched = result;
  const promises = Array.isArray(enriched.promises) ? enriched.promises : [];
  const proofExecutions = Array.isArray(enriched.proofExecutions) ? enriched.proofExecutions : [];
  const evidenceRecords = Array.isArray(enriched.evidenceRecords) ? enriched.evidenceRecords : void 0;
  const repairRecords = Array.isArray(enriched.repairRecords) ? enriched.repairRecords : void 0;
  const executionManifests = Array.isArray(enriched.executionManifests) ? enriched.executionManifests : [];
  const evidenceRefs = evidenceRecords === void 0 ? result.evidence.map((evidence) => ({
    kind: "evidence",
    id: evidence.id,
    revision: evidence.revision,
    schemaVersion: 1
  })) : evidenceRecords.map((evidence) => ({
    kind: "evidence",
    id: evidence.id,
    revision: evidence.revision,
    schemaVersion: evidence.schemaVersion
  }));
  const binding = workspaceBinding ?? result.workspace.binding;
  const workspace = binding === void 0 || result.workspace.modelRevision === void 0 ? void 0 : {
    rootBinding: binding,
    ...result.workspace.packageManager === void 0 ? {} : { packageManager: result.workspace.packageManager },
    modelRevision: result.workspace.modelRevision
  };
  return {
    kind: "verify",
    outcome: result.outcome,
    ...result.operationalStatus === "blocked" ? { partial: true } : {},
    ...workspace === void 0 ? {} : { workspace },
    reasonCodes: result.reasonCodes,
    applicationModel: result.applicationModel,
    summary: result.summary,
    promises,
    proofExecutions,
    evidence: evidenceRefs,
    ...evidenceRecords === void 0 ? {} : { evidenceRecords },
    repairs: (repairRecords ?? result.repairs).map((repair) => ({
      kind: "repair",
      id: repair.id,
      revision: repair.revision,
      schemaVersion: repair.schemaVersion
    })),
    ...repairRecords === void 0 ? {} : { repairRecords },
    executionManifests,
    cacheDecisions: [result.cache]
  };
}
function toProtocolEnvelope(result, clock) {
  return {
    schemaVersion: 1,
    command: "verify",
    invocationId: result.invocationId,
    engine: {
      version: result.engineVersion,
      artifactDigest: ENGINE_ARTIFACT_DIGEST
    },
    operationalStatus: result.operationalStatus,
    startedAt: clock.startedAt,
    durationMs: clock.durationMs,
    result: verifyProtocolResult(result, clock.workspaceBinding),
    diagnostics: diagnosticsFor(result)
  };
}

// ../../packages/adapter-core/src/public/dispatcher.ts
var MAX_DEADLINE_MS = 60 * 60 * 1e3;
var MAX_EVENTS = 256;
var MAX_PROVENANCE_OBJECTS = 128;
var MAX_READ_BYTES = 4 * 1024 * 1024;
var LocalAdapterError = class extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.name = "LocalAdapterError";
    this.code = code;
  }
};
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function boundedIdentity(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.length > 256 || /[\u0000-\u001f\u007f]/.test(value)) throw new LocalAdapterError(
    "VFY_ADAPTER_INVALID_REQUEST",
    `${label} must be a bounded opaque identifier`
  );
  return value;
}
function assertDeadline(value) {
  if (value === void 0) return void 0;
  if (!Number.isSafeInteger(value) || Number(value) <= 0 || Number(value) > MAX_DEADLINE_MS) {
    throw new LocalAdapterError(
      "VFY_ADAPTER_INVALID_REQUEST",
      `deadlineMs must be between 1 and ${MAX_DEADLINE_MS}`
    );
  }
  return Number(value);
}
function refKey3(reference) {
  return canonicalize(reference);
}
function referenceForDocument(document2) {
  return {
    kind: document2.kind,
    id: document2.id,
    revision: document2.revision,
    schemaVersion: document2.schemaVersion
  };
}
function assertReference(value) {
  if (!isRecord(value)) {
    throw new LocalAdapterError("VFY_ADAPTER_INVALID_REQUEST", "reference must be exact");
  }
  const keys = Object.keys(value).sort();
  if (canonicalize(keys) !== canonicalize(["id", "kind", "revision", "schemaVersion"]) || typeof value.kind !== "string" || typeof value.id !== "string" || typeof value.revision !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value.revision) || !Number.isSafeInteger(value.schemaVersion) || Number(value.schemaVersion) <= 0) throw new LocalAdapterError("VFY_ADAPTER_INVALID_REQUEST", "reference must be exact");
  boundedIdentity(value.kind, "reference kind");
  boundedIdentity(value.id, "reference id");
  return value;
}
function assertRetainedResult(value) {
  if (!isRecord(value) || value.kind !== "verify" || value.schemaVersion !== 1 || typeof value.engineVersion !== "string" || typeof value.invocationId !== "string" || !Array.isArray(value.events)) throw new LocalAdapterError(
    "VFY_ADAPTER_INVALID_REQUEST",
    "retained run is incompatible with the current adapter"
  );
  return value;
}
function assertReadSize(value) {
  const normalized = JSON.parse(JSON.stringify(value));
  if (Buffer.byteLength(canonicalize(normalized)) > MAX_READ_BYTES) {
    throw new LocalAdapterError(
      "VFY_ADAPTER_RESPONSE_OVERSIZED",
      "retained resource exceeds the local adapter response limit"
    );
  }
  return normalized;
}
function defaultStateRoot(workspaceRoot) {
  return resolve(workspaceRoot, ".verify", "state");
}
var LocalCanonicalDispatcher = class {
  #workspace;
  #runtime;
  #platform;
  #now;
  #nowIso;
  #createInvocationId;
  constructor(options) {
    const id = boundedIdentity(options.workspace.id, "workspace binding");
    const root = resolve(options.workspace.root);
    this.#workspace = { id, root };
    this.#runtime = options.runtime ?? new LocalVerificationRuntime(options.stateRoot ?? defaultStateRoot(root));
    this.#platform = options.platform ?? process.platform;
    this.#now = options.now ?? (() => Date.now());
    this.#nowIso = options.nowIso ?? (() => (/* @__PURE__ */ new Date()).toISOString());
    this.#createInvocationId = options.createInvocationId ?? (() => `invocation:${randomUUID4()}`);
  }
  #assertBinding(value) {
    const candidate = boundedIdentity(value, "workspaceBinding");
    if (candidate !== this.#workspace.id) {
      throw new LocalAdapterError(
        "VFY_ADAPTER_BINDING_DENIED",
        "workspace binding is not authorized by this local server"
      );
    }
  }
  async verify(argumentsValue, signal, onProgress) {
    this.#assertBinding(argumentsValue.workspaceBinding);
    if (argumentsValue.offline !== true || typeof argumentsValue.noCache !== "boolean") {
      throw new LocalAdapterError(
        "VFY_ADAPTER_INVALID_REQUEST",
        "local verification requires explicit offline and noCache booleans"
      );
    }
    const deadlineMs = assertDeadline(argumentsValue.deadlineMs);
    const invocationId = boundedIdentity(this.#createInvocationId(), "invocationId");
    const request = {
      schemaVersion: 1,
      command: "verify",
      invocationId,
      arguments: { noCache: argumentsValue.noCache },
      configurationReferences: [],
      policyReferences: [],
      consentGrantReferences: [],
      offline: true,
      ...deadlineMs === void 0 ? {} : { deadlineMs },
      outputMode: "json",
      environment: {
        platform: this.#platform,
        allowlistedBindings: [this.#workspace.id]
      },
      workspace: { rootBinding: this.#workspace.id }
    };
    const startedAt = this.#nowIso();
    const startedMs = this.#now();
    const result = await this.#runtime.verify({
      schemaVersion: 1,
      workspaceRoot: this.#workspace.root,
      invocationId,
      ...deadlineMs === void 0 ? {} : { deadlineMs },
      signal
    }, argumentsValue.noCache);
    if (onProgress !== void 0) {
      for (const event2 of result.events.slice(0, MAX_EVENTS)) {
        await onProgress({
          sequence: event2.sequence,
          stage: event2.stage,
          status: event2.status,
          ...event2.reasonCode === void 0 ? {} : { reasonCode: event2.reasonCode }
        });
      }
    }
    return {
      request,
      envelope: toProtocolEnvelope(result, {
        startedAt,
        durationMs: Math.max(0, Math.round(this.#now() - startedMs)),
        workspaceBinding: this.#workspace.id
      })
    };
  }
  getRun(argumentsValue) {
    this.#assertBinding(argumentsValue.workspaceBinding);
    const invocationId = boundedIdentity(argumentsValue.invocationId, "invocationId");
    const retained = this.#runtime.readRun(invocationId);
    if (retained === void 0) {
      throw new LocalAdapterError("VFY_ADAPTER_NOT_FOUND", "retained run was not found");
    }
    const result = assertRetainedResult(retained);
    const events = this.#runtime.readHistoryEvents(invocationId);
    const first = events[0]?.occurredAt;
    const last = events.at(-1)?.occurredAt;
    const startedAt = first ?? "1970-01-01T00:00:00.000Z";
    const durationMs = first === void 0 || last === void 0 ? 0 : Math.max(0, Date.parse(last) - Date.parse(first));
    return toProtocolEnvelope(result, {
      startedAt,
      durationMs,
      workspaceBinding: this.#workspace.id
    });
  }
  getRunEvents(argumentsValue) {
    this.getRun(argumentsValue);
    const events = this.#runtime.readHistoryEvents(argumentsValue.invocationId);
    return assertReadSize({
      schemaVersion: 1,
      invocationId: argumentsValue.invocationId,
      events: events.slice(0, MAX_EVENTS),
      truncated: events.length > MAX_EVENTS
    });
  }
  async getEvidence(argumentsValue) {
    this.#assertBinding(argumentsValue.workspaceBinding);
    this.getRun(argumentsValue);
    const evidenceId = boundedIdentity(argumentsValue.evidenceId, "evidenceId");
    const run = assertRetainedResult(this.#runtime.readRun(argumentsValue.invocationId));
    if (!run.evidenceRecords.some((record) => record.id === evidenceId)) {
      throw new LocalAdapterError(
        "VFY_ADAPTER_NOT_FOUND",
        "evidence is not linked to the retained invocation"
      );
    }
    const evidence = await this.#runtime.readEvidence(evidenceId);
    if (evidence === void 0) {
      throw new LocalAdapterError("VFY_ADAPTER_NOT_FOUND", "retained evidence was not found");
    }
    return assertReadSize(evidence);
  }
  getProvenance(argumentsValue) {
    this.#assertBinding(argumentsValue.workspaceBinding);
    this.getRun(argumentsValue);
    const reference = assertReference(argumentsValue.reference);
    const run = assertRetainedResult(this.#runtime.readRun(argumentsValue.invocationId));
    const allowed = new Map(
      run.revisionDocuments.map((document2) => [
        refKey3(referenceForDocument(document2)),
        document2
      ])
    );
    const rootKey = refKey3(reference);
    if (!allowed.has(rootKey)) {
      throw new LocalAdapterError(
        "VFY_ADAPTER_NOT_FOUND",
        "exact revision is not linked to the retained invocation"
      );
    }
    const edges = this.#runtime.readHistoryEdges().filter((edge) => allowed.has(refKey3(edge.source)) && allowed.has(refKey3(edge.target))).sort((left, right) => canonicalize(left).localeCompare(canonicalize(right)));
    const reached = /* @__PURE__ */ new Set([rootKey]);
    const queue = [rootKey];
    while (queue.length > 0 && reached.size < MAX_PROVENANCE_OBJECTS) {
      const current = queue.shift();
      for (const edge of edges) {
        const source = refKey3(edge.source);
        const target = refKey3(edge.target);
        const next = source === current ? target : target === current ? source : void 0;
        if (next !== void 0 && !reached.has(next)) {
          reached.add(next);
          queue.push(next);
          if (reached.size >= MAX_PROVENANCE_OBJECTS) break;
        }
      }
    }
    const objects = [...reached].sort().map((key) => {
      const document2 = allowed.get(key);
      return this.#runtime.readCanonicalRevision(referenceForDocument(document2)) ?? document2;
    });
    return assertReadSize({
      schemaVersion: 1,
      invocationId: argumentsValue.invocationId,
      root: reference,
      objects,
      edges: edges.filter(
        (edge) => reached.has(refKey3(edge.source)) && reached.has(refKey3(edge.target))
      ),
      truncated: reached.size >= MAX_PROVENANCE_OBJECTS
    });
  }
  inspectPermissions(workspaceBinding) {
    this.#assertBinding(workspaceBinding);
    return {
      schemaVersion: 1,
      profile: "local-workspace",
      workspaceBinding: this.#workspace.id,
      offline: true,
      tools: [
        "verification.verify",
        "verification.get_run",
        "verification.get_evidence",
        "verification.get_provenance",
        "verification.inspect_permissions"
      ],
      mutations: [],
      publication: false,
      providerCredentials: false
    };
  }
  close() {
    this.#runtime.close();
  }
};

// ../../packages/github-check-projector/src/public/index.ts
function verifyResult(envelope) {
  return envelope.result?.kind === "verify" ? envelope.result : void 0;
}
function conclusionFor(status, outcome) {
  if (status === "cancelled") return "cancelled";
  if (status === "internal_error" || status === "blocked" || status === "invalid") {
    return "action_required";
  }
  if (outcome === "satisfied") return "success";
  if (outcome === "violated") return "failure";
  return "neutral";
}
function boundedReasonCodes(envelope, result) {
  const codes = /* @__PURE__ */ new Set();
  for (const diagnostic of envelope.diagnostics) codes.add(diagnostic.code);
  for (const code of result?.reasonCodes ?? []) codes.add(code);
  for (const promise of result?.promises ?? []) {
    for (const code of promise.reasonCodes) codes.add(code);
  }
  return [...codes].filter((code) => /^[A-Z0-9_]{1,128}$/.test(code)).sort().slice(0, 64);
}
function evidenceClassifications(result) {
  const counts = {};
  for (const evidence of result?.evidenceRecords ?? []) {
    const classification = evidence.classification;
    if (classification === "SECRET") continue;
    counts[classification] = (counts[classification] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}
function projectGitHubCheck(envelope) {
  const result = verifyResult(envelope);
  const outcome = result?.outcome ?? null;
  const conclusion = conclusionFor(envelope.operationalStatus, outcome);
  const summary = result?.summary;
  const counts = {
    requiredPromises: summary?.requiredPromiseCount ?? 0,
    advisoryPromises: summary?.advisoryPromiseCount ?? 0,
    satisfied: summary?.satisfiedCount ?? 0,
    violated: summary?.violatedCount ?? 0,
    indeterminate: summary?.indeterminateCount ?? 0,
    proofs: result?.proofExecutions.length ?? 0,
    evidence: result?.evidence.length ?? 0
  };
  const reasonCodes = boundedReasonCodes(envelope, result);
  const classifications = evidenceClassifications(result);
  const classificationSummary = Object.entries(classifications).map(([name, count]) => `${name}=${count}`).join(",") || "none";
  const title = outcome === null ? `Verification ${envelope.operationalStatus}` : `Verification ${outcome}`;
  return {
    schemaVersion: 1,
    status: "completed",
    conclusion,
    operationalStatus: envelope.operationalStatus,
    outcome,
    reasonCodes,
    counts,
    durationMs: Number(envelope.durationMs),
    classifications,
    invocationId: String(envelope.invocationId),
    output: {
      title,
      summary: `Operational status: ${envelope.operationalStatus}; outcome: ${outcome ?? "none"}; promises: ${counts.satisfied} satisfied, ${counts.violated} violated, ${counts.indeterminate} indeterminate; proofs: ${counts.proofs}; evidence: ${counts.evidence}; duration: ${Number(envelope.durationMs)}ms; reasons: ${reasonCodes.join(",") || "none"}; classifications: ${classificationSummary}.`
    }
  };
}

// lib/public/check-client.js
import { request as httpsRequest } from "node:https";
var MAX_RESPONSE_BYTES = 1024 * 1024;
var API_VERSION = "2026-03-10";
var HttpsCheckTransport = class {
  send(request, signal) {
    return new Promise((resolve2, reject) => {
      const outgoing = httpsRequest({
        method: request.method,
        hostname: request.hostname,
        path: request.path,
        headers: request.headers,
        signal,
        timeout: 3e4
      }, (response) => {
        const chunks = [];
        let size = 0;
        response.on("data", (chunk) => {
          size += chunk.length;
          if (size > MAX_RESPONSE_BYTES) {
            outgoing.destroy(new Error("GitHub response exceeded the fixed limit"));
            return;
          }
          chunks.push(chunk);
        });
        response.once("end", () => resolve2({
          statusCode: response.statusCode ?? 0,
          body: Buffer.concat(chunks).toString("utf8")
        }));
      });
      outgoing.once("timeout", () => outgoing.destroy(new Error("GitHub request timed out")));
      outgoing.once("error", reject);
      outgoing.end(request.body);
    });
  }
};
function repositoryPath(repository) {
  if (!/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(repository)) {
    throw new Error("repository identity is invalid");
  }
  return `/repos/${repository}/check-runs`;
}
function headSha(value) {
  if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(value)) {
    throw new Error("commit identity is invalid");
  }
  return value;
}
async function publishGitHubCheck(projection, context, signal, transport = new HttpsCheckTransport()) {
  if (context.token.length === 0 || context.token.length > 4096 || /[\r\n]/.test(context.token)) {
    return { published: false, code: "VFY_GITHUB_CHECK_UNAVAILABLE" };
  }
  let path5;
  let sha2;
  try {
    path5 = repositoryPath(context.repository);
    sha2 = headSha(context.headSha);
  } catch {
    return { published: false, code: "VFY_GITHUB_CHECK_UNAVAILABLE" };
  }
  const body = JSON.stringify({
    name: "Verify",
    head_sha: sha2,
    status: projection.status,
    conclusion: projection.conclusion,
    external_id: projection.invocationId,
    output: projection.output
  });
  try {
    const response = await transport.send({
      method: "POST",
      hostname: "api.github.com",
      path: path5,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${context.token}`,
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(body)),
        "user-agent": "verify-github-action",
        "x-github-api-version": API_VERSION
      },
      body
    }, signal);
    if (response.statusCode !== 201) {
      return { published: false, code: "VFY_GITHUB_CHECK_UNAVAILABLE" };
    }
    const parsed = JSON.parse(response.body);
    if (!Number.isSafeInteger(parsed.id) || Number(parsed.id) <= 0) {
      return { published: false, code: "VFY_GITHUB_CHECK_UNAVAILABLE" };
    }
    return {
      published: true,
      code: "VFY_GITHUB_CHECK_PUBLISHED",
      checkRunId: Number(parsed.id)
    };
  } catch {
    return { published: false, code: "VFY_GITHUB_CHECK_UNAVAILABLE" };
  }
}

// lib/public/action.js
function booleanInput(value, defaultValue) {
  if (value === void 0 || value === "")
    return defaultValue;
  if (value === "true")
    return true;
  if (value === "false")
    return false;
  throw new Error("boolean action input must be true or false");
}
async function runGitHubAction(options) {
  const workspace = options.environment.GITHUB_WORKSPACE;
  if (workspace === void 0 || workspace.length === 0) {
    throw new Error("GITHUB_WORKSPACE is required");
  }
  const ownedDispatcher = options.dispatcher === void 0;
  const dispatcher = options.dispatcher ?? new LocalCanonicalDispatcher({
    workspace: { id: "workspace:github-action", root: workspace },
    stateRoot: join3(options.environment.RUNNER_TEMP ?? workspace, "verify-state")
  });
  try {
    const dispatch = await dispatcher.verify({
      workspaceBinding: "workspace:github-action",
      offline: true,
      noCache: booleanInput(options.environment["INPUT_NO-CACHE"], true)
    }, options.signal);
    const projection = projectGitHubCheck(dispatch.envelope);
    const publish = booleanInput(options.environment["INPUT_PUBLISH-CHECK"], true);
    const publication = publish ? await publishGitHubCheck(projection, {
      repository: options.environment.GITHUB_REPOSITORY ?? "",
      headSha: options.environment.GITHUB_SHA ?? "",
      token: options.environment["INPUT_GITHUB-TOKEN"] ?? ""
    }, options.signal, options.checkTransport) : { published: false, code: "VFY_GITHUB_CHECK_DISABLED" };
    return { envelope: dispatch.envelope, projection, publication };
  } finally {
    if (ownedDispatcher)
      dispatcher.close();
  }
}

// lib/bin/run.js
var controller = new AbortController();
process.once("SIGINT", () => controller.abort("caller"));
process.once("SIGTERM", () => controller.abort("shutdown"));
function safeCommandValue(value) {
  return value.replace(/[\r\n]/g, " ").slice(0, 1024);
}
async function writeOutput(name, value) {
  const output = process.env.GITHUB_OUTPUT;
  if (output === void 0 || output.length === 0)
    return;
  await appendFile(output, `${name}=${safeCommandValue(value)}
`, "utf8");
}
try {
  const result = await runGitHubAction({
    environment: process.env,
    signal: controller.signal
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
  if (!["success", "neutral"].includes(result.projection.conclusion))
    process.exitCode = 1;
} catch {
  process.stderr.write("::error title=Verify Action failed::The local verification adapter could not complete.\n");
  process.exitCode = 1;
}
