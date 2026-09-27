# R51 P2T — Durable Receipt Terminalization / Session Binding

## Scope

P2T closes the missing Runtime-owned bridge between authoritative P2F result acceptance and the P2B one-shot execution-session lifecycle.

P2F remains the sole authoritative acceptance transaction. P2T only consumes a validated `DURABLE_RESULT_ACCEPTANCE_V1` record and marks the existing session flag `RECEIPT_TERMINAL=true`.

## Boundary

`P2S PASS -> P2F ACCEPTED + EXECUTION_RECEIPT_V1 -> P2T RECEIPT_TERMINAL -> P2B session lifecycle`

P2T does not mark execution terminal, deregister transport, complete cleanup, stop billing, or directly make the session complete.

## Exact binding

Before terminalization P2T requires:

- expected acceptance-record SHA-256;
- expected execution-receipt `OBJECT_SHA256`;
- exact execution-plan hash;
- exact execution epoch;
- exact attempt id;
- exact lease generation;
- exact fence token;
- valid P2F acceptance and embedded receipt;
- current P2B session state version and submitted fence.

`SESSION_ID` is intentionally independent from `EXECUTION_ID`. P2T does not conflate those identities.

## Idempotency

- same idempotency key + same request -> replay allowed;
- changed request under the same key -> existing P2B idempotency conflict;
- different key after `RECEIPT_TERMINAL=true` -> denied;
- stale session CAS -> denied;
- stale fence -> denied.

## Session completion invariant

P2T contributes only one existing terminal flag:

`RECEIPT_TERMINAL=true`

The existing P2B invariant remains unchanged:

`SESSION_COMPLETE = EXECUTION_TERMINAL AND RECEIPT_TERMINAL AND EXECUTION_TRANSPORT_DEREGISTERED AND REQUIRED_RESOURCE_CLEANUP_TERMINAL AND BILLING_STOPPED_OR_NOT_APPLICABLE`

Therefore authoritative result acceptance alone cannot complete a session.

## Non-goals

P2T does not:

- define verifier or acceptance semantics;
- reinterpret Pilote A6 execution class or parallelism;
- mutate P2F acceptance records or receipts;
- mint runtime identities;
- set other terminal flags;
- settle reservation usage or stop billing;
- deregister execution transport;
- mutate Task Contract V1, Interface V1, or the frozen 27 fields.
