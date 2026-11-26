# Bootstrap and compatibility lock

Candidate version: 0.1.0 (Rev6.0 control layer). Repository: `neoflowcore/atelier-runtime`.

- Frozen engine baseline commit: `066418b37e949531e9f1da0fa0ff2f07dd3f9c03`.
- Frozen baseline tree: `95417a322ae03652bdf417c31efb72219a0d5e44`.
- Read `R52_RUNTIME_INTERFACE_FREEZE_v001.json` and `ATELIER_REV52_FINAL_SEAL_v001.json` at the baseline commit. Expected Git blob identities: `ed29abf6074287f9eb5e34424aff06518e856c5d` and `2f249b6d6fd5e4dafce936b2a796e893cbf3675b` respectively. Expected interface digest: `d6b22817a194b864611118e36d19bb1fda0eeca6b8a60eda31bec82b5bf622c4`.
- Read `docs/rev52/R52_R3_SOURCE_MUTATION_AUTHORITY.md` at the baseline commit for authority boundaries; read the Runtime and Pilote Rev5.2 handoff bundles for the interface contracts when necessary.
- Candidate plan pin: commit `4223dcf4e7d0bbf4fa0bb4f64709268b59277cf5`. Read `docs/rev60/R60_SKILL_NATIVE_MASTER_PLAN_v001.md` (blob `c784531f0292501b43c00f2a06e826a3495dc841`) and `docs/rev60/R60_CAPABILITY_MATRIX_v001.md` (blob `b3dd27177b9e3e94ce50657ed9ae0044a294e6d4`) at that exact ref.
- Use connector file reads with an explicit commit ref; compare reported blob identities. If identity metadata is unavailable, use a supported local content-integrity check or mark the pin unverified. Do not silently substitute main or latest. Upgrading a pin requires review and a new package.
- The migration branch `pilote-CS-0600-atelier-skill-native` is a candidate, not a release channel. The Atelier repository identifies the control plane, not automatic authorization to mutate any target project.
- The observed GitHub surface offers repository/file/tree/branch/run reads, candidate Git data writes and draft PRs, but no confirmed workflow dispatch operation. Tool discovery and installed-skill qualification are required each surface. Prefer existing event CI when suitable; never simulate unsupported dispatch or bypass restrictions.
- Historical Rev5.2 seal PASS and CI run 36408291443 are baseline evidence only. The current candidate must earn new evidence. Verify the project-specific plan and grant separately before mutations.
