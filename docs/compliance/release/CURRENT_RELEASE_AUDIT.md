# Current Release Audit

**Date:** 2026-07-19
**Status:** `@adamrasheed/verify@0.2.0` published through OIDC and independently verified

## Passing gates

- Release-tool fixture suite: 3/3 tests passed.
- Offline/passive static gate and executable runtime deny harness passed. The
  socket canary was blocked and the CLI still completed verification.
- Generated adversarial corpus passed bounded/deep trees, Unicode/case
  collisions, symlinks and special files, dirty mutation, corrupted cache,
  miss/hit/bypass behavior, and hostile secret/script canaries.
- Generated 100,000-file / 589,078-byte warm discovery p95 was 322.445 ms
  against 5 s.
- Engine overhead p95 was 16.185 ms against 1 s; healthy cache lookup p95 was
  0.241 ms against 50 ms.
- Deadline cancellation completed in 66.209 ms, first progress appeared in
  53.565 ms, maximum machine output was 104,076 bytes, and maximum measured RSS
  was 273,723,392 bytes.
- Synthetic exact npm pack audit: passed.
- MVP repository corpus: 8/8 passed, including npm, pnpm, Yarn, unknown,
  malformed, duplicate, empty, and hostile fixtures.
- Public package audit: `@adamrasheed/verify@0.2.0` passed as a four-file, self-contained
  executable package with no lifecycle scripts or production dependencies.
- The exact tested candidate was published by the release workflow and the
  downloaded registry tarball has SHA-256
  `eda8641b1e90257e649487245eaec9dbc586a0a7e814dd70ba88497c2c3c07ca`.
- npm registry signature and SLSA provenance verification passed, and a clean
  registry install executed `verify version` successfully.
- Engine suite: 20/20 passed, including progressive lifecycle transactions,
  crash-prefix recovery, projection reconciliation, exact cache provenance,
  Promise aggregation ownership, and model supersession.
- CLI process suite: 20/20 passed, including JSON purity, JSONL terminal
  discipline, durable inspection/cache behavior, atomic repair apply and
  re-verification, and cancellation under one second.
- Repair suite: 5/5 passed, including read-only preview, atomic exact-byte
  application, stale-target rejection, and path/symlink containment.

## Publication record

Candidate preparation binds the exact repository HEAD, performance report,
security report, pack manifest, SBOM, provenance, and tested tarball bytes.
Founder decisions F-001 and F-002 resolve the package as
`@adamrasheed/verify` and the license as Apache-2.0. Version `0.2.0` was
published without a long-lived npm token by GitHub Actions trusted publishing
from source revision `ea6e7759f6812ccbb213e582d2ed03a758b324a9`. The protected
release run completed successfully and the package was independently verified
against the public registry on 2026-07-19. See
[`PUBLISHED_RELEASE.json`](PUBLISHED_RELEASE.json) for the machine-readable
integrity, signature, provenance, and workflow record.
