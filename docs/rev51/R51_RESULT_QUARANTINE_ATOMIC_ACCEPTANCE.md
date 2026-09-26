# Runtime Rev5.1 — Worker Result Quarantine to Atomic Acceptance

Status: LOCAL VERIFIED CANDIDATE / REMOTE WRITE REQUIRES EXACT WT APPROVAL

Base anchor:

- repository: `neoflowcore/atelier-runtime`
- branch: `runtime-r51-a2-consumer-binding`
- HEAD: `6955b7c4d68a0c8eec2202f160e4dc6e2501800e`
- TREE: `b79cf5e8d9817b60893666679d8c8ef7ad1537d4`

This Runtime-owned binding implements the existing Rev5.1 result acceptance order without adding or redesigning a shared cross-stack contract.

Acceptance order:

1. Validate exact `RUNTIME_EXECUTION_PLAN_V1` object hash.
2. Validate exact `WORKER_JOB_V1` object hash and upstream plan binding.
3. Require exact Runtime-owned `EXECUTION_ID`, `ATTEMPT_ID`, and `FENCE_TOKEN` verification bindings.
4. Require every candidate artifact to already be `QUARANTINED` and bound to the same execution.
5. Require content digest proof for every candidate artifact.
6. Require content, fence, worker-job, execution-plan, and security/output-contract verification gates to all PASS.
7. Only after every gate passes, derive immutable artifact records without mutating the quarantined inputs.
8. Emit `EXECUTION_RECEIPT_V1`, hash-bound to the exact `WORKER_JOB_V1` and `RUNTIME_EXECUTION_PLAN_V1`, with sorted accepted artifact IDs.

Fail-closed rules:

- non-PASS verification cannot accept output;
- stale fence binding is rejected;
- worker-job or plan hash drift is rejected;
- non-quarantined output is rejected;
- artifact origin mismatch is rejected;
- content digest mismatch is rejected;
- duplicate artifact IDs are rejected;
- security/output-contract verification is mandatory.

Preserved invariants:

- `TASK_CONTRACT_V1_MUTATION=0`
- `FROZEN_27_FIELDS_MUTATION=0`
- `INTERFACE_V1_MUTATION=0`
- `SHARED_CONTRACT_REDESIGN=0`
- `PILOTE_SEMANTIC_REINTERPRETATION=0`
- `WORKER_SAYS_PASS != RUNTIME_ACCEPTED_OUTPUT`

The candidate uses the already sealed `ARTIFACT_STORE_V1` and `EXECUTION_RECEIPT_V1` schemas. The verification evidence object consumed by the Runtime module is Runtime-private implementation input and is not introduced as a new shared schema.
