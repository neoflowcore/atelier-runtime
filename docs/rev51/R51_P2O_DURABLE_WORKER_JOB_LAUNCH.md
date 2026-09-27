# Runtime Rev5.1 - P2O Durable Worker-Job Launch Claim

Status: Phase 2 candidate for exact remote application.

## Scope

This Runtime-owned slice adds a durable exactly-once launch claim between an already-created `WORKER_JOB_V1` and the first worker-job execution submission.

It does not reinterpret Pilote A6 execution-class or parallelism semantics. It consumes the existing worker-job contract and current P2A execution lineage only.

## Launch binding

The durable launch record binds:

- `WORKER_JOB_SHA256`
- `EXECUTION_ID`
- `ATTEMPT_ID`
- `FENCE_TOKEN`
- `ENTRYPOINT_SHA256`

The entrypoint is normalized through the existing Runtime A2 worker-job module. Shell entrypoint fields remain denied, `shell_interpretation` remains `DENY`, and `SEMANTIC_REPLANNING` must remain `DENY`.

## Exactly-once launch gate

Before launch claim Runtime acquires the same execution-state lock used by P2A, re-reads current execution state, verifies attempt/fence binding, and then atomically changes launch state from `AVAILABLE` to `CLAIMED`.

A successful result changes state to `STARTED` and prevents a second launch claim for the same worker job.

## Outcome unknown

`OUTCOME_UNKNOWN` changes the launch record to `OUTCOME_UNKNOWN`.

While in that state:

- blind retry is denied;
- a second launch operation is denied;
- only the same `OPERATION_ID` and operation idempotency key may reconcile the result.

## Durability

The launch journal uses state-version CAS, request idempotency, hash-chained events, fsync, atomic rename, and crash/reopen validation.

## Evidence classification

Repository engine: Node 22.13.0.
Local validation runtime: Node 22.16.0.

Local targeted execution used supplemental P2A / entrypoint harnesses and is classified as `SUPPLEMENTAL_PASS_CANONICAL_BLOCKED`. Candidate source imports the production Runtime modules at their normal repository paths.
