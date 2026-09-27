# Runtime Rev5.1 — P26 v022 Long-Run Contract Promotion

**Status:** LOCAL_TARGETED_VALIDATION_PASS / REMOTE_EXACT_CANDIDATE_PENDING

## Scope

This promotion implements the Runtime-side contracts required by the P26 Interface Freeze precheck without changing the host-project master plan. The authoritative host scope remains `ATELIER POST-REV5.1 RUNTIME-FIRST REINFORCED PLAN v017`; the v022 sources are execution-governor inputs for the previously deferred long-run/control-policy promotion only.

Source inputs:

- `UNIVERSAL_PROJECT_ONE_SHOT_CONTROL_POLICY_v022_GENERIC_FINAL_SEALED_20260927.md`
  - SHA256: `380a18e88ecda85f38ad0ecfe1c063cb055f9cdb5c655883760a951567ddafcc`
- `PROMPT_UNIVERSAL_ONE_SHOT_v022_RESUME_FINAL_v001_20260927.txt`
  - SHA256: `c7c6b62aa14bac1b0a0db76730aaa1d5129d40503142de32d7d134f578709b1d`

## Promoted Runtime contract set

1. `project-identity-plan-binding-v1.mjs`
   - current-project identity authority order
   - cross-project target membership fence
   - `PROJECT_SOURCE_MANIFEST_V1`
   - authoritative plan-set binding and source refresh detection
2. `master-plan-run-contract-v1.mjs`
   - `MASTER_PLAN_EXECUTION_GRANT_V1`
   - universal Continue/Resume/Reattach alias binding
   - master-plan-run lifetime invariants
   - persistent branch and merge deferral semantics
3. `continuation-decision-v1.mjs`
   - global next legal action selection
   - local-blocker bypass
   - continuation decision and response gate
   - premature-stop watchdog
4. `source-mutation-compiler-v1.mjs`
   - fully specified source-mutation request compilation
   - read-required recovery for missing authoritative mutation inputs
   - force-push/blind-retry/no-op trigger denial
   - semantic CI evaluation with non-contractual count drift tolerance
5. `longrun-checkpoint-reattach-v1.mjs`
   - identity+plan-bound durable checkpoint hashing
   - latest matching checkpoint selection
   - safe-local continuation under narrow identity/plan uncertainty
   - no duplicate execution / no reapproval on valid reattach
6. `auth-endgame-transaction-v1.mjs`
   - final credential/auth bind manifests
   - transitive live-auth dependency closure
   - project-end closure preflight
   - one aggregated interactive-auth boundary and second-prompt denial

## P26 blocked-contract coverage

The Runtime implementation now supplies deterministic semantics for all P26 `promotionBlockedContracts` and `endgameImplementationNotYetPromoted` categories. The mapping is recorded in `R51_P26_V022_POLICY_PROMOTION_RECEIPT_v001.json`.

This promotion does **not** claim that live credential-bound provider checks have run. Existing deferred Global Auth Endgame items remain deferred until project-development completion and the single aggregated auth boundary, if unresolved auth remains at that point.

Optional/unbound v017 work remains unchanged:

- P12 external Workspace/MCP intake: not bound without a project-defined source pin.
- P13 Workspace adapter: deferred on P12 project override.
- P14 Android zero-touch agent: optional and not required for the generic Runtime core.

## Targeted validation

Local Node semantic validation on the promotion-only files:

- tests: `49`
- pass: `49`
- fail: `0`
- unexpected functional failures: `0`

Acceptance is semantic; the test count is evidence, not a frozen contract. No GitHub Actions rerun or workflow dispatch was used for this local validation.

## Remote candidate gate

The next action is one coherent mutation on the existing persistent branch `runtime-r51-p8-dependency-lock-cache`. Because draft PR #7 already tracks that branch, the branch update is expected to create the single exact-candidate pull-request CI run. P26 Interface Freeze / Runtime Development Seal remain unclaimed until that exact candidate is read back and its semantic CI result is reconciled.
