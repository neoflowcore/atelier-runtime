# Pilote Rev5.1 R51-A5 — Capability / Resource / Security Intent

Status: `AUTHORITATIVE CANDIDATE`

Upstream semantic anchor:

- repository: `neoflowcore/atelier-runtime`
- branch: `pilote-r51-a4-approval-effect-operator-intent`
- HEAD: `395779f3ff04fb56d2aaa6a836a05b6600d18747`
- TREE: `a0615fd74f6d7235744453f46b3430037afd4858`
- contract-set SHA256: `a8b220c92a47306061e9aca1c65077d357b00bda12e9daad4f37215256083f4a`

R51-A5 publishes Pilote-owned semantic intent for capabilities, resources, and security requirements. Runtime remains responsible for choosing and attesting concrete workers, providers, resources, credentials, leases, attempts, and fences.

## Capability boundary

A5 binds exactly to the capability requirements already present in Task Contract V1 and A2 `PILOTE_EXECUTION_INTENT_V1`.

`CAPABILITY_ATTESTATION_POLICY=STATIC_AND_DYNAMIC_REQUIRED`

`CAPABILITY_DRIFT_POLICY=FAIL_CLOSED`

A5 may request capabilities but cannot mint an attestation identity or choose a concrete provider/worker.

## Resource boundary

A5 reuses A2 `RESOURCE_INTENT` exactly. It does not select a concrete VM, droplet, runner, worker, provider account, resource ID, or backend instance.

Before destructive Runtime reconciliation:

`RESOURCE_OWNERSHIP_PROOF_POLICY=DURABLE_PROOF_REQUIRED_BEFORE_DESTRUCTIVE_ACTION`

The concrete durable ownership proof remains Runtime-owned.

## Security boundary

Fixed semantic requirements:

- `HOST_MOUNT_POLICY=DENY_DEFAULT`
- `HOST_SECRET_INHERITANCE=DENY`
- `PRIVILEGED_WORKER=DENY_DEFAULT`
- `UNTRUSTED_CODE_ON_PERSISTENT_WORKER=DENY`
- `JOB_SCOPED_CREDENTIAL_LEASE=REQUIRED`
- `BOOTSTRAP_CREDENTIAL_PRIVILEGED_JOB_EQUIVALENCE=DENY`
- `UNATTESTED_WORKER_PRIVILEGED_JOB_CREDENTIAL=DENY`
- `WARM_REUSE_SANITATION_RECEIPT=REQUIRED`
- `STRUCTURED_ENTRYPOINT=REQUIRED`
- `SHELL_EXECUTION=DENY_DEFAULT`
- `SECRET_PERSISTENCE=DENY`

Bootstrap or transport credentials are not privileged job credentials. An unattested worker receives no privileged job credential.

## Preserved invariants

```text
TASK_CONTRACT_V1_MUTATION=0
FROZEN_27_FIELDS_MUTATION=0
INTERFACE_V1_MUTATION=0
SHARED_CONTRACT_REDESIGN=0
A2_EXECUTION_INTENT_SCHEMA_MUTATION=0
A3_VERIFIER_ACCEPTANCE_SEMANTIC_MUTATION=0
A4_APPROVAL_EFFECT_OPERATOR_SEMANTIC_MUTATION=0
RUNTIME_OWNED_PROVIDER_ID_EMISSION=0
RUNTIME_OWNED_WORKER_ID_EMISSION=0
RUNTIME_OWNED_ATTESTATION_ID_EMISSION=0
RUNTIME_OWNED_CREDENTIAL_LEASE_ID_EMISSION=0
```
