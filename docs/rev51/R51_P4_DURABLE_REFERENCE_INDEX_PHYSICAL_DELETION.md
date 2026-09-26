# Runtime Rev5.1 — P4 Durable Reference Index + Physical Deletion Boundary

Status: credential-independent development candidate. No P4 phase acceptance or live/provider attestation claim.

This slice closes the prior P4 safety gap where retention could decide eligibility but physical CAS deletion remained deliberately unimplemented because a caller-supplied shared-reference count was insufficient authority.

The new `ARTIFACT_REFERENCE_INDEX_V1` is durable and fail-closed. References are created only from a valid P2F durable acceptance record. A coverage seal requires an explicit complete set of valid authoritative acceptance journals and checks that the active reference set is exactly identical before sealing. Once sealed, new references cannot be registered into that generation. Reference release requires the existing P2J GC tombstone and additionally binds the tombstone's `ACCEPTANCE_JOURNAL_SHA256` to the exact acceptance journal that created the reference. A zero-reference proof is available only from a sealed index after every matching content reference has been released.

`commitPhysicalArtifactDeletionV1` requires all of the following before unlinking immutable bytes: sealed complete reference coverage, zero active content references, exact P2J tombstone binding, existing P4 retention eligibility, and exact byte length/SHA-256 verification. It writes a durable deletion receipt and treats an already absent blob as `SUCCESS_NOOP` only after the full proof chain passes. Runtime-authoritative time is excluded from the idempotency fingerprint so semantic replay does not conflict merely because the retry occurs later.

This implementation is local-filesystem only and creates no provider mutation, paid compute, shared Interface V1 change, or Pilote semantic reinterpretation. Provider-backed storage and live qualification remain deferred to later approved Runtime phases / global auth endgame as applicable.

An isolated semantic harness was executed on Node 22.16.0 while the repository pins Node 22.13.0; it passed 8/8 and is supplemental evidence only. The production modules and the real-repository integration test syntax-check successfully, but canonical exact-repository / exact-runtime integration remains pending. No workflow dispatch, rerun, or intermediate full CI was used for this slice.
