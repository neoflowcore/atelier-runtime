# Runtime Rev5.1 — P2H Durable Reservation Settlement

P2H adds a durable accounting ledger after P2G admission reservation reaches a terminal state. It records actual runtime/cost usage, releases unused reserved capacity, rejects usage above reservation, provides CAS/idempotency, and preserves a hash-chained event ledger across restart.

This slice does not reinterpret Pilote parallelism/execution-class semantics, does not mint provider/worker/attempt/fence identities, and does not mutate Task Contract V1 or Interface V1.
