# P30 Global Auth Endgame — GitHub-hosted Final Live Acceptance

The authoritative v016 plan is provider-neutral. It explicitly supports `GitHub execution` in Generic Zero-Touch Transport and names `repository-hosted CI executor` as an Alternative Provider candidate. The same plan marks SSH as `BREAK_GLASS_ONLY`. Therefore DigitalOcean + SSH is not a required final-live dependency for this Project Run.

## Selected path

P30 selects the already-authorized repository CI plane:

```text
provider       = github-actions
executor class = repository-hosted-ci-executor
transport      = github-execution
new provider resource = 0
manual SSH = 0
manual token copy/paste = 0
```

The implementation extends the existing `runtime-selftest` job rather than adding another job. The job retains its existing `ubuntu-24.04` runner and five-minute timeout.

Current GitHub list pricing observed for a standard Linux 2-core hosted runner is USD 0.006/minute, rounded to whole minutes. The five-minute timeout therefore bounds list-price exposure for the job at USD 0.03; included minutes may reduce actual billed cost. No separate VM/Droplet lease is created.

## Live acceptance transaction

On the exact PR candidate, after the existing security/unit/release selftest passes:

1. validate `R51_P30_GITHUB_LIVE_TRIGGER_V1` against the authoritative v016 project/source identity and the exact parent candidate;
2. use the job-scoped read-only GitHub token to read the exact commit, PR head, workflow run, and job identity;
3. bind `SOURCE_PROVENANCE` to local HEAD + GitHub Commit API + PR head;
4. bind `BINDING_IDENTITY` to repository + workflow run ID + job ID;
5. compile Runtime `PRODUCTION_ATTESTATION_V1` over those GitHub provider bindings;
6. compile `PROVIDER_QUALIFICATION_OBSERVATION_V1` from measured job startup/execution time, available disk, zero human/credential touches, zero orphan/unknown-outcome counts, and conservative list-price exposure;
7. reuse the frozen P33 credential-independent failure matrix by exact content identity instead of inventing a second live fault campaign;
8. treat provider cleanup as `SUCCESS_NOOP` because no user-owned provider resource is created;
9. upload the observation as canonical evidence, then query the current Actions run and verify that exact artifact by name/ID;
10. compile `PILOTE_FINAL_LIVE_ACCEPTANCE_SEMANTICS_V1`.

The final semantic result must be:

```text
LIVE_ACCEPTED = true
DECISION = MERGE_READY_AWAITING_RELEASE_AUTHORITY
PROJECT_COMPLETE = false
FINAL_RESPONSE_ALLOWED = false
```

Final merge/release authority remains a separate human-only boundary and is not inferred from `ㅇㅇ`, CI success, artifact success, or live acceptance.

## Auth closure

`FINAL_AUTH_BIND_MANIFEST_V1` is resealed for the selected GitHub path. Required auth is limited to GitHub source/run/job read and canonical evidence operations, all resolved by the existing connection or job-scoped platform token. DigitalOcean remains an optional alternative provider, not a required dependency.
