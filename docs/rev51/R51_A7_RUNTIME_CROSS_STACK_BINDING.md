# Runtime Rev5.1 — R51-A7 Checkpoint / Cache / Data-Locality Cross-stack Binding

Status: REMOTE APPLY CANDIDATE

## Authoritative Pilote A7 anchor

- branch: `pilote-r51-a7-checkpoint-cache-data-locality-intent`
- HEAD: `ccd3e5bc2b134c9bce274015d9b836afdad6e8f2`
- TREE: `5df9e4ecd8b88d17ea87038c9f675900a4780e57`
- schema SHA256: `37c4e61dc7bc247dd91d8e8ccbb4191dfb9930e88be9cbd7852e4d401ce275f4`
- test vector SHA256: `a4845c7fab35f9cbb85c37a1fd180d7f9b58ccdab37f9ebb224fd882ee672660`
- expected result SHA256: `5e35700923ee42084a22b8bfa4ea51434ada50e0d47b8915a04322b85cb23031`
- authoritative manifest SHA256: `dc4794dd8f0b75ee12c76ee6bffc63b7bdbb4d83f88374b1583e99f2252d83fe`
- contract set SHA256: `a8b220c92a47306061e9aca1c65077d357b00bda12e9daad4f37215256083f4a`

## Runtime binding

Runtime consumes A7 without redefining Pilote semantic intent.

Checkpoint:
- `NOT_REQUESTED`, `ELIGIBLE`, and `REQUIRED` map to disabled, optional, and required Runtime capability states.
- any accepted checkpoint carries Runtime-owned `CHECKPOINT_ID`, content identity, producer receipt, current attempt, lease generation, and fence binding.
- checkpoint resume requires a new attempt identity, a strictly newer lease generation, and exactly one fence-sequence advance with a new fence token.
- checkpoint submission from a stale attempt, lease generation, or fence is denied.

Cache:
- cache reuse is allowed only for immutable CAS content with a producer receipt and matching Runtime security-domain identity.
- a cache hit is an acceleration signal only; it is never verifier-equivalent, cannot bypass the final gate, and cannot become authoritative evidence merely by existing.

Data locality:
- concrete provider selection remains Runtime-owned.
- `COLOCATE_WITH_INPUT_SET` requires Runtime-owned input-set identity plus colocation satisfaction.
- `EGRESS_RESTRICTED` requires restricted egress and fail-closed enforcement.
- locality realization must preserve A5 security requirements and may only make them stricter.

## Existing Runtime primitive alignment

The binding is consistent with existing Runtime Rev5.1 primitives:
- `durable-execution-state-v1.mjs` already carries attempt, lease-generation, fence-sequence, fence-token and rejects stale fences while enforcing monotonic fence/lease advancement.
- `durable-result-acceptance-v1.mjs` already rejects stale attempt/lease/fence and only accepts immutable artifact records after a PASS execution receipt.
- `durable-result-verification-v1.mjs` keeps verifier PASS as a separate durable verification event bound to attempt/fence/content.
- `artifact-store-v1.schema.json` already models immutable artifacts, security domains, and cache/checkpoint retention classes.
- `pilote-capability-resource-security-consumer-v1.mjs` keeps A5 security requirements and Runtime-owned provider/resource identities separate from Pilote semantic intent.

## Preserved boundaries

`TASK_CONTRACT_V1`, frozen 27 fields, Interface V1, shared contract set, A2 execution intent, and A6 parallelism/execution-class semantics are unchanged. Runtime emits no concrete provider/cache/checkpoint identity into the Pilote A7 semantic artifact.
