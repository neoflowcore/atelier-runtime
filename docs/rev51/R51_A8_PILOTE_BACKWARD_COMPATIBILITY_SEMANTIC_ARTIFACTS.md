# Pilote Rev5.1 R51-A8 — Backward Compatibility Semantic Artifacts

Status: `AUTHORITATIVE CANDIDATE`

Upstream A7 anchor:

- HEAD: `ccd3e5bc2b134c9bce274015d9b836afdad6e8f2`
- TREE: `5df9e4ecd8b88d17ea87038c9f675900a4780e57`

A8 implements the already-frozen backward-compatibility semantic artifacts. Compatibility is an execution adapter, not a semantic adapter.

## Exact legacy profiles

```text
COMPAT_PROFILE_REV42_TASK_V1
LEGACY_SOURCE_FAMILY=REV42_TASK_V1
LEGACY_SEALED_IDENTITY_SHA256=90b016211babd4f10b7de7700c54ea6e2db9179563d88502fc1d9983ad47b617
PROFILE_SHA256=bb36e0eeb02def246696894b91121348330bc3086124e68753a69a8d40e41be8

COMPAT_PROFILE_REV45_PHASE_V1
LEGACY_SOURCE_FAMILY=REV45_PHASE_V1
LEGACY_SEALED_IDENTITY_SHA256=3439a7249b6ba9051269c89e6d783a343457cf01e43ec8a62dcffd1b0ed55284
PROFILE_SHA256=b758045aaa65f02e9f22f73c330220b12a9e3b399603d3115026175dce9a4049

COMPAT_PROFILE_REV50_FRAMEWORK_V1
LEGACY_SOURCE_FAMILY=REV50_FRAMEWORK_V1
LEGACY_SEALED_IDENTITY_SHA256=141fe59a393fe5224833fe0d83ec80589464d08bf2bf7729c3cf7b9d9c0f00f8
PROFILE_SHA256=fca1cea7faa088d7d5e013b12561c654585e7e5b73cc5353a6772d42c4169984
```

Rev4.2 uses the frozen Interface V1 manifest identity. Rev4.5 and Rev5.0 use the exact final Builder Kit package digests. Profile selection is exact and fail-closed; names or version resemblance are never sufficient.

## Input-mode exclusivity

```text
INPUT_MODE=LEGACY_COMPAT|NATIVE_REV51
ONE_EXECUTION=EXACTLY_ONE_INPUT_MODE
NATIVE_REV51 -> LEGACY_DOWNGRADE=DENY
LEGACY_COMPAT -> REV51_INTENT_SYNTHESIS=DENY
```

## Default classes

Legacy behavior is classified into exactly:

```text
A_SAFE_RUNTIME_DEFAULT
B_DERIVED_FROM_EXISTING_CONTRACT
C_REQUIRES_EXPLICIT_REV51_INTENT
```

Class C missing semantics fail closed with `BLOCKED_NEEDS_REV51_EXECUTION_INTENT`.

## Transparent hardening

The allowlist contains only execution-hardening behavior. It may never mutate task, dependency, acceptance, expected-output or declared-effect semantics.

## Legacy acceptance oracle

A8 does not compare full Runtime51 receipt bytes against historical legacy receipt bytes. It seals a minimal acceptance projection:

```text
PASS -> PASS
FAIL -> NON_PASS
BLOCKED -> BLOCKED
OUTCOME_UNKNOWN -> OUTCOME_UNKNOWN
```

Only a Runtime-sealed receipt may be projected. Runtime-defined equivalence remains denied. PASS equivalence requires projected `PASS`; non-pass and unknown outcomes do not become accepted.

## Registry lifecycle

`REVOKED` profile + new execution is denied. Historical receipts remain verifiable by their recorded old profile SHA.

## Preserved invariants

```text
TASK_CONTRACT_V1_MUTATION=0
FROZEN_27_FIELDS_MUTATION=0
INTERFACE_V1_MUTATION=0
LEGACY_BUILDER_MUTATION=0
SHARED_CONTRACT_REDESIGN=0
SEMANTIC_REINTERPRETATION=0
LEGACY_REQUIRED_FIELD_ADDITION=0
LEGACY_TO_REV51_INTENT_SYNTHESIS=0
REV51_TO_LEGACY_DOWNGRADE=0
RUNTIME_DEFINED_EQUIVALENCE=0
```
