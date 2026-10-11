# Atelier Runtime Rev5.2 Additive DigitalOcean Guardrails V1

**Status:** additive implementation, mock conformance PASS; live provisioning OFF. Does not modify the frozen Rev5.2 Runtime interfaces, baseline receipts, or approved phase contract.

## Objective

Provide a fail-closed DigitalOcean compute surface for the existing Runtime Provider Control Layer, minimizing manual SSH and manual token handling while preventing duplicate create on network failure, orphaned billable resources, and false "zero billing" receipts.

The existing DigitalOcean ChatGPT connector is already sufficient for account/droplet/snapshot/billing **read** operations. These new Node modules are an optional independently runnable Runtime adapter, not a substitute for the ChatGPT connector or an automatic grant of paid provisioning authority.

## Artifacts

- `runtime/rev52/digitalocean-guardrails-v1.mjs`: budget/lease admission; CAS state machine; unknown-outcome reconciliation; bounded, identity-confirmed delete and residue readback.
- `runtime/rev52/digitalocean-json-journal-v1.mjs`: demonstration local JSON file CAS journal; persists across process restart and refuses concurrent writes.
- `runtime/rev52/digitalocean-rest-provider-v1.mjs`: authenticated DigitalOcean REST adapter with read pagination, cost quote, billing, Droplet create/delete, child resource readback.
- `scripts/rev52/digitalocean-watchdog-v1.mjs`: independent read-only inspect or opt-in watchdog tick. Requires external scheduler to run periodically.
- `test/rev52-digitalocean-guardrails-v1.test.mjs`: injected provider failure tests, including uncertainty, protection and restarts.

## Required security contract

1. Default policy `NO_NEW_PAID_RESOURCE`. Paid create is denied without a specific execution source SHA-256, explicit `grantId` and `explicitPaidApproval`, a verified live size/region price, and a fresh monthly bill observation.
2. Budget check before provisioning: `current month usage + already reserved + conservative lease cost + buffer <= monthly cap`. Estimate uses integer milli-USD and rounds up. This is a **software safety envelope, not a provider-enforced hard spending cap**. Billing data can lag; taxes, snapshots, egress, and unrelated resources may raise final amounts. Cap is breached -> watchdog initiates cleanup of owned lease.
3. Maximum test lease is six hours. Lease expiration does **not** auto-delete a Droplet by itself. An independent, working watchdog must be scheduled **off** the disposable Droplet and must have a durable journal and delete permission.
4. Each lease gets a unique exact-identity `atelier-run-*` ownership tag; no generic delete-by-tag. The sole allowed `DELETE /droplets/:id` must be preceded by readback proving `id`, exact `name`, and tag. Any mismatch stops and requires reconciliation.
5. Write journal state `CREATE_OUTCOME_UNKNOWN` **before** the create HTTP call. If the response is missing, scan authoritative provider inventory: adopt exactly one matching Droplet; zero candidates means **uncertain**, not permission to recreate; multiple candidates are quarantined. No blind POST retries.
6. Write `DELETE_OUTCOME_UNKNOWN` **before** DELETE. Confirm resource absence with a fresh provider list and check child inventory before `CLOSED`. A second DELETE requires affirmative evidence that the same owned ID still exists; no more than two attempts.
7. Evidence must be externally stored and SHA-256 verified before voluntary normal cleanup. Expired lease, breached budget, or unavailable billing monitoring permits emergency cleanup without completed evidence, recorded as `ABORTED_AND_CLEAN`.
8. Protected legacy snapshots are never deleted. Child readback compares baseline volume, reserved IP, load balancer and snapshot inventories: newly found resources, even if untagged, prevent job closure. Incomplete API scopes/pagination mean `RESIDUE_PENDING`, not PASS.
9. `jobScopedResidueZero` means only the run has no observed resource delta. `accountWideBillableZero` intentionally stays **unknown/null**. Other account services, retained snapshots, taxes and their costs are not falsely marked zero.
10. Failure to list any required surface blocks create or closure. No provider tokens in source, logs, ChatGPT messages, evidence receipts or repo. No live resource creation/deletion as part of test suite.

## Existing account preflight (observed 2026-10-11)

The connected DigitalOcean account was inspected using read-only ChatGPT connector calls: **0 Droplets**, **1 existing Droplet snapshot** (`xxxamber-source1536-preserved-2026-09-22`, image ID `246454343`, 48.67 GB) and month-to-date usage $2.91 at the observation time. This is a point-in-time observation, not proof of all-provider zero billing or a recurring monitor. The preservation list must retain snapshot ID `246454343`; it is **not** owned by any new execution lease.

## Local validation

```bash
node --test test/rev52-digitalocean-guardrails-v1.test.mjs
node scripts/rev52/digitalocean-watchdog-v1.mjs --inspect
```

The default watchdog command is read-only and uses no token. Live `--watch` requires `DIGITALOCEAN_TOKEN` and both `DO_EXTERNAL_WATCHDOG_CONFIRMED=YES` and `DO_ENABLE_LEASE_CLEANUP=YES`; credentials must be supplied from a secure secret manager. Do not pass tokens on command lines. The sample JSON journal must reside **outside** the disposable VM; a production-grade shared CAS store in R2/D1 or equivalent and an independently scheduled watchdog are required before actual paid provisioning. The script does not install its own scheduler.

## Provider API permissions (least privilege)

Only grant access after the exact service scopes have been confirmed against the live DigitalOcean account. Provisioning needs Droplet create, read and delete privileges; the inventory includes Droplets, sizes, billing, snapshots, volumes, reserved IPs and load balancers. A read-only validation should use read-only privileges. The REST adapter never exposes a non-DigitalOcean endpoint, and rejects incomplete scans. The ChatGPT connector's OAuth context is separate from a runtime's API token; the latter is **not** automatically inherited.

## Integration with frozen Rev5.2

This is an **additive provider-specific implementation**, not a new Runtime frozen contract version. It should be registered as a provider adapter in the existing `PROVIDER_CONTROL_ADAPTER_REGISTRY_V1` only after the real off-box journal, watchdog and callback wiring have qualified. The existing `BILLING_RESIDUE_RECEIPT_V3` is left unchanged; do not claim this adapter is accepted by the project-wide final gate until a compatible real receipt, including all mandatory provider child scans, has been produced.

Planned gates:

- G0: current account read-only inventory, snapshot preservation: **PASS**.
- G1: 27 local injected-provider Node tests including cleanup, budgets, crash recovery: **PASS** (update test count if new tests added).
- G2: read-only live API rest-provider smoke with delegated credentials: **NOT RUN**; ChatGPT connector read-only access has already been verified separately.
- G3: external durable CAS store + independent scheduled watchdog, verified lease registration and provable emergency deletion: **BLOCKED / NOT DEPLOYED**.
- G4: exact authorized disposable Droplet, evidence externalization, deletion + readback, and provider-side billing reconciliation: **NOT RUN** (requires paid resource approval and G3).

## Zero-waste workflow

Keep changes in a single candidate commit. Run focused local tests first; do not dispatch repeated full GitHub Actions, provision cloud resources, touch historical snapshots, or merge/freeze the Runtime interface automatically. Qualify external execution only after off-box cleanup protection exists. Source changes must preserve the sealed Rev5.2 interface and its existing SHA-bound evidence.
