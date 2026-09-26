# Runtime Rev5.1 P9 — Provider Scheduler / Safe Fallback

Status: credential-independent development candidate.

P9 composes the existing P3 deterministic backend gate, P5 capability admission/provider registry, and P6 exact runtime re-attestation. It does not duplicate those authorities.

`PROVIDER_SCHEDULING_POLICY_V1` defines deterministic provider order together with allowed cost classes and explicit data-policy constraints: data classification, execution zones, external-upload policy, source-egress policy, and artifact-egress policy. A fallback provider is selected only when capability, adapter readiness, provider health, cost, and data-policy gates all pass. A provider missing or mismatching any of those constraints is skipped rather than executed and failed later.

`PROVIDER_CIRCUIT_BREAKER_V1` counts infrastructure failures separately from application failures. Application failures never quarantine a provider. Repeated infrastructure failure reaches `QUARANTINED`; a successful health recheck can restore the provider. This prevents provider faults from causing blind application reruns.

`EXECUTION_START_REATTESTATION_V1` re-runs P5 admission and P6 exact-environment validation immediately before execution. Provider-profile identity drift, quarantine, data-policy drift, or runtime/package-manager/environment drift blocks start and returns a canonical receipt.

No application execution, remote/provider mutation, paid compute, credential binding, network probe, shared Interface V1 mutation, or Pilote semantic reinterpretation is performed by this slice.
