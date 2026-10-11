# CF + DigitalOcean Watchdog Verification V002

**Status:** code/mocked integration PASS, **production G3/G4 NOT QUALIFIED**. Test date 2026-10-11 (KST).

## Actual executions and evidence

- Original source bundle SHA256: `eb9e0a5beb2e99811f99ac2c0263b030534470a5cc67b7136b2bf7041864bd42`.
- Reproduced original 34/34 pass with Node 22.16.0, `node --test` under a clean source ZIP unpack.
- `node --check` passed for three source modules.
- Unconfigured live monitor preflight produced `BLOCKED / CF_DO_WATCHDOG_CONNECTION_REQUIRED` and exit code `2`, as intended.
- Read-only connected Cloudflare API inventory: account API PASS; the dedicated `atelier-do-watchdog` Worker and dedicated D1 database do not appear among account resources. No deployment or write operation was performed. Other project resources exist and must be preserved.
- DigitalOcean read-only account inspection: 0 Droplets; snapshot ID 246454343 remains `available` and 48.67 GB; monthly usage observation $2.94 (last account-generated 2026-10-11T05:14:49Z). This is NOT account-wide zero billing.
- Added six regression tests, including known fail-closed READY TTL lease reservation limitation. The suite now reports **40/40 PASS**, local mock only.

## Failures reproduced and patch rationale

1. **Confirmed safety defect:** `CLOSED` with no deletion/child residue receipt was accepted by D1 storage. A negative assertion failed against the original V1 implementation. V2 now requires a run-matching, complete zero-residue receipt with valid content digest before the trusted controller can commit `CLOSED`.
2. **Confirmed privilege separation gap:** external journal HTTP bearer clients were not prevented from directly writing delete/closure states. V2 denies `DELETE_OUTCOME_UNKNOWN`, `VERIFY_ABSENCE`, `CLOSED` in the remote CAS API and reserves them for off-VM controller.
3. **Known liveness limitation:** an expired `READY` reservation (no create attempted) persists; no automatic retirement without a positively verified inventory. The V2 test records this current safe-but-sticky behavior; it is not fixed in V2.

## Limitations and remaining gates

- Current code does not establish independent artifact hash verification, provider account UUID pinning across token changes, or provider-signed closure evidence. Hash checking is tamper detection, not an independent attestation. Keep actual production resource creation disarmed.
- The 40 tests simulate D1 via Node `node:sqlite` and inject a fake DigitalOcean provider/controller. They do not prove exact compatibility with the prior guardrails implementation; the full repository was unavailable through runtime Git clone due DNS restrictions.
- A Cloudflare Wrangler production bundle dry run has not been performed because Wrangler is absent locally, and no dependency installation/network access was available.
- Next acceptance must connect scoped secrets through a protected secret broker, deploy a *dedicated* D1 and Worker with disarmed flags, run a genuine Cron heartbeat and no-cost status probe, then explicitly authorize the minimum-cost disposable Droplet only with fallback cleanup and billing controls.
- No provider mutation, Droplet creation/deletion, snapshot deletion, production merge, or GitHub Actions run was performed for these checks.
