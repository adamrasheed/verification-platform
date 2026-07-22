# Native Host Release Signing

The `Sign native plugin hosts` workflow is the only repository release path for
the macOS and Windows sandbox hosts. It is manually dispatched with a SemVer
version and an `all`, `macos`, or `windows` target (default `all`), and runs in
the protected `native-host-release` GitHub environment.
Unsigned, unnotarized, untimestamped, or identity-mismatched output fails before
an artifact is retained.

## Protected secrets

Configure these secrets on the `native-host-release` environment:

- `MACOS_CERTIFICATE_P12_BASE64`: base64 PKCS#12 containing the Developer ID
  Application certificate and private key.
- `MACOS_CERTIFICATE_PASSWORD`: PKCS#12 password.
- `MACOS_DEVELOPER_ID_APPLICATION`: exact certificate common name, including
  `Developer ID Application:` and the Team ID suffix.
- `MACOS_TEAM_ID`: ten-character Apple Team ID.
- `APPLE_NOTARY_KEY_BASE64`: base64 App Store Connect API `.p8` key.
- `APPLE_NOTARY_KEY_ID`: App Store Connect API key ID.
- `APPLE_NOTARY_ISSUER_ID`: App Store Connect API issuer ID.
- `WINDOWS_CERTIFICATE_PFX_BASE64`: base64 Authenticode PKCS#12/PFX containing
  the host-signing certificate and private key.
- `WINDOWS_CERTIFICATE_PASSWORD`: PFX password.
- `WINDOWS_HOST_SIGNER_THUMBPRINT`: exact uppercase host certificate
  thumbprint.
- `WINDOWS_NODE_SIGNER_THUMBPRINT`: exact uppercase signer thumbprint already
  present on the pinned Node distribution.
- `WINDOWS_TIMESTAMP_URL`: trusted RFC 3161 timestamp service URL.

No signing secret is exposed to dependency installation or artifact upload
steps. Temporary certificate/key files and the macOS keychain are deleted even
when signing fails.

## Output and runtime pins

Each successful job retains a ZIP plus `manifest.json` for 30 days. The
manifest seals the archive digest and the values required by the production
launcher:

- macOS: `teamIdentifier`, `signingAuthority`, and the host/helper/supervisor
  `cdHash` values;
- Windows: host and Node `sha256` values plus their `signerThumbprint` values.

The macOS gate requires an Apple-anchored Developer ID Application chain,
hardened runtime, trusted timestamp, accepted notarization, and a stapled
ticket. It then reruns the synthetic providers and containment canaries through
the signed host using the exact manifest pins. The accepted `0.1.0` production
pins are retained in `pins/macos-0.1.0.json`; they were produced and exercised
by [Actions run 29896962096](https://github.com/adamrasheed/verification-platform/actions/runs/29896962096).

The Windows gate requires trusted Authenticode signatures, RFC 3161
timestamping, exact signer pins, and exact file digests.

Validate a downloaded artifact set with:

```sh
node tooling/native/release/check-manifest.mjs path/to/manifest.json path/to/artifacts
```
