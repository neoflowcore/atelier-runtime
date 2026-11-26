# R60 Execution and Evidence Protocol v001

Development candidate. No production key enrollment, stable promotion, merge or installation is granted by this document.

## Contract composition

A bound signed release and independently approved project grant enter the pinned Rev5.2 control bridge. The actual bridge decision binds the current project identity, plan, repository, branch, source HEAD/tree, release and eligible next action. The portable execution protocol consumes that decision, compiles an advisory native tool request and binds its proposal/handoff hashes across subsequent observations. It does not grant authority, execute a connector or implement a remote write server. `CREATE_TREE -> CREATE_COMMIT -> UPDATE_REF -> REMOTE_EFFECT_VERIFIED` requires actual native tool calls, complete Git Trees, exact single parent, non-force CAS and branch readback. Each invocation revalidates the grant. An expired grant blocks further handoff and requires independent read-only reconciliation. No direct protected branch or workflow/registry change through this adapter. The complete tree response is validated by recomputing every Git tree object; unknown/unsupported shapes fail closed. Draft PR creation and final merge remain separate governed operations.

## CI and artifact

Bind repository, immutable HEAD, workflow ID, run ID and exact run attempt. Require complete job list and named successful steps. Do not confuse skipped steps or a different run with acceptance. Required archives are identified by run/attempt-bound name (run-ID-attempt-N-NAME), matching artifact metadata and actual archive SHA-256; safe ZIP inspection is bounded and never extracts files. Legacy artifacts without attempt-bound names require separate qualification; no artifact means NOT_REQUIRED only where the approved plan explicitly needs none. The evidence receipt is a metadata and bytes verification, not proof of semantic Runtime acceptance. Read actual logs and contract assertions for semantic gates. Native connector artifact references are not bytes until read back through a supported transport.

## Release candidate preparation

`tools/atelier-skill/prepare_registry.py` emits an UNSIGNED_REGISTRY_DRAFT using candidate commit/tree/manifest bytes, verified CI receipt, explicit required jobs/artifacts, generation, expiry and previous verified registry state. A first registry needs explicit review. Preserve earlier stable entries and revocation history; do not reuse IDs/commits. Human review and offline signing of exact bytes remain mandatory. A draft is never a stable publication. Existing signed-registry verification and high-water mark enforce selection on the next invocation. Do not publish a draft or promote a release solely because a script reports valid structure. Server-side write enforcement and real installed-skill acceptance remain separate.

## Development versus field acceptance

Pre-install verify the resolver, signature, checkpoint, native read adapter, mutation proposal, Runtime-to-native handoff, CI/archive evidence, candidate publication draft, manifest reproducibility and package structure. Qualify actual connector call schemas, supported script execution and durable state per product surface; do not count local fixtures as installed-skill evidence. Establish production key custody and repository protection before stable promotion. No unauthorized credential changes, paid resources or final merge. Rev6.1 is reserved for defects from field verification after Rev6.0 development is complete.
