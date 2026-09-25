# Runtime Rev5.1 — R51-A5T Execution Terminal Cross-stack Binding

Status: `REMOTE APPLY CANDIDATE`

## Authoritative Pilote A5T anchor

- branch: `pilote-r51-a5t-execution-terminal-semantic-binding`
- HEAD: `e74a428d1c987aaec396a8a144869747b42360e9`
- TREE: `1a403580a090edc8747c156ae67cd9031fbcf439`
- source status schema SHA256: `fd612bf9556b20b9434d6218ec437d9ec61dfe447f1d9eb534fbb4e7a2a3b5f2`

## Runtime binding

Runtime consumes the A5T semantic partition without reinterpreting it.

Terminal execution states:
`SUCCEEDED / FAILED / CANCELED / EXPIRED`

Non-terminal:
`REQUESTED / READY / RUNNING / OUTCOME_UNKNOWN`

`OUTCOME_UNKNOWN` remains reconciliation-required and cannot set `EXECUTION_TERMINAL`.

Concrete mutation requires Runtime-owned evidence bound to the current durable execution state:
- execution id;
- execution epoch;
- attempt id;
- lease generation;
- current fence token;
- durable state version;
- final durable event SHA-256;
- operation id and idempotency identity;
- closed `EXECUTION_SESSION_STATUS_V1` snapshot.

A terminal projection changes only P2B `EXECUTION_TERMINAL=true`. It does not imply result, project, or release acceptance.

## Preserved boundaries

`P2E EXECUTE PASS`, provider-saga COMPLETE, P2F acceptance, and arbitrary P2A `MATERIALIZED_STATE` are not used as substitutes for authoritative execution-state evidence.

Task Contract V1, frozen 27 fields, Interface V1, and shared Rev5.1 contracts are unchanged.
