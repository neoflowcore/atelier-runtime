# Pilote Rev5.1 R51-A4 — Approval / Effect / Operator Intent

Status: `AUTHORITATIVE CANDIDATE`

Upstream semantic anchor:

- repository: `neoflowcore/atelier-runtime`
- branch: `pilote-r51-a3-verifier-acceptance-intent`
- HEAD: `8a87ddb7fba03165339f86b26047417624b43899`
- TREE: `fc8ce3ce6c7a1650c2894937699c51876b6428bc`
- contract set: `ATELIER_REV51_CONTRACT_SET_V1`
- CONTRACT_SET_SHA256: `a8b220c92a47306061e9aca1c65077d357b00bda12e9daad4f37215256083f4a`

R51-A4 publishes the Pilote-owned approval/effect/operator semantic intent. It does not create Runtime approval grants, claims, operation IDs, idempotency keys, attempts, leases, fence tokens, workers, providers, or resources.

## Authority boundary

Declared task effects, allowed scopes, approval mode, operator policy, and intervention policy are semantic intent only.

`DECLARATION_NEVER_GRANTS_AUTHORITY`

The first irreversible remote submission requires Runtime to atomically claim an available approval grant before submission:

`FIRST_IRREVERSIBLE_REMOTE_SUBMISSION -> ATOMIC_APPROVAL_CLAIM_REQUIRED`

Pilote does not mint the grant ID or claim ID.

For an unknown provider outcome:

`OUTCOME_UNKNOWN -> SAME_OPERATION_RECONCILE -> APPROVAL_REOPEN=DENY -> SECOND_MUTATION=DENY`

The exact Runtime operation and idempotency identity remain Runtime-owned.

## Effect and scope binding

A4 is bound to the existing A2 `APPROVAL_BOUNDARY` and the sealed Task Contract V1 fields:

- `EFFECT_CLASSES`
- `ALLOWED_SCOPE`
- `REMOTE_MUTATION_INTENT`
- `HOST_OPERATION_INTENT`
- `INTERVENTION_POLICY`

A4 cannot add an effect class or scope that the Task Contract did not declare.

For `REMOTE_MUTATION_INTENT=EXACT_APPROVAL_REQUIRED`, A4 requires `APPROVAL_MODE=EXPLICIT_HUMAN_APPROVAL`.

## Operator boundary

Normal policy remains:

`ZERO_TOUCH_AFTER_APPROVAL`

Observe-only interaction preserves trust. State-affecting, privileged, recovery, or ambiguous interactive mutation requires the Runtime trust-reset path already implemented by Runtime P2C:

`CURRENT_ATTESTATION_INVALIDATED -> CURRENT_FENCE_ADVANCED -> AUTOMATIC_RESULT_ACCEPTANCE_SUSPENDED -> REATTESTATION_REQUIRED -> NEW_ATTEMPT_REQUIRED`

A4 states this semantic requirement but does not generate the new Runtime attempt, lease, fence, or intervention receipt.

## Preserved invariants

```text
TASK_CONTRACT_V1_MUTATION=0
FROZEN_27_FIELDS_MUTATION=0
INTERFACE_V1_MUTATION=0
SHARED_CONTRACT_REDESIGN=0
A2_EXECUTION_INTENT_SCHEMA_MUTATION=0
A3_VERIFIER_ACCEPTANCE_SEMANTIC_MUTATION=0
RUNTIME_OWNED_APPROVAL_ID_EMISSION=0
RUNTIME_OWNED_OPERATION_ID_EMISSION=0
RUNTIME_OWNED_FENCE_IDENTITY_EMISSION=0
```
