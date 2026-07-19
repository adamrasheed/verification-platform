# Plugin Installation and Authorization

**Status:** User contract; production execution gated on native sandbox host

Installing a plugin, trusting its publisher, and authorizing an operation are
three separate decisions.

## Installation

Installation records the exact artifact digest and manifest. It grants no
filesystem, process, provider, secret, or side-effect permission. A later
artifact version is a different executable and is never silently substituted
inside a run.

## Publisher trust

Publisher trust binds a publisher ID and Ed25519 key for a bounded validity
period. Every launch rechecks:

- manifest signature;
- exact artifact digest;
- publisher validity;
- revoked key and artifact lists;
- Engine, protocol, and platform compatibility.

Revocation fails closed. A local-development artifact is visibly untrusted and
cannot inherit production permissions.

## Operation authorization

Authorization shows the exact effective operation:

- plugin and operation IDs;
- sandbox enforcement tier;
- maximum physical-memory and CPU budgets, plus the plugin-process count;
- filesystem read and write roots;
- destination IDs, methods, path classes, and byte bounds;
- Secret Reference IDs, audiences, and scopes;
- side effects and expiry.

The Engine rejects any difference between the authorization decision, manifest
maximums, operation request, and broker grant. Non-interactive use requires an
existing external policy that grants the exact values.

Secret values never enter the plugin process. The broker attaches a credential
only to the named outbound provider request and revokes the handle at
cancellation, expiry, or process exit.

## Current availability

The SDK, signed manifest, protocol runtime, authorization boundary, egress
broker, and synthetic conformance suite are implemented. Production dynamic
execution remains `unavailable` until a signed native sandbox host passes the
platform canaries. The macOS implementation now passes filesystem, subprocess,
raw-network, memory, CPU, cancellation, and signature-rejection canaries; it
becomes production-available only for a release-pinned Developer ID bundle.
The Linux implementation passes the equivalent namespace, seccomp, identity,
resource, and protocol canaries with release-pinned native dependencies; hosts
that restrict the required namespaces remain unavailable.
The ordinary plugin-free CLI continues to operate normally.
