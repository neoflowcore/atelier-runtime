# Runtime Rev5.1 - R51-P2G Durable Admission / Budget Reservation / Cancellation

Status: LOCAL VERIFIED CANDIDATE / REMOTE WRITE NOT YET AUTHORIZED

## Scope

This Runtime-owned slice adds durable admission, numeric budget reservation, and cancellation gating without changing Task Contract V1, Interface V1, the frozen 27 fields, or Pilote semantics.

Pilote A6 is not yet authoritative remote. P2G therefore does not interpret `PARALLELISM_INTENT`, execution-class semantics, DAG scheduling, or scheduling order.

## Authoritative inputs consumed

P2G consumes already-frozen inputs only:

- Task Contract V1 `ECONOMY_BUDGET.MAX_EXECUTIONS`
- Task Contract V1 `ECONOMY_BUDGET.MAX_RETRIES`
- Task Contract V1 `ECONOMY_BUDGET.MAX_REPAIRS`
- Task Contract V1 `ECONOMY_BUDGET.MAX_PARALLELISM`
- A2 `BUDGET_INTENT.MAX_RUNTIME_SECONDS`
- A2 `BUDGET_INTENT.MAX_COST_MICRO_USD`
- current P2A execution-state `EXECUTION_ID`
- current P2A `STATE_VERSION`
- current P2A `ATTEMPT_ID`
- current P2A `LEASE_GENERATION`
- current P2A `FENCE_TOKEN`

`MAX_PARALLELISM` is enforced only as the numeric ceiling already frozen inside Task Contract V1. No A6 parallelism semantics are inferred.

## Durable admission model

A reservation is required before a new execution, retry, or repair may start.

Each reservation durably binds:

- reservation ID supplied by the caller;
- reservation kind (`EXECUTION`, `RETRY`, or `REPAIR`);
- runtime-seconds reservation;
- cost-micro-USD reservation;
- current P2A fence token;
- current P2A execution-state version;
- current attempt ID;
- current lease generation.

The store maintains append-only hash-chained events and idempotency receipts. The same idempotency key with the same request is replay-safe; a changed request using the same key is denied.

Budget is intentionally not refunded when a reservation reaches a terminal state. This prevents crash/retry cycles from silently regaining already-admitted budget.

## Atomicity and race boundary

Every admission mutation acquires the existing P2A execution-state lock first and the admission-store lock second:

```text
acquire <execution-state>.lock
-> acquire <admission-store>.lock
-> validate full P2A durable state
-> validate EXPECTED_EXECUTION_STATE_VERSION
-> validate current FENCE_TOKEN
-> validate admission STATE_VERSION CAS
-> apply reservation/start/settlement/cancellation transition
-> append hash-chained event
-> fsync temp
-> atomic rename admission store
-> fsync directory
-> release admission lock
-> release execution-state lock
```

This prevents a fence/state transition from racing between admission validation and durable admission commit.

## Cancellation boundary

Cancellation closes admission immediately.

After cancellation is requested:

- new reservations are denied;
- previously reserved but not started work cannot start;
- terminal settlement remains allowed so cleanup/reconciliation can finish;
- cancellation becomes terminal once no active reservations remain;
- the cancellation record binds the current P2A fence token but does not mint or advance a Runtime fence, attempt, lease, provider, worker, or operation identity.

Already-submitted remote operations remain governed by the existing P2A/P2E `OUTCOME_UNKNOWN -> same operation reconciliation only` boundary. P2G does not reopen approval or authorize a second remote mutation.

## Result of local targeted validation

```text
NODE_CHECK=PASS
TARGETED_TESTS=18/18 PASS
CURRENT_FENCE_BINDING=PASS
EXECUTION_STATE_CAS=PASS
BUDGET_IDEMPOTENCY=PASS
MAX_EXECUTIONS_FAIL_CLOSED=PASS
MAX_RETRIES_FAIL_CLOSED=IMPLEMENTED
MAX_REPAIRS_FAIL_CLOSED=IMPLEMENTED
MAX_RUNTIME_FAIL_CLOSED=PASS
MAX_COST_FAIL_CLOSED=PASS
MAX_PARALLELISM_NUMERIC_CEILING=PASS
CANCELLATION_NEW_ADMISSION=DENY
CANCELLATION_NEW_START=DENY
TERMINAL_SETTLEMENT_AFTER_CANCEL=ALLOW
CRASH_REOPEN=PASS
EVENT_LEDGER_TAMPER=DENY
```

## Evidence classification

Repository engine: Node `22.13.0`.
Available local runtime: Node `22.16.0`.

The local test environment uses a supplemental P2A validator harness to exercise the new module in isolation. The candidate source imports the repository's real `runtime/rev51/durable-execution-state-v1.mjs`; the harness is not part of the candidate patch.

Therefore local execution evidence is `SUPPLEMENTAL_PASS_CANONICAL_BLOCKED`.

## Preserved invariants

```text
TASK_CONTRACT_V1_MUTATION=0
FROZEN_27_FIELDS_MUTATION=0
INTERFACE_V1_MUTATION=0
SHARED_CONTRACT_REDESIGN=0
PILOTE_SEMANTIC_REINTERPRETATION=0
PILOTE_A6_SEMANTIC_DEPENDENCY=0
PARALLELISM_INTENT_REINTERPRETATION=0
EXECUTION_CLASS_REINTERPRETATION=0
DAG_SCHEDULING_REINTERPRETATION=0
RUNTIME_OWNED_PROVIDER_ID_EMISSION=0
RUNTIME_OWNED_WORKER_ID_EMISSION=0
RUNTIME_OWNED_ATTEMPT_ID_EMISSION=0
RUNTIME_OWNED_FENCE_TOKEN_EMISSION=0
```
