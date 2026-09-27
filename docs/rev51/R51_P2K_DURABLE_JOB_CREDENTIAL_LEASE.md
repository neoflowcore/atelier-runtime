# Runtime Rev5.1 — P2K Durable Job-Scoped Credential Lease / Revocation

P2K turns the authoritative A5 credential boundary into durable Runtime state without persisting secret material.

## Runtime behavior

- `JOB_SCOPED_CREDENTIAL_LEASE=REQUIRED` is enforced from the bound A5 policy.
- lease identities, execution IDs, worker IDs, job hashes, attestation hashes, attempts, and fence tokens are consumed as bindings; this slice mints none of them.
- only an opaque `CREDENTIAL_REF` is durable; credential material / token / password / private-key fields are rejected.
- credential use requires the current execution, attempt, fence, worker, worker-job hash, and worker-ready-attestation hash.
- expiry or terminal cancellation/trust reset/lease replacement marks revocation required and immediately blocks credential use.
- revocation `OUTCOME_UNKNOWN` may only reconcile the exact same `OPERATION_ID` and `OPERATION_IDEMPOTENCY_KEY`; blind retry / second mutation is denied.
- terminal `REVOKED` state survives restart and event-ledger tampering fails closed.

## Boundary

This slice does not modify Runtime E administrator credential grants, Task Contract V1, Interface V1, Pilote A5 semantics, or Pilote A6 parallelism / execution-class semantics.
