# Runtime Rev5.1 — R51-A2 Authoritative Intent Consumer Binding

Status: `LOCAL VERIFIED CANDIDATE / REMOTE WRITE NOT AUTHORIZED`

Authoritative Pilote source:

- branch: `pilote-r51-a2-execution-intent`
- HEAD: `53716039bb0df7d725bf8d8b791f376ee17d9551`
- TREE: `071d6a4e08fe97d32775336eddaf703535fa6871`
- contract set: `ATELIER_REV51_CONTRACT_SET_V1`
- contract set SHA256: `a8b220c92a47306061e9aca1c65077d357b00bda12e9daad4f37215256083f4a`
- intent schema SHA256: `31fd4c004726434c9b01614aa6f1d2b58409e58dd2af09d492a4a79f483bd82a`
- canonicalization: `ATELIER_EXECUTION_CANONICAL_JSON_V1`

The Runtime consumer does not reinterpret Pilote project/phase/task semantics. It only:

1. validates exact upstream identity and native-input boundary;
2. rejects concrete provider/worker/lease/attempt/fence/operation/secret identities in Pilote intent;
3. binds the exact `INTENT_SHA256` as `UPSTREAM_OBJECT_SHA256` / `EXECUTION_INTENT_SHA256`;
4. selects Runtime-owned compute/transport/verifier realization;
5. enforces direct requirements such as `GITHUB_GATE_REQUIRED` without inventing missing intent;
6. emits `RUNTIME_EXECUTION_PLAN_V1` with a Runtime-owned object hash.

No Task Contract V1, frozen 27 fields, Interface V1, contract-set identity, or A2 authoritative bytes are mutated by this candidate.
