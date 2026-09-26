# Runtime Rev5.1 P17 — Privacy-Minimal Evidence + Provider Drift

P17 creates normalized provider evidence from only required identities, binding facts, measurement-window/criteria references, normalized metric summaries, and verdicts. Obvious secret/token/bearer material is rejected; raw provider bodies and raw telemetry are not canonical evidence. A cheap state fingerprint covers deployment/version/traffic/bindings/contract settings/credential-capability fingerprint so unchanged state may reuse evidence and changed state stales affected evidence for re-attestation.
