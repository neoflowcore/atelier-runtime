# Runtime Rev5.1 — R51-A8 Backward Compatibility Cross-stack Binding

Status: REMOTE APPLY CANDIDATE

## Authoritative Pilote A8 anchor

- branch: `pilote-r51-a8-backward-compatibility-semantic-artifacts`
- HEAD: `96ab5e3b3d9ac17452d0c707b508152b7d09c197`
- TREE: `3f8f0d2fd5795724d88ec7f7b47eed8bfc659774`
- module SHA256: `6f2ff2b90a505029f05988870329d0f181c8791fb0fa66e18e54b06d760360d1`
- schema SHA256: `5b52e8b9d183b6beb8aaee42e8365b64c5faafb67def3cbdbac4b0fe9e9601db`
- vector SHA256: `9f08e739759f07abf07fc4c5c95ad4fc27dee901ca74e3014543de1ac99b8a13`
- expected SHA256: `92be3ace31932d9acde6e39077d055ceb62aa9636bb2b179b28252799770728d`
- semantic artifact set SHA256: `4220684785f382c3dc0d252da8715ceb0ecb79d6783cf6901ac3e26eb21e8ca9`
- authoritative manifest SHA256: `82723878aa150627158c80f14dff38ed82a4d901c474b09c410119cde2568ee5`

## Runtime binding

Runtime consumes the sealed A8 artifact without redefining legacy semantics.

Exact profile selection is required for Rev4.2 Task, Rev4.5 Phase and Rev5.0 Framework legacy input. Unknown families and exact-identity mismatches fail closed. Runtime does not infer compatibility from version labels or approximate identity.

## Input mode

One execution has exactly one semantic input mode:

```text
LEGACY_COMPAT
NATIVE_REV51
```

Native-to-legacy downgrade and legacy-to-Rev5.1 intent synthesis remain denied.

## Compatibility defaults

Legacy missing values are partitioned only into the sealed A8 classes:

- safe Runtime defaults;
- values derived from existing frozen contract fields;
- values that require explicit Rev5.1 execution intent.

The third class fails closed with `BLOCKED_NEEDS_REV51_EXECUTION_INTENT`.

## Transparent hardening

Runtime may apply only the sealed execution-hardening allowlist. It may not use hardening to mutate task, dependency, acceptance, expected-output or declared-effect semantics.

## Receipt compatibility metadata

A8 requires exact compatibility metadata:

```text
INPUT_MODE
COMPAT_PROFILE_ID
COMPAT_PROFILE_VERSION
COMPAT_PROFILE_SHA256
```

The existing shared `EXECUTION_RECEIPT_V1` schema remains frozen in this bind. Therefore A8 binds and validates this metadata in the Runtime compatibility evidence layer without mutating Interface V1 or the shared receipt schema. P7 receipt/evidence integration can consume this sealed metadata contract later without semantic reinterpretation.

## Identity chain

Runtime validates all six A8 chain links as SHA256 identities and exact-binds `COMPAT_PROFILE_HASH` to the selected profile:

```text
LEGACY_SEALED_INPUT_HASH
TASK_CONTRACT_HASH
COMPAT_PROFILE_HASH
RUNTIME_EXECUTION_PLAN_HASH
WORKER_JOB_HASH
EXECUTION_RECEIPT_HASH
```

## Legacy acceptance oracle

Runtime51 receipt bytes are not compared directly with historical receipt bytes. A Runtime-sealed receipt is projected to:

```text
PASS
NON_PASS
BLOCKED
OUTCOME_UNKNOWN
```

The sealed oracle accepts only projected `PASS`. Runtime-defined tolerance or equivalence remains denied.

## Preserved boundaries

```text
TASK_CONTRACT_V1_MUTATION=0
FROZEN_27_FIELDS_MUTATION=0
INTERFACE_V1_MUTATION=0
SHARED_CONTRACT_REDESIGN=0
PILOTE_SEMANTIC_REINTERPRETATION=0
LEGACY_REQUIRED_FIELD_ADDITION=0
LEGACY_TO_REV51_INTENT_SYNTHESIS=0
REV51_TO_LEGACY_DOWNGRADE=0
RUNTIME_DEFINED_EQUIVALENCE=0
```
