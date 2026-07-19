# Plugin SDK

Provider-facing, provider-neutral Plugin Contract bindings. The SDK defines
strict manifest, NDJSON message, operation, permission, and broker request
types. It performs no filesystem, process, network, credential, or provider SDK
I/O.

Contract v1 artifacts are deterministic, self-contained single-file ESM
bundles. The manifest digest identifies those exact executable bytes; relative
runtime imports are not part of the artifact and therefore are not available.

Installation is not authorization. Manifest permissions are maximum requests,
not runtime grants. Provider credentials are represented only by opaque
references and are never delivered through this protocol.
