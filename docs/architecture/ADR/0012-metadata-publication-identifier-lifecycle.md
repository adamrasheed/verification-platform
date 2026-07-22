# ADR-0012: Metadata Publication Identifier Lifecycle

**Status:** accepted
**Date:** 2026-07-22
**Owner:** Lead Architect

## Context

Default metadata publication must not expose raw local semantic IDs or
revisions, or a cloud-available derivation key that permits dictionary testing.
The architecture requires stable, tenant-scoped, object-type-domain-separated
identifiers and explicitly gates metadata publication on their key lifecycle.

## Frozen clauses affected

This ADR resolves the implementation privacy decision required by Architecture
Freeze §§11.2–11.4 and the M8 entry gate without changing their semantics.

## Decision

Publication IDs use a versioned 256-bit keyed MAC over canonical bytes
containing a fixed product domain, tenant ID, closed object type, and exact
local revision reference. The first algorithm is HMAC-SHA-256 and the external
identifier is `pub_v1_` followed by unpadded base64url MAC bytes.

Local key material is generated with a cryptographically secure random source,
contains at least 256 bits, and is stored by an operating-system credential or
secret-storage integration. The Cloud Client receives only an operation handle
with a local key ID and MAC function. Key bytes, key IDs, local semantic IDs,
and local revisions are never included in cloud-visible documents.

The Engine atomically retains a local mapping from tenant, object type, and
exact local reference to the publication ID and local key ID. Existing mappings
remain authoritative after rotation; the new active key derives only previously
unmapped subjects. A collision with another local subject fails closed. Loss of
the key prevents new derivations but does not invalidate retained mappings or
already published cloud resources. Recovery imports the same key through the
local secret-store boundary; it never downloads derivation material from cloud.

Deletion removes the local mapping only as part of the same authorized deletion
unit that records the non-identifying tombstone required by Freeze §11. Cloud
tombstones retain only the opaque publication ID and deletion metadata. Key
rotation alone neither deletes nor republishes data, and never creates a hidden
retry or a second semantic request.

## Alternatives considered

- Sending raw revisions or unkeyed revision hashes.
- Using a cloud-held or tenant-global derivation key.
- Recomputing every publication ID when the active key rotates.
- Random identifiers without a durable local mapping.

## Tradeoffs

Stable rotation requires durable local mappings and secure local key backup.
Losing both the mapping and key prevents deterministic recovery, which is safer
than introducing cloud-visible linkability or a recovery escrow by default.

## Consequences

Publication identity is deterministic for a retained mapping, unlinkable across
tenant and object domains without the local key, and structurally distinct from
local `RevisionRef` values. Provider and region selection remain independent.

## Domain impact

None. Publication IDs are boundary identities and never become domain revisions
or inputs to Promise, Proof, Evidence, or outcome semantics.

## Security and privacy impact

The local key is `SECRET`. MAC input containing local references exists only in
local memory. Cloud payloads contain the opaque output and tenant binding only.

## Compatibility and migration

The `pub_v1_` prefix identifies the derivation format without exposing the key.
A future algorithm uses a new prefix and retains old mappings; it does not
silently reinterpret existing IDs.

## Conformance changes

Tests cover determinism, tenant and object separation, rotation stability,
invalid MAC length, cloud-field exclusion, and collision failure behavior.

## Rollback strategy

Disable metadata publication and retain local mappings. No local verification
result changes, and already accepted cloud publications remain immutable under
their declared retention and deletion rules.

## Reconsideration triggers

A platform cannot provide secure local key storage, HMAC-SHA-256 becomes
unsuitable, or an explicitly approved cross-device recovery feature is added.

## Approval

Accepted by Lead Architect.
