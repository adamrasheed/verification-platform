# Evidence

Normalizes, bounds, classifies, redacts, and validates passive workspace
observations. Raw repository files are never retained.

Normalization rejects absolute, escaping, duplicate, and non-normalized paths,
validates exact observation content identities, redacts before hashing, and
retains only bounded canonical observations. Validation produces a separate
immutable decision. `EvidenceCaptureCommitPort.commitCapture` defines the
atomic Evidence-plus-attempt-edge boundary.
