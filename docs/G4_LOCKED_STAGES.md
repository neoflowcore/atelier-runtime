# G4 Locked Install and Declared Stages

## Baseline

- Runtime: `bc54295b86d1887c0b7d26d528b410015fa12c8e`
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
