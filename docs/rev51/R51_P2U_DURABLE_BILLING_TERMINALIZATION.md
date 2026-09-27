# R51 P2U — Durable Billing Terminalization / Session Binding

## Scope

P2U closes the Runtime-owned bridge between P2H durable reservation settlement and the P2B one-shot execution-session billing terminal state.

P2H remains authoritative for reservation accounting. P2U does not perform accounting arithmetic. It consumes a durable settlement for the session's exact budget reservation and changes only the existing P2B field:

`BILLING_STATUS: ACTIVE -> STOPPED`

## Exact binding

A new billing terminalization requires:

- settlement store `EXECUTION_PLAN_SHA256` equals session `EXECUTION_PLAN_HASH`;
- session `BUDGET_RESERVATION_ID` exists in the P2H settlement map;
- settlement `FENCE_TOKEN` equals the session fence;
- exact expected P2H settlement-store state version;
- exact expected `RESERVATION_USAGE_SETTLED` event SHA-256;
- the settlement event payload is byte-semantically equal to the durable settlement record;
- current P2B session state version and submitted session fence.

The event-payload cross-check prevents a settlement-record-only mutation from being treated as authoritative billing evidence.

## State boundary

`P2G terminal reservation -> P2H durable settlement -> P2U BILLING_STATUS=STOPPED -> P2B session lifecycle`

P2U changes no other terminal flags.

## Idempotency

- same idempotency key + same request -> replay;
- changed request under the same key -> P2B idempotency conflict;
- a different key after billing is already terminal -> denied;
- stale session CAS -> denied;
- stale session fence -> denied;
- stale settlement-store version -> denied;
- wrong settlement event hash -> denied.

## Session completion invariant

P2U contributes only the existing billing condition:

`BILLING_STATUS=STOPPED`

The P2B completion rule remains unchanged:

`SESSION_COMPLETE = EXECUTION_TERMINAL AND RECEIPT_TERMINAL AND EXECUTION_TRANSPORT_DEREGISTERED AND REQUIRED_RESOURCE_CLEANUP_TERMINAL AND BILLING_STOPPED_OR_NOT_APPLICABLE`

Therefore settlement alone cannot complete a session.

## Non-goals

P2U does not:

- redefine reservation accounting;
- modify P2H settlement records;
- set execution/receipt/transport/cleanup terminal flags;
- select a provider or transport;
- interpret Pilote A6 execution-class or parallelism semantics;
- mutate Task Contract V1, Interface V1, or the frozen 27 fields.
