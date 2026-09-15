# Runtime D2 Exact-Approved Merge and Candidate-Tag Coordination

Entry state:

```text
RUNTIME_D1=REMOTE_VERIFIED
SYNC_3=PASS
RUNTIME_C=SEALED
PILOTE_REV4.5=SEALED
```

D2 adds deterministic mechanics for exact-approved merge preparation and release-candidate tag coordination. It does not activate production merge or deployment authority.

## Merge preparation

A merge envelope is valid only when all of the following are exact-bound:

- exact Task Contract hash;
- active WRITE_EXCLUSIVE Runtime D lease;
- verified Runtime D scheduler decision for CANDIDATE_WRITE;
- opaque external approval-evidence SHA-256;
- exact repository and PR number;
- exact base ref and expected base head;
- exact head ref and expected head SHA;
- provider readback of the same open PR subject;
- non-production safety class.

The envelope is a mechanical preparation artifact only. Through Rev5 it carries no provider merge authority.

## Candidate-tag coordination

A candidate-tag envelope binds an exact tag name to an exact candidate commit and exact approval evidence. It may coordinate a release-candidate marker but never implies deployment or production promotion.

## Authority fences

```text
PILOTE_MERGE_AUTHORITY=NONE
RUNTIME_PRODUCTION_MERGE_AUTHORITY=NONE
HUMAN_ONLY_READY_AND_FINAL_MERGE=PRESERVE_THROUGH_REV5
PROVIDER_MERGE_MUTATION_AUTHORITY=NONE_THROUGH_REV5
CANDIDATE_TAG_DOES_NOT_IMPLY_DEPLOY=TRUE
PRODUCTION_DEPLOY_AUTHORITY=NONE
INTERFACE_V1_MUTATION=0
FROZEN_27_FIELDS_MUTATION=0
PILOTE_SEMANTIC_REIMPLEMENTATION=0
FORCE_PUSH=DENY
BLIND_RERUN=DENY
```

D2 validates and seals merge/tag mechanics only. A future separately authorized migration after Rev5 may activate mechanical merge, and Plan E retains production promotion/release authority.
