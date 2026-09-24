# Pilote Rev5.1 R51-A5T — Execution Terminal Semantic Binding

Status: `AUTHORITATIVE CANDIDATE`

Purpose: close the cross-stack gap identified by Runtime P2X without pre-implementing A6 or changing the shared contract set.

## Existing source semantic

A5T binds only the already-existing:

`schemas/rev51/execution-session-status-v1.schema.json`

Exact source identity:

```text
SHA256=fd612bf9556b20b9434d6218ec437d9ec61dfe447f1d9eb534fbb4e7a2a3b5f2
GIT_BLOB=d0e0c62d1b387d39eb911e493eeb459e283e626a
```

Existing EXECUTION_STATE enum:

```text
REQUESTED
READY
RUNNING
SUCCEEDED
FAILED
CANCELED
EXPIRED
OUTCOME_UNKNOWN
```

## Terminal projection

```text
TERMINAL:
SUCCEEDED
FAILED
CANCELED
EXPIRED

NON_TERMINAL:
REQUESTED
READY
RUNNING
OUTCOME_UNKNOWN
```

Therefore:

```text
OUTCOME_UNKNOWN != EXECUTION_TERMINAL
OUTCOME_UNKNOWN -> RECONCILIATION_REQUIRED
```

Runtime must not infer terminal execution from provider-saga COMPLETE, P2E EXECUTE PASS, P2F acceptance, or arbitrary P2A MATERIALIZED_STATE.

## Acceptance boundary

```text
EXECUTION_TERMINAL
!= EXECUTION_ACCEPTED
!= PROJECT_ACCEPTED
!= RELEASE_ACCEPTED
```

Even `SUCCEEDED` only means the execution lifecycle is terminal. It does not imply result acceptance.

## Ownership

Pilote owns the semantic partition of the existing enum.

Runtime owns:

- concrete durable evidence for current EXECUTION_STATE;
- current attempt / fence validity;
- state-transition CAS;
- mutation of P2B `EXECUTION_TERMINAL`;
- operation and idempotency identities.

```text
RUNTIME_EVIDENCE_AUTHORITY=AUTHORITATIVE_RUNTIME_EVIDENCE_REQUIRED
PILOTE_DIRECT_FLAG_MUTATION=DENY
```

## Non-goals

A5T does not:

- modify Task Contract V1;
- modify frozen 27 fields;
- modify Interface V1;
- redesign the shared Rev5.1 contract set;
- redefine P2E/P2F/P2T/P2U/P2X ownership;
- publish or pre-implement A6 semantics.
