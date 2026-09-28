# Runtime Rev5.2 R52-R0 — Baseline / Identity / Plan / v024 Contract Lock

Status: IMPLEMENTED_BASELINE_BINDING

## Fresh repository baseline

- repository: `neoflowcore/atelier-runtime`
- default branch: `main`
- Rev5.2 development branch: `runtime-r52-track-a`
- Track A base main HEAD: `813721a7235d5b96fc4806f8ae9cd8e3e1740e78`
- base commit: merged Runtime Rev5.1 / v016 live-accepted release candidate
- canonical repository Node engine: `22.13.0`
- paid compute created by R52-R0: `0`

## Rev5.2 authority binding

The Rev5.1 repository identity `R51_PROJECT_IDENTITY_v001.json` is preserved as legacy migration input only. It is bound to `ephemdrop / v016` and must not become the Rev5.2 authority merely because it is present in the repository.

Rev5.2 binds current-project authority to:

- `R52_PROJECT_IDENTITY_v001.json`
- `R52_PROJECT_SOURCE_MANIFEST_v001.json`
- Master Plan v019 SHA-256 `3e8583c1a5d875cfc54c1ae377ad6aba5385de500f3759f1f13cfa812c271ec9`
- Runtime Track A v001 SHA-256 `551474fb480ea0cac7961fac503094740cf4d8f56204aa3f8ca2c4d1ed0b2177`
- Universal One-Shot control policy v024 SHA-256 `74874548f27bb60ba2c202d482789b1370e701a83b93416255acc3c6fadc9329`

The plan may live outside the repository. The repository manifest pins its project-local attachment reference and digest rather than copying the authoritative plan into source.

## Rev5.1 reusable intake

The following Rev5.1 Runtime capabilities are reusable inputs and are not rewritten in R52-R0:

- project identity / source-manifest compiler
- master-plan run contract and continue alias binding
- long-run checkpoint / reattach primitives
- auth-endgame manifest / closure / transaction primitives
- durable convergence and OUTCOME_UNKNOWN reconciliation
- capability admission / exact runtime / network-registry / dependency controls
- provider evidence and billing/residue safety foundations

Rev5.2 adds project-wide state and resolver semantics on top of these verified foundations.

## R52-R0 gate

```text
BASELINE_IDENTITY = PASS
PLAN_BINDING_CONTRACT = PASS
CROSS_PROJECT_IMPORT = 0
V024_REQUIREMENT_MATRIX = PASS
PAID_COMPUTE = 0
```

No Pilote implementation is started in Track A.
