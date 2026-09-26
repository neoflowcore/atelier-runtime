# Runtime Rev5.1 — R51-A3 Cross-stack Verifier / Acceptance Consumer Binding

Status: `LOCAL VERIFIED CANDIDATE / REMOTE WRITE NOT YET AUTHORIZED`

## Authoritative Pilote A3E anchor

- repository: `neoflowcore/atelier-runtime`
- branch: `pilote-r51-a3-verifier-acceptance-intent`
- HEAD: `8a87ddb7fba03165339f86b26047417624b43899`
- TREE: `fc8ce3ce6c7a1650c2894937699c51876b6428bc`
- schema SHA256: `59652f22bbf361b496947b26671aae81d58ff79c579561c050bf0e54b830cf58`
- canonicalization: `ATELIER_EXECUTION_CANONICAL_JSON_V1`
- Pilote verifier-policy module SHA256: `a3d086939dc5e08e5ec20beb85b30a0e0d5275c2d165c24d97e563d339786c5a`
- test-vector-set SHA256: `080b23a76005d83bfdd8495c51c486959d6ba53e6be9181e460e01fa0202e61f`
- expected-result-set SHA256: `7d884b47d4c2f1c47f404dd3bf148036447324d86ef93e88be34a1b4f77c93bd`
- authoritative manifest SHA256: `ad914089dec666fb5befc4ba9084736043bd1466b3f543a11823c3a6e4fab6ca`

## Runtime-owned consumer behavior

The Runtime consumer validates the exact A3 policy envelope and then binds:

1. A2 `VERIFIER_POLICY_REF.ID/VERSION/SHA256` to the A3 policy bytes.
2. A2 `ACCEPTANCE_REQUIREMENT_REF` to the A3 policy acceptance reference.
3. Runtime plan `VERIFIER_POLICY` to the A3 selected mode.
4. Runtime plan `VERIFIER_POLICY_REF_SHA256` to the A3 policy hash.
5. Runtime plan `ACCEPTANCE_REQUIREMENT_REF` to the exact Pilote semantic reference.
6. Runtime plan `EXECUTION_INTENT_SHA256` and contract-set identity to their existing upstream anchors.

The Runtime consumer does not create acceptance criteria, tolerance, or direct project acceptance from worker success.

Fixed denies remain:

- `RUNTIME_DEFINED_ACCEPTANCE_SEMANTICS=DENY`
- `RUNTIME_DEFINED_TOLERANCE=DENY`
- `RAW_WORKER_SUCCESS_DIRECT_ACCEPTANCE=DENY`

Supported modes remain exactly:

- `RUNTIME_REQUIRED`
- `PROJECT_CI_REQUIRED`
- `RUNTIME_PLUS_PROJECT_CI`

The eight normalized A3E vectors are reproduced by the targeted Runtime consumer tests with the same expected outcomes.

## Preserved invariants

```text
TASK_CONTRACT_V1_MUTATION=0
FROZEN_27_FIELDS_MUTATION=0
INTERFACE_V1_MUTATION=0
SHARED_CONTRACT_REDESIGN=0
PILOTE_SEMANTIC_REINTERPRETATION=0
RUNTIME_DEFINED_ACCEPTANCE_SEMANTICS=0
RAW_WORKER_SUCCESS_DIRECT_PROJECT_ACCEPTANCE=0
```
