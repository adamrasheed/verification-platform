import {
  canonicalSha256,
  type Sha256Function,
} from "./canonical-json.js";
import type {
  CanonicalValue,
  OpaqueId,
} from "./primitives.js";

export type SemanticIdentityKind =
  | "workspace"
  | "application"
  | "capability"
  | "promise"
  | "proof"
  | "discoverySignal"
  | "discoveryFact";

export interface NaturalKeyScope {
  readonly workspaceId: string;
  readonly applicationId?: string;
  readonly relativeRoot: string;
}

export type WorkspaceNaturalKey =
  | {
      readonly source: "repository";
      readonly repositoryId: string;
    }
  | {
      readonly source: "localVcs";
      readonly rootIdentityDigest: string;
      readonly vcsIdentityDigest: string;
    };

export type SemanticIdRequest =
  | {
      readonly kind: "workspace";
      readonly schemaVersion: number;
      readonly naturalKey: WorkspaceNaturalKey;
    }
  | {
      readonly kind: "application";
      readonly schemaVersion: number;
      readonly naturalKey: {
        readonly workspaceId: string;
        readonly root: string;
        readonly packageIdentity: string;
      };
    }
  | {
      readonly kind: "capability";
      readonly schemaVersion: number;
      readonly naturalKey: {
        readonly applicationId: string;
        readonly capabilityType: string;
        readonly scope: NaturalKeyScope;
      };
    }
  | {
      readonly kind: "promise";
      readonly schemaVersion: number;
      readonly naturalKey: {
        readonly subjectId: string;
        readonly predicateId: string;
        readonly scope: NaturalKeyScope;
      };
    }
  | {
      readonly kind: "proof";
      readonly schemaVersion: number;
      readonly naturalKey: {
        readonly evaluatorId: string;
        readonly evaluatorVersion: string;
        readonly predicateLanguageRevision: string;
        readonly evidenceRequirementIdentity: string;
      };
    }
  | {
      readonly kind: "discoverySignal" | "discoveryFact";
      readonly schemaVersion: number;
      readonly naturalKey: {
        readonly readerId: string;
        readonly normalizedRelativeInput: string;
        readonly structuredPointer: string;
        readonly signalKind: string;
      };
    };

export interface SemanticIdDeriver {
  derive(request: SemanticIdRequest): Promise<OpaqueId>;
}

/**
 * Derives logical IDs exclusively from a versioned, domain-separated natural
 * key. The digest adapter is injected so this package never imports a runtime
 * crypto or I/O API.
 */
export class CanonicalSemanticIdDeriver implements SemanticIdDeriver {
  readonly #sha256: Sha256Function;

  constructor(sha256: Sha256Function) {
    this.#sha256 = sha256;
  }

  async derive(request: SemanticIdRequest): Promise<OpaqueId> {
    if (!Number.isSafeInteger(request.schemaVersion) || request.schemaVersion < 1) {
      throw new TypeError("semantic identity schemaVersion must be a positive safe integer");
    }
    assertNaturalKey(request);
    const digest = await canonicalSha256(
      {
        domain: "verification-platform/semantic-id",
        kind: request.kind,
        naturalKey: request.naturalKey as unknown as CanonicalValue,
        schemaVersion: request.schemaVersion,
      },
      this.#sha256,
    );
    return `sid:${request.kind}:${digest.slice("sha256:".length)}` as OpaqueId;
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNormalizedRelativePath(value: unknown): value is string {
  return isNonEmptyString(value)
    && !value.startsWith("/")
    && !value.includes("\\")
    && (
      value === "."
      || value.split("/").every(
        (segment) => segment !== "" && segment !== "." && segment !== "..",
      )
    );
}

function assertScope(value: NaturalKeyScope): void {
  if (
    !isNonEmptyString(value.workspaceId)
    || !isNormalizedRelativePath(value.relativeRoot)
    || (value.applicationId !== undefined && !isNonEmptyString(value.applicationId))
  ) {
    throw new TypeError("semantic identity scope is unavailable or ambiguous");
  }
}

function assertNaturalKey(request: SemanticIdRequest): void {
  switch (request.kind) {
    case "workspace": {
      const key = request.naturalKey;
      if (
        (key.source === "repository" && !isNonEmptyString(key.repositoryId))
        || (
          key.source === "localVcs"
          && (
            !/^sha256:[a-f0-9]{64}$/.test(key.rootIdentityDigest)
            || !/^sha256:[a-f0-9]{64}$/.test(key.vcsIdentityDigest)
          )
        )
      ) {
        throw new TypeError("workspace semantic identity signals are unavailable");
      }
      return;
    }
    case "application": {
      const key = request.naturalKey;
      if (
        !isNonEmptyString(key.workspaceId)
        || !isNormalizedRelativePath(key.root)
        || !isNonEmptyString(key.packageIdentity)
      ) throw new TypeError("application semantic identity is unavailable or ambiguous");
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
      if (
        !isNonEmptyString(key.evaluatorId)
        || !isNonEmptyString(key.evaluatorVersion)
        || !/^sha256:[a-f0-9]{64}$/.test(key.predicateLanguageRevision)
        || !isNonEmptyString(key.evidenceRequirementIdentity)
      ) throw new TypeError("proof semantic identity is unavailable");
      return;
    }
    case "discoverySignal":
    case "discoveryFact": {
      const key = request.naturalKey;
      if (
        !isNonEmptyString(key.readerId)
        || !isNormalizedRelativePath(key.normalizedRelativeInput)
        || !isNonEmptyString(key.structuredPointer)
        || !isNonEmptyString(key.signalKind)
      ) throw new TypeError("discovery semantic identity is unavailable");
    }
  }
}

export type EphemeralIdKind =
  | "invocation"
  | "attempt"
  | "event"
  | "transport"
  | "storage";

export interface EphemeralIdSource {
  next(kind: EphemeralIdKind): OpaqueId;
}

export type EphemeralIdFactory = (kind: EphemeralIdKind) => string;

/**
 * Adapts an Engine-owned randomness source without reading ambient randomness.
 * Ephemeral IDs are deliberately opaque and must never enter revision
 * preimages or semantic natural keys.
 */
export class DelegatingEphemeralIdSource implements EphemeralIdSource {
  readonly #factory: EphemeralIdFactory;

  constructor(factory: EphemeralIdFactory) {
    this.#factory = factory;
  }

  next(kind: EphemeralIdKind): OpaqueId {
    const id = this.#factory(kind);
    if (typeof id !== "string" || id.length < 1 || id.length > 512) {
      throw new TypeError("ephemeral ID factory returned an invalid opaque ID");
    }
    return id as OpaqueId;
  }
}
