# R51-A2 Pilote Execution Intent — Authoritative Remote Bytes

Status: `AUTHORITATIVE_REMOTE_CANDIDATE`

This publication binds the Pilote-owned `PILOTE_EXECUTION_INTENT_V1` bytes to the sealed Rev5.1 contract-set identity.

```text
CONTRACT_SET_ID=ATELIER_REV51_CONTRACT_SET_V1
CONTRACT_SET_SHA256=a8b220c92a47306061e9aca1c65077d357b00bda12e9daad4f37215256083f4a
PILOTE_EXECUTION_INTENT_V1_SCHEMA_SHA256=31fd4c004726434c9b01614aa6f1d2b58409e58dd2af09d492a4a79f483bd82a
PILOTE_EXECUTION_INTENT_V1_CANONICALIZATION_ID=ATELIER_EXECUTION_CANONICAL_JSON_V1
PILOTE_EXECUTION_INTENT_V1_TEST_VECTOR_SET_SHA256=9bde23ef29b9af96a741a3e49a0a4776760472430e393899f19383764730f6ad
PILOTE_EXECUTION_INTENT_V1_EXPECTED_RESULT_SET_SHA256=584a728d6a2ea2222fd4596b8c25756d84577c3fb31d29c93a87c7a4403c2a5b
```

The intent remains provider-neutral. Concrete provider, worker, runner, lease, attempt, fence, operation, idempotency and secret-value identities are forbidden from Pilote semantic intent.

The six authoritative vectors cover one valid native intent and fail-closed cases for provider identity, secret value, legacy-mode downgrade, contract-set drift and intent tampering.
