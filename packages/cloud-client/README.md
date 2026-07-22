# Cloud Client

Vendor-neutral metadata publication and signed-policy boundary contracts for
Architecture Freeze §11 and EDD §§16 and 27.

The public API owns strict metadata-publication validation, disclosure-manifest
preparation and byte-for-byte verification, locally keyed publication IDs, and
signed policy distribution validation. It depends only on the public Protocol
API. It does not calculate verdicts, upload source or Evidence bodies, perform
ambient telemetry, choose a cloud vendor, store key bytes, or issue network
requests.

All default outbound fields are `MINIMAL_METADATA`. Publication keys remain
behind a caller-supplied local key store and MAC operation; cloud-visible
documents never contain local semantic IDs, revisions, or key identifiers.
Existing local mappings preserve publication identity across key rotation.

Schemas and compatibility are owned by Founding Engineering. M8 foundation
acceptance is covered by `cloud-client:test`; release status is experimental.
