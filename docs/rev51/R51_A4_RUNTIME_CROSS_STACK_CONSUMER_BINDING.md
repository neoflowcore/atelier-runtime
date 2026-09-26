# Runtime Rev5.1 — R51-A4 Cross-stack Approval / Effect / Operator Consumer Binding

Status: `LOCAL VERIFIED CANDIDATE / REMOTE WRITE NOT YET AUTHORIZED`

## Authoritative Pilote A4 anchor

- repository: `neoflowcore/atelier-runtime`
- branch: `pilote-r51-a4-approval-effect-operator-intent`
- HEAD: `395779f3ff04fb56d2aaa6a836a05b6600d18747`
- TREE: `a0615fd74f6d7235744453f46b3430037afd4858`
- schema SHA256: `7848f5983ef42ea06e1909530990961ca3db6d34e268a414cd238ad7ef1afa5d`
- canonicalization: `ATELIER_EXECUTION_CANONICAL_JSON_V1`
- test-vector-set SHA256: `18fafc3b42b3fb1a7df852003d2499dce9ab9cdcd7f4c032a7949a35962f589b`
- expected-result-set SHA256: `2ec752e64d99da612c82fe9e316e7e2e2835160226c78d3740670fdaf132ca95`
- authoritative manifest SHA256: `bc8085b27534092a7dc22d2a0f79ff4a7ba48af9c06cbbcf940fbc8fa0486554`

## Runtime-owned binding only

The Runtime consumer does not create or reinterpret Pilote approval semantics. It validates and preserves the exact A4 semantic intent and binds it to the already-existing Task Contract, A2 execution intent, Runtime execution plan, Runtime approval grant enforcement, and P2C operator trust-reset boundary.

Runtime enforces these exact relationships:

1. `PROJECT_ID / PHASE_ID / TASK_ID` remain bound across Task Contract, A2 intent, and A4 intent.
2. `TASK_CONTRACT_SHA256` and `EXECUTION_INTENT_SHA256` remain exact.
3. A4 approval mode, effect refs, and scope refs remain identical to A2 `APPROVAL_BOUNDARY` and Runtime plan `APPROVAL_BOUNDARY`.
4. A4 cannot escalate beyond Task Contract `EFFECT_CLASSES` or `ALLOWED_SCOPE`.
5. `REMOTE_MUTATION_INTENT`, `HOST_OPERATION_INTENT`, `INTERVENTION_POLICY`, and `OPERATOR_POLICY` remain upstream-bound.
6. `EXACT_APPROVAL_REQUIRED` requires `EXPLICIT_HUMAN_APPROVAL`.

## Authority boundary

The binding preserves:

```text
DECLARATION_NEVER_GRANTS_AUTHORITY
FIRST_IRREVERSIBLE_REMOTE_SUBMISSION -> ATOMIC_APPROVAL_CLAIM_REQUIRED
OUTCOME_UNKNOWN -> SAME_OPERATION_RECONCILE
APPROVAL_REOPEN=DENY
SECOND_MUTATION=DENY
ZERO_TOUCH_AFTER_APPROVAL
STATE_AFFECTING_INTERVENTION -> TRUST_RESET_REQUIRED
OBSERVE_ONLY_INTERVENTION -> TRUST_PRESERVED
```

Runtime-owned approval, operation, attempt, lease, fence, worker, provider, or resource identities are not accepted inside Pilote A4 intent.

The existing `runtime/rev51/approval-grant-v1.mjs` remains the Runtime enforcement mechanism for claim/reconcile/consume state; the A4 consumer does not mint a grant or operation ID.

The existing P2C trust-reset implementation remains the Runtime enforcement mechanism for state-affecting operator intervention; A4 does not mint replacement attempt/lease/fence authority.

## Local verification

Available local Node: `22.16.0`
Repository engine: `22.13.0`

Therefore test execution is supplemental evidence.

Targeted result:

```text
NODE_CHECK=PASS
TARGETED_TESTS=18/18 PASS
A4_AUTHORITATIVE_VECTOR_RESULTS=8/8 PASS
APPROVAL_EFFECT_SCOPE_BINDING=PASS
APPROVAL_GRANT_COMPATIBILITY=PASS
OUTCOME_UNKNOWN_RECONCILIATION_BOUNDARY=PASS
```

## Preserved invariants

```text
TASK_CONTRACT_V1_MUTATION=0
FROZEN_27_FIELDS_MUTATION=0
INTERFACE_V1_MUTATION=0
SHARED_CONTRACT_REDESIGN=0
PILOTE_SEMANTIC_REINTERPRETATION=0
RUNTIME_OWNED_APPROVAL_ID_EMISSION=0
RUNTIME_OWNED_OPERATION_ID_EMISSION=0
RUNTIME_OWNED_FENCE_IDENTITY_EMISSION=0
```
