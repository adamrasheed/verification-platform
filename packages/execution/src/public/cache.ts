import { createHash } from "node:crypto";
import {
  link,
  mkdir,
  open,
  readFile,
  readdir,
  rm,
  unlink,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  canonicalSha256,
  canonicalize,
  type CanonicalValue,
  type OpaqueId,
  type RevisionRef,
  type Rfc3339Utc,
  type Sha256Digest,
  type Sha256Function,
} from "@verify-internal/contracts";
import type { CancellationToken } from "./cancellation.js";

export interface CacheKeyInput {
  readonly engineArtifact: Sha256Digest;
  readonly contractVersion: string;
  readonly pluginAndToolArtifacts: readonly Sha256Digest[];
  readonly proof: RevisionRef;
  readonly model: RevisionRef;
  readonly inputDigests: readonly Sha256Digest[];
  readonly configuration: CanonicalValue;
  readonly policy: CanonicalValue;
  readonly environment: CanonicalValue;
  readonly reproducibility: "hermetic" | "replayable" | "observational";
  readonly discoveryOutputDigest: Sha256Digest;
  readonly credentialBindingIdentity?: OpaqueId;
}

export interface CacheEligibilityInput {
  readonly policyMode: "disabled" | "content_addressed";
  readonly everyInputHasDigest: boolean;
  readonly observational: boolean;
  readonly validUntil?: Rfc3339Utc;
  readonly nowEpochMs: number;
  readonly evidenceComplete: boolean;
  readonly validationComplete: boolean;
  readonly integrityValid: boolean;
  readonly classificationValid: boolean;
  readonly redactionValid: boolean;
  readonly authorizationSufficient: boolean;
}

export type CacheEligibility =
  | { readonly eligible: true }
  | { readonly eligible: false; readonly reasonCode: string };

export interface CacheEntryPayload {
  readonly schemaVersion: number;
  readonly planKey: Sha256Digest;
  readonly proof: RevisionRef;
  readonly model: RevisionRef;
  readonly originatingExecutionId: OpaqueId;
  readonly originatingResultDigest: Sha256Digest;
  readonly evidenceRefs: readonly RevisionRef[];
  readonly validationEventIds: readonly OpaqueId[];
  readonly reproducibility: "hermetic" | "replayable" | "observational";
  readonly validUntil?: Rfc3339Utc;
  readonly value: CanonicalValue;
}

export interface StoredCacheEntry extends CacheEntryPayload {
  readonly integrityDigest: Sha256Digest;
}

export type CacheLookup =
  | { readonly disposition: "hit"; readonly entry: StoredCacheEntry }
  | { readonly disposition: "miss"; readonly reasonCode: string };

export type CachePublication =
  | {
      readonly disposition: "published" | "reused";
      readonly wonPublication: boolean;
      readonly entry: StoredCacheEntry;
    }
  | {
      readonly disposition: "miss";
      readonly wonPublication: false;
      readonly reasonCode: string;
    };

function sha256(bytes: Uint8Array): Sha256Digest {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function entryIntegrity(
  entry: CacheEntryPayload | StoredCacheEntry,
): Sha256Digest {
  const preimage = {
    ...(entry as unknown as Record<string, CanonicalValue>),
  };
  delete preimage.integrityDigest;
  return sha256(
    new TextEncoder().encode(canonicalize(preimage)),
  );
}

function planKeyHex(planKey: Sha256Digest): string {
  if (!/^sha256:[a-f0-9]{64}$/.test(planKey)) {
    throw new TypeError("invalid cache plan key");
  }
  return planKey.slice(7);
}

export async function deriveCacheKey(
  input: CacheKeyInput,
  digest: Sha256Function,
): Promise<Sha256Digest> {
  return canonicalSha256(
    {
      ...input,
      domain: "verification-platform/cache-key",
    } as unknown as CanonicalValue,
    digest,
  );
}

export function evaluateCacheEligibility(
  input: CacheEligibilityInput,
): CacheEligibility {
  if (input.policyMode === "disabled") {
    return { eligible: false, reasonCode: "policy_disabled" };
  }
  if (!input.everyInputHasDigest) {
    return { eligible: false, reasonCode: "unstable_input" };
  }
  if (input.observational) {
    if (
      input.validUntil === undefined ||
      Date.parse(input.validUntil) <= input.nowEpochMs
    ) {
      return { eligible: false, reasonCode: "observation_expired" };
    }
  }
  if (!input.evidenceComplete) {
    return { eligible: false, reasonCode: "evidence_missing" };
  }
  if (!input.validationComplete) {
    return { eligible: false, reasonCode: "validation_missing" };
  }
  if (!input.integrityValid) {
    return { eligible: false, reasonCode: "integrity_invalid" };
  }
  if (!input.classificationValid) {
    return { eligible: false, reasonCode: "classification_invalid" };
  }
  if (!input.redactionValid) {
    return { eligible: false, reasonCode: "redaction_invalid" };
  }
  if (!input.authorizationSufficient) {
    return { eligible: false, reasonCode: "authorization_insufficient" };
  }
  return { eligible: true };
}

export class LocalCacheStore {
  readonly #root: string;

  constructor(root: string) {
    this.#root = root;
  }

  private entryPath(planKey: Sha256Digest): string {
    const hex = planKeyHex(planKey);
    return join(this.#root, "entries", hex.slice(0, 2), `${hex}.json`);
  }

  async lookup(
    planKey: Sha256Digest,
    referencesValid: (entry: StoredCacheEntry) => boolean | Promise<boolean>,
  ): Promise<CacheLookup> {
    let raw: Uint8Array;
    try {
      raw = await readFile(this.entryPath(planKey));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { disposition: "miss", reasonCode: "not_found" };
      }
      throw error;
    }
    let entry: StoredCacheEntry;
    try {
      entry = JSON.parse(new TextDecoder().decode(raw)) as StoredCacheEntry;
      if (
        entry.schemaVersion !== 1 ||
        entry.planKey !== planKey ||
        entryIntegrity(entry) !== entry.integrityDigest
      ) {
        return { disposition: "miss", reasonCode: "corrupt" };
      }
    } catch {
      return { disposition: "miss", reasonCode: "corrupt" };
    }
    if (!(await referencesValid(entry))) {
      return { disposition: "miss", reasonCode: "missing_reference" };
    }
    return { disposition: "hit", entry };
  }

  async publish(
    entry: CacheEntryPayload,
    publicationToken: string,
    cancellation?: CancellationToken,
  ): Promise<CachePublication> {
    if (!/^[A-Za-z0-9._-]{1,160}$/.test(publicationToken)) {
      throw new TypeError("publicationToken contains unsafe characters");
    }
    cancellation?.throwIfCancelled();
    const stored: StoredCacheEntry = {
      ...entry,
      integrityDigest: entryIntegrity(entry),
    };
    const bytes = new TextEncoder().encode(
      canonicalize(stored as unknown as CanonicalValue),
    );
    const temporary = join(
      this.#root,
      "stage",
      `${publicationToken}.json`,
    );
    const destination = this.entryPath(entry.planKey);
    await mkdir(dirname(temporary), { recursive: true, mode: 0o700 });
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      cancellation?.throwIfCancelled();
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
    let wonPublication = false;
    try {
      await link(temporary, destination);
      wonPublication = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        await rm(temporary, { force: true });
        throw error;
      }
    }
    await unlink(temporary);
    const winner = await this.lookup(entry.planKey, () => true);
    if (winner.disposition !== "hit") {
      return {
        disposition: "miss",
        wonPublication: false,
        reasonCode: winner.reasonCode,
      };
    }
    return {
      disposition: wonPublication ? "published" : "reused",
      wonPublication,
      entry: winner.entry,
    };
  }

  async clear(): Promise<void> {
    await rm(join(this.#root, "entries"), { recursive: true, force: true });
  }

  async recover(): Promise<readonly string[]> {
    const stage = join(this.#root, "stage");
    let names: string[];
    try {
      names = await readdir(stage);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    for (const name of names) {
      await rm(join(stage, name), { recursive: true, force: true });
    }
    return names.sort();
  }
}
