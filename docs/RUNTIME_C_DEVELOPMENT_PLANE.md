# Runtime C Development Plane

Runtime C introduces an isolated development execution plane after Runtime B is sealed. It does not compile Pilote phases or tasks. It consumes an already-valid Interface V1 Task Contract and enforces Runtime-owned execution constraints.

The development profile is `SELF_HOSTED_LINUX_X64_DEV_WORKSPACE_V1` layered on the existing `SELF_HOSTED_LINUX_X64_V1` backend identity. The backend itself still grants no target-source authority. Candidate source mutation exists only through the Plan C source-write gateway.

Required boundaries:

```text
WORKSPACE_CLASS=ISOLATED_WRITABLE
REMOTE_MUTATION_INTENT=EXACT_APPROVAL_REQUIRED
REMOTE_SOURCE_WRITE=GATEWAY_ONLY
VALIDATION_EXECUTION_SOURCE_WRITE=0
MERGE_AUTHORITY=NONE
FINAL_MERGE_AUTHORITY=HUMAN_ONLY
LEASE_STATE=NOT_IMPLEMENTED_PLAN_D
```

Runtime C rejects production, merge/tag, host-privileged and oracle effects. Same-task parallelism is restricted to one before Plan D. Runtime C never assigns meaning to `INTERVENTION_POLICY`, `REPLAN_BOUNDARY` or any future Pilote approval vocabulary.
