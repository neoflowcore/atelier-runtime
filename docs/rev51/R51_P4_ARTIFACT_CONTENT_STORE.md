# Runtime Rev5.1 — P4 Artifact Content Store, local slice

Status: development in progress; no P4 acceptance or live attestation claim.

This Runtime-private local adapter stores content by security domain and SHA-256 in quarantine. Every stage/read checks exact bytes and size. Sealing publishes verified immutable bytes before authoritative acceptance. Accepted reads validate the existing durable result acceptance record before returning hash-verified bytes. Concurrent identical stages and seals converge through exclusive hard-link publication; conflicting or corrupt existing content fails closed. The adapter performs no provider mutation and creates no new shared schema.

The existing P2F durable acceptance journal remains the authority for the acceptance decision. This adapter does not treat a storage write or worker success as acceptance. Immutable staged bytes are not accepted output until the durable journal commits their manifest reference. P4 still needs integration and full phase acceptance against the authoritative plan.

Local targeted tests are supplemental because this environment has Node 24.19.0 while the repository pins 22.13.0. No Actions dispatch, rerun, or intermediate full CI was performed.

The `commitStoredResultAcceptanceV1` adapter hashes quarantined bytes and seals immutable staged bytes before calling P2F's durable journal commit. A failed journal decision can leave unreferenced immutable bytes for later GC; it cannot make them accepted. A corrupt or absent quarantine object blocks the journal decision. This is local filesystem durability only; provider-backed stores and phase-wide retention/GC integration are pending.

Retention evaluation is fail closed for active/shared references and requires an authoritative GC tombstone, exact security domain, and class-specific terminal evidence. Pinned and audit retention cannot be collected by this evaluator. Physical deletion is deliberately unimplemented until a durable reference index can prove the zero-reference claim; a caller-supplied count alone is insufficient deletion authority.
