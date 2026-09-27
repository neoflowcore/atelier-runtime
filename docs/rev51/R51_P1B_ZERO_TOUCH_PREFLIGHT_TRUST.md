# Runtime Rev5.1 — R51-P1B Zero-Touch / Preflight / Trust Foundation

Status: `CANDIDATE / P1 CROSS-STACK SEAL PENDING`

This candidate implements only Runtime-owned enforcement semantics already accepted by the A/B Rev5.1 targeted reconciliation.

## Locked semantics

```text
COMPUTE_PROVIDER != EXECUTION_TRANSPORT != VERIFIER_POLICY

NORMAL_PATH_POLICY=ZERO_TOUCH_AFTER_APPROVAL
OPERATOR_ACTIONS_AFTER_APPROVAL=0
MANUAL_SSH_COUNT=0
MANUAL_TERMUX_COMMAND_COUNT=0
MANUAL_SECRET_COPY_COUNT=0
MANUAL_RUNNER_REGISTRATION_COUNT=0
WORKER_GITHUB_DEVICE_LOGIN_COUNT=0
MANUAL_RERUN_COUNT=0

READY_ATTESTATION_TTL=REQUIRED
PRE_TRIGGER_REVALIDATION=REQUIRED

CHAT_DISCONNECTED=NO_EFFECT
ANDROID_OFFLINE=NO_EFFECT
SSH_DISCONNECTED=NO_EFFECT
```

Capacity-first GitHub gate requires, immediately before the authoritative trigger:

```text
READY_ATTESTATION_VALID=PASS
SOURCE_IDENTITY_EXACT=PASS
EXECUTION_PLAN_VALID=PASS
APPROVAL_VALID=PASS
BUDGET_RESERVATION_VALID=PASS
VERIFIER_POLICY_EXACT=PASS
EXECUTION_TRANSPORT_READY=PASS
```

The following is recovery-only and is not a successful zero-touch normal path:

```text
queue first -> no runner -> manual runner setup -> rerun
```

## Operator intervention trust model

`OBSERVE_ONLY` does not invalidate attestation, advance fence, or require a new attempt.

`STATE_AFFECTING`, `PRIVILEGED_MUTATION`, and `RECOVERY_MUTATION` require:

```text
CURRENT_ATTESTATION_INVALIDATED
CURRENT_FENCE_ADVANCED
AUTOMATIC_RESULT_ACCEPTANCE_SUSPENDED
REATTESTATION_REQUIRED
NEW_ATTEMPT_REQUIRED
```

No Pilote semantic contract is defined or reinterpreted by this candidate.
