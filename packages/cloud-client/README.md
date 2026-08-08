# Cloud Client

Metadata publication and signed-policy boundary contracts, plus the concrete
PostgreSQL persistence adapter, for Architecture Freeze §11 and EDD §§16,
19–21, and 27.

The public API owns strict metadata-publication validation, disclosure-manifest
preparation and byte-for-byte verification, locally keyed publication IDs,
signed policy distribution validation, five-minute signed publication intents,
and bounded allowlist-ingestion semantics. It depends only on the public
Protocol API. It does not calculate verdicts, upload source or Evidence bodies,
perform ambient telemetry, choose a cloud vendor, or store key bytes. Network
access exists only in the explicitly constructed `PostgresPublicationStore`;
the contract and in-memory conformance paths remain passive.

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
Outbox conformance uses expiring fenced leases, a stable event identity,
bounded attempts, and idempotent acknowledgement. `PostgresPublicationStore`
implements admission and deletion transactions, `FOR UPDATE SKIP LOCKED`
claims, monotonically increasing fences, bounded serialization retries, and
sanitized terminal dead letters. The M9-T05 queue port now transports only a
canonical, digest-free outbox reference, receives one message at a time, deletes
only processed or idempotent duplicate deliveries, and uses bounded jittered
visibility changes before source-bound DLQ redrive. The concrete AWS adapter
must bind the exact regional queue URL; protected live relay/worker and
secondary-sink scans remain the deployment gate.

Authorized deletion atomically removes the active projection and any queued
acceptance event, installs a minimal digest-free tombstone, and emits one
`PublishedRunDeleted` event. Exact reads then return `deleted_reference`, and
restore tooling must pass the tombstone gate before reintroducing a record.
The PostgreSQL adapter applies ADR-0013's 30-day active projection and 365-day
minimum tombstone schedules; purge cannot remove a tombstone while its deletion
event is pending or leased. Backup expiry and secondary-store propagation remain
infrastructure responsibilities. The in-memory conformance store does not
silently claim these production policies.

List reads are bounded to 100 items and ordered by `(publishedAt,
publishedRunId)`. Continuation cursors are random, opaque, expire after five
minutes, are retained in a bounded store, and are bound to the exact tenant and
project; malformed, expired, and cross-scope cursors fail identically.

Cloud isolation conformance requires explicit API, store, cache, queue, backup,
and migration adapters. The matrix proves same-tenant success while requiring
cross-tenant and missing-resource requests to converge on `not_authorized`; an
incomplete surface set cannot pass. This is a harness for real adapters, not a
claim that provider infrastructure already exists.

The secondary-sink inventory is a closed ten-sink contract covering logs,
audit, metrics, traces, dead letters, caches, indexes, exports, backups, and
migrations. Every entry declares ownership, tenant scope, allowed non-sensitive
data classes, deletion behavior, and mandatory canary scanning. Bounded scans
reject source and secret markers everywhere and tenant markers in any sink not
authorized for that tenant.

The PostgreSQL integration case runs when `VERIFY_POSTGRES_URL` is set; CI binds
it to a digest-pinned PostgreSQL 17.6 service matching development RDS. Schemas
and compatibility are owned by Founding Engineering. M8 foundation acceptance
is covered by `cloud-client:test`. The digest-bound metadata-cloud
foundation report retains contract, security, and supply-chain verification,
but is explicitly not releasable: provider deployment, service SLO, and
disaster recovery remain blocked until their deployed M9 Evidence exists.
