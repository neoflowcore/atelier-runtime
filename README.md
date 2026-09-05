# Atelier Runtime

Atelier Runtime V1 is a thin, deterministic execution standard for verifying an exact GitHub commit on GitHub-hosted runners.

V1 exposes one profile, `NODE_WEB_VERIFY` (`profile_version: 1`). It accepts declarative npm script names and records machine-readable evidence. It does not provide a new compute platform, arbitrary shell access, persistent hosting, source editing, or GitHub source-write authority.

Current phase: `G0_CONTRACT_LOCK=PASS`

See:

- [`docs/V1_SCOPE_LOCK.md`](docs/V1_SCOPE_LOCK.md)
- [`docs/SECURITY_BOUNDARY.md`](docs/SECURITY_BOUNDARY.md)
- [`docs/TARGET_REPO_INTEGRATION.md`](docs/TARGET_REPO_INTEGRATION.md)

