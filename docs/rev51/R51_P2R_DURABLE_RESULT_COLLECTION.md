# R51 P2R — Durable Result Collection / Quarantine Admission

## Scope

P2R introduces the durable boundary between an `ACTIVE` execution transport and the pre-existing P2F durable result acceptance transaction.

P2R does not decide that a result is correct. It only proves that a submitted result belongs to the current Runtime execution lineage and admits staging artifacts into `QUARANTINED` state exactly once.

The collection record binds:

- current `EXECUTION_ID`, `EXECUTION_EPOCH`, `ATTEMPT_ID`, `LEASE_GENERATION`, and `FENCE_TOKEN`;
- active transport `WORKER_ID` and `WORKER_JOB_SHA256`;
- execution-state version and terminal event hash;
- transport-state version, terminal event hash, and canonical transport-store hash;
- result evidence SHA-256;
- a deterministically sorted quarantined artifact manifest.

## State boundary

`STAGING artifacts -> P2R collection -> QUARANTINED artifacts -> P2F verification/atomic acceptance -> IMMUTABLE artifacts`

P2R therefore preserves the separation between result collection and authoritative acceptance. Worker completion, artifact existence, or a transport result never equals Runtime acceptance.

## Exactly-once semantics

The collection journal is immutable after first commit.

- same idempotency key + same request: replay allowed;
- same key + changed request: denied;
- different key after collection: denied;
- stale fence: denied;
- stale execution state version: denied;
- stale transport state version: denied.

The execution-state, transport-state, and collection-journal locks are held while a new collection record is derived and atomically written. Replay remains readable after later state advancement because the original collection record is authoritative for the original request.

## Fail-closed provenance rules

A new collection is denied unless:

- P2A durable execution state is valid;
- provider outcome is not unresolved;
- the submitted fence is current;
- P2Q durable transport is `ACTIVE` with conformance `PASS`;
- transport has no unresolved active operation;
- execution, attempt, and fence lineage match between P2A and P2Q;
- submitted worker identity and worker-job hash match P2Q;
- every submitted artifact is `STAGING`, belongs to the same execution, and has a valid content hash and storage descriptor.

Raw provider resource IDs, registration tokens, credentials, and secret values are forbidden from the P2R request/record surface.

## P2F bridge

`buildDurableResultAcceptanceRequestV1` converts a validated P2R collection record into the existing P2F request shape. It does not call P2F and does not bypass P2F verification. The helper preserves the collection's exact state/fence/attempt binding and passes the quarantined manifest forward unchanged.

## Non-goals

P2R does not:

- interpret Pilote A6 execution-class or parallelism semantics;
- select compute providers or execution transports;
- mint execution, attempt, fence, worker, provider, or artifact identities;
- declare verifier PASS;
- make artifacts immutable;
- mutate Task Contract V1, Interface V1, or the frozen 27 fields;
- dispatch or rerun GitHub Actions.
