# Adapter Core

Shared local command dispatch and canonical result projection for transport
adapters. This package owns no presentation verdicts: CLI, MCP, and GitHub
consume the same protocol envelope and may only add transport-specific
presentation outside it.

Workspace paths are resolved from host-configured bindings. A caller can select
only the exact binding already authorized by the adapter host.
