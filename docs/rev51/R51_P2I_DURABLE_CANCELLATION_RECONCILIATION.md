# Runtime Rev5.1 — P2I Durable Cancellation Reconciliation

P2I records in-flight remote operations that remain OUTCOME_UNKNOWN after cancellation and permits only same-operation reconciliation to a terminal observation. Blind retry, stale cancellation fence, second terminal mutation, and changed idempotent replay are denied. The journal is durable and hash chained across restart.

P2I does not create new admission, execution, provider, worker, attempt, lease, or fence authority.
