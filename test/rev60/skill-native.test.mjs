import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { decide, loadFrozenContracts } from "../../tools/atelier-skill/control-bridge.mjs";

const sha = c => c.repeat(64);
const git = c => c.repeat(40);
async function fixture() {
  const c = await loadFrozenContracts();
  const identity = { projectIdentityDigest: sha("a"), authoritativePlanSetDigest: sha("b"), sourceManifestDigest: sha("c"), repository: "neoflowcore/sandbox", branch: "pilote-CS-test", head: git("d"), tree: git("e") };
  const state = c.state.compileProjectRunStateV2({ ...identity, runId: "test-run", runtimeInterfaceVersion: "5.2-FROZEN", currentDevelopmentBranch: identity.branch, currentSourceIdentity: { head: identity.head, tree: identity.tree } });
  const envelope = c.authority.compileSourceMutationAuthorityEnvelopeV1({ ...identity, targetRepository: identity.repository, repositorySet: [identity.repository], developmentBranchOrBranchClass: identity.branch, authoritySource: "test-fixture" });
  return { selection: { status: "BOUND", publisher_verified: true, write_authority: false, enabled_features: ["runtime.control", "source.handoff"], release: { id: "fixture", commit: git("f"), manifest_sha256: sha("f") } }, identity, observation: { ...identity }, state, envelope, actions: [{ id: "implement", kind: "CODE", phaseId: "P1" }, { id: "approve", kind: "AUTH" }], proposed: { operation: "source.commit", targetRepository: identity.repository, developmentBranchOrBranchClass: identity.branch, forcePush: false, destructive: false, expectedHead: identity.head, baseTree: identity.tree } };
}

test("Python release resolver, signature and manifest suites", () => {
  const p = spawnSync("python3", ["-m", "unittest", "discover", "-s", "test/rev60", "-p", "test_*.py", "-v"], { encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }, timeout: 30000 });
  assert.equal(p.status, 0, `${p.error ?? ""}\n${p.stdout}\n${p.stderr}`);
  assert.ok(Number(p.stderr.match(/Ran (\d+) tests/)?.[1]) >= 66, p.stderr);
  for (const name of ["test_same_install_new_release_and_resume_pin", "test_checkpoint_cas", "test_collect_immutable_snapshot", "test_readback_exact_and_unknown", "test_full_handoff_no_authority", "test_git_tree_identity", "test_runtime_binding_drift", "test_exact_evidence_bytes", "test_initial_unsigned_draft", "test_field_never_stable", "test_surface_requires_real_observations", "test_local_git_full_cas_and_reconciliation", "test_manifest_and_archive_bytes", "test_future_feature_same_bootstrap"]) assert.match(p.stderr, new RegExp(name));
});

test("frozen handoff and actual contract execution, not a write grant", async () => {
  const r = await decide(await fixture());
  assert.equal(r.status, "ADVISORY_DECISION", r.reason);
  assert.equal(r.next.ACTIVE_NEXT.id, "implement");
  assert.equal(r.response.continueExecution, true);
  assert.equal(r.writeAuthority, false);
});

test("reject remote head drift", async () => {
  const f = await fixture(); f.observation.head = git("0");
  assert.equal((await decide(f)).reason, "REMOTE_DRIFT");
});

test("reject tampered envelope", async () => {
  const f = await fixture(); f.envelope = { ...f.envelope, authoritySource: "changed" };
  assert.equal((await decide(f)).reason, "AUTHORITY_ENVELOPE_MISMATCH");
});

test("reject mutated state", async () => {
  const f = await fixture(); f.state = { ...f.state, runId: "other" };
  assert.equal((await decide(f)).reason, "PROJECT_STATE_MISMATCH");
});

test("reject merge and force", async () => {
  const f = await fixture(); f.proposed.operation = "merge";
  assert.equal((await decide(f)).reason, "MUTATION_SCOPE_DENIED");
  f.proposed.operation = "source.commit"; f.proposed.forcePush = true;
  assert.equal((await decide(f)).reason, "MUTATION_SCOPE_DENIED");
});

test("reject checkpoint drift and missing runtime feature", async () => {
  const f = await fixture(); f.checkpoint = { releaseId: "other" };
  assert.equal((await decide(f)).reason, "CHECKPOINT_RELEASE_DRIFT");
  delete f.checkpoint; f.selection.enabled_features = [];
  assert.equal((await decide(f)).reason, "RELEASE_OR_CAPABILITY_UNBOUND");
});


test("actual frozen control decision binds native tool handoff", async () => {
  const c = await loadFrozenContracts();
  const f = await fixture();
  const emptyTree = createHash("sha1").update("tree 0\0").digest("hex");
  f.identity.tree = emptyTree;
  f.observation.tree = emptyTree;
  f.proposed.baseTree = emptyTree;
  f.state = c.state.compileProjectRunStateV2({ ...f.identity, runId: "test-run", runtimeInterfaceVersion: "5.2-FROZEN", currentDevelopmentBranch: f.identity.branch, currentSourceIdentity: { head: f.identity.head, tree: emptyTree } });
  const decision = await decide(f);
  assert.equal(decision.status, "ADVISORY_DECISION", decision.reason);
  const ctx = { project_sha256: f.identity.projectIdentityDigest, plan_sha256: f.identity.authoritativePlanSetDigest, repository: f.identity.repository, branch: f.identity.branch, head: f.identity.head, tree: emptyTree };
  const original = { context: ctx, grant: { ...ctx, scope: "NON_DESTRUCTIVE_SOURCE_DEVELOPMENT", expires_at: Math.floor(Date.now()/1000)+600, allowed_prefixes: ["src"] }, observation: ctx, operation: "source.commit", force: false, destructive: false, changes: [{path:"src/a.txt",mode:"100644",content:"test"}] };
  const surface = spawnSync("python3", ["-c", "import sys,json;sys.path.insert(0,'test/rev60');from surface_fixture import surface_fixture;print(json.dumps(surface_fixture(sys.argv[1],sys.argv[2],int(sys.argv[3]))))", ctx.repository, ctx.branch, String(Math.floor(Date.now()/1000))], {encoding:"utf8",env:{...process.env,PYTHONDONTWRITEBYTECODE:"1"}});
  assert.equal(surface.status, 0, surface.stderr);
  const input = { stage: "prepare", original, surface_evidence: JSON.parse(surface.stdout), fresh_branch: ctx, base_tree: { sha: emptyTree, truncated: false, tree: [] }, control_decision: decision, bound_release: f.selection, action_id: "implement" };
  const p = spawnSync("python3", [".agents/skills/atelier-dev/scripts/execution_protocol.py"], {input: JSON.stringify(input), encoding: "utf8", env:{...process.env,PYTHONDONTWRITEBYTECODE:"1"}});
  assert.equal(p.status, 0, p.stderr);
  const r = JSON.parse(p.stdout);
  assert.equal(r.status, "ADVISORY_HANDOFF", r.reason);
  assert.equal(r.request.tool, "create_tree");
  assert.equal(r.request.arguments.base_tree_sha, emptyTree);
  assert.equal(r.write_authority, false);
});
