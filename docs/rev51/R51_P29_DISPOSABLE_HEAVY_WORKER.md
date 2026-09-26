# Runtime Rev5.1 P29 — Disposable Heavy Worker Lifecycle

P29 composes existing durable provider/bootstrap/billing primitives into a higher-level create/close guard. Creation is denied until preflight, execution path, credential reference readiness, artifact destination, cleanup authority, cost authorization, TTL, and cost cap are all present. Closure requires heavy completion, evidence externalization, required-artifact verification, destroy confirmation, absence verification, and billable-residue PASS. Power-off never counts as destroy. No paid resource is created by this slice.
