import { createPublicKey, verify } from "node:crypto";
import type { KeyObject } from "node:crypto";
import {
  manifestSigningBytes,
  type ProviderPluginManifest,
} from "@verify-internal/plugin-sdk";
import { PluginRuntimeError } from "./errors.js";

export interface TrustedPluginPublisher {
  readonly publisherId: string;
  readonly keyId: string;
  readonly publicKeyPem: string;
  readonly notBefore: string;
  readonly notAfter: string;
}

export interface PluginRevocations {
  readonly publisherKeyIds: readonly string[];
  readonly artifactDigests: readonly string[];
}

export type PluginTrustDecision =
  | {
      readonly tier: "verified-publisher";
      readonly publisherId: string;
      readonly keyId: string;
    }
  | {
      readonly tier: "local-development";
      readonly publisherId: string;
      readonly keyId: string;
    };

function validAt(instant: Date, notBefore: string, notAfter: string): boolean {
  const lower = Date.parse(notBefore);
  const upper = Date.parse(notAfter);
  const value = instant.getTime();
  return Number.isFinite(lower) && Number.isFinite(upper) && value >= lower && value < upper;
}

function parsePublicKey(pem: string): KeyObject {
  try {
    return createPublicKey(pem);
  } catch {
    throw new PluginRuntimeError("VFY_PLUGIN_TRUST_DENIED", "publisher public key is invalid");
  }
}

export function verifyPluginPublisher(
  manifest: ProviderPluginManifest,
  publishers: readonly TrustedPluginPublisher[],
  revocations: PluginRevocations,
  now: Date,
): PluginTrustDecision {
  if (
    revocations.publisherKeyIds.includes(manifest.publisher.keyId)
    || revocations.artifactDigests.includes(manifest.artifactDigest)
  ) {
    throw new PluginRuntimeError("VFY_PLUGIN_REVOKED", "plugin publisher or artifact is revoked");
  }
  const publisher = publishers.find((candidate) =>
    candidate.publisherId === manifest.publisher.id
    && candidate.keyId === manifest.publisher.keyId);
  if (!publisher || !validAt(now, publisher.notBefore, publisher.notAfter)) {
    throw new PluginRuntimeError("VFY_PLUGIN_TRUST_DENIED", "publisher is not trusted at execution time");
  }
  const signature = Buffer.from(manifest.signature.value, "base64");
  if (!verify(null, manifestSigningBytes(manifest), parsePublicKey(publisher.publicKeyPem), signature)) {
    throw new PluginRuntimeError("VFY_PLUGIN_TRUST_DENIED", "plugin manifest signature is invalid");
  }
  return {
    tier: "verified-publisher",
    publisherId: publisher.publisherId,
    keyId: publisher.keyId,
  };
}

export function localDevelopmentTrust(manifest: ProviderPluginManifest): PluginTrustDecision {
  return {
    tier: "local-development",
    publisherId: manifest.publisher.id,
    keyId: manifest.publisher.keyId,
  };
}
