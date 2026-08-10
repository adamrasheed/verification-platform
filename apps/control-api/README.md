# Control API

Provider-neutral HTTP adapter for the first metadata-cloud `/v1` surface. The
adapter accepts only bounded canonical JSON, authenticates short-lived bearer
identities, resolves grants server-side, authorizes the exact tenant and
resource, and delegates publication semantics to `cloud-client`.

The current surface contains publication-intent creation, publication
acceptance, and bounded published-run reads. Dispatch remains unavailable until
M9-T07 connects a customer-controlled workload engine. AWS runtime wiring stays
under `tooling/infra/aws`; this application contains no provider SDK.
