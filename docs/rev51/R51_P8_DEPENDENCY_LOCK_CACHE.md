# Runtime Rev5.1 / v016 P8 — Lockfile Discipline + Lock-bound Dependency Cache

Status: credential-independent canonical exact-runtime CI PASS.

P8 generalizes the repository's existing `package-lock.json` + `npm ci` discipline without changing the current workflow. A canonical install with an existing lockfile is frozen. A missing lockfile is not silently created during a build; it becomes `DEPENDENCY_RESOLUTION_JOB_REQUIRED` for a registry-capable admitted provider.

`DEPENDENCY_CACHE_KEY_V1` binds the lockfile SHA-256, exact package-manager identity/version, P6 execution-environment fingerprint, OS/arch/libc and install-policy digest. Direct `node_modules` directory reuse is explicitly denied; cache payloads are limited to verified package/tarball style material bound to the exact key. Cache miss falls back only to P7 network-preflight PASS and a frozen network install. Network/capability blockage consumes zero application rerun budget.

Canonical qualification reused the automatically created pull-request self-test for exact candidate `f034d7e40e1e12d80f6396f94f1e2abe6360ba78`: run `36253019629`, job `108434477549`, repository-pinned Node `22.13.0` / npm `10.9.2`. Required behavior passed, unexpected failures were zero, the observed summary was 746/746 tests PASS, and the release policy gate passed. No manual dispatch or rerun was used.

No dependency graph mutation, registry call, paid compute, provider mutation, credential binding, Interface V1 mutation or Pilote semantic reinterpretation occurs in this slice.
