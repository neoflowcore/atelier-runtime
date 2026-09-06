# G3 Contract Preflight

## Baseline

- Runtime: `d4e757f706ffe80ce7fe248943052d0b3a27024d`
- Positive run: `34002034425`
- Negative run: `34002003708`

## Scope

G3 validates the checked-out target's explicit `.atelier/runtime.json` against its `package.json` before any target npm script is executed.

## Acceptance gate

- exact Runtime and Target identities remain verified
- fixed Node `22.13.0`
- schema/profile/package manager/script surface validated fail-closed
- undeclared fields, shell-like script names, and missing package scripts are blocked
- valid Golden Target emits `G3_CONTRACT_PREFLIGHT=PASS`
- target npm script execution before PASS: zero
- source-write authority: none
- both checkouts keep `persist-credentials: false`
