# Runtime Rev5.1 / v016 P5 — Capability Resolver + Admission Controller

Status: credential-independent development candidate.

P5 does not replace the existing P2M durable capability-attestation epoch or P3 deterministic router/admission policy. It fills the remaining Runtime-owned gap between the frozen Task Contract and provider selection: execution-environment compilation, a freshness-bounded observed provider capability registry, capability-first admission, and a canonical admission receipt.

`compileExecutionEnvironmentContractV1` validates the frozen Task Contract and projects its execution class, OS/arch/workspace, network/data/secret classes and frozen capability requirements into an immutable Runtime environment contract. Project/runtime adapter requirements such as exact language runtime, package manager, registries, minimum disk/memory and additional provider capability tokens are accepted only through a separate Runtime overlay; frozen Task Contract semantics are not mutated. `resolveRequiredCapabilitiesV1` emits a content-bound requirement set and digest.

`PROVIDER_CAPABILITY_REGISTRY_V1` durably stores content-addressed observed profiles with explicit `OBSERVED_AT` / `VALID_UNTIL`. Profiles include capability tokens, OS/arch/workspace/network/data/secret classes, runtime/package-manager fingerprints, registry reachability declarations, capacity, cost class, health, and execution-adapter readiness. Stale profiles fail closed and do not count as current capability evidence.

`evaluateCapabilityAdmissionV1` requires the current provider profile to satisfy the resolved environment contract, adapter readiness, provider health and allowed cost class. It composes the existing P3 candidate gate using only the original frozen Task capability set, preserving P3 semantics while Runtime-owned overlay capabilities remain P5-owned. Runtime/package-manager or registry mismatch is classified as admission failure, not application-test failure. `CAPABILITY_ADMISSION_RECEIPT_V1` binds the required-capability digest to the observed provider-profile digest and decision.

This slice performs no paid compute, provider mutation, credential binding, shared Interface V1 mutation, or Pilote semantic reinterpretation. Exact provisioner behavior remains P6; network protocol probing remains P7; provider fallback/scheduler policy remains P9.
