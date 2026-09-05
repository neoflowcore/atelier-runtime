# Security Boundary

## Locked policy

```text
REPOSITORY_POLICY=ALLOWLIST_ONLY
PERMISSIONS_CONTENTS=READ
SOURCE_WRITE=DENY
REMOTE_SOURCE_WRITE_AUTHORITY=NONE
BRANCH_CREATE=DENY
COMMIT_CREATE=DENY
PR_CREATE=DENY
FORCE_PUSH=DENY
RAW_SHELL_INPUT=DENY
ARBITRARY_COMMAND_INPUT=DENY
ARBITRARY_ARGS_INPUT=DENY
ARBITRARY_ENV_INPUT=DENY
EXTRA_SECRETS=NONE
SECRET_PRINT=DENY
CHECKOUT_PERSIST_CREDENTIALS=FALSE
AUTO_RETRY=0
ACTION_DEPENDENCY_PINNING=FULL_COMMIT_SHA
FLOATING_ACTION_TAGS_IN_RELEASE=DENY
```

Only approved target repositories may invoke Runtime V1. Target npm scripts are executable code, so the runtime exposes no privileged extra secrets and grants no remote source-write authority. Both runtime and target checkouts must set `persist-credentials: false`.

The contract accepts npm script names matching `^[A-Za-z0-9:_-]+$`; it never accepts shell, command, flags, arbitrary arguments, environment injection, secret forwarding, or clone URLs.

GitHub-hosted runners are ephemeral. V1 does not claim complete outbound-network isolation.

