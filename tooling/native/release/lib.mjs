import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const digestPattern = /^sha256:[a-f0-9]{64}$/;
const versionPattern = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/;

export function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function exactKeys(value, expected, label) {
  if (
    typeof value !== "object"
    || value === null
    || Array.isArray(value)
    || Object.keys(value).sort().join("\n") !== [...expected].sort().join("\n")
  ) throw new TypeError(`${label} has an invalid shape`);
}

function releaseFile(value, label) {
  exactKeys(value, ["file", "sha256"], label);
  if (
    typeof value.file !== "string"
    || value.file !== path.basename(value.file)
    || !digestPattern.test(value.sha256)
  ) throw new TypeError(`${label} is invalid`);
}

function codeIdentity(value, identifier, label) {
  exactKeys(value, ["cdHash", "identifier"], label);
  if (value.identifier !== identifier || !/^[a-f0-9]{40,128}$/.test(value.cdHash)) {
    throw new TypeError(`${label} is invalid`);
  }
}

function signedFileIdentity(value, label) {
  exactKeys(value, ["sha256", "signerThumbprint", "subject", "timestamped"], label);
  if (
    !digestPattern.test(value.sha256)
    || !/^[A-F0-9]{40,128}$/.test(value.signerThumbprint)
    || typeof value.subject !== "string"
    || value.subject.length === 0
    || value.timestamped !== true
  ) throw new TypeError(`${label} is invalid`);
}

export function validateNativeHostReleaseManifest(manifest) {
  exactKeys(
    manifest,
    ["artifact", "identity", "kind", "platform", "schemaVersion", "version"],
    "native host release manifest",
  );
  if (
    manifest.schemaVersion !== 1
    || manifest.kind !== "verify-native-host-release"
    || !versionPattern.test(manifest.version)
    || !["macos", "windows"].includes(manifest.platform)
  ) throw new TypeError("native host release metadata is invalid");
  releaseFile(manifest.artifact, "native host release artifact");
  if (manifest.platform === "macos") {
    exactKeys(
      manifest.identity,
      ["helper", "host", "notarized", "signingAuthority", "supervisor", "teamIdentifier", "timestamped"],
      "macOS identity",
    );
    if (
      !/^[A-Z0-9]{10}$/.test(manifest.identity.teamIdentifier)
      || !manifest.identity.signingAuthority?.startsWith("Developer ID Application:")
      || !manifest.identity.signingAuthority.endsWith(` (${manifest.identity.teamIdentifier})`)
      || manifest.identity.notarized !== true
      || manifest.identity.timestamped !== true
    ) throw new TypeError("macOS release identity is invalid");
    codeIdentity(manifest.identity.host, "dev.verify.plugin-host", "macOS host identity");
    codeIdentity(manifest.identity.helper, "dev.verify.plugin-host.node", "macOS helper identity");
    codeIdentity(
      manifest.identity.supervisor,
      "dev.verify.plugin-supervisor",
      "macOS supervisor identity",
    );
  } else {
    exactKeys(manifest.identity, ["host", "node"], "Windows identity");
    signedFileIdentity(manifest.identity.host, "Windows host identity");
    signedFileIdentity(manifest.identity.node, "Windows Node identity");
  }
  return manifest;
}

export async function verifyNativeHostReleaseManifest(manifest, artifactRoot) {
  validateNativeHostReleaseManifest(manifest);
  const artifact = path.resolve(artifactRoot, manifest.artifact.file);
  const relative = path.relative(path.resolve(artifactRoot), artifact);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new TypeError("native host artifact escapes its root");
  }
  if (sha256(await readFile(artifact)) !== manifest.artifact.sha256) {
    throw new TypeError("native host artifact digest does not match");
  }
  return manifest;
}
