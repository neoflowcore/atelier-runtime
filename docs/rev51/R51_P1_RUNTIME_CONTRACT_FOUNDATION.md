# Runtime Rev5.1 — R51-P1 Runtime Contract Foundation

Status: `CANDIDATE / CROSS_STACK_SEAL_PENDING`

This changeset starts Runtime Rev5.1 after the read-only R51-P0 exact Rev5.0 baseline lock.

## Scope

This candidate implements Runtime-owned enforcement foundations only:

- immutable downstream contract envelope/hash chaining;
- exact Rev5.0 Interface V1 / Task Contract V1 freeze checks;
- compute provider / execution transport / verifier policy separation;
- exclusive per-execution input mode (`LEGACY_COMPAT` vs `NATIVE_REV51`);
- approval grant atomic claim before first irreversible remote submission;
- `OUTCOME_UNKNOWN` reconciliation without reopening authority.

## Explicit non-ownership

This candidate does not define or reinterpret Pilote project/phase/task semantics, semantic dependencies, acceptance meaning, verifier intent, or approval-boundary intent.

`PILOTE_EXECUTION_INTENT_V1` remains a Pilote-owned semantic contract. Runtime consumes its exact immutable hash and later cross-stack-sealed schema identity.

## Frozen baseline

```text
INTERFACE_VERSION=1.0.0
INTERFACE_MANIFEST_SHA256=90b016211babd4f10b7de7700c54ea6e2db9179563d88502fc1d9983ad47b617
TASK_CONTRACT_SCHEMA_SHA256=6afcf7aa1b7d3d73b28d6195326db22c82774de308664ce85ba52e42fba640e8
TASK_CONTRACT_MACHINE_SCHEMA_SHA256=3bdbb85a7879c8cee2c7eb2f18c3936fac7a44389ec0ae61f0954b9c19660b65
FROZEN_FIELDS=27
TASK_CONTRACT_V1_MUTATION=0
INTERFACE_V1_MUTATION=0
```

## Cross-stack constraints preserved

```text
AUTHORITATIVE_PROJECT_DAG_OWNER=PILOTE
AUTHORITATIVE_PHASE_DAG_OWNER=PILOTE
AUTHORITATIVE_TASK_DAG_OWNER=PILOTE
AUTHORITATIVE_EXECUTION_DAG_OWNER=RUNTIME
AUTHORITATIVE_EXECUTION_STATE_OWNER=RUNTIME

COMPUTE_PROVIDER != EXECUTION_TRANSPORT != VERIFIER_POLICY

ONE_EXECUTION=EXACTLY_ONE_INPUT_MODE
LEGACY_TO_REV51_INTENT_SYNTHESIS=0
REV51_TO_LEGACY_DOWNGRADE=0

FIRST_IRREVERSIBLE_REMOTE_SUBMISSION -> ATOMIC_APPROVAL_CLAIM
OUTCOME_UNKNOWN -> APPROVAL_REOPEN=DENY
OUTCOME_UNKNOWN -> SAME_OPERATION_IDEMPOTENCY_RECONCILIATION_ONLY
```

## P1 closure note

This is not the R51-P1 final cross-stack seal. P1 remains open until Developer A and Developer B bind exact shared bytes for the Pilote-owned intent schema, compatibility profiles/oracles, shared fixtures, canonicalization IDs, protocol/contract-set identity, and the rest of the agreed P1 contract set.
