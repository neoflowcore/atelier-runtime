# R51 P2V — Durable Session Closure Seal

## Scope

P2V is an observational Runtime-owned closure seal for an already-complete P2B one-shot execution session.

P2V does not create completion and does not set any lifecycle flag. It reads the authoritative P2B session under the session lock, requires `SESSION_STATUS=COMPLETE`, verifies the existing completion invariant, binds the final session event and full session snapshot, and writes one immutable closure seal.

## Boundary

`P2B SESSION_STATUS=COMPLETE -> P2V OBSERVATIONAL CLOSURE SEAL`

The seal records:

- session identity;
- execution-plan hash;
- execution epoch;
- attempt id;
- lease generation;
- fence token;
- final session state version;
- final event sequence and event SHA-256;
- canonical full-session snapshot SHA-256;
- all four existing terminal flags;
- terminal billing status.

## Completion semantics

P2V imports and uses the existing P2B `isSessionCompleteV1` predicate.

It does not define or infer any of the following:

- what makes execution terminal;
- what proves transport deregistration;
- what constitutes aggregate required-resource cleanup;
- what makes billing terminal.

If P2B is not already complete, P2V fails closed.

## Exactly-once seal

- the session lock is held while the final snapshot is read;
- a dedicated seal lock serializes creation;
- the seal is written by fsync + atomic rename + directory fsync;
- exact idempotent replay is allowed;
- changed request under the same key is denied;
- a second seal under another key is denied;
- reopening validates the seal hash;
- replay also rechecks the current session snapshot hash against the sealed snapshot.

## Non-goals

P2V does not:

- mutate the P2B session;
- synthesize missing terminal evidence;
- alter P2T or P2U;
- interpret Pilote A6;
- mutate Task Contract V1, Interface V1, or the frozen 27 fields;
- dispatch or rerun workflows.
