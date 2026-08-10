# Authorization

Deny-default local authorization. Repository files are inputs and can never
grant permissions to the verifier.

The package also owns the provider-neutral M8 cloud action catalog and exact
tenant/resource authorization decision. Cloud roles and memberships are
expanded server-side into exact grants; user, workload, and operator
principals receive no ambient tenant or support bypass. Wrong-tenant, wrong-ID,
missing-resource, and absent-grant cases share the same public denial.

The cloud identity verifier accepts one closed Ed25519 compact-JWT profile.
Tokens are audience restricted, live for at most fifteen minutes, support
independent key and token revocation, and intentionally carry no tenant, role,
action, or resource authority. Those grants are always resolved server-side.
