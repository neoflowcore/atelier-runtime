# Runtime Rev5.1 — R51-P2F Durable Result Acceptance Transaction

Status: LOCAL VERIFIED CANDIDATE / REMOTE WRITE NOT AUTHORIZED

## Scope

This Runtime-owned slice converts the already-existing `QUARANTINE_VERIFY_ATOMIC_ACCEPT` result validation into a durable exactly-once acceptance commit.

It does not redefine Pilote verifier semantics, mutate Task Contract V1, modify Interface V1, or add a new shared cross-stack schema.

## Commit boundary

Authoritative result acceptance occurs only while Runtime holds the same durable execution-state lock used by P2A plus an acceptance-journal lock.

The commit sequence is:

1. Acquire `${statePath}.lock` used by durable execution-state CAS.
2. Acquire `${journalPath}.lock` for acceptance serialization.
3. If an accepted journal already exists, permit only exact idempotent replay of the same request fingerprint.
4. Read and validate current durable execution state.
5. Require exact `STATE_VERSION`, `EXECUTION_EPOCH`, `LEASE_GENERATION`, `ATTEMPT_ID`, and `FENCE_TOKEN` bindings.
6. Deny acceptance while provider outcome reconciliation is unresolved.
7. Run the existing exact quarantine/content/security/result verification policy.
8. Build the immutable accepted-artifact manifest and `EXECUTION_RECEIPT_V1`.
9. Bind them to the exact source durable-state event sequence/hash.
10. Persist one hash-bound `DURABLE_RESULT_ACCEPTANCE_V1` journal by fsync + atomic rename + directory fsync.
11. Release locks.

## Exactly-once rules

- blob existence is not authoritative acceptance;
- a stale fence cannot commit;
- a stale attempt, execution epoch, lease generation, or state version cannot commit;
- `OUTCOME_UNKNOWN` / reconciliation-required state cannot commit;
- failed verification leaves the authoritative journal absent;
- a stale temporary file is not authoritative acceptance;
- the same idempotency key and request fingerprint may replay after restart;
- the same idempotency key with changed semantic request is denied;
- a second acceptance under another idempotency key is denied;
- reopen validates the journal hash and the embedded `EXECUTION_RECEIPT_V1` object hash.

## Evidence classification

Repository engine contract: Node 22.13.0.
Available local runtime: Node 22.16.0.

The pre-existing `result-quarantine-acceptance-v1.mjs` used in the local harness is byte-identical to the remote source (`SHA256=86ccc2d2f186886a26e1a381c9a6eac4ec0bfafedbed6a041c725c4b207730c4`).

The P2A durable-state validator is represented by a narrow local harness after fresh remote source inspection; therefore the targeted execution evidence remains supplemental rather than canonical/full-repository integration evidence.

## Preserved invariants

- `TASK_CONTRACT_V1_MUTATION=0`
- `FROZEN_27_FIELDS_MUTATION=0`
- `INTERFACE_V1_MUTATION=0`
- `SHARED_CONTRACT_REDESIGN=0`
- `PILOTE_SEMANTIC_REINTERPRETATION=0`
- `PILOTE_A6_SEMANTIC_DEPENDENCY=0`
- `WORKER_SAYS_PASS != RUNTIME_ACCEPTED_OUTPUT`
- `BLOB_EXISTENCE != AUTHORITATIVE_ARTIFACT_ACCEPTANCE`
