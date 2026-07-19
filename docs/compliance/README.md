# Compliance Evidence

This directory maps frozen requirements to implementation owners, controls, and
retained conformance Evidence.

`MVP_COMPLIANCE.csv` begins as a planning skeleton. A requirement may move from
`planned` to `implemented` only when its named test or control exists and its
Evidence record identifies the tested artifact digest.

M5 release Evidence templates and the tested-byte promotion workflow are under
[`release/`](release/). Template status is deliberately `pending`; only
generated, digest-bound `passed` reports may enter a release candidate.
