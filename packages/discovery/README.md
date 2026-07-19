# Discovery

Passive, deterministic, offline workspace discovery for npm, pnpm, and Yarn.
Readers inspect bounded ordinary data files and never evaluate repository code.

The package owns deny-only discovery plans, no-follow bounded file reads,
duplicate-key-safe structured JSON, static pnpm workspace parsing, attributed
signals/facts/conflicts, and deterministic Application Model construction.
`resolveAndSealWorkspaceModel` requires all four exact Proof definitions before
it creates Promises or Promise-Proof bindings.
