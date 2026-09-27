# Runtime Rev5.1 — R51-P2C Operator Intervention / Trust Reset

Status: `LOCAL CANDIDATE / REMOTE WRITE NOT AUTHORIZED`

Source anchor:

- repository: `neoflowcore/atelier-runtime`
- branch: `runtime-r51-a2-consumer-binding`
- HEAD: `8328423bd1484d8e0aba44ded6a38921600d9947`
- TREE: `13941ac2386aafd286edc91fabdc4970e1393cf1`
- contract set: `ATELIER_REV51_CONTRACT_SET_V1`
- CONTRACT_SET_SHA256: `a8b220c92a47306061e9aca1c65077d357b00bda12e9daad4f37215256083f4a`

## Scope

This bounded Runtime-owned slice implements `OPERATOR_INTERVENTION_RECEIPT_V1` and the previously sealed intervention trust boundary. It does not consume, infer, synthesize, or pre-implement Pilote R51-A3 verifier/acceptance intent semantics.

Implemented Runtime behavior:

1. canonical interaction classes are preserved: `OBSERVE_ONLY`, `STATE_AFFECTING`, `PRIVILEGED_MUTATION`, `RECOVERY_MUTATION`;
2. unknown or ambiguous interactive access fails conservative to `STATE_AFFECTING`;
3. `OBSERVE_ONLY` records a durable audit event while preserving attestation trust, attempt, lease, and fence authority;
4. state-affecting / privileged / recovery intervention records a durable receipt inside the hash-chained execution ledger;
5. state-affecting intervention advances fence authority and requires a new attempt and higher lease generation;
6. the receipt marks current attestation invalidated, automatic result acceptance suspended, re-attestation required, and new attempt required;
7. the pre-intervention one-shot session becomes stale after trust reset and cannot silently rejoin the new authority;
8. intervention recording is CAS-bound and idempotent;
9. receipt bytes are self-hashed and tamper-detectable;
10. intervention timestamps use explicit Runtime-authoritative time inputs.

## Minimum receipt meaning

`OPERATOR_INTERVENTION_RECEIPT_V1` binds:

```text
SESSION_ID
INTERACTION_CLASS
INTERVENTION_TYPE
REASON
AFFECTED_SCOPE
AFFECTED_STATE
AUTHORITY_EFFECT
STARTED_AT
ENDED_AT
POST_INTERVENTION_ATTESTATION
NEW_ATTEMPT_ID
NEW_LEASE_GENERATION
NEW_FENCE_TOKEN
```

The implementation additionally binds the execution id, pre/post authority tuple, fence sequence, classification mode, trust-reset flag, and receipt SHA-256.

## Trust effect

```text
OBSERVE_ONLY
=> ATTESTATION_INVALIDATION=NO
=> FENCE_ADVANCE=NO
=> AUTOMATIC_RESULT_ACCEPTANCE=UNCHANGED
=> REATTESTATION_REQUIRED=NO
=> NEW_ATTEMPT_REQUIRED=NO

STATE_AFFECTING | PRIVILEGED_MUTATION | RECOVERY_MUTATION
=> CURRENT_ATTESTATION_INVALIDATED
=> CURRENT_FENCE_ADVANCED
=> AUTOMATIC_RESULT_ACCEPTANCE_SUSPENDED
=> REATTESTATION_REQUIRED
=> NEW_ATTEMPT_REQUIRED
```

Ambiguous/unclassified interactive access is normalized to `STATE_AFFECTING` with `CLASSIFICATION_MODE=CONSERVATIVE_STATE_AFFECTING`.

## Durable authority effect

For state-affecting intervention:

```text
OLD_ATTEMPT / OLD_LEASE / OLD_FENCE
    -> OPERATOR_INTERVENTION_TRUST_RESET
    -> NEW_ATTEMPT / NEW_LEASE / NEW_FENCE
```

The complete receipt is embedded in the authoritative durable execution event payload. The previous one-shot session therefore fails exact attempt/lease/fence validation after trust reset.

`OBSERVE_ONLY` writes only the audit event and does not advance authority.

## Explicit non-scope

This slice does not define or change:

- Pilote R51-A3 verifier intent;
- Pilote R51-A3 acceptance intent;
- verifier-policy semantic meaning;
- acceptance-requirement semantic meaning;
- worker re-attestation issuance semantics;
- execution-session rebind semantics after re-attestation;
- provider provisioning/bootstrap saga;
- cost-accounting/admission arithmetic;
- full R51-P2 closure.

## Preserved invariants

```text
TASK_CONTRACT_V1_MUTATION=0
FROZEN_27_FIELDS_MUTATION=0
INTERFACE_V1_MUTATION=0
SHARED_CONTRACT_REDESIGN=0
PILOTE_SEMANTIC_REINTERPRETATION=0
PILOTE_R51_A3_SEMANTIC_DEPENDENCY=0

INV-042 STATE_AFFECTING_MANUAL_INTERVENTION_INVALIDATES_CURRENT_WORKER_ATTESTATION
INV-043 STATE_AFFECTING_MANUAL_INTERVENTION_REQUIRES_NEW_ATTEMPT_AND_FENCE
INV-048 OBSERVE_ONLY_OPERATOR_ACTION_DOES_NOT_RESET_TRUST
```

## Evidence boundary

Repository engine contract: Node `22.13.0`.

Available local runtime: Node `22.16.0`.

Therefore local syntax and targeted test results are supplemental evidence only. Exact source bytes, content SHA-256, Git blob SHA, candidate tree, fresh CAS, and later remote readback remain independently exact-bindable.
