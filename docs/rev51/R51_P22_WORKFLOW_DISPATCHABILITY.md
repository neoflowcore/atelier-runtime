# Runtime Rev5.1 P22 — Workflow Dispatchability / Trigger Attestation

P22 distinguishes workflow present, registered, trigger eligible, dispatch authorized, dispatch accepted, and run created. `RUN_NOT_OBSERVED` is not normalized to `WORKFLOW_FAILED`; no-op commits and blind redispatch are outside this credential-independent receipt layer.
