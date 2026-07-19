# ADR-0011: Plugin Security Enforcement

**Status:** accepted
**Date:** 2026-07-19
**Owner:** Lead Architect

## Context

The Plugin Contract and egress-broker boundary are frozen, but dynamic plugin
execution remained gated on concrete sandbox, publisher trust, revocation, and
secret-delivery selections. The first implementation must make an unavailable
control visible and fail closed rather than silently treating a child process
as a sandbox.

## Frozen clauses affected

This ADR resolves Architecture Freeze §§9, 10.5, 11.5, 14.4, 18 and 20.1 without
changing their semantics.

## Decision

Production backends are selected as a small signed native sandbox host using:

- Linux user/mount/PID/network namespaces plus a reviewed seccomp profile;
- macOS App Sandbox entitlements on the host and inherited helper, not the
  deprecated `sandbox-exec` interface;
- Windows AppContainer with a restricted token and Job Object.

The TypeScript runtime does not substitute Node's Permission Model for those
controls because Node documents it as unsuitable for malicious-code isolation.
Until a native host for a platform is built, signed, and passes the canaries,
the effective tier is `unavailable` and dynamic execution fails closed. Test
launchers use the visibly non-production `conformance-process-v1` tier and
cannot satisfy a production authorization.

The first macOS implementation packages a sandboxed background application and
an inherited Node helper. Exact artifact bytes enter through a dedicated pipe,
are rehashed and staged inside the application container, and execute with an
empty environment and Node capability restrictions. Ad hoc signing is accepted
only by the non-production development tier. Production remains unavailable
until Developer ID identities and code-directory hashes are pinned and a hard
memory supervisor passes its canary.

Distributable plugins require:

- an exact SHA-256 artifact digest;
- an Ed25519 signature over canonical manifest metadata;
- a separately configured publisher trust root;
- non-revoked publisher key and artifact digests;
- source and build provenance in the signed manifest.

Local-development plugins are digest-pinned but untrusted. They may run only
without provider egress, secret bindings, workspace writes, or subprocesses.

Secret values never enter plugin argv, environment, stdin, stdout, protocol
messages, or files. Plugins receive only opaque Secret Reference IDs. The
Engine-owned egress broker resolves an invocation-scoped reference and attaches
the credential directly to an authorized outbound request. The broker scans
the bounded provider response for credential canaries before returning a
sanitized response.

Provider egress uses manifest destination IDs instead of arbitrary URLs. The
broker owns HTTPS construction, DNS resolution, public-address enforcement,
redirect denial, method/path/schema allowlists, byte limits, credential
attachment, response parsing, redaction, cancellation, and audit.

## Alternatives considered

- Treating an ordinary child process as a sufficient sandbox.
- Shipping bubblewrap without a seccomp and process-control profile.
- Passing short-lived credentials to plugin stdin or environment variables.
- Trusting a public key embedded only in the plugin manifest.
- Allowing plugin-selected URLs behind a hostname allowlist.

## Tradeoffs

Native host packaging adds platform work and broker-compatible provider clients
must be adapted to typed requests. Dynamic execution remains unavailable during
that work, keeping the security claim precise and preventing ambient SDK
behavior from escaping the contract.

## Consequences

The plugin SDK and protocol runtime remain portable. Unsupported or incomplete
native hosts fail before launch, and the plugin-free CLI continues to work
unchanged. A backend may become available without changing the Plugin Contract
only after it proves equivalent enforcement.

## Domain impact

None. Plugin output remains candidate data; the Engine remains the only
authority that materializes Evidence, Repairs, Proof results, or aggregate
Promise status.

## Security and privacy impact

Installation, publisher trust, runtime authorization, provider credentials, and
egress are separate decisions. No one decision implies another.

## Compatibility and migration

Plugin Contract major 1 is the first stable major. Readers reject incompatible
majors before authorization. Additive minor fields follow the frozen
compatibility window.

## Conformance changes

Conformance covers manifest integrity, signature and revocation, handshake,
duplicate/malformed/oversized messages, crash, timeout, flood, cancellation,
permission denial, secret canaries, DNS address classes, redirects, telemetry
destinations, and three provider behaviors without core changes.

## Rollback strategy

Revoke the publisher key or artifact digest and disable the runtime entry point.
The plugin-free Engine and retained history remain valid.

## Reconsideration triggers

A portable capability or WebAssembly backend proves equivalent filesystem,
process, network, secret, cancellation, and resource enforcement with less
native packaging.

## Approval

Accepted by Lead Architect.
