# Runtime Plan A — Self-Hosted Linux x64 Foundation

## Status

```text
SYNC_1=PASS
INTERFACE_VERSION=1.0.0
INTERFACE_MANIFEST_SHA256=90b016211babd4f10b7de7700c54ea6e2db9179563d88502fc1d9983ad47b617
BASELINE_EPOCH_ID=11cfb57b2cd0f4d36e6c064ee908ab198677d5309529c2054829cc9da7f103a3
RUNTIME_BASE_SHA=2f82365b7270fd7b4cb15dcf4f87fe7e0e05f4d9
RUNTIME_BASE_TREE=4fc4081accb3ad2a649c90dc236f4284612e7f4f
RUNTIME_A_STATUS=COMPATIBLE_FINAL_CANDIDATE_LOCAL
LIVE_SELF_HOSTED_INVOCATION=NOT_RUN
```

This Plan A candidate consumes only the SYNC-1 `CORE_FROZEN` 27-field Task Contract. It does not consume, infer, or reimplement later R42-P4/P5 semantics. `INTERVENTION_POLICY` and `REPLAN_BOUNDARY` remain opaque tokens.

## Foundation boundary

Plan A adds the smallest explicit self-hosted Linux x64 execution backend while leaving Runtime V1 hosted behavior unchanged.

```text
BACKEND_ID=SELF_HOSTED_LINUX_X64_V1
BACKEND_KIND=SELF_HOSTED
RUNNER_LABELS=[self-hosted,linux,x64,atelier-runtime-v1]
REQUIRED_NODE=v22.13.0
HOSTED_FALLBACK=NONE
TARGET_SOURCE_WRITE_AUTHORITY=NONE
```

The new path is a `workflow_call`-only backend foundation probe. It is not generic task execution, does not run arbitrary Task commands, and does not claim Task acceptance. Generic terminal/task-DAG execution remains a later Runtime plan responsibility.

## Execution flow

```text
exact runtime SHA
+ exact caller target SHA
+ fixed .atelier/task-contract.json
        |
        v
frozen Task Contract validation
        |
        v
Plan A eligibility compiler
        |
        v
fixed self-hosted Linux x64 backend
        |
        v
read-only source/backend foundation probe
        |
        v
RUNTIME_A_SELF_HOSTED_FOUNDATION_V1 receipt
```

The workflow request surface is closed to:

```text
request_id
idempotency_key
runtime_sha
target_sha
```

There is no caller-provided shell, command, args, env, secret, repository, clone URL, runner label or Task Contract path.

## Plan A fail-closed fences

The Plan A foundation accepts only Tasks that are structurally valid under the sealed interface and compatible with this narrow backend:

- explicit `RESOURCE_REQUIREMENTS.EXECUTION_CLASS=SELF_HOSTED_REQUIRED`;
- Linux/x64 or `ANY` constraints compatible with Linux x64;
- workspace class `NONE` or `READ_ONLY`;
- `NETWORK_CLASS=NONE`;
- `SECRET_CLASS=NONE`;
- `REMOTE_MUTATION_INTENT=NONE`;
- `HOST_OPERATION_INTENT=NONE`;
- `ORACLE_REQUIREMENT=NONE`;
- Git source requires `SOURCE_READ` capability;
- every Plan A `TOUCH_SET` operation must be `READ`;
- no unsupported effect/capability class is silently downgraded.

```text
APPROVAL_INTENT_IS_EXECUTION_AUTHORITY=FALSE
CAPABILITY_REQUIREMENT_IS_CAPABILITY_GRANT=FALSE
RESOURCE_REQUIREMENT_IS_RESOURCE_ALLOCATION=FALSE
VALIDATION_EXECUTION_SOURCE_WRITE=ZERO
```

`RUNTIME_DEFAULT` and `HOSTED_ELIGIBLE` are deliberately not silently routed to self-hosted. Deterministic multi-backend selection belongs to Plan B.

## Evidence / receipt

The Runtime-owned companion receipt binds:

- interface version and manifest SHA-256;
- Task Contract hash;
- requested/executed target SHA;
- requested/actual Runtime engine SHA;
- fixed backend ID and expected labels;
- observed runner environment/OS/arch/Node version;
- target tree SHA before/after;
- tracked-source mutation result;
- `remote_source_write_authority=NONE`.

`PASS` means only that the fixed self-hosted foundation read-only probe satisfied its backend/source-integrity contract. It does not mean Pilote acceptance requirements were semantically completed.

## Hermetic interface fixtures

The Runtime branch contains byte-for-byte copies of the SYNC-1 machine schema, canonicalization vectors and valid/invalid fixtures under `fixtures/runtime-a/interface-v1/`. `SOURCE_BINDING.json` binds each copy to its exact SHA-256. These are consumer regression fixtures only; they do not mutate the root Interface manifest.

## Action Economy

The new workflow has only `workflow_call`; it has no `push`, `pull_request` or `workflow_dispatch` trigger. Merely committing the workflow to the Runtime development branch therefore does not intentionally create a validation run.

```text
ACTION_ECONOMY_MODE=v2
INTERMEDIATE_FULL_CI=0_TARGET
BLIND_RERUN=0
BLIND_MUTATION_RETRY=0
```

## Local verification

The candidate is validated without GitHub Actions:

```text
NEW_RUNTIME_TESTS=26/26 PASS
NODE_SYNTAX_CHECK=PASS
SEALED_FIXTURE_HASH_BINDING=PASS
CANONICALIZATION_VECTORS=PASS
SELF_HOSTED_NO_FALLBACK_STATIC_GATE=PASS
READ_ONLY_AUTHORITY_STATIC_GATE=PASS
CALLABLE_ONLY_WORKFLOW_GATE=PASS
```

A local CLI simulation on Node `v22.16.0` intentionally produced a valid `INFRA_FAILURE/NODE_VERSION_NOT_22_13_0` receipt and the receipt gate rejected it. This demonstrates fail-closed Node-version attestation; it is not a live self-hosted PASS claim.

## V1 preservation

No existing Runtime V1 workflow, V1 runtime execution module, V1 schema, V1 security boundary, V1 release policy, or V1 receipt schema is changed by this Plan A candidate. The frozen V1 control remains independently recoverable.
