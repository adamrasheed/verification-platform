# Control API

Provider-neutral HTTP adapter for the first metadata-cloud `/v1` surface. The
adapter accepts only bounded canonical JSON, authenticates short-lived bearer
identities, resolves grants server-side, authorizes the exact tenant and
resource, and delegates publication semantics to `cloud-client`.

The current surface contains dispatch creation/read/cancellation,
publication-intent creation, publication acceptance, and bounded published-run
reads. Dispatch requests are admitted only for explicitly bound customer
workloads, use a nested offline Verify request, and never carry source. AWS
runtime wiring stays under `tooling/infra/aws`; this application contains no
provider SDK.
