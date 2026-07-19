# MVP Repository Corpus

These repositories are inert data fixtures. The verifier must never execute
their scripts or configuration. Each fixture carries an `expected.json`
document used by integration and security gates.

Large and platform-sensitive fixtures are generated under the operating-system
temporary directory by `tooling/conformance/generated-corpus.mjs`. The
generated suite covers bounded and 100,000-file trees, deep paths,
Unicode/case collisions, symlinks, special files, mutation, cache corruption,
and secret canaries without checking those files into the repository.
