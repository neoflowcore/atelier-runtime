# G7 Runtime Receipt Guards

Status: COMPLETE
Gate: `G7_RUNTIME_RECEIPT_GUARDS=PASS`

## Canonical v004 scope

G7 adds deterministic receipt, whole-run tracked-source integrity evidence, environment evidence, GitHub Actions overlap guard binding, and canonical receipt artifact publication without turning Runtime V1 into a control plane.

Out of scope remains a durable idempotency database/service, arbitrary shell authority, target source write authority, and mandatory execution/environment fingerprint hashes.

## Implementation evidence

- Implementation Runtime SHA: `78fcda73ec3c0f6d8e9ec143f66ad0f608e21cde`
- Runtime self-test: `34004662969` PASS
- Receipt compatibility preserved for pre-G7 `createReceipt`, `initialStages`, and `STAGE_NAMES` exports.
- Deterministic self-tests cover PASS, BLOCKED, APP_FAILURE, INFRA_FAILURE, TIMEOUT, CANCELLED, run_attempt, target/Runtime SHA binding, tracked-source mutation, environment null-without-guessing, overlap guard, and receipt-finalize fail-closed semantics.

## Positive Golden Target evidence

- Golden Target SHA: `1ffdfb1cedf01b316b5147c6dc03e722a1d8caf7`
- Run: `34004683481` SUCCESS
- Receipt artifact ID: `9980567468`
- Receipt artifact digest: `sha256:55e2a3bd16c7fda18ef36be5d87397a5a9085f4949860baa119ada61a2accaba`
- Raw markers:
  - `G7_RECEIPT_INIT=PASS`
  - `G7_RECEIPT_FINALIZED=PASS`
  - `G7_RUN_ATTEMPT_BINDING=PASS`
  - `G7_SHA_BINDING=PASS`
  - `G7_ENVIRONMENT_EVIDENCE=PASS`
  - `G7_SOURCE_INTEGRITY=PASS`
  - `G7_OVERLAP_GUARD=PASS`
  - `G7_RESULT=PASS`
  - `G7_RECEIPT_ARTIFACT=PASS`
  - `G7_RUNTIME_RECEIPT_GUARDS=PASS`

## APP_FAILURE negative evidence

- Golden Target SHA: `58810661887791e904daf286d9837dfbfd32e880`
- Run: `34004737720` FAILURE as expected
- Browser failure evidence artifact ID: `9980584002`
- Browser artifact digest: `sha256:780196f4ff25fe27fb527bad47c238fa98e1cd52350ccefc754526eecf4d1812`
- Runtime receipt artifact ID: `9980584183`
- Runtime receipt artifact digest: `sha256:3eb984e6ea64cad4bc1dee927d1f5a2a3cc9f27534f49c3be03002b19fb196ab`
- Raw classification:
  - `G6_FAILURE_CLASS=APP_FAILURE`
  - `G6_FAILURE_STAGE=BROWSER`
  - `G7_RECEIPT_FINALIZED=PASS`
  - `G7_RESULT=APP_FAILURE`
  - `G7_FAILURE_STAGE=BROWSER`
  - `G7_FAILURE_REASON=BROWSER_SCRIPT_EXIT_1`
  - `G7_CANONICAL_PASS_DENIED=RESULT_APP_FAILURE`

The negative run proves that failure diagnostics and the canonical receipt are both preserved while a non-PASS receipt cannot be exposed as canonical G7 PASS.

## Integrity and overlap decision

- Existing GitHub Actions concurrency remains fixed at repository plus caller idempotency key with `cancel-in-progress: false`.
- G7 records and validates this guard; no durable idempotency service is introduced.
- G4 tracked-source integrity remains unchanged and G7 adds before/after whole-run tracked-source state, so later Web/Browser mutations cannot become PASS.
- Target remote source write authority remains `NONE` in the canonical receipt.

## Acceptance decision

`G7_RUNTIME_RECEIPT_GUARDS=PASS`

G7 is accepted subject to final sealed-SHA Golden Target pin and rerun.
