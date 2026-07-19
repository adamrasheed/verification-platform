# Plugin Runtime

Owns plugin artifact verification, publisher trust and revocation, protocol
framing, process containment, deadlines/cancellation, and the Engine-controlled
provider egress broker.

Production dynamic execution is fail-closed. It remains unavailable until a
signed native host for the current platform passes the filesystem, process,
network, secret, cancellation, and resource canaries in ADR-0011. Test-only
launchers are visibly marked and cannot satisfy a production authorization.

The macOS development host is an App Sandbox `.app` with an inherited,
JIT-entitled Node helper. The Engine sends exact digest-pinned artifact bytes
over a dedicated inherited pipe; the helper receives an empty environment and
Node capability restrictions while App Sandbox denies raw network and
workspace access. It remains a non-production tier until distribution signing
is available.

The separate native supervisor sees only process identity and configured
limits. It enforces physical-memory and CPU budgets, propagates cancellation to
the sandbox tree, and maps exhaustion to a typed runtime error. A production
launcher becomes available only when Developer ID authority, Team ID, hardened
runtime, and exact supervisor/host/helper code-directory hashes all match.
