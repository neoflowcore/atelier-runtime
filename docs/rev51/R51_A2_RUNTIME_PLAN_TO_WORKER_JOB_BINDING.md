# Runtime Rev5.1 — RUNTIME_EXECUTION_PLAN_V1 → WORKER_JOB_V1 Binding

Status: `RECOVERED LOCAL CANDIDATE / REMOTE WRITE REQUIRES NEW EXACT WT APPROVAL`

Base anchor:

- repository: `neoflowcore/atelier-runtime`
- branch: `runtime-r51-a2-consumer-binding`
- HEAD: `e0f8cf109ed305cd425c9864719132aa73062311`
- TREE: `0655cce631f2b7626c105762b0af6aff9bdb3743`

This Runtime-owned binding preserves the frozen cross-stack contract boundary. It does not modify Task Contract V1, the frozen 27 fields, Interface V1, or Pilote project/phase/task semantics.

Binding rules:

1. `RUNTIME_EXECUTION_PLAN_V1.OBJECT_SHA256` is copied exactly into both `WORKER_JOB_V1.UPSTREAM_OBJECT_SHA256` and `EXECUTION_PLAN_HASH`.
2. Runtime must supply non-empty `EXECUTION_ID`, `ATTEMPT_ID`, and `FENCE_TOKEN`.
3. `DIRECT_WORKER` maps to `DIRECT_REMOTE`; `GITHUB_SELF_HOSTED_JIT` maps to `GITHUB_GATE`.
4. `ENTRYPOINT_SPEC_V1` is structured and shell interpretation defaults to `DENY`; shell command/script fields are rejected.
5. `SEMANTIC_REPLANNING=DENY` is fixed in every emitted worker job.
6. Worker job `OBJECT_SHA256` is computed with the existing Rev5.1 canonical object hash function and is validated as an exact downstream envelope.

The previously proposed `WT-RUNTIME-R51-A2DOWN-001` is not reused because its exact payload bytes were not recoverable after session interruption. This candidate must be sealed under a new exact WT before any remote mutation.
