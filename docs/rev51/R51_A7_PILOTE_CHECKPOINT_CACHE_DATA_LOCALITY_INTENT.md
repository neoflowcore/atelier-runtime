# Pilote Rev5.1 R51-A7 — Checkpoint / Cache / Data-Locality Intent

Status: `AUTHORITATIVE CANDIDATE`

Upstream anchor:

- repository: `neoflowcore/atelier-runtime`
- branch: `pilote-r51-a6-parallelism-execution-class-intent`
- HEAD: `878e5966f6a4c3fc45f76659f83d107f17ce9f6d`
- TREE: `e4eb4a8a1887fb859f0504431584f5f66869ce3b`

A7 binds the checkpoint, cache, and data-locality semantics already carried by `PILOTE_EXECUTION_INTENT_V1`. It does not select a provider, worker, checkpoint ID, cache key, attempt, lease, or fence.

## Checkpoint semantics

```text
CHECKPOINT_POLICY =
NOT_REQUESTED
ELIGIBLE
REQUIRED
```

Semantics:

- `NOT_REQUESTED`: checkpoint use disabled.
- `ELIGIBLE`: Runtime may use checkpointing if supported.
- `REQUIRED`: compatible checkpoint capability is required.

Resume from a checkpoint is never continuation of the old attempt identity.

```text
CHECKPOINT_STRONG_IDENTITY=REQUIRED
CHECKPOINT_RESUME_NEW_ATTEMPT=REQUIRED
CHECKPOINT_RESUME_NEW_LEASE_GENERATION=REQUIRED
CHECKPOINT_RESUME_FENCE_ADVANCE=REQUIRED
CHECKPOINT_STALE_ATTEMPT_ACCEPTANCE=DENY
```

## Cache semantics

```text
CACHE_POLICY =
NOT_REQUESTED
ELIGIBLE
REQUIRED
```

Cache reuse requires:

```text
CACHE_IMMUTABLE_CAS=REQUIRED
CACHE_PRODUCER_RECEIPT=REQUIRED
CACHE_SECURITY_DOMAIN_MATCH=REQUIRED
```

And:

```text
CACHE_HIT != VERIFIER_PASS
CACHE_HIT_VERIFIER_EQUIVALENCE=DENY
CACHE_FINAL_GATE_BYPASS=DENY
CACHE_OBJECT_AUTHORITATIVE_EVIDENCE=DENY
```

A cache object may accelerate computation. It does not become authoritative project evidence merely by existing.

## Data locality semantics

```text
DATA_LOCALITY_POLICY =
NONE
COLOCATE_WITH_INPUT_SET
EGRESS_RESTRICTED
```

- `NONE`: no additional locality requirement beyond existing security constraints.
- `COLOCATE_WITH_INPUT_SET`: placement must satisfy input-set colocation.
- `EGRESS_RESTRICTED`: egress restriction is fail-closed.

Concrete provider/resource selection remains Runtime-owned.

```text
DATA_LOCALITY_PROVIDER_SELECTION=RUNTIME_OWNED
DATA_LOCALITY_SECURITY_WEAKENING=DENY
EGRESS_RESTRICTED_FAIL_CLOSED=REQUIRED
RUNTIME_STRICTER_LOCALITY=ALLOW
```

A locality policy may make Runtime stricter. It cannot weaken A5 security requirements.

## Ownership boundary

Pilote owns semantic intent only.

Runtime owns concrete:

- checkpoint identity and storage location;
- checkpoint integrity/provenance validation;
- cache key and immutable CAS object;
- security-domain identity;
- input-set identity;
- current attempt/lease/fence identities;
- provider/worker/resource selection.

## Preserved invariants

```text
TASK_CONTRACT_V1_MUTATION=0
FROZEN_27_FIELDS_MUTATION=0
INTERFACE_V1_MUTATION=0
SHARED_CONTRACT_REDESIGN=0
A2_EXECUTION_INTENT_SCHEMA_MUTATION=0
A6_PARALLELISM_EXECUTION_CLASS_SEMANTIC_MUTATION=0

CACHE_HIT_NEVER_IMPLICITLY_EQUALS_VERIFIER_PASS=YES
OLD_ATTEMPT_CANNOT_SUBMIT_CURRENT_RESULT_OR_CHECKPOINT=YES

RUNTIME_OWNED_CHECKPOINT_ID_EMISSION=0
RUNTIME_OWNED_CACHE_KEY_EMISSION=0
RUNTIME_OWNED_PROVIDER_ID_EMISSION=0
```
