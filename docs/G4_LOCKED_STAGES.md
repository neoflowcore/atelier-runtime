# G4 Locked Install and Declared Stages

## Baseline

- G3 Runtime: `bc54295b86d1887c0b7d26d528b410015fa12c8e`
- G3 positive run: `34002331893`
- G3 negative run: `34002408556`

## Scope

After G3 preflight passes, run `npm ci` and declared non-server stages in the fixed order `format, lint, typecheck, build, test, integration`.

## Acceptance gate

- npm install is exactly `npm ci`
- npm scripts are invoked as argument arrays with `shell: false`
- undeclared stages are `SKIPPED`
- first failed stage prevents later declared stages from running
- tracked source state is captured before install and after execution
- tracked source mutation fails the run
- source-write authority remains none
- both checkouts keep `persist-credentials: false`

## Evidence

- implementation Runtime: `a9fccdef0e0785a456a038b7c7140efd01102ae1`
- Runtime self-test: run `34002644242`, job `101404154040`
- positive Target: `74e160061b9b7b95e91b9ef376059c3777c5dfee`
- positive run: `34002691442`, job `101404282935`
- fail-fast negative: run `34002792768`, job `101404545045`, draft PR #4
- source-integrity negative: run `34002903884`, job `101404850522`, draft PR #5
