# R51 P2Q — Durable Execution Transport Registration / Conformance

## Scope

P2Q makes the selected execution transport durable without selecting a provider, reordering the DAG, or interpreting Pilote A6 execution-class/parallelism semantics.

Supported transport identities remain the frozen Rev5.1 schema values:

- `DIRECT_WORKER`
- `GITHUB_SELF_HOSTED_JIT`

The durable record binds transport state to the current `EXECUTION_ID`, `ATTEMPT_ID`, `FENCE_TOKEN`, `WORKER_ID`, and `WORKER_JOB_SHA256`.

## State machine

`PREPARING -> READY -> ACTIVE -> CLOSED`

Failure paths:

- conformance `FAIL|BLOCKED` -> `FAILED`
- activation `FAIL|BLOCKED` -> `FAILED`
- activation `OUTCOME_UNKNOWN` -> `OUTCOME_UNKNOWN`
- `OUTCOME_UNKNOWN` may only be reconciled by the same `OPERATION_ID` and remote idempotency key.

## Safety boundaries

- Transport activation requires conformance `PASS`.
- Transport activation requires the P2O worker-job launch to be `CLAIMED`.
- The current P2A execution fence is checked under the execution-state lock.
- Worker-job lineage drift is fail-closed.
- A second activation after `OUTCOME_UNKNOWN` is denied; only reconciliation of the same operation is allowed.
- Raw provider resource IDs, JIT registration IDs/tokens, runner registration tokens, credentials, and secret values are not part of the durable store.
- Closing the transport requires a SHA-256 deregistration evidence identity.

## Non-goals

P2Q does not:

- choose the compute provider;
- choose or reinterpret execution class;
- infer Pilote A6 semantics;
- mint a worker, attempt, fence, provider resource, or registration identity;
- dispatch a workflow or rerun GitHub Actions;
- mutate Task Contract V1, Interface V1, or the frozen 27 fields.

## Evidence classification

The local targeted tests run under Node `22.16.0` while the repository contract requires Node `22.13.0`. The local tests also use narrow P2A/P2O reader harnesses. They are therefore supplemental evidence only. Remote Git blob/tree/commit readback is separately classified as remote source-integrity evidence after apply.
