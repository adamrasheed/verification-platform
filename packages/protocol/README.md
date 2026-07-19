# Protocol

**Status:** Internal, protocol major 1
**Owner:** Founding Engineering
**Authority:** Architecture Freeze §12, EDD §§16–18 and 23, ADR-0007
**Acceptance:** M1-T08 through M1-T11

This package owns command requests, the common command envelope, stable result
discriminants, StructuredError decoding, CLI exit mapping, JSONL framing, and
current/previous-major reader selection.

It depends only on `contracts` and `events`. It does not perform discovery,
evaluate Evidence, aggregate Promises, authorize work, route workloads, publish
data, or render an adapter-specific verdict.

## Stable result kinds

- `verify` is the full result inside an authorized Engine boundary.
- `dispatchVerification` is a routing result and never a fabricated verify
  result.
- `publishedVerification` is a Cloud Boundary allowlist projection using
  `PublishedObjectRef`, never `RevisionRef`.
- `getRun` retrieves an exact retained local verify envelope.
- `getPublishedRun` retrieves an allowlisted published projection.

Unknown additive fields are ignored by readers. Unknown control-flow values
produce `incompatible_result` and CLI exit code 6. Protocol major 1 is the first
published major, so no previous production reader exists yet; the compatibility
helper supports an explicit previous-major reader when major 2 is introduced.

## Data classification and I/O

Protocol values may carry any classification authorized by their owning local
contract. `publishedVerification` is restricted to `MINIMAL_METADATA`. The
package performs no filesystem, process, credential, or network I/O.

## Source artifacts

- `schemas/` contains source JSON Schemas.
- `schemas/repair-command.schema.json` governs the local post-MVP preview/apply
  result documents; write authority and write effects are distinct fields.
- `fixtures/` contains current-major valid and invalid examples.
- `test/` proves discriminants, compatibility, exit mapping, and JSONL terminal
  rules.
