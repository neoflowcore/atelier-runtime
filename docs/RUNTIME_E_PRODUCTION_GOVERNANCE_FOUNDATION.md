# Runtime E1 — Production Governance Foundation

Entry gate:

```text
RUNTIME_D=SEALED
SYNC_3=PASS
```

E1 is the PRE-FINAL production-governance foundation. It does not activate production promotion, rollback, merge, or deployment authority.

## E1 scope

- provider administration boundary for ruleset / branch-protection policy changes;
- explicit opaque authority evidence binding for provider-admin mutation preparation;
- credential firewall with reference-only secret handling;
- allowlisted egress policy and pinned toolchain identity;
- deterministic append-only governance audit chain;
- Runtime D seal binding for PRE-FINAL eligibility.

## Authority fences

```text
PROVIDER_ADMIN_MUTATION=EXACT_AUTHORITY_REQUIRED
SOURCE_TREE_WRITE_AUTHORITY=NONE_FROM_E1
PRODUCTION_PROMOTION_AUTHORITY=NONE_IN_E1
PRODUCTION_ROLLBACK_AUTHORITY=NONE_IN_E1
RUNTIME_PRODUCTION_MERGE_AUTHORITY=NONE_THROUGH_REV5
FINAL_MERGE_AUTHORITY=HUMAN_ONLY
SECRET_MATERIAL_IN_RECEIPT=DENY
WILDCARD_EGRESS=DENY
UNPINNED_TOOLCHAIN=DENY
INTERFACE_V1_MUTATION=0
FROZEN_27_FIELDS_MUTATION=0
PILOTE_SEMANTIC_REIMPLEMENTATION=0
FORCE_PUSH=DENY
BLIND_RERUN=DENY
```

Ruleset and branch-protection operations are provider-administration operations, not Task Contract authority. The authority evidence is opaque to Runtime and must be exact-bound outside Interface V1.

Production promotion/rollback/readback mechanics are intentionally deferred to E2. E1 can reach PRE-FINAL only; final Runtime E seal still requires Pilote Rev5 + SYNC-4 / final cross-stack E2E.
