# Runtime Rev5.1 / v016 P6 — Exact Runtime Provisioning

Status: credential-independent development candidate.

P6 consumes the P5 capability requirement set, successful admission receipt, and observed provider profile. It does not select a provider, create provider resources, bind credentials, dispatch workflows, or reinterpret Pilote semantics.

The slice adds `EXACT_RUNTIME_PROVISION_SPEC_V1` and `EXACT_RUNTIME_PROVISION_RECEIPT_V1`. The spec content-binds the admitted P5 requirement/profile identities to exact runtime and package-manager versions, OS/arch/libc, optional container-image digest, and minimum disk/memory capacity. A PASS receipt records a deterministic environment fingerprint.

Execution-start re-attestation re-observes the same environment immediately before application execution and rejects exact-identity drift.

P6 deliberately reuses P2O durable worker-job launch and P2Q durable execution transport rather than rebuilding launch/transport authority. Registry requirements remain carried in the provision spec, while protocol-level DNS/TCP/TLS/HTTPS/registry probing belongs to P7. Provider scheduling/fallback remains P9.

Safety boundaries:

```text
PROVIDER_MUTATION=0
PAID_COMPUTE=0
CREDENTIAL_BINDING=0
WORKFLOW_DISPATCH=0
BLIND_RERUN=0
TASK_CONTRACT_V1_MUTATION=0
INTERFACE_V1_MUTATION=0
PILOTE_SEMANTIC_REINTERPRETATION=0
```

Local targeted verification under Node 22.16.0 is 10/10 PASS. The repository contract pins Node 22.13.0, so canonical exact-repository CI remains the acceptance authority when available.
