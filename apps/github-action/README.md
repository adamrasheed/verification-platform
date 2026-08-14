# Verify GitHub Action

The Action runs the canonical local Engine inside the workflow checkout and
projects a terminal result through `github-check-projector`. The check body is a
fixed metadata allowlist and contains no annotations. Give the workflow
`checks: write` only when check publication is desired.

```yaml
permissions:
  contents: read
  checks: write
steps:
  - uses: actions/checkout@v7
  - uses: adamrasheed/verify-action@v1
```

The dedicated public distribution is
[`adamrasheed/verify-action`](https://github.com/adamrasheed/verify-action).
Use `@v1` for compatible v1 updates or `@v1.0.0` for the immutable first
release. This directory remains the canonical implementation and conformance
source; the distribution repository records the exact source revision and
bundle digest for every release.

## Customer-workload offers

`runCustomerWorkloadOffer` is the customer-owned execution boundary used by a
transport adapter after it claims a tenant-bound offer. It rejects offers that
are not bound to `workload:github:$GITHUB_REPOSITORY`, runs the nested canonical
request offline against the checked-out workspace, heartbeats the fenced lease,
and forwards cancellation to the Engine. Only an immutable, source-free
dispatch context and a validated `MetadataPublicationPayload` cross the
injected publication transport; local source, evidence bytes, the lease token,
and the full canonical envelope never do. Completion stores only the
verification invocation ID and the published-run reference.
