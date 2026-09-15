# Runtime B Seal Candidate B3

B3 completes the Runtime-owned portion of Plan B without consuming or redefining Pilote semantics.

Runtime B now contains:

1. deterministic hosted versus self-hosted backend selection;
2. Task Contract and backend-specific binding identity;
3. no silent cross-backend fallback;
4. opaque external authority-evidence binding to the exact Task Contract and backend;
5. execution-context verification that rejects cross-backend or cross-contract reuse.

The authority artifact itself remains externally defined. Runtime only accepts its SHA-256 digest. Therefore B3 does not modify Interface V1, the 27 frozen Task Contract fields, or any Pilote phase/task/approval vocabulary.

```text
RUNTIME_B_IMPLEMENTATION=COMPLETE_CANDIDATE
RUNTIME_B_SEAL_CANDIDATE=YES
PILOTE_REV4.5_FINAL_SEAL_DEPENDENCY=NONE_FOR_RUNTIME_B_IMPLEMENTATION
SYNC_3=NOT_EVALUATED
LIVE_SELF_HOSTED_INVOCATION=NOT_RUN
LEASE_STATE=NOT_IMPLEMENTED_PLAN_D
VALIDATION_EXECUTION_SOURCE_WRITE=ZERO
REMOTE_SOURCE_WRITE_AUTHORITY=NONE
```

The final Runtime B seal decision is made only after exact remote readback of the B3 candidate and the configured final validation gate. Runtime C must not claim SEALED from this document alone.
