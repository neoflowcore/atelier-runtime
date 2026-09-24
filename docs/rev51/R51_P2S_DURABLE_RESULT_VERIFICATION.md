# R51 P2S — Durable Result Verification / A3 Policy Binding

## Scope

P2S makes the verifier outcome durable after P2R result collection and before P2F atomic acceptance. It does not invent acceptance semantics, tolerances, or project policy. The authoritative verifier policy remains Pilote A3 and the Runtime execution plan remains the exact consumer-bound plan.

The durable record binds the P2R collection record hash, execution/attempt/fence lineage, worker-job hash, Runtime plan hash, Pilote A3 verifier policy identity, acceptance requirement reference, contract-set hash, worker-result evidence hash, verifier-evidence hash, artifact manifest, and terminal verification payload.

## State boundary

`P2R QUARANTINED -> P2S PASS|FAIL|BLOCKED -> P2F acceptance (PASS only)`

`FAIL` and `BLOCKED` are durable terminal verifier outcomes but cannot be converted into an acceptance request. `PASS` is only eligible for the existing P2F gate; P2S does not itself make artifacts immutable or create an execution receipt.

## Policy separation

P2S validates the existing A3 policy object with the Runtime A3 consumer and requires exact identity binding to the Runtime plan:

- `VERIFIER_POLICY`
- `VERIFIER_POLICY_REF_SHA256`
- `ACCEPTANCE_REQUIREMENT_REF`
- `CONTRACT_SET_SHA256`

This preserves the frozen rule that Runtime does not define acceptance semantics or tolerance and that raw worker success is not direct project acceptance.

## Exactly-once semantics

One durable verification record is allowed per collection journal.

- same idempotency key + same request -> replay;
- same key + changed request -> deny;
- different key after terminal verification -> deny;
- collection record tamper -> deny;
- collection lock or verification lock contention -> deny.

The collection journal is locked while the verification record is derived so the binding is exact and crash-reopenable.

## PASS mechanical gate

For a `PASS` record, the existing P2F verification contract is preserved mechanically:

- execution, attempt, fence, worker-job, and plan hashes must match;
- content/fence/worker-job/plan/security-output checks must all be `true`;
- artifact content bindings must cover the exact P2R quarantined artifact set and content hashes.

`FAIL` and `BLOCKED` may preserve false verifier checks for evidence, but they cannot cross the P2F bridge.

## P2F bridge

`buildDurableResultAcceptanceRequestFromVerificationV1` emits the existing P2F request shape only from a validated durable `PASS` record whose collection hash and result evidence hash still match P2R. P2F remains the sole authoritative atomic acceptance transaction.

## Non-goals

P2S does not:

- interpret Pilote A6 parallelism or execution-class intent;
- choose a verifier policy;
- define acceptance requirements or tolerance;
- mint execution, attempt, fence, worker, provider, or artifact identities;
- dispatch or rerun workflows;
- mutate Task Contract V1, Interface V1, or the frozen 27 fields.
