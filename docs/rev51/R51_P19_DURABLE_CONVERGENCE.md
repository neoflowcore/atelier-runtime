# Runtime Rev5.1 P19 — Durable Convergence Semantics

P19 distinguishes `SUCCESS_NOOP` from mutation-required state. Desired state already present is success, not pipeline failure. Unknown mutation outcomes remain non-final until reconciliation; if reconciliation observes the desired state, the operation converges without a blind retry.
