# Runtime Rev5.1 / v016 P8 — Lockfile Discipline + Lock-bound Dependency Cache

Status: credential-independent development candidate.

P8 generalizes the repository's existing `package-lock.json` + `npm ci` discipline without changing the current workflow. A canonical install with an existing lockfile is frozen. A missing lockfile is not silently created during a build; it becomes `DEPENDENCY_RESOLUTION_JOB_REQUIRED` for a registry-capable admitted provider.

`DEPENDENCY_CACHE_KEY_V1` binds the lockfile SHA-256, exact package-manager identity/version, P6 execution-environment fingerprint, OS/arch/libc and install-policy digest. Direct `node_modules` directory reuse is explicitly denied; cache payloads are limited to verified package/tarball style material bound to the exact key. Cache miss falls back only to P7 network-preflight PASS and a frozen network install. Network/capability blockage consumes zero application rerun budget.

No dependency graph mutation, registry call, paid compute, provider mutation, credential binding, Interface V1 mutation or Pilote semantic reinterpretation occurs in this slice.
