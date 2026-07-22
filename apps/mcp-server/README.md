# Verify Local MCP Server

Local stdio MCP adapter for one host-configured workspace binding. The client
cannot supply a filesystem path: `--workspace` resolves the root at process
startup and tools accept only the matching opaque `--binding` value.

```sh
npm run build
node apps/mcp-server/dist/bin/verify-mcp.js \
  --workspace /absolute/workspace \
  --binding workspace:local
```

The server exposes canonical verification, retained run/evidence/provenance
reads, permission inspection, and read-only schema/glossary resources. It does
not expose Repair application, installation, credentials, publication, remote
dispatch, prompts, sampling, or network transports.
