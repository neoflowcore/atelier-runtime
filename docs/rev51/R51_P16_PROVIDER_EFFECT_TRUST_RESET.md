# Runtime Rev5.1 P16 — Effect-Semantics Authority + Trust Reset

P16 classifies provider operations by declared side effect rather than HTTP method. `POST` queries can remain read-only and a misleading `GET` cannot gain read authority when its semantic class is a provider mutation. Operator-side state mutation marks only affected evidence domains stale and requires authoritative re-read/revalidation before reuse. This slice performs no provider mutation or credential binding.
