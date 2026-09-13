# Runtime Plan A — Self-Hosted Linux x64 Foundation (A1 candidate)

## Gate binding

```text
SYNC_1=PASS
INTERFACE_VERSION=1.0.0
INTERFACE_MANIFEST_SHA256=90b016211babd4f10b7de7700c54ea6e2db9179563d88502fc1d9983ad47b617
BASELINE_EPOCH_ID=11cfb57b2cd0f4d36e6c064ee908ab198677d5309529c2054829cc9da7f103a3
RUNTIME_BASE_SHA=2f82365b7270fd7b4cb15dcf4f87fe7e0e05f4d9
RUNTIME_BASE_TREE=4fc4081accb3ad2a649c90dc236f4284612e7f4f
```

This increment consumes only the SYNC-1 CORE_FROZEN Task Contract fields. It does not consume or infer R42-P4/P5 follow-up semantics.

## A1 scope

A1 introduces two Runtime-owned primitives:

1. exact consumer validation for the frozen 27-field Task Contract, including deterministic task-hash verification and the CORE_FROZEN minimum effect/capability consistency checks;
2. an explicit `SELF_HOSTED_LINUX_X64_V1` backend binding compiler and backend-binding receipt.

The backend identity is fixed:

```text
BACKEND_ID=SELF_HOSTED_LINUX_X64_V1
RUNNER_LABELS=[self-hosted,linux,x64,atelier-runtime-v1]
HOSTED_FALLBACK=NONE
TARGET_SOURCE_WRITE_AUTHORITY=NONE
```

A1 deliberately does not dispatch. It is compatibility/shadow evidence until the self-hosted execution path is added and independently sealed.

## Fail-closed fences

Plan A A1 accepts only an explicit `RESOURCE_REQUIREMENTS.EXECUTION_CLASS=SELF_HOSTED_REQUIRED` task whose OS/arch are compatible with Linux x64. It does not reinterpret `RUNTIME_DEFAULT` or `HOSTED_ELIGIBLE`; deterministic multi-backend selection belongs to Plan B.

A1 blocks requirements that belong to later Runtime plans, including isolated writable workspaces, source/provider mutation, secret issuance, privileged host operations, external oracles and egress classes requiring enforcement not yet provided by this foundation.

```text
APPROVAL_INTENT_IS_EXECUTION_AUTHORITY=FALSE
CAPABILITY_REQUIREMENT_IS_CAPABILITY_GRANT=FALSE
RESOURCE_REQUIREMENT_IS_RESOURCE_ALLOCATION=FALSE
VALIDATION_EXECUTION_SOURCE_WRITE=ZERO
```

## V1 preservation

No existing Runtime V1 workflow, runtime module, schema, security boundary, release policy or receipt schema is modified by this A1 increment. The frozen V1 control remains an independent baseline.
