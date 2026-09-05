# Target Repository Integration

Runtime V1 is invoked from an approved target repository through a thin caller workflow. Runtime logic remains centralized in `neoflowcore/atelier-runtime`.

## Target surface

```text
.github/workflows/atelier-runtime-v1.yml
.atelier/runtime.json
.atelier/routes.json  # only when HTTP checks are declared
```

## Required request fields

```text
request_id
idempotency_key
target_sha
profile=NODE_WEB_VERIFY
profile_version=1
```

The caller must pin the reusable workflow to an exact Atelier Runtime commit SHA. Floating branch or tag references are not release-safe.

The reusable workflow receives the caller repository as its execution context; it does not accept an arbitrary repository URL. The requested target SHA must be a full lowercase 40-character Git commit SHA.

Runtime and target sources are checked out separately:

```text
runtime/ = neoflowcore/atelier-runtime at the reusable workflow SHA
target/  = caller repository at target_sha
```

All project commands run inside `target/`. Both checkouts disable credential persistence. Target repository mutation is outside Runtime V1.

