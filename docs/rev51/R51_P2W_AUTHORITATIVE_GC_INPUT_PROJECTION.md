# R51 P2W — Authoritative GC Input Projection

## Scope

P2W is a pure Runtime-owned bridge from existing authoritative terminal evidence into the existing P2J GC tombstone contract.

It consumes:

- P2F durable result acceptance;
- P2E provider bootstrap saga in COMPLETE state;
- P2V durable session closure seal.

It does not delete artifacts and does not write GC tombstones itself.

## Exact cross-stack/runtime binding

P2W requires exact agreement for:

- execution-plan hash across P2F, P2E, and P2V;
- execution id across P2F and P2E;
- execution epoch, attempt id, lease generation, and fence token across P2F and P2V;
- transport deregistration, required resource cleanup, and billing terminal status across P2E projection and P2V seal.

Only an artifact present in the immutable P2F accepted manifest can be projected.

## P2J compatibility

The projection calculates:

- acceptance journal SHA-256 from P2F;
- execution receipt SHA-256 from P2F;
- canonical accepted-artifact manifest SHA-256;
- accepted artifact content SHA-256;
- provider saga completion;
- transport deregistration;
- resource-cleanup terminal state;
- billing terminal state.

The resulting object is passed through the existing P2J `evaluateGcEligibilityV1` gate before it is returned.

## Non-goals

P2W does not:

- create acceptance;
- create session completion;
- reinterpret provider cleanup semantics;
- delete artifacts;
- commit GC tombstones;
- interpret Pilote A6;
- mutate Task Contract V1, Interface V1, or frozen task fields.
