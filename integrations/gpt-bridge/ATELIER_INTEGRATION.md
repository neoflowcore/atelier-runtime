# Atelier GPT-Bridge Integration v001

## Decision

GPT-Bridge is adopted by **deterministic import**, not by turning it into Runtime Core.

Pinned upstream:

- Repository: `dreamurl/GPT-Bridge`
- Commit: `699b8885d4faf8e48a3ecfdcd43781807f7fc6a4`
- Package version: `0.1.0`
- License declaration: `MIT` in upstream `package.json`

The exact source snapshot is materialized under:

```text
integrations/gpt-bridge/upstream/
```

by:

```bash
node scripts/sync-gpt-bridge-upstream.mjs
```

The sync script refuses a dirty/non-exact upstream checkout and always checks out the locked commit.

## Architecture

```text
ChatGPT
  -> OpenAI Secure MCP Tunnel
  -> Atelier Runtime MCP Gateway
  -> Runtime policy / authority
  -> GPT-Bridge-derived Developer Workspace Adapter
  -> VS Code workspace
```

GPT-Bridge is a transport/workspace substrate. It is **not** authoritative runtime state.

## Reuse targets

- MCP HTTP/server plumbing
- workspace read/search
- VS Code diagnostics
- buffer-first text edits
- path guard / symlink escape protection
- deny-list and redaction
- audit log
- tunnel bootstrap/reference patterns

## Atelier-owned controls

These remain outside the imported upstream layer:

- `PHASE_EXECUTION_GRANT`
- durable authoritative job state
- Credential Plane and credential leases
- compute leases
- Billing Firewall
- idempotency keys
- `OUTCOME_UNKNOWN` reconciliation
- evidence / receipt authority
- cleanup authority
- provider lifecycle
- checkpoint / resume

## Normal-path invariants

```text
MICRO_APPROVAL_NORMAL_PATH = 0
MANUAL_SSH_NORMAL_PATH = DENY
MANUAL_TERMUX_NORMAL_PATH = DENY
TOKEN_COPY_PASTE_NORMAL_PATH = DENY
PLAINTEXT_LONG_LIVED_API_KEY_NORMAL_PATH = DENY

VS_CODE_STATE_IS_RUNTIME_AUTHORITY = FALSE
TUNNEL_CONNECTION_IS_JOB_AUTHORITY = FALSE
GPT_BRIDGE_UPSTREAM_DIRECT_MUTATION = DENY
```

Atelier changes should initially be implemented **around** the imported snapshot rather than silently rewriting it. If upstream code must be modified, record it as an explicit patch/delta.

## Adaptation sequence

1. Materialize exact upstream snapshot.
2. Baseline typecheck/build locally; no full CI yet.
3. Wrap write operations with Atelier policy adapter.
4. Map workspace tools to Runtime capabilities.
5. Replace per-write normal-path approvals with Phase-grant scoped authorization.
6. Add OpenAI Secure MCP Tunnel as a Generic Zero-Touch Transport.
7. Route tunnel/provider credentials through Credential Plane.
8. Map audit events to Runtime evidence/receipts.
9. Qualify Local Windows and VMware.
10. Qualify Android/Termux ARM64 separately.
11. Keep SSH as break-glass only.

## ACTION ECONOMY MODE v2

The import/sync itself must not dispatch CI.

First qualification should be local/zero-cost. Full CI is reserved for the exact candidate after the Atelier adapter delta is ready.
