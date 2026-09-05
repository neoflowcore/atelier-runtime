# Runtime V1 Scope Lock

## Product definition

```text
EXECUTION_INFRASTRUCTURE=GITHUB_ACTIONS_GITHUB_HOSTED_RUNNER
ATELIER_RUNTIME_ROLE=THIN_EXECUTION_STANDARD
BROAD_NODE_WEB_EXECUTION=TRUE
NEW_COMPUTE_PLATFORM=FALSE
CONTROL_PLANE=OUT_OF_SCOPE_V1
SOURCE_WRITE=DENY
```

Runtime V1 executes, verifies, classifies, and records evidence. It does not decide what should run, repair code, approve mutations, or manage durable task state.

## Immutable profile

```text
PROFILE=NODE_WEB_VERIFY
PROFILE_VERSION=1
RECEIPT_SCHEMA_VERSION=1
SOURCE_TYPE=GITHUB_REPOSITORY
SOURCE_REF=EXACT_SHA
RUNNER=GITHUB_HOSTED_EPHEMERAL
OS=LINUX_ONLY
PACKAGE_MANAGER=NPM_ONLY
BROWSER=CHROMIUM_ONLY
AUTO_RETRY=0
PERSISTENT_SERVER=DENY
VISUAL_CERTIFICATION=OUT_OF_SCOPE_V1
```

The explicit `.atelier/runtime.json` contract is required. Script slots are optional and may include `format`, `lint`, `typecheck`, `build`, `test`, `integration`, `dev`, and `browser`. An undeclared optional stage is `SKIPPED`, never `PASS`.

## Result taxonomy

Top-level results are `PASS`, `BLOCKED`, `APP_FAILURE`, `INFRA_FAILURE`, `TIMEOUT`, and `CANCELLED`.

Stage states are `NOT_RUN`, `SKIPPED`, `PASS`, `FAIL`, `BLOCKED`, `TIMEOUT`, and `CANCELLED`.

## Deferred

V1 excludes other language runtimes, package managers other than npm, Docker or general service orchestration, multi-OS/browser matrices, arbitrary commands or arguments, persistent preview hosting, source mutation, a durable idempotency database, a control plane, and GPT/Pilote integration.

