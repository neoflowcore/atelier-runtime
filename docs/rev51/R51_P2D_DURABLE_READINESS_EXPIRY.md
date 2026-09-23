# Runtime Rev5.1 - R51-P2D Durable Readiness Expiry / Re-attestation Gate

Status: LOCAL VERIFIED CANDIDATE / REMOTE WRITE NOT AUTHORIZED

## Scope

This Runtime-owned slice closes the durable readiness-expiry gap between preflight validation and one-shot execution-session binding.

It does not define Pilote A6 semantics and does not modify Task Contract V1, Interface V1, or the frozen contract set.

## Runtime behavior

1. A valid `WORKER_READY_ATTESTATION_V1` is durably registered with worker ID, execution-plan hash, attestation ID/hash, issue time, and expiry time.
2. Runtime-authoritative time is used to reconcile expiry.
3. At or after `EXPIRES_AT`, readiness becomes `EXPIRED`, the execution gate closes, and `REATTESTATION_REQUIRED=true` is durably recorded in the hash-chained event ledger.
4. Restart/reopen preserves the expired gate state.
5. A replacement attestation is accepted only after expiry and only for the same worker and execution-plan hash.
6. Replacement reopens the readiness gate but does not mint or advance attempt, lease, or fence identity.
7. An already-created one-shot session is not silently rebound. Its `WORKER_READY_ATTESTATION_HASH` must equal the currently durable attestation hash; therefore the pre-expiry session becomes stale after replacement.
8. New session creation may explicitly bind the replacement attestation hash.

## Boundary

Readiness TTL expiry is not treated as state-affecting operator intervention. Time expiry alone therefore does not advance Runtime execution authority.

State-affecting manual intervention remains governed separately by P2C and requires the existing trust-reset / new-attempt / fence-advance path.

## Evidence boundary

Repository engine: Node 22.13.0.
Available local runtime: Node 22.16.0.

Local syntax and targeted tests are supplemental evidence because of the Node-version mismatch. Exact source bytes, content SHA-256, Git blob SHA, candidate tree, fresh CAS, and later remote readback remain independently bindable.
