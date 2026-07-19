# Release Tooling

These scripts stage and verify a local npm release candidate. They never invoke
`npm publish`.

## Commands to wire at the workspace root

```sh
node tooling/release/test-release-tools.mjs
node tooling/release/audit-pack.mjs apps/cli
node tooling/conformance/run-security-gates.mjs \
  --out docs/compliance/release/SECURITY_REPORT.json
node tooling/conformance/benchmark.mjs \
  --out docs/compliance/release/PERFORMANCE_REPORT.json

node tooling/release/prepare-candidate.mjs \
  --package apps/cli \
  --out .release/candidate \
  --performance docs/compliance/release/PERFORMANCE_REPORT.json \
  --security docs/compliance/release/SECURITY_REPORT.json \
  --source-revision "$GIT_COMMIT_SHA"

node tooling/release/attest-tested-bytes.mjs \
  .release/candidate/release-candidate.json \
  .release/candidate/test-attestation.json \
  -- node tooling/release/verify-packed-artifact.mjs

node tooling/release/check-candidate.mjs \
  .release/candidate/release-candidate.json

node tooling/release/promote-tested-bytes.mjs \
  .release/candidate/release-candidate.json \
  .release/promoted/candidate.tgz
```

`prepare-candidate` runs `npm pack` with scripts disabled, inspects the tar
headers and bytes independently, rejects forbidden lifecycle hooks and
undeclared paths, and writes deterministic file, CycloneDX SBOM, and in-toto
provenance documents. It requires already-passed security and performance
reports.

`attest-tested-bytes` permits only the policy-owned packed-artifact verifier and
binds the exact tarball SHA-256 before and after it runs. The separately bound
security and performance reports retain the complete M5 gate Evidence.
`check-candidate` deterministically regenerates the pack
manifest, SBOM, and provenance and verifies every referenced digest.
`promote-tested-bytes` copies only a fully valid candidate and rechecks the
destination digest. Publication remains a separate, explicitly authorized
action.
