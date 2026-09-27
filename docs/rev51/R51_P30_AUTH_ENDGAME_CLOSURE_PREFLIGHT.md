# P30 Global Auth Endgame — Closure Preflight

P29 credential-independent cross-stack development is canonically accepted at `948917924f08afbf9642e94b40f17778f354af1f` with run `36289657309`: 1016/1016 PASS and security lint PASS. Therefore `PROJECT_DEVELOPMENT_COMPLETE=TRUE`.

The full live-auth dependency closure is complete and the final auth manifest is sealed. Existing connected GitHub and DigitalOcean authority resolves every required auth capability; `UNRESOLVED_REQUIRED_AUTH_COUNT=0`. No token, API key, OAuth bootstrap, or interactive auth prompt is required.

The remaining Final Live Seal path includes disposable paid remote-worker economics/cleanup and credential-bound live failure qualification. DigitalOcean is connected and currently has no observed active droplets or SSH keys. The installed DigitalOcean Codex workspace workflow restricts provisioning to its supported workspace sizes. Its default is `nyc3` + `s-2vcpu-4gb` (2 vCPU / 4 GiB / 80 GiB), currently USD 0.03571/hour (USD 24/month), using Codex Universal image ID `234061005`. The workflow requires user confirmation of the default region/size or an allowed customization before create.

Creation is denied at this preflight because two required admission conditions are not yet true:

1. **Cost authority / workspace selection** — no new paid-resource cost cap/TTL has been approved, and the DigitalOcean workspace workflow requires confirmation of region/size before create. Proposed bounded envelope: max USD 0.10, TTL 2 hours; at the current base compute rate, two hours is about USD 0.07142 before any separately billed extras.
2. **Trusted automated execution path** — the installed DigitalOcean Codex workspace workflow requires Codex Desktop plus local OpenSSH. The current execution surface is Web; OpenSSH is absent in the ephemeral executor, the package-install probe timed out and was not retried, and the raw DigitalOcean connector exposes no remote-exec operation.

No droplet, SSH key, paid lease, or provider mutation was created. Manual SSH/Termux/token-copy fallback remains denied.

Once both boundaries are resolved, the intended continuous endgame transaction is:

```text
ephemeral SSH key
-> disposable worker create
-> exact source + live qualification
-> production/source/binding attestation
-> credential-bound failure cases
-> canonical evidence externalize/readback
-> droplet delete
-> absence verify
-> ephemeral key delete
-> residue scan = 0
-> final acceptance
-> FINAL_LIVE_SEAL
```


The earlier v1 preflight's `s-1vcpu-1gb` candidate was a generic Droplet price observation, not a valid Codex workspace selection. v2 supersedes that candidate before any provider mutation or billing occurred.


## Fresh provider-readiness reconciliation

A fresh read-only DigitalOcean reconciliation found no active Droplets and one pre-existing SSH public key. This corrects the earlier zero-key observation. The existing key does not make the current Web runtime a trusted execution path: its private key is not available here, local `ssh` and `ssh-keygen` are absent, and the installed DigitalOcean Codex workspace flow requires ephemeral local key generation plus Codex Desktop/OpenSSH.

The Codex Universal image `234061005` is currently available in `nyc3` with an 80 GiB minimum disk. The default supported workspace size `s-2vcpu-4gb` is also currently available in `nyc3` at USD 0.03571/hour. This is read-only provider readiness evidence only; no provider mutation or paid lease was created.
