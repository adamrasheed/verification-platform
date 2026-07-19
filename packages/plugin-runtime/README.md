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
and a hard memory supervisor pass conformance.
