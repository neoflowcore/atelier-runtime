import test from "node:test";
import assert from "node:assert/strict";
import { RUNTIME_C_PATHS, buildRuntimeCSealReceipt, promoteRuntimeCSeal, validateRuntimeCSealSnapshot } from "../runtime/plan-c-seal.mjs";

function snapshot(overrides = {}) {
  return {
    repository: "neoflowcore/atelier-runtime",
    base_b3_head: "9f0a6165f906fa27a6d178105d7c5faf9aae8683",
    base_b3_tree: "2b6e7c597284e8ac44b2ea2a927c6699f2184bbf",
    main_sha: "2f82365b7270fd7b4cb15dcf4f87fe7e0e05f4d9",
    candidate_sha: "d".repeat(40), candidate_tree: "e".repeat(40), ahead_by: 1, behind_by: 0, total_commits: 1,
    workflow_runs_count: 0, changed_paths: [...RUNTIME_C_PATHS], runtime_b_sealed: "YES",
    dev_plane_validation: "PASS", dag_validation: "PASS", gateway_validation: "PASS", provider_readback_validation: "PASS", mutation_journal_validation: "PASS",
    interface_v1_unchanged: true, frozen_task_contract_fields_count: 27, pilote_semantic_compiler_reimplementation: 0,
    gateway_only_remote_source_write: "PASS", validation_execution_source_write: 0, merge_authority: "NONE", final_merge_authority: "HUMAN_ONLY",
    lease_state: "NOT_IMPLEMENTED_PLAN_D", live_provider_mutation: "NOT_RUN", ...overrides
  };
}

test("exact Runtime C snapshot is implementation-complete preseal", () => {
  assert.deepEqual(validateRuntimeCSealSnapshot(snapshot()), { ok: true, errors: [] });
  const receipt = buildRuntimeCSealReceipt(snapshot());
  assert.equal(receipt.runtime_c_implementation, "COMPLETE");
  assert.equal(receipt.runtime_c_sealed, "NO");
  assert.equal(receipt.sync_3, "NOT_EVALUATED");
});

test("final static gate promotes Runtime C seal without claiming SYNC-3", () => {
  const preseal = buildRuntimeCSealReceipt(snapshot());
  const promoted = promoteRuntimeCSeal(preseal, { targeted_tests: "PASS", source_readback: "PASS", workflow_runs_count: 0, main_drift: "NONE" });
  assert.equal(promoted.ok, true);
  assert.equal(promoted.receipt.runtime_c_sealed, "YES");
  assert.equal(promoted.receipt.sync_3, "NOT_EVALUATED");
  assert.equal(promoted.receipt.phase_to_typed_tasks_to_receipts, "NOT_EVALUATED_UNTIL_SYNC_3");
});

test("any live provider mutation during validation blocks seal", () => {
  assert.equal(validateRuntimeCSealSnapshot(snapshot({ live_provider_mutation: "RUN" })).ok, false);
});

test("non-gateway remote source write blocks seal", () => {
  assert.equal(validateRuntimeCSealSnapshot(snapshot({ gateway_only_remote_source_write: "FAIL" })).ok, false);
});

test("merge authority blocks seal", () => {
  assert.equal(validateRuntimeCSealSnapshot(snapshot({ merge_authority: "RUNTIME" })).ok, false);
});

test("Plan D lease implementation blocks Runtime C seal", () => {
  assert.equal(validateRuntimeCSealSnapshot(snapshot({ lease_state: "IMPLEMENTED" })).ok, false);
});

test("workflow run or main drift blocks Runtime C seal", () => {
  assert.equal(validateRuntimeCSealSnapshot(snapshot({ workflow_runs_count: 1 })).ok, false);
  assert.equal(validateRuntimeCSealSnapshot(snapshot({ main_sha: "f".repeat(40) })).ok, false);
});
