# Runtime Rev5.1 — R51-A5 Cross-stack Capability / Resource / Security Consumer Binding

Status: `LOCAL VERIFIED CANDIDATE / REMOTE WRITE NOT YET AUTHORIZED`

## Authoritative Pilote A5 anchor

- repository: `neoflowcore/atelier-runtime`
- branch: `pilote-r51-a5-capability-resource-security-intent`
- HEAD: `47607a346f57077b46f3df527fae5a51e960243b`
- TREE: `22871e691daedc9a922de95f6d7820b93c136e81`
- module SHA256: `a38d88c13f497007a6903297713d064f5f71188aa5a734423f3a7d0838fed1eb`
- schema SHA256: `1bbcd5a6acf38f677527ad69117c210b0c114754ba96c36edc268f7cffd948f8`
- canonicalization: `ATELIER_EXECUTION_CANONICAL_JSON_V1`
- test-vector-set SHA256: `1b48f197728e418a4941dfe758c71842aae94fb83f2106d8bfcaf3ccd37af1ee`
- expected-result-set SHA256: `0da554f47146a075e239d9cb60eeccffbe1002f98ce99306bcb3674ebeaae109`
- authoritative manifest SHA256: `59a9b26f59fbe2a9c452e6f86313a86d7d0e6635a43f9a3198a5af4634d5fe11`

## Runtime-owned binding only

The Runtime consumer does not synthesize or reinterpret Pilote A5 semantics. It verifies the exact A5 intent envelope and binds it to the existing Task Contract, A2 execution intent, and Runtime execution plan.

The binding enforces:

1. `CAPABILITY_REQUIREMENT_REFS` equals Task Contract and A2 capability requirements.
2. `RESOURCE_INTENT` equals A2 and Runtime plan resource intent.
3. `SECURITY_REQUIREMENT` equals A2 and Runtime plan security requirement.
4. Runtime plan remains bound to the A2 execution-intent hash and frozen Rev5.1 contract-set hash.
5. A5 cannot carry Runtime-owned provider, worker, attestation, credential-lease, attempt, fence, operation, resource-binding, or secret identities.

## A5 fixed security policies

```text
CAPABILITY_ATTESTATION_POLICY=STATIC_AND_DYNAMIC_REQUIRED
CAPABILITY_DRIFT_POLICY=FAIL_CLOSED
RESOURCE_OWNERSHIP_PROOF_POLICY=DURABLE_PROOF_REQUIRED_BEFORE_DESTRUCTIVE_ACTION
HOST_MOUNT_POLICY=DENY_DEFAULT
HOST_SECRET_INHERITANCE=DENY
PRIVILEGED_WORKER=DENY_DEFAULT
UNTRUSTED_CODE_ON_PERSISTENT_WORKER=DENY
JOB_SCOPED_CREDENTIAL_LEASE=REQUIRED
BOOTSTRAP_CREDENTIAL_PRIVILEGED_JOB_EQUIVALENCE=DENY
UNATTESTED_WORKER_PRIVILEGED_JOB_CREDENTIAL=DENY
WARM_REUSE_SANITATION_RECEIPT=REQUIRED
STRUCTURED_ENTRYPOINT=REQUIRED
SHELL_EXECUTION=DENY_DEFAULT
SECRET_PERSISTENCE=DENY
```

## Runtime enforcement observation boundary

The consumer also validates Runtime-owned execution facts without changing Pilote semantics:

- static and dynamic capability attestations must both be valid;
- capability drift fails closed;
- destructive action requires durable resource-ownership proof;
- bootstrap credential class cannot be equivalent to privileged-job credentials;
- job credential lease must be job-scoped;
- unattested workers cannot receive privileged-job credentials;
- privileged worker, host mount, host-secret inheritance, untrusted persistent-worker execution, shell execution, and secret persistence remain denied by default;
- warm reuse requires a sanitation receipt;
- structured entrypoint remains required.

These checks bind policy to observed Runtime state. They do not mint provider IDs, worker IDs, attestation IDs, credential lease IDs, attempt IDs, fence tokens, or operation IDs.

## Requested binding result mapping

A successful receipt emits:

```text
CAPABILITY_REQUIREMENT_BINDING=PASS
RESOURCE_INTENT_BINDING=PASS
SECURITY_REQUIREMENT_BINDING=PASS
CAPABILITY_ATTESTATION_BOUNDARY=PASS
CAPABILITY_DRIFT_BOUNDARY=PASS
RESOURCE_OWNERSHIP_PROOF_BOUNDARY=PASS
CREDENTIAL_CLASS_SEPARATION=PASS
WORKER_PRIVILEGE_BOUNDARY=PASS
SECRET_PERSISTENCE_BOUNDARY=PASS
```

## Validation

Local Node: `22.16.0`
Repository engine: `22.13.0`

Therefore local execution is supplemental evidence.

Targeted results:

```text
NODE_CHECK=PASS
TARGETED_TESTS=22/22 PASS
A5_AUTHORITATIVE_VECTOR_RESULTS=8/8 PASS
```

The 8 authoritative vectors reproduce the expected result ordering, including denial of Runtime-owned provider/attestation IDs, weakened capability attestation, privileged-worker allow, bootstrap credential privilege equivalence, secret persistence, and contract-set drift.

## Preserved invariants

```text
TASK_CONTRACT_V1_MUTATION=0
FROZEN_27_FIELDS_MUTATION=0
INTERFACE_V1_MUTATION=0
SHARED_CONTRACT_REDESIGN=0
PILOTE_SEMANTIC_REINTERPRETATION=0
RUNTIME_OWNED_PROVIDER_ID_EMISSION=0
RUNTIME_OWNED_WORKER_ID_EMISSION=0
RUNTIME_OWNED_ATTESTATION_ID_EMISSION=0
RUNTIME_OWNED_CREDENTIAL_LEASE_ID_EMISSION=0
```
