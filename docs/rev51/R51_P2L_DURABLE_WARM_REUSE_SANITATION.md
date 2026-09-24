# Runtime Rev5.1 — P2L Durable Warm-Reuse Sanitation Receipt

P2L turns the frozen A5 warm-reuse sanitation requirement into a durable, one-time Runtime gate.

A receipt is issued only after prior-job terminal state, job credential revocation, workspace/process/network reset, absence of host mounts, a clean secret scan, and denial of untrusted code on a persistent worker. It is bound to the worker, previous job, next job, and next worker-ready attestation. Warm reuse consumes the receipt exactly once. Expired, invalid, consumed, mismatched, or replayed-for-another-job receipts fail closed.

P2L does not choose the next job, reorder a DAG, interpret A6 parallelism semantics, mint worker/job/attestation identities, or persist secret material.
