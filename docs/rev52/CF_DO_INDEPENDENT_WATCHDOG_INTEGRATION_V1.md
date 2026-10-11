# Atelier Runtime Rev5.2 — Cloudflare + DigitalOcean Independent Watchdog V1

**Implementation:** code and hermetic D1/Worker tests complete. **Live deployment:** NOT DEPLOYED / NOT AUTHORIZED. **Paid Droplet lifecycle:** NOT TESTED. **Rev5.2 frozen contracts:** unchanged. **Promotion/merge:** not performed.

## Goal and architecture

Keep DigitalOcean as optional disposable heavy compute, while running the only scheduled cleanup authority **outside** the disposable Droplet in a dedicated Cloudflare Worker. D1 persists the authoritative `DO_RUN_GUARDED_V1` journal under compare-and-swap (CAS). Cloudflare API/MCP can inspect deployments; DigitalOcean REST is used only by the scheduled monitor and by the separately authorized Runtime executor.

```text
Atelier Runtime (existing guardrails, exact HEAD/TREE + grant + cost quote)
      |                        \
      | HTTPS bearer / CAS      \ scoped DigitalOcean runtime API credential
      v                          v
Cloudflare Worker + D1        DigitalOcean one disposable Droplet
(independent */5 cron)             | exact atelier-run-* ownership tag
      |                            | evidence externalization
      +---- scoped DO API ---------+-> cleanup on expiry / budget breach
      |
      +-- D1 durable record: unknown create, bound VM id, delete attempts,
          protected snapshot list, child-resource baselines and evidence receipt
```

## Additive files

| Path | Purpose |
|---|---|
| `cloudflare/atelier-do-watchdog/worker.mjs` | Authenticated D1 CAS endpoints, health gate and independent Cron tick |
| `cloudflare/atelier-do-watchdog/migrations/0001_init.sql` | D1 durable run and heartbeat tables, ownership-tag uniqueness |
| `cloudflare/atelier-do-watchdog/wrangler.example.toml` | OFF-by-default isolated Worker/D1 deployment template |
| `runtime/rev52/cloudflare-d1-do-journal-v1.mjs` | D1 CAS implementation, immutable identity and SHA256 checks; atomic account-wide lease reservation |
| `runtime/rev52/cloudflare-remote-do-journal-v1.mjs` | HTTPS authenticated remote store exposing the exact `read/cas` interface required by existing guardrails |
| `scripts/rev52/digitalocean-cf-watchdog-preflight-v1.mjs` | Read-only status probe, fails closed when heartbeat or cleanup protection is absent |
| `test/rev52-cloudflare-digitalocean-watchdog-v1.test.mjs` | Node built-in sqlite/D1 mock and injected Cron/controller tests (no cloud writes) |

## Authority and cost isolation

- No ChatGPT, Cloudflare or DigitalOcean OAuth credential is copied into the repository. Existing ChatGPT connector credentials are NOT retrievable by external Runtime code. The deploy operator must perform a separate **one-time scoped secret grant**.
- `DO_JOURNAL_SHARED_SECRET` is a strong random string (minimum 32 characters) used only for the Worker journal. `DIGITALOCEAN_TOKEN` is stored as a Cloudflare Worker secret, not plaintext `vars`.
- The pre-existing DigitalOcean snapshot must be included in the protected-snapshot list and baseline snapshot inventory; its live identifier must be obtained via authorized readback rather than hardcoded in a public repository. It is NOT disposable; no snapshot-deletion code is present.
- Default Wrangler flags `DO_SCHEDULER_ENABLED=NO` and `DO_ENABLE_LEASE_CLEANUP=NO` reject registration of any new paid lease. Absence of credentials, heartbeat or fresh DigitalOcean billing also denies registration.
- A remote lease must pass the frozen Runtime's original paid-grant, exact-source, image/size, billing and evidence checks. The Worker additionally validates signed-identity SHA256, TTL <= 6 hours, fresh balance, D1 atomic budget reservation, heartbeat age, and the single-run ownership tag.
- Actual charges are **not** hard capped by these checks. DigitalOcean invoice timing, Cloudflare Worker/D1 charges, egress, snapshots, other products and scheduler outages can increase charges. Neither an OFF Droplet nor a software lease TTL halts DigitalOcean billing by itself. For a hard-dollar limit use provider controls when independently verified.
- The Worker does not create any DigitalOcean Droplet, snapshot, volume, R2 bucket or D1 database. It writes only the dedicated D1 journal and, **once explicitly armed**, can DELETE precisely identified DigitalOcean Droplets through the existing guarded controller. Cleanup demands positive readback of the exact ID, name and ownership tag. It relies on the existing two-attempt reconciliation and post-delete child/snapshot scan. A failing scan means `RESIDUE_PENDING`, never automatic PASS. Unresolved create/delete outcomes also suppress a fresh admission heartbeat; expired never-created registrations intentionally remain fail-closed until an independently verified reconciliation/retirement path is qualified.
- Cron heartbeat is required before the first lease registration, but is **not** proof that the future scheduled invocation or provider deletion will definitely occur. Do not promote to paid runtime without an exact live deletion rehearsal and an independent alert/watchdog fallback.

## Live, read-only account baseline (2026-10-11)

- Cloudflare API MCP: `whoami` PASS; 3 Workers, 4 existing D1 databases and 4 R2 buckets enumerated. Existing production/staging resources are **untouched** and NOT reused as the watchdog DB.
- DigitalOcean connector: `droplet_list` returned 0. One previously preserved snapshot remains; exact identifiers are intentionally omitted from this public-source document. Snapshot storage can continue to incur expense, so account-wide billing is NOT zero.
- Only connected **read** capability was exercised. Cloudflare MCP in this chat was OAuth-authorized with Read only, not deployment/create/secret-modification authority. DigitalOcean provisioning/delete was not called.

## G3 deployment prerequisites (not yet executed)

1. After verifying Cloudflare Free/Paid plan limits and independently authorizing a **dedicated** Worker + D1 namespace, create database `atelier-do-watchdog`. Do not repurpose any existing D1 database. If this could produce charges, secure an explicit budget first.
2. With authorized provider write privileges, copy `wrangler.example.toml` to `wrangler.toml`, insert the dedicated database ID, and keep flags set to `NO` initially. Run the migration on this dedicated database only. `wrangler d1 migrations apply <name> --remote --config <path>` must target the exact intended account/database.
3. Bind D1 as `DO_WATCHDOG_DB`. Store `DIGITALOCEAN_TOKEN` and `DO_JOURNAL_SHARED_SECRET` as Cloudflare Worker secrets via a verified secure channel; do not paste them in ChatGPT or commit them. The DigitalOcean token must have the least privileges required for Droplet inventory, cost, child/snapshot inventory and controlled deletion; test those scopes before admitting paid runs.
4. Deploy **once** to a dedicated Worker, initially disarmed. Confirm `GET /v1/health` (with journal bearer) reports `ready=false` and no cross-project resource changes. Verify Cron exists and propagates (Cloudflare documents propagation can take up to 15 minutes).
5. Only after a real cleanup-authority test or an explicitly approved paid rehearsal, change BOTH staged enable flags to `YES`, redeploy the exact candidate and wait for a genuine scheduled heartbeat. `node scripts/rev52/digitalocean-cf-watchdog-preflight-v1.mjs` must return `PASS`. A healthy heartbeat alone is **necessary but insufficient** for paid-VM admission.
6. Using a single expressly authorized, shortest-lived minimum-price Droplet with a strict grant, prove `create → journal-before-POST → failure / restart → exactly-one adoption → evidence externalization → bounded DELETE → 404/readback → full child and snapshot residue scan`. Require `CLOSED`, zero **job-scoped** residue, no protected snapshot mutation and no orphan billable resource. Reconcile provider billing after the run. If any stage fails, stop all new paid provisioning, retain journal and escalate cleanup immediately.

## Runtime integration (no frozen-contract edits)

```js
import { createCloudflareRemoteDigitalOceanJournalV1 } from './runtime/rev52/cloudflare-remote-do-journal-v1.mjs';
import { createDigitalOceanGuardedControllerV1 } from './runtime/rev52/digitalocean-guardrails-v1.mjs';
import { createDigitalOceanRestProviderV1 } from './runtime/rev52/digitalocean-rest-provider-v1.mjs';

const store=createCloudflareRemoteDigitalOceanJournalV1({
  baseUrl:process.env.DO_WATCHDOG_URL,
  bearerToken:process.env.DO_WATCHDOG_SHARED_SECRET
});
const health=await store.health();
if(health.ready!==true)throw new Error('DO_EXTERNAL_WATCHDOG_REQUIRED');
const provider=createDigitalOceanRestProviderV1({bearerToken:process.env.DIGITALOCEAN_TOKEN});
const controller=createDigitalOceanGuardedControllerV1({store,provider});
// Only the existing EXACT-GRANT admission path may then call controller.initialize(...)
// and controller.start(...). The Worker Cron continues when this process stops.
```

## Local validation

```sh
node --test test/rev52-cloudflare-digitalocean-watchdog-v1.test.mjs
node --check cloudflare/atelier-do-watchdog/worker.mjs
node --check runtime/rev52/cloudflare-d1-do-journal-v1.mjs
node --check runtime/rev52/cloudflare-remote-do-journal-v1.mjs
```

The new test file uses Node 22's built-in `node:sqlite` to simulate D1 SQL statements; scheduled deletion is **injected** (fake provider/controller), not actual DigitalOcean deletion. The V2 regression suite also verifies that journal clients cannot claim deletion/closure through the HTTP CAS route and that a CLOSE requires a complete, digest-verified run-specific residue receipt. This verifies the data contract, not the physical accuracy of provider readback. Full integration with frozen Runtime modules, Wrangler bundle and real Cloudflare/DigitalOcean OAuth write scopes remains a separate qualification gate.

## Gate status

| Gate | Acceptance | Status |
|---|---|---|
| G0 | Real connected account inventory and protected snapshot readback | PASS, read-only |
| G1 | Remote D1 CAS, billing reservation, auth and Cron failures exercised without provider mutations | PASS, 40 hermetic tests (including V2 closure authorization hardening) |
| G2 | Dedicated Cloudflare Worker/D1 deployed; cron heartbeat, secrets, GET probes | BLOCKED (read-only Cloudflare OAuth) |
| G3 | Real independent cleanup-authority and full readback tested | BLOCKED (requires scoped writes and explicit paid rehearsal grant) |
| G4 | Exact paid compute qualification and final promotion into Runtime registry | NOT AUTHORIZED / NOT RUN |

## Supporting provider documentation

- Cloudflare Cron triggers: https://developers.cloudflare.com/workers/configuration/cron-triggers/
- Cloudflare D1 Worker bindings: https://developers.cloudflare.com/d1/get-started/
- Workers Node.js crypto compatibility: https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/
- DigitalOcean API: https://docs.digitalocean.com/reference/api/api-reference/

## V2 focused safety test update (2026-10-11)

- Reproduced a problem missed by the original 34 tests: the D1 CAS store accepted a `CLOSED` record without an authoritative residue readback receipt. It now rejects such transitions and verifies `DO_RESIDUE_READBACK_V1` structure, run identity, zero job-scoped residue, completeness, child scan, delete readback, and its SHA256 digest. The readback is not a provider-signed attestation; a correctly authorized internal controller remains required.
- The HTTP journal API now rejects transitions into `DELETE_OUTCOME_UNKNOWN`, `VERIFY_ABSENCE`, or `CLOSED`; only the independent Worker/controller, using the D1 binding, may store cleanup terminal evidence. This avoids remote clients claiming closure with a fabricated receipt.
- Observed by negative test: an expired lease still in `READY` (no create started) remains a budget reservation. This is a deliberate conservative fail-closed limitation in V1, not a claim of automatic retirement. A trusted retirement path with positive zero-owned-resource inventory and CAS concurrency protection is required before paid operations can be production-qualified.
- End-to-end real-controller integration, cloud bundle build, actual D1 migrations and Cron trigger, and DigitalOcean live deletion remain unverified. **Keep live paid provisioning disabled.**
- New suite: 40 tests PASS on Node 22.16.0, no provider mutations or CI runs. See `CF_DO_WATCHDOG_TEST_REPORT_V002.md`.
