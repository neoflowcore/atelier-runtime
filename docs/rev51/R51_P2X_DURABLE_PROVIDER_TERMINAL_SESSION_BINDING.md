# R51 P2X — Durable Provider Terminal Session Binding

## Scope

P2X binds the existing P2E provider-saga terminal projection into the existing P2B one-shot session lifecycle.

P2X does not invent terminal semantics. It consumes the P2E export `deriveOneShotSessionTerminalProjectionV1` and, only from a valid COMPLETE provider saga, sets the two P2B fields already represented by that projection:

- `EXECUTION_TRANSPORT_DEREGISTERED=true`
- `REQUIRED_RESOURCE_CLEANUP_TERMINAL=true`

## Exact binding

Before session mutation P2X requires:

- valid P2E durable provider saga;
- `SAGA_STATUS=COMPLETE`;
- exact expected saga state version;
- exact final provider-saga event SHA-256;
- provider saga execution-plan hash equals session execution-plan hash;
- provider saga approval-grant id equals session approval-grant id;
- provider saga budget-reservation id equals session budget-reservation id;
- P2E terminal projection reports provider saga complete;
- P2E terminal projection reports transport deregistered and cleanup terminal;
- session billing status exactly matches the P2E projection.

The session still enforces its own state-version CAS and submitted fence through the existing P2B mutation primitive.

## Ownership boundaries

P2X intentionally does not set:

- `EXECUTION_TERMINAL`;
- `RECEIPT_TERMINAL`;
- `BILLING_STATUS`.

Receipt terminalization remains P2T-owned. Billing terminalization remains P2U-owned. Execution-terminal semantics remain unbound until an authoritative source exists.

## Idempotency

- same key + same semantic request -> exact P2B replay;
- changed request under same key -> P2B idempotency conflict;
- different key after both provider terminal flags are already set -> denied;
- stale P2B session CAS -> denied;
- stale saga state version or final-event hash -> denied.

## Non-goals

P2X does not:

- redefine P2E provider lifecycle semantics;
- define execution-terminal semantics;
- modify receipt or billing state;
- interpret Pilote A6;
- mutate Task Contract V1, Interface V1, or frozen task fields.
