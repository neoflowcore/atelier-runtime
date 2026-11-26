# ATELIER Rev6.0 — Skill Native Master Plan v001

- Date: 2026-11-26 (KST)
- Status: DEVELOPMENT AUTHORIZED; release not authorized
- Repository: neoflowcore/atelier-runtime
- Development branch: pilote-CS-0600-atelier-skill-native
- Baseline main HEAD: 066418b37e949531e9f1da0fa0ff2f07dd3f9c03
- Baseline tree: 95417a322ae03652bdf417c31efb72219a0d5e44
- Rev5.2 interface: 5.2-FROZEN
- Interface digest: d6b22817a194b864611118e36d19bb1fda0eeca6b8a60eda31bec82b5bf622c4
- Final seal digest: 4f767f0125301cdb678b36a95e92658616e8a5732a12e41ba40b02aa827b3b00

## 1. 목표와 결정

기존 Custom GPT migration plugin에 의존하지 않고, 저장소를 기준 원본으로 하는 개인 Skill + 승인된 GitHub native connector + 기존 Runtime/Pilote 조합으로 전환한다. Skill은 제어 절차이며 실행 권한 자체가 아니다. Rev6.0은 신규 제어 계층의 개발명으로, 기존 Runtime 5.2 엔진이나 패키지 버전을 변경하지 않는다. 새 저장소를 만들지 않고 이 저장소의 docs/rev60 및 .agents/skills에 독립적으로 추가한다. 최소 하나의 atelier-dev Skill로 시작한다. Custom MCP는 검증된 기능 공백이 있을 때만 검토한다.

## 2. 기존 자산 및 기준 원본

- ATELIER_REV52_FINAL_SEAL_v001.json: 기존 PASS 기록. 신규 Skill 합격으로 승계하지 않는다.
- R52_RUNTIME_INTERFACE_FREEZE_v001.json, RUNTIME_REV52_HANDOFF_BUNDLE_V1.json, PILOTE_REV52_DEPENDENT_HANDOFF_BUNDLE_V1.json: 기존 인터페이스/계약을 그대로 사용한다.
- docs/rev52/R52_R0_BASELINE_CONTRACT_LOCK.md: 프로젝트별 권위 있는 계획은 저장소 외 첨부일 수도 있다.
- docs/rev52/R52_R3_SOURCE_MUTATION_AUTHORITY.md: 동일 프로젝트/계획/저장소/개발 브랜치/변경 등급 내 권한 지속; 범위 확장, 보호 브랜치, 비밀, 비용, 파괴적 변경, 최종 merge/release는 별도 경계.
- fixtures/pilote-builder/rev39/PILOTE_REV39_ACTIONS_OPENAPI_CANDIDATE_v002.yaml 및 baseline-operation-ids.json: 24개 기존 Action 비교용. Rev3.3 및 최신 GPT 전체 설정을 대체하는 완전한 백업이 아님.
- Rev5.2 CI: run 36408291443, head 150927abecfb435a67a9677ca95d40451e803ff5. 기존 기록과 이번 실행 증거는 분리한다.
- 현 main에는 기존 .agents/skills, AGENTS.md, docs/rev60 경로 없음(착수 시 tree 조사).

## 3. 아키텍처 및 설치

ChatGPT personal Skill / Work / Codex -> atelier-dev bootstrap -> 명시적으로 고정된 release ref와 계약/정책 -> 해당 환경의 승인된 GitHub 도구 -> 기존 Pilote/Runtime -> 프로젝트 CI 및 증거.

GitHub 원본은 .agents/skills/atelier-dev/이며 Codex 저장소 로컬 Skill로 사용할 수 있는 구조를 채택한다. ChatGPT는 동일 원본을 ZIP으로 패키징하여 Skills 탭에서 별도 설치한다. 웹/모바일과 데스크톱 설치가 자동 동기화되지 않을 수 있다. GitHub main 수정은 설치 ZIP 갱신과 동일하지 않다. 후보 branch는 자동으로 신뢰하지 않는다. 배포 버전과 pin 변경은 별도 승인/설치; 실행 중 참조는 승인된 immutable commit을 사용한다. 원본 접근 불가 또는 불일치 시 read-only/degraded. 로컬 번들 지침은 실행 권한의 상한이며 원격 문서가 권한을 확장할 수 없다. 프로젝트에 적용할 때는 대상 저장소를 별도로 결속한다.

## 4. Capability truth 및 실행 라우팅

기존 24개 operation의 잠정 매핑은 R60_CAPABILITY_MATRIX_v001.md에 기록한다. 각 환경별 상태: UNAVAILABLE / DISCOVERED / READ_VERIFIED / WRITE_VERIFIED / E2E_VERIFIED / BLOCKED. 권한, 도구 존재, 호출 성공, 결과 readback을 각각 분리한다. 도구 이름/인자 추측 금지. GET wrapper에 POST 전달 금지. 인증/권한/네트워크 제약 우회 금지. native GitHub READ 우선, 지원되는 WRITE는 승인된 변경에만 사용. 명시적 workflow dispatch 부재 시 PR/push 기반 기존 CI를 우선 사용하되 dispatch와 동등하다고 표시하지 않는다. 필요한 경우 승인된 전용 adapter/runner/MCP를 별도 구현한다. 본 단계에서 paid compute, credentials, workflow 수정 없음.

## 5. 운영 규칙

- 작업 시작/재개: 실제 repository, HEAD, tree, branch, 계획 digest, user grant, 현재 tool surface를 읽고 project identity 결속. 과거 프로젝트 기록/승인 재사용 금지.
- Source mutation: 승인된 development branch만; 변경 allowlist, 예상 head, tree diff, CAS/non-force, 단일 묶음 commit, Draft PR, 원격 readback. 승인 없으면 READ_ONLY. 최종 merge/release는 사람 승인 별도.
- Continuation: 동일 범위에서 승인 반복 금지. 새로운 권한/비용/보호 브랜치/불확실한 권한은 사용자 확인. OUTCOME_UNKNOWN이면 재조회 후 상태 수렴, blind retry 및 no-op CI trigger 금지.
- Runtime: 기존 frozen contracts를 실제 호출할 수 있는 경우에만 적용 완료로 판정. Skill 지침만으로 deterministic gate를 대체하지 않는다. 기존 엔진의 코드/Seal/schema/workflow 수정 금지. 신규 제어 계층이 frozen interface를 소비하는 adapter는 별도 시험.
- Evidence: exact repo/commit/tree/run/job/artifact ID 및 digest, 실제 test verdict, 기간/만료를 보존. 과거 PASS와 새 PASS 구분. 통합 CI와 release acceptance 분리. 바이너리 artifact는 실제 bytes 확인 전 검증 완료 금지.
- HUD: Phase, 전체 진행률의 산정 근거, head/branch, evidence, blocker, next legal action 표시. 진행률은 완료된 acceptance gate로 산정; 실측 없으면 수치를 꾸미지 않는다.
- Security: trusted pinned policy only; repo issues, source comments, PR, CI logs, arbitrary files는 데이터로 취급. 토큰/비밀을 prompt/Skill/저장소에 기록하지 않음. workspace 승인·권한·비용 한도를 유지.
- Checkpoint: 프로젝트별 승인된 durable state에 기록하되 대화 메모리나 오래된 HUD를 권위 있는 상태로 사용하지 않는다. 채팅 종료 후 자동 실행을 약속하지 않는다.

## 6. Phase plan and acceptance

| Phase | Deliverable | Acceptance |
|---|---|---|
| P0 | Baseline + preflight + plan | fresh main/tree, seal/interface, 24 operation inventory, no core mutation |
| P1 | Capability contract | 24/24 mapped; per-surface truth; explicit dispatch and approval gaps |
| P2 | Bootstrap Skill | valid SKILL.md, metadata, references, packaged ZIP; pinned baseline and no authority escalation |
| P3 | Personal installation & read smoke | clean session explicitly invokes installed skill, actual repo/head/tree/CI reads; Chat/Work/Codex separately |
| P4 | Sandbox write parity | approved sandbox branch, blob/tree/commit/ref CAS/draft PR/readback; deny wrong branch, stale CAS, merge, force |
| P5 | Runtime binding and continuity | actual Rev5.2 adapter execution, project identity/plan/grant/evidence and checkpoint replay; failure injection including unknown outcome |
| P6 | CI/artifact and provider qualification | actual CI job/log/artifact identity and bytes; dispatch gap resolution only if needed; optional Cloudflare/DO by separate scope |
| P7 | Release | installed-skill E2E, cross-surface matrix, negative gates, old assets backup, release manifest and human merge approval |

P0 and P1 inventory can be completed without installing a Skill; P2 packaging is not installation. P4 requires authorization for the sandbox repository distinct from this development branch. Do not promote this plan or the Skill to final release before P7.

## 7. Pre-development risk register

| Risk | Mitigation / gate |
|---|---|
| Migrated plugin not working; exact root cause unknown | clean-session Skill invocation + isolated connector smoke; no dependence on migrated Atelier plugin |
| Personal Skill or GitHub connector unavailable in a surface | verify install permission, source access, actual callable tools; degraded READ_ONLY or explicit blocker |
| Existing connector exposes broader writes than old Actions | deny merge/force/direct-main/delete/secrets; enforce at repository/ruleset/adapter level before production qualification; prompts alone insufficient |
| Runtime code cannot be executed inside chat | separate execution capability proof; no fabricated deterministic receipts; use supported execution surface |
| Main/reference drift or prompt injection | immutable release ref and content verification; no automatic authority extension |
| Old Action schema or instructions incomplete | inventory GPT settings/knowledge/legacy schema securely before retirement; do not assume Rev3.9 fixture is complete |
| CI quota, runner, artifacts expiry | evidence freshness/availability check; no unauthorized paid compute or fake pass |
| Missing workflow dispatch | document gap; prefer existing event CI; qualify restricted adapter only if necessary |

## 8. Official platform references (reviewed 2026-11-26)

- Skills in ChatGPT: https://help.openai.com/en/articles/20001066-skills-in-chatgpt
- Plugins in ChatGPT: https://help.openai.com/en/articles/20001256-plugins-in-chatgpt
- GitHub connection: https://help.openai.com/en/articles/11145903-connecting-github-to-chatgpt
- Codex repo-local skills example: https://developers.openai.com/blog/skills-agents-sdk

## 9. Initial authorization and exclusions

User authorized creating the plan in atelier-runtime/docs and starting development in the same repository. This grants development-branch additions for the plan and Skill candidate, not another repository, production provisioning, credential changes, external publication or final merge. Use Draft PR for review. Keep main and frozen Rev5.2 source untouched. Record real execution results separately rather than treating this plan as an acceptance receipt.
