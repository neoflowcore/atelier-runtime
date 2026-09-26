# Runtime Rev5.1 - R51-P2E Durable Provider / Bootstrap Saga

Status: LOCAL VERIFIED CANDIDATE / REMOTE WRITE NOT YET AUTHORIZED

## Scope

This Runtime-owned slice makes the one-shot provider/bootstrap lifecycle durable and restart-safe without depending on unpublished Pilote A6 semantics.

The fixed Runtime saga is:

```text
PROVISION
-> BOOTSTRAP
-> ATTEST
-> REGISTER_TRANSPORT
-> BIND_JOB
-> EXECUTE
-> COLLECT
-> DEREGISTER
-> CLEANUP
-> BILLING_STOP
-> COMPLETE
```

It does not modify Task Contract V1, Interface V1, the frozen 27 fields, or the shared Rev5.1 contract set.

## Durable authority model

The durable saga binds:

- execution ID and execution-plan hash;
- bootstrap-spec hash;
- compute-provider class and execution-transport class;
- approval-grant ID and budget-reservation ID;
- strict phase prefix;
- active operation identity and idempotency key;
- per-phase evidence hashes;
- provider observations;
- transport deregistration, cleanup, and billing terminal state;
- hash-chained append-only event ledger and state-version CAS.

Runtime authoritative desired state remains primary. Provider-observed state is recorded as evidence but cannot advance or rewrite the desired saga phase.

## OUTCOME_UNKNOWN

An irreversible operation that returns `OUTCOME_UNKNOWN` places the saga in `RECONCILIATION_REQUIRED`.

While that state is active:

```text
BLIND_RETRY=DENY
PHASE_ADVANCE=DENY
SECOND_OPERATION=DENY
SAME_OPERATION_RECONCILIATION_ONLY=YES
```

Reconciliation must use the same `OPERATION_ID` and operation idempotency key. A successful reconciliation advances exactly one phase. A failure becomes terminal and does not reopen approval or create a second mutation.

## Evidence bindings

Successful `BOOTSTRAP`, `ATTEST`, `REGISTER_TRANSPORT`, and `BIND_JOB` phases require SHA-256 evidence bindings.

The saga does not synthesize provider, worker, credential, attestation, attempt, lease, or fence semantic authority. Those remain Runtime-owned identities or upstream/downstream bound evidence as already defined by P2A-P2D and A5.

## One-shot session terminal projection

The saga exposes the Runtime-owned terminal projection needed by P2B:

```text
DEREGISTER PASS
-> EXECUTION_TRANSPORT_DEREGISTERED=true

CLEANUP PASS
-> REQUIRED_RESOURCE_CLEANUP_TERMINAL=true

BILLING_STOP PASS
-> BILLING_STATUS=STOPPED | NOT_APPLICABLE
-> PROVIDER_SAGA_COMPLETE=true
```

This projection does not itself mark execution or receipt terminal. P2B `SESSION_COMPLETE` still requires all of its independent terminal conditions.

## Validation

Local execution environment:

```text
Node=22.16.0
Repository engine Node=22.13.0
```

Therefore local execution is supplemental evidence.

Targeted validation:

```text
NODE_CHECK=PASS
TARGETED_TESTS=16/16 PASS
CRASH_REOPEN=PASS
STRICT_PHASE_ORDER=PASS
OUTCOME_UNKNOWN_BLIND_RETRY=DENY
SAME_OPERATION_RECONCILE_ONLY=PASS
PROVIDER_OBSERVED_OVERRIDE=DENY
CAS_AND_IDEMPOTENCY=PASS
DEREGISTER_CLEANUP_BILLING_TERMINAL=PASS
EVENT_HASH_TAMPER_REJECT=PASS
```
