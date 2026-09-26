# R51-P2P — Durable Worker Isolation Boundary

## Purpose

P2P turns the A5 worker-isolation declarations into a durable pre-launch authorization bound to the current Runtime execution lineage.

The boundary is intentionally separate from semantic scheduling and from the P2O launch state machine. It does not reinterpret Pilote A6 parallelism or execution-class intent.

## Durable binding

Each isolation record binds:

- `EXECUTION_ID`
- `ATTEMPT_ID`
- `FENCE_TOKEN`
- `WORKER_ID`
- `WORKER_JOB_SHA256`
- `WORKER_READY_ATTESTATION_HASH`
- `ISOLATION_PROFILE_SHA256`

The initialization and claim paths validate the current P2A durable execution state. The claim path also requires the P2O worker-job launch record to refer to the same lineage and job.

## A5 policy enforcement

P2P requires the authoritative A5 policy values:

- `PRIVILEGED_WORKER=DENY_DEFAULT`
- `HOST_MOUNT_POLICY=DENY_DEFAULT`
- `HOST_SECRET_INHERITANCE=DENY`
- `UNTRUSTED_CODE_ON_PERSISTENT_WORKER=DENY`

The durable record can only be created with:

- `WORKER_PRIVILEGED=false`
- `HOST_MOUNT_GRANTED=false`
- `HOST_SECRET_INHERITED=false`
- `UNTRUSTED_CODE_ON_PERSISTENT_WORKER=false`

## Exactly-once launch authorization

The isolation boundary begins `AVAILABLE`. A successful launch authorization claim transitions it to `CLAIMED` and records the launch operation identity.

- exact replay of the same claim is allowed;
- a changed replay is denied;
- a second claim is denied;
- exact replay remains valid if P2O has since progressed beyond `AVAILABLE`;
- `TRUST_RESET`, `POLICY_DRIFT`, `WORKER_REATTESTED`, or `WORKER_REPLACED` can invalidate an available or previously claimed boundary;
- once `INVALID`, even an old exact claim replay is denied.

This gives policy invalidation precedence over historical idempotent authorization.

## Durability

State mutations use:

- exclusive state locks;
- P2A execution-state lock for current-lineage checks;
- state-version CAS;
- request idempotency fingerprints;
- append-only SHA-256 event chaining;
- fsync + atomic rename + directory fsync.

## Non-goals and frozen boundaries

P2P does not:

- mint or advance execution, attempt, lease, fence, provider, or worker identities;
- persist host secret material or host mount paths;
- reinterpret Task Contract fields;
- alter `WORKER_JOB_V1`, `RUNTIME_EXECUTION_PLAN_V1`, or frozen interface schemas;
- interpret A6 parallelism or execution-class semantics;
- dispatch, rerun, merge, or write `main`.
