# Runtime Rev5.1 — R51-P3 Policy / Router / Admission / Approval

Status: `REMOTE APPLY CANDIDATE`

R51-P3 closes the frozen-plan policy surface by composing the already-published Rev5.1 contracts and durable foundations rather than redefining them.

## Deterministic router

Runtime candidate selection is deterministic:

```text
ROUTER_POLICY=DETERMINISTIC_PRIORITY_THEN_BACKEND_ID
```

A candidate is eligible only when all of the following hold:

- Runtime readiness is true;
- execution transport readiness is true;
- all frozen Task Contract capabilities are present;
- the A6 execution-class constraint is satisfied;
- the exact Pilote verifier-policy SHA256 is supported.

Selection order is Runtime-owned `ROUTER_PRIORITY`, then lexical `BACKEND_ID`. Pilote does not emit provider identity.

## Verifier separation

```text
P3_VERIFIER_SEPARATION_POLICY=
EXACT_POLICY_HASH_INDEPENDENT_OF_PROVIDER_AND_TRANSPORT
```

Compute/backend selection, execution transport and verifier policy remain separate axes.

## Read-only preflight

The P3 preflight wrapper calls the existing frozen `EXECUTION_PREFLIGHT_V1` validator with `GATE_TRIGGERED=false` and performs no mutation.

```text
PREFLIGHT_EFFECT=READ_ONLY
MUTATION_PERFORMED=false
```

## Aggregate admission / budget

P3 delegates mutation to the existing durable P2G admission transaction. Therefore aggregate reservation remains CAS/idempotency/fence-bound and cannot bypass the already-tested Task Contract and Runtime budget ceilings.

## Operator interaction / manual fallback

Normal-path manual fallback remains denied. State-affecting manual fallback is recovery-only and requires `RECOVERY_INTERACTION_ALLOWED + RECOVERY_MUTATION`.

## Plan invalidation

Approval is bound to exact `PLAN_HASH`. Drift or explicit invalidation maps to the existing Approval Grant V1 invalidation path rather than silent execution.

## Readiness TTL / pre-trigger revalidation

Every pre-trigger check uses Runtime-authoritative time against the durable readiness state. Expired readiness blocks the trigger and requires re-attestation.

## Approval Grant V1

P3 uses the already-sealed Approval Grant lifecycle:

```text
AVAILABLE -> CLAIMED -> CONSUMED
```

The first irreversible mutation claims `OPERATION_ID + IDEMPOTENCY_KEY`. `OUTCOME_UNKNOWN` keeps the same claim reconciliation-only and never reopens approval.

## Preserved boundaries

```text
TASK_CONTRACT_V1_MUTATION=0
FROZEN_27_FIELDS_MUTATION=0
INTERFACE_V1_MUTATION=0
SHARED_CONTRACT_REDESIGN=0
PILOTE_SEMANTIC_REINTERPRETATION=0
PROVIDER_SELECTION_OWNERSHIP=RUNTIME
VERIFIER_POLICY_EXACT=REQUIRED
BLIND_RERUN=0
```
