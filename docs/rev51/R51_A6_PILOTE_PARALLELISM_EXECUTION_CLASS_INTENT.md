# Pilote Rev5.1 R51-A6 — Parallelism / Execution-Class Intent

Status: `AUTHORITATIVE CANDIDATE`

Upstream anchor:

- repository: `neoflowcore/atelier-runtime`
- branch: `pilote-r51-a5t-execution-terminal-semantic-binding`
- HEAD: `e74a428d1c987aaec396a8a144869747b42360e9`
- TREE: `1a403580a090edc8747c156ae67cd9031fbcf439`

A6 binds already-published Task Contract V1 and A2 execution-intent semantics. It does not introduce a new scheduler, provider selector, backend identifier, reservation identifier, queue identifier, worker identifier, attempt, lease, or fence.

## Parallelism semantic boundary

A2 already carries:

```text
PARALLELISM_INTENT =
INHERIT_DAG
PARALLEL_ALLOWED
SERIAL_REQUIRED
```

A6 makes their exact semantics explicit:

```text
INHERIT_DAG
-> preserve semantic dependency DAG
-> effective cap = frozen Task Contract MAX_PARALLELISM

PARALLEL_ALLOWED
-> parallel execution is permitted, not required
-> preserve semantic dependency DAG
-> effective cap = frozen Task Contract MAX_PARALLELISM

SERIAL_REQUIRED
-> effective cap = 1
-> preserve semantic dependency DAG
```

Runtime may always apply a stricter concurrency limit for admission/capacity/cost/safety. Runtime must not exceed the A6 effective cap.

Runtime may add execution-only ordering edges needed for concrete safety or resource serialization, but it may not invent or remove semantic dependency edges.

## Execution-class semantic boundary

Task Contract V1 already freezes:

```text
RUNTIME_DEFAULT
HOSTED_ELIGIBLE
SELF_HOSTED_REQUIRED
HOST_LOCAL_REQUIRED
```

A6 preserves these existing classes without changing Interface V1.

`SELF_HOSTED_REQUIRED` and `HOST_LOCAL_REQUIRED` are hard class constraints. They cannot be silently downgraded.

`HOSTED_ELIGIBLE` expresses eligibility, not a concrete provider choice.

`RUNTIME_DEFAULT` delegates concrete execution-class realization to Runtime while preserving all other semantic constraints.

Concrete provider/backend/worker/resource selection remains Runtime-owned.

## Provider / transport independence

```text
EXECUTION_CLASS != COMPUTE_PROVIDER
COMPUTE_PROVIDER != EXECUTION_TRANSPORT
```

A hard self-hosted class does not itself choose VMware, DigitalOcean, a runner ID, a VM ID, or any other provider identity.

## Admission intersection

A6 semantic limits are combined with Runtime admission limits by intersection:

```text
ALL_APPLICABLE_LIMITS_MUST_PASS
```

Examples include:

- Task Contract `MAX_PARALLELISM`;
- A6 serial/parallel semantic cap;
- project concurrency limit;
- provider concurrency limit;
- execution-class limit;
- active cost reservation.

Runtime P2G may continue enforcing the already-frozen numeric Task Contract ceiling. A6 now supplies the semantic interpretation P2G intentionally did not infer before publication.

## Preserved invariants

```text
TASK_CONTRACT_V1_MUTATION=0
FROZEN_27_FIELDS_MUTATION=0
INTERFACE_V1_MUTATION=0
SHARED_CONTRACT_REDESIGN=0
A2_EXECUTION_INTENT_SCHEMA_MUTATION=0
A5T_EXECUTION_TERMINAL_SEMANTIC_MUTATION=0

RUNTIME_SEMANTIC_EDGE_ADD=DENY
RUNTIME_SEMANTIC_EDGE_REMOVE=DENY
RUNTIME_EXECUTION_ONLY_EDGE_ADD=ALLOW

RUNTIME_OWNED_PROVIDER_ID_EMISSION=0
RUNTIME_OWNED_WORKER_ID_EMISSION=0
RUNTIME_OWNED_RESERVATION_ID_EMISSION=0
RUNTIME_OWNED_SCHEDULER_ID_EMISSION=0
```
