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

## Worker admission and attestation (A3 candidate)

Before the exact target source is checked out, the self-hosted workflow now emits and gates a Runtime-owned worker attestation. This is an execution-resource check only; it does not interpret Pilote approval semantics and does not create a lease.

```text
WORKER_ATTESTATION_TYPE=RUNTIME_A_WORKER_ATTESTATION_V1
ADMISSION_SCOPE=PLAN_A_FOUNDATION_PROBE_ONLY
LEASE_STATE=NOT_IMPLEMENTED_PLAN_D
REMOTE_SOURCE_WRITE_AUTHORITY=NONE
```

The attestation binds the requested/actual Runtime SHA, fixed backend ID, scheduler selector, observed `RUNNER_ENVIRONMENT`, `RUNNER_OS`, `RUNNER_ARCH`, `RUNNER_NAME`, exact Node version, and a deterministic SHA-256 worker fingerprint. Target checkout is skipped unless this admission gate passes.

The `atelier-runtime-v1` label is enforced by the GitHub Actions `runs-on` selector. GitHub does not expose the complete matched runner-label set as a normal job environment variable, so the receipt records that selector as expected scheduler identity rather than falsely claiming runtime enumeration of every label.

Lease allocation, lease ownership, renewal, expiry and multi-caller contention are intentionally absent. Those remain Plan D responsibilities under the validated Runtime workpack.

## A4 evidence cross-binding

The Plan A closeout candidate adds a Runtime-owned evidence binding receipt. It does not change the Task Contract or interpret any new Pilote semantics.

```text
worker attestation bytes --sha256--+
                                    +--> RUNTIME_A_EVIDENCE_BINDING_V1
foundation receipt bytes --sha256--+
```

The binding fails closed unless both child receipts agree on request/idempotency identity, requested and actual Runtime SHA, fixed backend identity, expected runner labels, and observed runner environment/OS/architecture/Node version. The binding also carries the Task Contract hash, exact target SHA pair, worker fingerprint, source-integrity evidence and exact child-file SHA-256 digests.

A binding `PASS` requires:

```text
WORKER_ATTESTATION=PASS
FOUNDATION_RECEIPT=PASS
REQUEST_ID_MATCH=PASS
IDEMPOTENCY_KEY_MATCH=PASS
RUNTIME_IDENTITY_MATCH=PASS
BACKEND_IDENTITY_MATCH=PASS
TARGET_REQUESTED_SHA==TARGET_EXECUTED_SHA
TREE_SHA_BEFORE==TREE_SHA_AFTER
TRACKED_SOURCE_MUTATION_DETECTED=false
REMOTE_SOURCE_WRITE_AUTHORITY=NONE
LEASE_STATE=NOT_IMPLEMENTED_PLAN_D
```

The evidence gate re-opens all three JSON files and independently recomputes both child-file SHA-256 digests before accepting the binding. A standalone binding JSON is therefore insufficient to establish PASS if its referenced evidence bytes have changed.

## V1 non-regression static proof

Before this A4 candidate was assembled, fresh remote comparison from packaged `main=2f82365b7270fd7b4cb15dcf4f87fe7e0e05f4d9` to Runtime A3 `5d58262733544406f12619ebf9bfaece4daad7a4` reported `ahead_by=3`, `behind_by=0`; every changed path was an additive Runtime A workflow/module/schema/test/fixture/doc path. No pre-existing V1 workflow, schema, runtime execution module, release policy, security boundary or package file was modified. A4 continues the same rule and changes only Plan A-owned files plus the Plan A workflow/documentation.

## A5 static closure and SYNC-2 handoff preparation

Plan A closure is represented by `RUNTIME_A_PLAN_A_CLOSURE_V1`. The closure receipt is deliberately a **static compatible-final-candidate** receipt, not a Runtime A seal and not a live self-hosted execution claim.

```text
CANDIDATE_CLASS=COMPATIBLE_FINAL_CANDIDATE_STATIC
RUNTIME_A_SEALED=NO
LIVE_SELF_HOSTED_INVOCATION=NOT_RUN
SYNC2_STATE=WAITING_A_REV42_SEALED_MANIFEST
```

The closure verifier binds the sealed SYNC-1 core hashes, the frozen Runtime V1 control, the current development base, the fixed Plan A backend identity, the complete Plan A-owned component manifest, the exact candidate SHA/tree supplied by fresh remote readback, the complete changed-path set relative to the development base, and observed Actions count.

A PASS requires all changed paths to be in the explicit Plan A-owned path set. Any change to existing V1 runtime/workflow/schema/security/release files therefore blocks closure rather than being silently accepted. The closure also requires `behind_by=0` and zero observed workflow runs under Action Economy v2.

This evidence is suitable for the Runtime side of the next cross-account gate only after the post-commit candidate SHA/tree are inserted from fresh remote readback. It does not assert `SYNC_2=PASS`; Developer A must still provide the sealed Rev4.2 interface manifest and fixtures, and the interface-manifest match must then be evaluated at SYNC-2.
