# Provider Plugin Developer Guide

**Status:** Contract available; production execution gated on native sandbox host

Provider plugins are separate, digest-pinned executables. They do not link
Engine internals and do not receive raw network or provider credentials.

## Contract workflow

1. Bundle the plugin operation entry point as a deterministic, self-contained
   single-file ESM artifact. Contract v1 does not admit unsigned relative
   runtime imports.
2. Declare a strict `ProviderPluginManifest`:
   - exact artifact SHA-256;
   - Plugin Contract versions and Engine compatibility;
   - operations, Evidence types, inputs, and side effects;
   - maximum filesystem, destination, and secret permissions;
   - source/build provenance and publisher key identity.
3. Sign the canonical manifest payload with the trusted Ed25519 publisher key.
4. Run every operation through the plugin conformance suite.
5. Publish the artifact, manifest, SBOM, provenance, and revocation channel
   separately from the core CLI.

The signature field is excluded from canonical signing bytes. The public key
embedded or referenced by a plugin is not self-authorizing; the user or
organization configures the publisher trust root independently.

## Process protocol

Each operation receives a fresh process. Standard input and output carry one
canonical JSON message per line. Standard error is bounded diagnostic data.

The first exchange is a mandatory handshake. It selects one mutually supported
Plugin Contract version before authorization or secret use. The operation then
emits:

- zero or more provider-neutral contributions;
- typed `ProviderRequest` messages for external observations;
- exactly one completion or typed operational error.

Malformed, duplicate, oversized, incompatible, late, or post-deadline messages
fail the invocation. Contributions are candidates; the Engine validates and
materializes all domain objects and remains the sole status authority.

## Provider requests

A plugin selects a manifest destination ID, signed path-template ID, typed path
parameters, method, outbound schema ID, data classification, bounded body, and
optional opaque Secret Reference ID. It cannot provide:

- a URL, raw path, hostname, port, redirect policy, or arbitrary headers;
- a credential value;
- proxy, telemetry, or ambient SDK configuration;
- source or sensitive Evidence without a feature-specific explicit-share gate.

The Engine broker validates the outbound body against a literal schema
allowlist, resolves and pins public destination addresses, attaches the scoped
credential, rejects redirects, bounds and validates the response, scans secret
canaries, and returns only sanitized JSON.

## Local development

Untrusted local-development plugins may exercise the protocol only through the
conformance tier. They receive no provider destinations, secrets, writes, or
subprocess permission and cannot satisfy production authorization.

The initial provider runtime also denies filesystem reads, filesystem writes,
subprocesses, and side effects for verified plugins. Discovery plugins and
mutating provider operations remain later permission modes with separate
conformance gates.

Production dynamic execution is currently unavailable until the signed native
sandbox host for the current platform passes ADR-0011. Do not instruct users to
override this gate.

The macOS development tier uses an App Sandbox application with an inherited
Node helper. It is continuously exercised with ad hoc signatures, but cannot
satisfy production authorization. A separate native supervisor enforces CPU
and physical-memory budgets without receiving plugin or provider data.
Production authorization additionally requires Developer ID signatures plus
pinned Team ID and supervisor/host/helper code-directory hashes.

The Linux production tier runs only when the native host, bundled Node helper,
system bubblewrap, and seccomp preload match release-pinned SHA-256 identities
and are not group- or world-writable. It exposes no workspace mount or external
network interface and enforces one process plus physical-memory and CPU budgets.
Restricted kernels that cannot construct every required namespace report the
plugin platform as unavailable.
