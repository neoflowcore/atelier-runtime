# Pilote Rev5.1 R51-A3 — Verifier / Acceptance Intent

Status: `LOCAL CANDIDATE`

Authoritative upstream anchor:

- repository: `neoflowcore/atelier-runtime`
- branch: `pilote-r51-a2-execution-intent`
- HEAD: `53716039bb0df7d725bf8d8b791f376ee17d9551`
- TREE: `071d6a4e08fe97d32775336eddaf703535fa6871`
- contract-set SHA256: `a8b220c92a47306061e9aca1c65077d357b00bda12e9daad4f37215256083f4a`

R51-A3 implements the Pilote-owned verifier policy object and exact acceptance-requirement reference binding required by the existing `PILOTE_EXECUTION_INTENT_V1` fields `VERIFIER_POLICY_REF` and `ACCEPTANCE_REQUIREMENT_REF`.

## Allowed verifier policies

- `RUNTIME_REQUIRED`
- `PROJECT_CI_REQUIRED`
- `RUNTIME_PLUS_PROJECT_CI`

The policy is provider-neutral. It does not select compute provider or execution transport.

## Acceptance ownership boundary

Pilote may bind acceptance semantics owned by task/project/phase/framework semantic sources. Runtime-owned acceptance namespaces are denied. Runtime enforces the selected verifier path but does not invent acceptance semantics or tolerance.

Fixed fail-closed rules:

- `RUNTIME_DEFINED_ACCEPTANCE_SEMANTICS=DENY`
- `RUNTIME_DEFINED_TOLERANCE=DENY`
- `RAW_WORKER_SUCCESS_DIRECT_ACCEPTANCE=DENY`

The acceptance hierarchy remains:

`WORKER_SUCCEEDED != EXECUTION_ACCEPTED != PROJECT_ACCEPTED != RELEASE_ACCEPTED`

## Compatibility boundary

This phase does not mutate Task Contract V1, its frozen 27 fields, Interface V1, the R51-P1 shared contract set, or the A2 execution-intent schema. A3 only supplies exact semantic policy bytes and a verifier reference compatible with the already-sealed A2 shape `{ID, VERSION, SHA256}`.

## Gate

- `RUNTIME_DEFINED_ACCEPTANCE_SEMANTICS=0`
- `VERIFIER_FIXTURES=PASS`
- `TASK_CONTRACT_V1_MUTATION=0`
- `FROZEN_27_FIELDS_MUTATION=0`
- `INTERFACE_V1_MUTATION=0`
- `SHARED_CONTRACT_REDESIGN=0`
