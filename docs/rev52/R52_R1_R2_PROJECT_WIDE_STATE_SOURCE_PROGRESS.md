# Runtime Rev5.2 R52-R1/R2 — Project-Wide Durable State and Source Progress

## Implemented

- `PROJECT_RUN_STATE_V2` with durable project/plan/source binding.
- Separate `ACTIVE_NEXT`, `DEFERRED_AUTH_NEXT`, provider-live, paid-resource and final-merge/release queues.
- Legacy `NEXT=AUTH/BOUND` migration that cannot override later credential-independent source work.
- Project-wide scan across phases for source/code/test/docs/config/spec/provider-independent evidence.
- Explicit semantic/safety live dependency as the only live dependency class allowed to block affected source work.
- Administrative/inferred live dependency does not block later source work.
- Auth endgame eligibility requires project-wide credential-independent exhaustion and closure-preflight PASS.
- Closure preflight itself requires no auth, provider mutation or paid compute.
- Alternate legal work is selected around locally blocked nodes.

## Supplemental local verification

The isolated new tests pass under the available local Node 22.16.0 environment. This is supplemental evidence only; repository-canonical Node 22.13.0 qualification is performed through the existing Runtime self-test workflow.

## Gates addressed

```text
LEGACY_NEXT_AUTH_CANNOT_OVERRIDE_SOURCE = PASS
REATTACH_DETERMINISTIC = addressed by deterministic state digest / migration receipt
DUPLICATE_EXECUTION = 0 by migration contract
CURRENT_PHASE_WORK_EXHAUSTED != PROJECT_WIDE_CREDENTIAL_INDEPENDENT_WORK_EXHAUSTED
AUTH_ENDGAME_READY != AUTH_ENDGAME_EXECUTABLE
INFERRED_LIVE_DEPENDENCY_AS_BLOCKER = DENY
AUTH_ENDGAME_CLOSURE_PREFLIGHT_REQUIRES_AUTH = FALSE
AUTH_ENDGAME_CLOSURE_PREFLIGHT_REQUIRES_PROVIDER_MUTATION = FALSE
AUTH_ENDGAME_CLOSURE_PREFLIGHT_REQUIRES_PAID_COMPUTE = FALSE
```
