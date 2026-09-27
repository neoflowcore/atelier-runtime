# R51 P2M — Durable Capability Attestation Epoch / Drift Gate

P2M persists the A5 `STATIC_AND_DYNAMIC_REQUIRED` capability-attestation policy and `FAIL_CLOSED` capability-drift policy without redefining Pilote semantics.

A durable epoch binds `WORKER_ID`, `WORKER_JOB_SHA256`, static attestation/fingerprint, dynamic attestation/fingerprint, state version, and an append-only hash-chained event ledger. A dynamic fingerprint mismatch transitions the epoch to `DRIFTED`; the same epoch cannot self-heal and requires a separately created new attestation epoch.

Execution is allowed only when a dynamic attestation exists, worker/job/epoch bindings match, and the durable state is `ACTIVE` with no drift.
