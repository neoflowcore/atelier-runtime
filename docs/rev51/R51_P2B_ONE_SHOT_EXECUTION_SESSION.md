# Runtime Rev5.1 — R51-P2B One-Shot Execution Session Lifecycle

Status: `LOCAL CANDIDATE / REMOTE WRITE NOT AUTHORIZED`

Source anchor:

- repository: `neoflowcore/atelier-runtime`
- branch: `runtime-r51-a2-consumer-binding`
- HEAD: `70d8c5e8c8e603d63106daad84a9b751b6e44822`
- TREE: `89009c981abf88995ea5c2bca2ce1fe7bc2292fa`
- contract set: `ATELIER_REV51_CONTRACT_SET_V1`
- CONTRACT_SET_SHA256: `a8b220c92a47306061e9aca1c65077d357b00bda12e9daad4f37215256083f4a`

## Scope

This bounded Runtime-owned slice implements the durable operational lifecycle of `ONE_SHOT_EXECUTION_SESSION_V1`. It consumes the already-remote-verified P2A durable execution-state/fence core and does not consume, synthesize, or pre-implement Pilote R51-A3 verifier/acceptance semantics.

Implemented:

1. durable session persistence with atomic write/fsync/rename;
2. exact binding to immutable execution-plan hash, execution epoch, attempt, lease generation and fence token;
3. opaque exact-hash compute-provider and execution-transport bindings;
4. worker-ready attestation hash, approval-grant id and budget-reservation id binding;
5. session-local CAS and idempotency conflict detection;
6. hash-chained session event ledger;
7. chat/SSH/Android/client disconnect evidence with `SESSION_LIFETIME_EFFECT=NO_EFFECT`;
8. completion rule stricter than job success;
9. terminal closure flags are monotonic;
10. stopped/non-applicable billing cannot reopen through the session lifecycle core;
11. completed session rejects later non-replay mutations;
12. exact validation against the authoritative P2A durable execution state.

## Session completion invariant

```text
SESSION_COMPLETE =
EXECUTION_TERMINAL
AND RECEIPT_TERMINAL
AND EXECUTION_TRANSPORT_DEREGISTERED
AND REQUIRED_RESOURCE_CLEANUP_TERMINAL
AND BILLING_STOPPED_OR_NOT_APPLICABLE
```

Job execution terminal alone yields `FINALIZING`, never `COMPLETE`.

## Client-liveness invariant

```text
CHAT_SESSION_LIVENESS != EXECUTION_SESSION_LIVENESS
SSH_CONNECTION_LIVENESS != EXECUTION_SESSION_LIVENESS
ANDROID_CLIENT_LIVENESS != EXECUTION_SESSION_LIVENESS
CLIENT_DISCONNECT => SESSION_LIFETIME_EFFECT=NO_EFFECT
```

## Explicit non-scope

This slice does not define:

- Pilote R51-A3 verifier or acceptance intent;
- verifier-policy semantic meaning;
- acceptance-requirement semantic meaning;
- provider provisioning/bootstrap saga;
- operator-intervention receipt persistence;
- attempt/fence rebinding after trust-reset intervention;
- cost-accounting units or admission-budget arithmetic;
- `EXECUTION_SESSION_STATUS_V1` cost/evidence projection;
- full R51-P2 closure.

Those remain separate bounded slices or cross-stack binds.

## Preserved invariants

```text
TASK_CONTRACT_V1_MUTATION=0
FROZEN_27_FIELDS_MUTATION=0
INTERFACE_V1_MUTATION=0
SHARED_CONTRACT_REDESIGN=0
PILOTE_SEMANTIC_REINTERPRETATION=0
PILOTE_R51_A3_SEMANTIC_DEPENDENCY=0

INV-026 ONE_SHOT_SESSION_SURVIVES_CHAT_SSH_AND_CLIENT_DISCONNECT
INV-047 SESSION_COMPLETE_REQUIRES_TRANSPORT_DEREGISTRATION_CLEANUP_AND_BILLING_STOP
```

## Evidence boundary

Repository engine contract: Node `22.13.0`.

The available local environment is not assumed canonical unless that exact runtime is active. Local syntax/targeted-test results must therefore be classified according to the captured runtime fingerprint.
