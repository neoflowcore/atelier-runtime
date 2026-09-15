# Runtime E2 — Promotion, Rollback, and Exact Provider Readback

E2 implements deterministic PRE-FINAL production promotion and rollback mechanics after E1 governance is remotely verified.

It binds each release request to an exact environment, candidate tag and commit, artifact digest, current release digest, desired release digest, E1 governance/security decisions, opaque external authority evidence, and mandatory provider readback.

E2 remains PRE-FINAL until Runtime E final seal. It therefore prepares and verifies production-state transitions but does not itself activate live provider mutation authority.

```text
SOURCE_TREE_WRITE_AUTHORITY=NONE_FROM_E2
MERGE_AUTHORITY=NONE
FINAL_MERGE_AUTHORITY=HUMAN_ONLY
LIVE_PROVIDER_MUTATION_AUTHORITY=NONE_UNTIL_RUNTIME_E_FINAL_SEAL
PROVIDER_READBACK_REQUIRED=YES
INTERFACE_V1_MUTATION=0
FROZEN_27_FIELDS_MUTATION=0
PILOTE_SEMANTIC_REIMPLEMENTATION=0
```

Final Runtime E seal still requires the planned Pilote Rev5 / SYNC-4 cross-stack final gate.
