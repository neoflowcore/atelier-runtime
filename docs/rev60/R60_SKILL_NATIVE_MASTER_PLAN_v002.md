# ATELIER Rev6.0 Universal Skill Native — Master Plan v002

Date: 2026-11-26 KST. Status: authorized development candidate, NOT released.
Supersedes R60_SKILL_NATIVE_MASTER_PLAN_v001.md on the existing development branch; retain v001 as history. Universal version binding is part of the initial Rev6.0, not a later Rev6.1 feature. No new repository or revision fork.

## 1. Goal and invariants

Install the small Atelier bootstrap once; discover compatible, approved stable releases and their declared features from GitHub on each new invocation. The installed bootstrap is the local policy ceiling. The repository is the evolving source of truth, not an independent source of user authority. Preserve all Rev5.2 frozen code, seals, schemas and workflows. Baseline main: 066418b37e949531e9f1da0fa0ff2f07dd3f9c03; tree: 95417a322ae03652bdf417c31efb72219a0d5e44. Use existing branch pilote-CS-0600-atelier-skill-native and Draft PR #12; no main write or merge. All v001 project identity, capability truth, CAS, approval, billing, evidence, checkpoint, anti-loop, and runtime restrictions remain in force except the obsolete permanent release pin/install-per-release model. The 24-operation inventory remains a baseline, not full qualification.

## 2. Universal architecture

Installed atelier-dev protocol 1 -> fixed repository and registry path on main -> independently trusted registry snapshot -> newest compatible stable entry -> immutable commit/tree and manifest -> SHA-256 verified module/feature files -> live capability discovery and verified adapter -> project-bound Pilote/Runtime, CI and evidence. New run may select a new release without reinstalling. A resumed run stays on its checkpoint release. Only bootstrap protocol, authority policy or platform permission changes may require installation or user approval. No background polling or automatic tool provisioning.

- Registry: .atelier/releases/registry.v1.json; stable entries ordered by unique sequence, revoked IDs separate. Initially empty; candidate is not a stable release.
- Manifest: .atelier/releases/manifest.v1.json at the selected immutable release commit; records protocol range, required capabilities, module paths and hashes, feature dependencies. Promotion occurs in a later commit, avoiding self-reference.
- Trust: require independently established protected review/promotion governance or signature trust root. Registry contents, historical PASS, mere connector permission, or a candidate PR are not proof. Initial trust establishment is pending; no write execution via an untrusted registry. Git commit/tree and content hash validation do not by themselves establish publisher authorization.
- Resolver: installed deterministic offline Python implementation, consuming actual connector observations; no token or network access. Use only BOUND results for release selection, not as mutation grants. If scripts or exact bytes cannot be obtained, use advisory READ_ONLY. No downloaded arbitrary code execution.
- Compatibility: prefer latest non-revoked compatible stable release; fallback only for protocol/capability mismatch. Integrity/trust/unavailable evidence fails closed. Resume requires exact release ID/commit/manifest; explicit migration for incompatibility or revocation. Prevent stale registry replay and unauthorized stable promotion at the publication trust gate; production enforcement remains pending.
- Features: load only declared verified paths needed by the task; disable features with missing verified capabilities. New tool, provider, credential or cost scope never follows from a remote manifest. Runtime execution remains a separate qualification.

## 3. Reset development acceptance gates

| Phase | Deliverable | Required evidence |
|---|---|---|
| P0 | Universal baseline and plan | main identity; v001 preserved; Rev5.2 untouched; threat model |
| P1 | Capability and publication trust | 24/24 mapped; actual per-surface capabilities; approved publisher trust and negative tests |
| P2 | Universal bootstrap and resolver | registry/manifest protocol; latest/compatibility/fallback/revoke/pin/feature/integrity tests; validated ZIP |
| P3 | Installed Skill live read | clean session; fetch registry at actual main HEAD; verify trust and module bytes; separate Chat/Work/Codex results |
| P4 | Write parity and policy enforcement | authorized sandbox; CAS failure, wrong branch, force/merge denial, real server/ruleset constraints |
| P5 | Runtime and continuation | actual frozen interface execution; project state, grant, evidence, checkpoint, unknown effect recovery |
| P6 | Dynamic release qualification | two distinct qualified release fixtures or staging versions selected by same installed ZIP; no mid-run drift; revoked release recovery; CI/artifact bytes; provider gaps |
| P7 | Stable promotion | release manifest and independent trust acceptance; full E2E; human merge/release authority; stable registry populated only after approval |

P0-P2 candidate implementation does not imply installed Skill execution, trust establishment or release acceptance. Do not count a unit test as a live operation. Maintain the legacy 24-action mapping in R60_CAPABILITY_MATRIX_v001.md. No new paid compute or credential changes in the initial candidate; no additional repo mutation unless separately authorized.

## 4. Initial implementation and test procedure

Source: .agents/skills/atelier-dev/ (SKILL.md, agents/openai.yaml, references/bootstrap.md, scripts/resolve_release.py). Tests: test/rev60/test_release_resolver.py. Registry: .atelier/releases/registry.v1.json. Run `PYTHONDONTWRITEBYTECODE=1 python test/rev60/test_release_resolver.py -v`. Package using the Skill validator/packager; compare all bundled file identities with the committed source. CI integration, installed-skill live registry retrieval, publication trust enforcement, runtime binding, and real two-release upgrade remain acceptance gates. Do not publish the empty registry as a working stable channel.
