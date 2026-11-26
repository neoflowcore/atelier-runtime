import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { decide, loadFrozenContracts } from "../../tools/atelier-skill/control-bridge.mjs";

const sha = c => c.repeat(64);
const git = c => c.repeat(40);
async function fixture() {
  const c = await loadFrozenContracts();
  const identity = { projectIdentityDigest: sha("a"), authoritativePlanSetDigest: sha("b"), sourceManifestDigest: sha("c"), repository: "neoflowcore/sandbox", branch: "pilote-CS-test", head: git("d"), tree: git("e") };
  const state = c.state.compileProjectRunStateV2({ ...identity, runId: "test-run", runtimeInterfaceVersion: "5.2-FROZEN", currentDevelopmentBranch: identity.branch, currentSourceIdentity: { head: identity.head, tree: identity.tree } });
  const envelope = c.authority.compileSourceMutationAuthorityEnvelopeV1({ ...identity, targetRepository: identity.repository, repositorySet: [identity.repository], developmentBranchOrBranchClass: identity.branch, authoritySource: "test-fixture" });
  return { selection: { status: "BOUND", publisher_verified: true, write_authority: false, enabled_features: ["runtime.control"], release: { id: "fixture", commit: git("f"), manifest_sha256: sha("f") } }, identity, observation: { ...identity }, state, envelope, actions: [{ id: "implement", kind: "CODE", phaseId: "P1" }, { id: "approve", kind: "AUTH" }], proposed: { operation: "source.commit", targetRepository: identity.repository, developmentBranchOrBranchClass: identity.branch, forcePush: false, destructive: false, expectedHead: identity.head, baseTree: identity.tree } };
}

test("Python release resolver, signature and manifest suites", () => {
  const p = spawnSync("python3", ["-m", "unittest", "discover", "-s", "test/rev60", "-p", "test_*.py", "-v"], { encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }, timeout: 30000 });
  assert.equal(p.status, 0, `${p.error ?? ""}\n${p.stdout}\n${p.stderr}`);
  assert.match(p.stderr, /Ran 24 tests/);
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
