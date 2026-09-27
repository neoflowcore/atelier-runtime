# Runtime Rev5.1 - P2N Durable Resource Ownership Proof

Status: Phase 2 candidate for exact remote application.

## Scope

This Runtime-owned slice converts the A5 resource-ownership requirement from a boolean preflight observation into a durable, fence-bound proof that must be claimed before any destructive provider-resource action.

It does not define provider resource semantics, create provider identifiers, reinterpret Pilote intent, or modify Task Contract V1 / Interface V1.

## Binding

The proof is durably bound to:

- `EXECUTION_ID`
- `EXECUTION_EPOCH`
- `ATTEMPT_ID`
- `LEASE_GENERATION`
- `FENCE_TOKEN`
- `WORKER_JOB_SHA256`
- `RESOURCE_FINGERPRINT_SHA256`
- `CREATION_RECEIPT_SHA256`
- `OWNERSHIP_ASSERTION_SHA256`

Raw provider resource identifiers are intentionally not persisted by this store.

## Destructive-action gate

Before the first destructive mutation, Runtime acquires the same execution-state lock used by P2A and then the ownership-proof lock. It re-reads the authoritative execution state, verifies the execution lineage and submitted fence, and atomically changes the proof from `AVAILABLE` to `IN_USE`.

A successful destructive operation consumes the proof. A second destructive operation using the same proof is denied.

## Outcome unknown

`OUTCOME_UNKNOWN` changes the proof to `RECONCILIATION_REQUIRED`.

While in that state:

- blind retry is denied;
- a second destructive operation is denied;
- only the same `OPERATION_ID` plus the same operation idempotency key may reconcile the result.

A reconciled PASS consumes the proof. A definitive FAIL/BLOCKED closes the proof fail-closed.

## Durability

State transitions use:

- exclusive lock files;
- state-version CAS;
- request idempotency fingerprints;
- hash-chained append-only events;
- fsync of the temporary file;
- atomic rename;
- directory fsync.

Crash/reopen therefore preserves the authoritative proof state.

## Evidence classification

Repository engine: Node 22.13.0.
Local validation runtime: Node 22.16.0.

Local targeted execution used supplemental A5/P2A harnesses and is classified as `SUPPLEMENTAL_PASS_CANONICAL_BLOCKED`. The candidate source itself imports the production A5 and P2A modules by their normal repository paths.
