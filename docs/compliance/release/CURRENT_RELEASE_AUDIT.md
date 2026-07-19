# Current Release Audit

**Date:** 2026-07-18
**Status:** `@adamrasheed/verify@0.1.0` published and independently verified

## Passing gates

- Release-tool fixture suite: 3/3 tests passed.
- Offline/passive static gate and executable runtime deny harness passed. The
  socket canary was blocked and the CLI still completed verification.
- Generated adversarial corpus passed bounded/deep trees, Unicode/case
  collisions, symlinks and special files, dirty mutation, corrupted cache,
  miss/hit/bypass behavior, and hostile secret/script canaries.
- Generated 100,000-file / 589,078-byte warm discovery p95 was 340.379 ms
  against 5 s.
- Engine overhead p95 was 7.008 ms against 1 s; healthy cache lookup p95 was
  0.157 ms against 50 ms.
- Deadline cancellation completed in 51.397 ms, first progress appeared in
  44.205 ms, maximum machine output was 104,100 bytes, and maximum measured RSS
  was 127,827,968 bytes.
- Synthetic exact npm pack audit: passed.
- MVP repository corpus: 8/8 passed, including npm, pnpm, Yarn, unknown,
  malformed, duplicate, empty, and hostile fixtures.
- Public package audit: `@adamrasheed/verify@0.1.0` passed as a four-file, self-contained
  executable package with no lifecycle scripts or production dependencies.
- The registry tarball is byte-identical to the tested candidate at SHA-256
  `497d2f883dc961926115bf074981731844966a9ada47b9c1ca2c3ff63d05f9d3`.
- npm registry signature verification passed, and a clean install executed
  `verify version` successfully.
- Engine suite: 20/20 passed, including progressive lifecycle transactions,
  crash-prefix recovery, projection reconciliation, exact cache provenance,
  Promise aggregation ownership, and model supersession.
- CLI process suite: 19/19 passed, including JSON purity, JSONL terminal
  discipline, durable inspection/cache behavior, and cancellation under one
  second.

## Publication record

Candidate preparation binds the exact repository HEAD, performance report,
security report, pack manifest, SBOM, provenance, and tested tarball bytes.
Founder decisions F-001 and F-002 resolve the package as
`@adamrasheed/verify` and the license as Apache-2.0. npm publication authority
was authenticated as `adamrasheed` on 2026-07-18. Version `0.1.0` was published
from source revision `23ebdb36673f3339dbd4eedf04af37f48c040fad` and verified
against the public registry on 2026-07-19. See
[`PUBLISHED_RELEASE.json`](PUBLISHED_RELEASE.json) for the machine-readable
integrity and signature record.
