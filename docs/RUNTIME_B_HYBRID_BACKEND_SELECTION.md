# Runtime Plan B — Hybrid Backend Selection B1

## Gate

```text
SYNC_2=PASS
RUNTIME_A_STATUS=COMPATIBLE_FINAL_CANDIDATE
RUNTIME_A_HEAD=c18800c0c8c2fe55c017e5a8c970a29daf42410f
RUNTIME_A_TREE=89bde4de3808d9715e002833f24c618cee52c440
INTERFACE_VERSION=1.0.0
INTERFACE_MANIFEST_SHA256=90b016211babd4f10b7de7700c54ea6e2db9179563d88502fc1d9983ad47b617
```

B1 consumes only the frozen Interface V1 Task Contract. It does not compile Pilote Phase/Task semantics, rewrite acceptance semantics, interpret the opaque intervention/replan vocabulary, or grant approval.

## Deterministic backend policy

```text
RUNTIME_DEFAULT       -> preserved V1 GitHub-hosted backend only
HOSTED_ELIGIBLE       -> preserved V1 GitHub-hosted backend only
SELF_HOSTED_REQUIRED  -> Plan A self-hosted backend only
HOST_LOCAL_REQUIRED   -> BLOCKED in Plan B1
```

There is no silent hosted-to-self-hosted or self-hosted-to-hosted fallback. `fallback_used` is always `false` in B1.

## Backend-bound Runtime identity

Every successful selection emits `RUNTIME_B_BACKEND_BINDING_V1`, binding the frozen interface identities, Task Contract hash, backend ID/kind, and source-write authority into a deterministic SHA-256 digest. The Runtime verifier rejects use of that identity with a different backend.

This is a Runtime enforcement primitive only. It deliberately does not define or parse Pilote approval-envelope semantics. A later authority envelope may reference the Runtime binding digest, but the semantic producer remains Pilote.

## B1 validation boundary

B1 admits only the existing read-only validation envelope already supported by Runtime A/V1 compatibility:

```text
EFFECT_CLASSES subset = READ_ONLY | LOCAL_COMPUTE
TOUCH_SET operations = READ
NETWORK_CLASS = NONE
SECRET_CLASS = NONE
REMOTE_MUTATION_INTENT = NONE
HOST_OPERATION_INTENT = NONE
ORACLE_REQUIREMENT = NONE
runtime source write authority = NONE
```

Network allowlisting, secret issuance, provider mutation, generic writable development workspaces and remote source mutation are not added by B1. Lease state remains `NOT_IMPLEMENTED_PLAN_D`.

## Preserved invariants

```text
PILOTE_RUNTIME_REIMPLEMENTATION=DENY
RUNTIME_PROJECT_SEMANTIC_REWRITE=DENY
RUNTIME_ACCEPTANCE_SEMANTIC_REWRITE=DENY
VALIDATION_EXECUTION_SOURCE_WRITE=ZERO
BLIND_RERUN=0
INFRA_RERUN_LOOP=0
MAIN_DIRECT_WRITE=DENY_BY_DEFAULT
HUMAN_ONLY_READY_AND_FINAL_MERGE=PRESERVE_THROUGH_REV5
```
