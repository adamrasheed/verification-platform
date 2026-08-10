import {
  verifyCloudIdentityToken,
} from "@verify-internal/auth";
import type {
  CloudIdentityTokenRevocationCheck,
  CloudIdentityVerificationKey,
} from "@verify-internal/auth";
import type { ControlApiAuthenticator } from "./types.js";

export function createCloudIdentityAuthenticator(
  keys: readonly CloudIdentityVerificationKey[],
  expectedAudience: string,
  isRevoked: CloudIdentityTokenRevocationCheck = () => false,
): ControlApiAuthenticator {
  const verificationKeys = structuredClone(keys);
  return {
    async authenticate(token, now) {
      const decision = await verifyCloudIdentityToken(
        token,
        verificationKeys,
        expectedAudience,
        now,
        isRevoked,
      );
      return decision.authenticated ? decision.principal : undefined;
    },
  };
}
