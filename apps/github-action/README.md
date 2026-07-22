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
  - uses: actions/checkout@v4
  - uses: adamrasheed/verification-platform/apps/github-action@v1
```
