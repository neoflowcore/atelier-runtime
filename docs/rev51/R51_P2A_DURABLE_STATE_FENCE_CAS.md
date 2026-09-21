# Runtime Rev5.1 — R51-P2A Durable State / Fence CAS Core

Status: `LOCAL CANDIDATE / REMOTE WRITE NOT AUTHORIZED`

Source anchor:

- repository: `neoflowcore/atelier-runtime`
- branch: `runtime-r51-a2-consumer-binding`
- HEAD: `76cbf506f27ef68332eba0b1ee8c7f2443c23f27`
- TREE: `4daf4a5577db4421f0c3782529fc4777edd6a6e1`
- contract set: `ATELIER_REV51_CONTRACT_SET_V1`
- CONTRACT_SET_SHA256: `a8b220c92a47306061e9aca1c65077d357b00bda12e9daad4f37215256083f4a`

## Scope

This is the first bounded Runtime-owned slice of R51-P2. It does not consume or synthesize Pilote R51-A3 verifier/acceptance semantics.

Implemented Runtime correctness primitives:

1. single-node durable execution-state record persisted by atomic temp-write + fsync + rename;
2. logical append-only event ledger with SHA-256 event hash chaining;
3. state-version compare-and-swap;
4. state-transition idempotency keys with conflict detection;
5. explicit Runtime-authoritative time input;
6. execution epoch / attempt / lease generation / fence state persistence;
7. strict fence sequence monotonicity and fence-token non-reuse;
8. stale-fence rejection before authoritative mutation;
9. provider `OUTCOME_UNKNOWN` persistence with reconciliation required and blind retry denied;
10. restart/reopen verification from durable bytes.

## Explicit non-scope

This candidate does not implement the entire R51-P2 phase. It intentionally leaves later bounded slices for:

- durable one-shot session lifecycle;
- operator-intervention receipt persistence;
- readiness-attestation expiry persistence/reconciliation;
- provider/bootstrap lifecycle saga state;
- state/event schema migrations beyond the V1 version boundary;
- stale lock recovery / multi-process coordination hardening.

It also does not modify:

```text
TASK_CONTRACT_V1
PILOTE_EXECUTION_INTENT_V1
RUNTIME_EXECUTION_PLAN_V1
WORKER_JOB_V1
EXECUTION_RECEIPT_V1
VERIFIER_POLICY
ACCEPTANCE_REQUIREMENT
```

## Preserved invariants

```text
TASK_CONTRACT_V1_MUTATION=0
FROZEN_27_FIELDS_MUTATION=0
INTERFACE_V1_MUTATION=0
SHARED_CONTRACT_REDESIGN=0
PILOTE_SEMANTIC_REINTERPRETATION=0

EXECUTION_DELIVERY=AT_LEAST_ONCE_POSSIBLE
AUTHORITATIVE_RESULT_ACCEPTANCE=EXACTLY_ONCE
STALE_FENCE_RESULT=REJECT
FENCE_TOKEN_ORDER=STRICTLY_MONOTONIC
FENCE_TOKEN_REUSE=DENY
OUTCOME_UNKNOWN_BLIND_RETRY=DENY
```

## Evidence boundary

The repository engine contract is Node `22.13.0`. The available local execution environment is Node `22.16.0`; therefore local syntax/test results are supplemental evidence only. Exact candidate bytes/hashes remain suitable for a later exact WT/CAS proposal after fresh remote drift verification.
