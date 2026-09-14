# Runtime C Source-Write Gateway and Mutation Journal

The Runtime C gateway is the only component allowed to prepare remote source-write requests. Validation never invokes a live provider mutation.

Allowed gateway operations are exactly:

- `CANDIDATE_BRANCH_PUSH` with `force=false`, a non-protected candidate ref and exact expected base head.
- `DRAFT_PR_CREATE` with `draft=true`.

The gateway binds each request to the frozen Task Contract hash, exact expected head, touch-set digest, isolated workspace identity, controlled DAG digest and an opaque external authority-evidence SHA-256. Runtime does not interpret the authority artifact.

Provider readback must confirm the candidate branch head or Draft PR subject exactly. Missing readback is represented as `PENDING_PROVIDER_READBACK`; Runtime does not schedule a blind retry. Confirmed or blocked readbacks are appended to a deterministic hash-chained mutation journal.

The gateway never provides merge, Ready-for-review, release, force-push, workflow-rerun or workflow-dispatch authority. Final merge remains human-only through Rev5.
