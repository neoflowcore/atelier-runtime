# G5 Web + HTTP Runtime Acceptance

Status: COMPLETE
Gate: `G5_WEB_HTTP_RUNTIME=PASS`

## Scope

G5 is limited to the declared `dev` package script, a bounded temporary localhost server, readiness polling, optional declarative route/status checks from `.atelier/routes.json`, and mandatory server cleanup. It does not introduce a persistent preview server or a general HTTP DSL.

## Runtime implementation baseline

Implementation SHA: `25d4126539fc3c8161f9243711b43783a5e60514`
Runtime self-test run: `34003421046` — PASS.

## Acceptance evidence

### Positive

Golden Target SHA: `dd2d09b5715951cc1042b8eac96d780bbf8989bf`
Run: `34003519518`

Observed raw markers:

- `G3_CONTRACT_PREFLIGHT=PASS`
- `G4_LOCKED_STAGES=PASS`
- `G5_DEV_SERVER=PASS`
- `G5_HTTP=PASS`
- `G5_CLEANUP=PASS`
- `G5_WEB_HTTP_RUNTIME=PASS`

### Negative — HTTP status mismatch

Golden Target SHA: `01c614e3452faac310429a3176022446726dd726`
Run: `34003455511`

Observed raw markers:

- `G4_LOCKED_STAGES=PASS`
- `G5_CLEANUP=PASS`
- `G5_FAILURE_REASON=STATUS_MISMATCH:0:EXPECTED_201:ACTUAL_200`
- `G5_FAILURE_STAGE=HTTP`
- process exit code `1`

### Negative — dev server startup failure

Golden Target SHA: `2b185915991d29311c0e50461befb9cb6059d16d`
Run: `34003488126`

Observed raw markers:

- `G4_LOCKED_STAGES=PASS`
- `G5_CLEANUP=PASS`
- `G5_FAILURE_REASON=SERVER_EXITED:1`
- `G5_FAILURE_STAGE=DEV_SERVER`
- process exit code `1`

## Acceptance decision

PASS. G5 demonstrates bounded local server startup/readiness, declarative HTTP status validation, fail-closed APP_FAILURE classification for HTTP and DEV_SERVER faults, and cleanup confirmation in both positive and negative paths.
