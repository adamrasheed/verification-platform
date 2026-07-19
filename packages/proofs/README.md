# Proofs

Provider-neutral, pure workspace-integrity evaluators. Verdicts are derived only
from validated normalized Evidence observations.

The four registry Proof revisions contain no Promise references; associations
are supplied to model sealing separately. Effective-attempt and Promise
aggregation preserve `error` and `cancelled` as indeterminate, require validated
Evidence for pass/fail, enforce one model/execution context, and exclude
ephemeral attempt and cache identities from deterministic result digests.
