import test from "node:test";
import assert from "node:assert/strict";
import {
  RUNTIME_A_HEAD,
  RUNTIME_A_TREE,
  RUNTIME_BASELINE_MAIN_SHA,
  RUNTIME_B1_PATHS,
  buildRuntimeBStaticClosure,
  validateRuntimeBRemoteSnapshot,
  validateRuntimeBStaticClosure
} from "../runtime/plan-b-closure.mjs";

const candidateSha = "c151c5c185dbe96b02e2cc2b29b4a0dffb88aad9";
const candidateTree = "0ec7ee74b54199a72bc04f4545ff618059800a0f";
const componentManifestSha256 = "f9b351a2cd7b1b5188d81678327861bc7893e1cd73147975ae6161337a4539bd";

function snapshot(overrides = {}) {
  return {
    repository: "neoflowcore/atelier-runtime",
    runtime_a_head: RUNTIME_A_HEAD,
    runtime_a_tree: RUNTIME_A_TREE,
    main_sha: RUNTIME_BASELINE_MAIN_SHA,
    candidate_sha: candidateSha,
    candidate_tree: candidateTree,
    ahead_by: 1,
    behind_by: 0,
    total_commits: 1,
    workflow_runs_count: 0,
    component_binding: "PASS",
    changed_paths: [...RUNTIME_B1_PATHS],
    ...overrides
  };
}

test("exact B1 remote snapshot is accepted", () => {
  assert.deepEqual(validateRuntimeBRemoteSnapshot(snapshot()), { ok: true, errors: [] });
});

test("closure is compatible-final static but deliberately not sealed", () => {
  const receipt = buildRuntimeBStaticClosure(snapshot(), componentManifestSha256);
  assert.equal(receipt.result, "PASS");
  assert.equal(receipt.candidate_class, "COMPATIBLE_FINAL_CANDIDATE_STATIC");
  assert.equal(receipt.runtime_b_sealed, "NO");
  assert.equal(receipt.seal_blocker, "APPROVAL_ENVELOPE_SEMANTICS_NOT_FROZEN");
  assert.equal(receipt.approval_extension_state, "NOT_FROZEN_NOT_CONSUMED");
  assert.deepEqual(validateRuntimeBStaticClosure(receipt), { ok: true, errors: [] });
});

test("main drift blocks", () => {
  assert.equal(validateRuntimeBRemoteSnapshot(snapshot({ main_sha: "f".repeat(40) })).ok, false);
});

test("unexpected changed path blocks", () => {
  assert.equal(validateRuntimeBRemoteSnapshot(snapshot({ changed_paths: [...RUNTIME_B1_PATHS, "runtime/pilote-compiler.mjs"] })).ok, false);
});

test("unexpected workflow run blocks", () => {
  assert.equal(validateRuntimeBRemoteSnapshot(snapshot({ workflow_runs_count: 1 })).ok, false);
});

test("fake Runtime B sealed state is rejected", () => {
  const receipt = buildRuntimeBStaticClosure(snapshot(), componentManifestSha256);
  receipt.runtime_b_sealed = "YES";
  assert.equal(validateRuntimeBStaticClosure(receipt).ok, false);
});

test("fake SYNC-3 pass is rejected", () => {
  const receipt = buildRuntimeBStaticClosure(snapshot(), componentManifestSha256);
  receipt.sync_3 = "PASS";
  assert.equal(validateRuntimeBStaticClosure(receipt).ok, false);
});

test("lease implementation before Plan D is rejected", () => {
  const receipt = buildRuntimeBStaticClosure(snapshot(), componentManifestSha256);
  receipt.lease_state = "IMPLEMENTED";
  assert.equal(validateRuntimeBStaticClosure(receipt).ok, false);
});
