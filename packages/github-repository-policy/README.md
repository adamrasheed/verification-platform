# GitHub Repository Policy Provider

Unreleased first-party Plugin Contract implementation for narrow, read-only
GitHub repository-policy observation. The plugin can observe only the default
branch, its classic branch protection, and the effective ruleset rules that
apply to it.

The child process receives an opaque repository binding and an opaque secret
reference. It never receives an owner, repository name, credential, URL,
source file, pull-request state, or mutation authority. Engine-owned payload
validation maps the binding to three fixed `api.github.com` GET paths, attaches
the credential in the egress broker, and reduces responses to the versioned
policy contribution schema.

This package remains private and unreleased while the Windows production gate
in M6-T06 and M6-T07 is on hold.
