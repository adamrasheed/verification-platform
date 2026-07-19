# Current Release Audit

**Date:** 2026-07-18
**Status:** release-candidate gates passed; publication authority remains external

## Passing gates

- Release-tool fixture suite: 3/3 tests passed.
- Offline/passive static gate and executable runtime deny harness passed. The
  socket canary was blocked and the CLI still completed verification.
- Generated adversarial corpus passed bounded/deep trees, Unicode/case
  collisions, symlinks and special files, dirty mutation, corrupted cache,
  miss/hit/bypass behavior, and hostile secret/script canaries.
- Generated 100,000-file / 589,078-byte warm discovery p95 was 344.164 ms
  against 5 s.
- Engine overhead p95 was 5.940 ms against 1 s; healthy cache lookup p95 was
  0.150 ms against 50 ms.
- Deadline cancellation completed in 46.311 ms, first progress appeared in
  42.716 ms, maximum machine output was 104,100 bytes, and maximum measured RSS
  was 129,417,216 bytes.
- Synthetic exact npm pack audit: passed.
- MVP repository corpus: 8/8 passed, including npm, pnpm, Yarn, unknown,
  malformed, duplicate, empty, and hostile fixtures.
- Public package audit: `verify@0.1.0` passed as a three-file, self-contained
  executable package with no lifecycle scripts or production dependencies.
- Engine suite: 20/20 passed, including progressive lifecycle transactions,
  crash-prefix recovery, projection reconciliation, exact cache provenance,
  Promise aggregation ownership, and model supersession.
- CLI process suite: 19/19 passed, including JSON purity, JSONL terminal
  discipline, durable inspection/cache behavior, and cancellation under one
  second.

## Publication prerequisites

Candidate preparation binds the exact repository HEAD, performance report,
security report, pack manifest, SBOM, provenance, and tested tarball bytes.
Production publication was intentionally not attempted because no production
signing identity/key or npm publication authority was provided. Package-name
ownership and the open-source license choice also remain explicit founder and
legal decisions (F-001 and F-002). The tooling does not invent or bypass those
authorities; publication is a separate, explicitly authorized action.
