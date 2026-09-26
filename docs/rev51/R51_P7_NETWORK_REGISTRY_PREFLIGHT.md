# Runtime Rev5.1 / v016 P7 — Network / Registry Preflight

Status: credential-independent development candidate.

P7 reuses P1B zero-touch execution preflight and P5 capability requirements. P1B already owns readiness, approval, budget and transport gates; P7 adds the missing protocol-level network/registry evidence contract rather than duplicating those gates.

`NETWORK_REGISTRY_PREFLIGHT_PLAN_V1` binds the P5 requirement-set digest to an explicit registry allowlist and the eight required observation stages: DNS resolution, TCP connectivity, TLS handshake, HTTPS request, registry response, registry auth when required, certificate trust, and proxy compatibility. A registry outside the approved egress policy is rejected before probing.

`evaluateNetworkRegistryPreflightV1` consumes normalized adapter observations and distinguishes infrastructure/policy failure classes instead of collapsing them into package-install or application failure. The result codes include `DNS_BLOCKED`, `TCP_BLOCKED`, `TLS_BLOCKED`, `HTTPS_BLOCKED`, `REGISTRY_BLOCKED`, `REGISTRY_AUTH_FAILED`, `CERTIFICATE_TRUST_FAILED`, `EGRESS_POLICY_MISMATCH`, and `PASS`. `sameNetworkFailureFingerprintV1` makes repeated identical failures machine-detectable so a caller can enforce the master-plan `NO_NEW_INFORMATION -> INSTALL_RERUN_DENY` rule.

The core does not perform live network calls or acquire credentials in this slice. Provider/network adapters supply observations later; authenticated live probes remain deferred to Global Auth Endgame if no existing auth can satisfy them. No paid compute, provider mutation, credential binding, shared Interface V1 mutation, or Pilote semantic reinterpretation is introduced.

Canonical P7 qualification: pull-request Runtime self-test run 36252888802, job 108434112181, repository-pinned Node 22.13.0 / npm 10.9.2, 735/735 tests PASS, fail=0, release gate PASS. P6 baseline was 722/722, so all thirteen P7 integration tests were exercised. No manual dispatch or rerun was used.
