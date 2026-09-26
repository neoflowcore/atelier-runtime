# Runtime Rev5.1 / v016 P6 — Exact Runtime Provisioner

Status: credential-independent development candidate.

P6 reuses the existing G3 fixed-runtime policy and the P5 resolved capability/environment contract. It does not replace provider adapters or hard-code provider-specific install commands. The Runtime-owned addition is a provider-neutral exact provisioning plan plus execution-start environment attestation.

`compileExactRuntimeProvisioningPlanV1` binds the P5 requirement-set digest and observed provider-profile digest to exact language runtime/package-manager versions, OS/arch/libc and optional immutable container image digest. A provider that cannot advertise the exact requested runtime/package-manager fingerprint is rejected before execution. `FALLBACK_TO_NEAREST_VERSION=false` is invariant.

`attestExecutionEnvironmentV1` compares the observed execution environment with the exact plan and emits a deterministic environment fingerprint only on exact match. `validateExecutionEnvironmentAtStartV1` is the P6 execution-start gate: runtime, package manager, OS, architecture, libc or image drift blocks start instead of becoming an application failure.

Provider-specific installation/bootstrap remains P10. Network/registry protocol probing remains P7. The current repository's canonical workflow already demonstrates the fixed Node 22.13.0 / npm 10.9.2 pattern, but P6 generalizes the contract without making GitHub Actions a mandatory provider.
