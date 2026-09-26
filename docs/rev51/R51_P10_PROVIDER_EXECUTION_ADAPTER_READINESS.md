# Runtime Rev5.1 P10 — Provider Execution Adapter Readiness

Status: credential-independent development candidate.

P10 separates provider capability from an immediately runnable execution path. `PROVIDER_EXECUTION_ADAPTER_READINESS_V1` records `READY`, `BOOTSTRAP_REQUIRED`, or `UNAVAILABLE`, plus the readiness of control-plane authority, artifact return, workflow dispatch when required, cleanup, source fetch, and the exact validation-harness identity. Readiness is freshness bounded and stale observations fail closed.

Source transport follows Action Economy priority: exact SHA checkout first, then immutable source bundle, and only then an ephemeral validation ref when the provider cannot consume an immutable source identity directly. `FALLBACK_EXECUTION_PLAN_V1` binds the exact candidate and reusable harness while capping the exact-candidate remote full-run budget at one and denying unrequired matrix expansion or intermediate remote gates.

This slice describes readiness and a plan only. It does not dispatch a workflow, run remote validation, create an ephemeral ref, bootstrap a provider, mutate provider state, allocate paid compute, or bind credentials.
