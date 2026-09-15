# Runtime D — Parallel / Multi-Caller Orchestration Foundation

Entry gate:

```text
RUNTIME_C=SEALED
PILOTE_REV4.5=SEALED
SYNC_3=PASS
PHASE_TO_TYPED_TASKS_TO_RECEIPTS=PASS
```

This additive foundation gives Runtime ownership of lease and scheduling state without changing Interface V1 or Pilote semantics.

## D1 scope

- deterministic branch/repository lease scope;
- shared-read and exclusive-write coordination;
- explicit acquire / renew / release / expiry transitions;
- multi-caller and multi-repository scheduling;
- exact idempotency binding over `TASK_CONTRACT_HASH`, opaque `APPROVAL_ID`, `DISPATCH_NONCE`, `EXECUTION_ID`, and `GENERATION`;
- same-scope write exclusion;
- Runtime C gateway requirement retained for candidate writes.

## Authority fences

```text
LEASE_GRANTS_SOURCE_WRITE_AUTHORITY=NO
SCHEDULER_GRANTS_SOURCE_WRITE_AUTHORITY=NO
REMOTE_SOURCE_WRITE=RUNTIME_C_GATEWAY_ONLY
MERGE_AUTHORITY=NONE_IN_D1
FINAL_MERGE_AUTHORITY=HUMAN_ONLY
INTERFACE_V1_MUTATION=0
FROZEN_27_FIELDS_MUTATION=0
PILOTE_SEMANTIC_REIMPLEMENTATION=0
SAME_BRANCH_CONCURRENT_WRITE=DENY
FORCE_PUSH=DENY
BLIND_RERUN=DENY
```

A lease is coordination evidence, not semantic approval and not mutation authority. Approval identifiers remain opaque Runtime bindings; Runtime does not infer approval meaning.

## Deferred from D1

Exact-approved merge mechanics and candidate-tag coordination are Plan D responsibilities but are intentionally deferred to the next Runtime D increment so the lease/scheduler core can be sealed independently. Production merge activation remains prohibited through Rev5.
