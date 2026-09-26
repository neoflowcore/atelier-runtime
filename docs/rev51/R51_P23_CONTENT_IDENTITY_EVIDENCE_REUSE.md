# Runtime Rev5.1 P23 — Content-Identity Evidence Reuse

P23 reuses content-dependent PASS evidence only when exact content identity matches (for example a Git tree or artifact digest). Commit/merge/release metadata evidence remains separately reevaluated even when source content is identical. Tree equality never implies release acceptance.
