# Runtime Rev5.1 — R51-A6 Parallelism / Execution-Class Cross-stack Binding

Status: REMOTE APPLY CANDIDATE

## Authoritative Pilote A6 anchor

- branch: pilote-r51-a6-parallelism-execution-class-intent
- HEAD: 878e5966f6a4c3fc45f76659f83d107f17ce9f6d
- TREE: e4eb4a8a1887fb859f0504431584f5f66869ce3b
- schema SHA256: f15d74050a35c56eb036deccd67f670953d2719082de2505f2881596e3bd2704
- test vector SHA256: 3f768f91f135e43e4e041d1bc642174dcacc2554f9c4054a82a3302d13add0ca

## Runtime binding

Runtime consumes A6 without redefining P2G or semantic DAG ownership.

Parallelism:
- INHERIT_DAG preserves semantic dependencies and uses the frozen Task Contract MAX_PARALLELISM ceiling.
- PARALLEL_ALLOWED is permission, never an obligation.
- SERIAL_REQUIRED forces the semantic cap to 1.
- Runtime may impose a stricter cap but may never exceed the A6 cap.

DAG:
- semantic dependency refs must remain exact and ordered.
- Runtime semantic edge add/remove remains denied.
- execution-only ordering is allowed only as a Runtime scheduling constraint.

Execution class:
- SELF_HOSTED_REQUIRED and HOST_LOCAL_REQUIRED are hard constraints.
- hosted/local downgrade is denied.
- HOSTED_ELIGIBLE is eligibility only.
- concrete provider and transport selection remain Runtime-owned and independent.

Admission:
- A6 cap, Task Contract/P2G MAX_PARALLELISM, project/provider/class limits, and active cost reservation are intersected.
- all applicable limits must pass.

## Preserved boundaries

Task Contract V1, frozen 27 fields, Interface V1, A2 execution intent, A5T terminal semantics, and P2G storage format are unchanged.
