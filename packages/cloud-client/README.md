# Cloud Client

Vendor-neutral metadata publication and signed-policy boundary contracts for
Architecture Freeze §11 and EDD §§16 and 27.

The public API owns strict metadata-publication validation, disclosure-manifest
preparation and byte-for-byte verification, locally keyed publication IDs,
signed policy distribution validation, five-minute signed publication intents,
and bounded allowlist-ingestion semantics. It depends only on the public
Protocol API. It does not calculate verdicts, upload source or Evidence bodies,
perform ambient telemetry, choose a cloud vendor, store key bytes, or issue
network requests.

All default outbound fields are `MINIMAL_METADATA`. Publication keys remain
behind a caller-supplied local key store and MAC operation; cloud-visible
documents never contain local semantic IDs, revisions, or key identifiers.
Existing local mappings preserve publication identity across key rotation.

Publication intents bind one exact tenant, project, purpose, manifest and
payload digest, idempotency key, retention class, policy revision, nonce,
audience, limit set, and validity interval. Ingestion accepts only uncompressed
canonical JSON, revalidates the disclosure byte-for-byte, and requires its
store implementation to consume nonce and idempotency state atomically. An
exact retry returns the original receipt; changed bytes and nonce replay fail
closed.

Successful admission atomically retains the exact validated
`PublishedVerificationResult`, its receipt, and one minimal
`PublishedRunAccepted` outbox event. Tenant/project reads return a defensive
copy of that immutable projection and never rerun Promise or Proof logic.
Provider-neutral outbox conformance uses expiring fenced leases, a stable event
identity, bounded attempts, and idempotent acknowledgement; the production
PostgreSQL/queue adapter remains gated on the provider decision.

Authorized deletion atomically removes the active projection and any queued
acceptance event, installs a minimal digest-free tombstone, and emits one
`PublishedRunDeleted` event. Exact reads then return `deleted_reference`, and
restore tooling must pass the tombstone gate before reintroducing a record.
Concrete active-retention durations, backup expiry, and secondary-store
propagation remain gated on D-002 rather than being invented by this package.

List reads are bounded to 100 items and ordered by `(publishedAt,
publishedRunId)`. Continuation cursors are random, opaque, expire after five
minutes, are retained in a bounded store, and are bound to the exact tenant and
project; malformed, expired, and cross-scope cursors fail identically.

Schemas and compatibility are owned by Founding Engineering. M8 foundation
acceptance is covered by `cloud-client:test`; release status is experimental.
