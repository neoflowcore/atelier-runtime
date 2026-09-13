import test from "node:test";
import assert from "node:assert/strict";
import {
  RUNTIME_B2_HEAD,
  RUNTIME_B2_TREE,
  RUNTIME_BASELINE_MAIN_SHA,
  RUNTIME_B3_PATHS,
  buildRuntimeBSealReceipt,
  promoteRuntimeBSeal,
  validateRuntimeBSealSnapshot
} from "../runtime/plan-b-seal.mjs";

function snapshot(overrides = {}) {
  return {
    repository: "neoflowcore/atelier-runtime",
    base_b2_head: RUNTIME_B2_HEAD,
    base_b2_tree: RUNTIME_B2_TREE,
    main_sha: RUNTIME_BASELINE_MAIN_SHA,
    candidate_sha: "1".repeat(40),
    candidate_tree: "2".repeat(40),
    ahead_by: 1,
    behind_by: 0,
    total_commits: 1,
    workflow_runs_count: 0,
    changed_paths: [...RUNTIME_B3_PATHS],
    authority_guard_validation: "PASS",
    backend_selector_validation: "PASS",
    interface_v1_unchanged: true,
    frozen_task_contract_fields_count: 27,
    pilote_semantic_compiler_reimplementation: 0,
    lease_state: "NOT_IMPLEMENTED_PLAN_D",
    validation_execution_source_write: 0,
    remote_source_write_authority: "NONE",
    ...overrides
  };
}

const finalGate = {
  targeted_tests: "PASS",
  source_readback: "PASS",
  workflow_runs_count: 0,
  main_drift: "NONE"
};

test("exact B3 snapshot is implementation-complete preseal", () => {
  assert.deepEqual(validateRuntimeBSealSnapshot(snapshot()), { ok: true, errors: [] });
  const receipt = buildRuntimeBSealReceipt(snapshot());
  assert.equal(receipt.result, "PASS");
  assert.equal(receipt.runtime_b_implementation, "COMPLETE");
  assert.equal(receipt.runtime_b_sealed, "NO");
  assert.equal(receipt.seal_decision, "PENDING_FINAL_GATE");
});

test("final gate promotes Runtime B seal without Pilote semantic reinterpretation", () => {
  const receipt = buildRuntimeBSealReceipt(snapshot());
  const promoted = promoteRuntimeBSeal(receipt, finalGate);
  assert.equal(promoted.ok, true);
  assert.equal(promoted.receipt.runtime_b_sealed, "YES");
  assert.equal(promoted.receipt.authority_semantics, "OPAQUE_EXTERNAL_EVIDENCE_ONLY");
});

test("unexpected path blocks seal candidate", () => {
  const result = validateRuntimeBSealSnapshot(snapshot({ changed_paths: [...RUNTIME_B3_PATHS, "runtime/pilote-orchestrator.mjs"] }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("B3_CHANGED_PATHS_MISMATCH"));
});

test("main drift blocks seal candidate", () => {
  assert.equal(validateRuntimeBSealSnapshot(snapshot({ main_sha: "f".repeat(40) })).ok, false);
});

test("workflow execution blocks zero-action seal candidate", () => {
  assert.equal(validateRuntimeBSealSnapshot(snapshot({ workflow_runs_count: 1 })).ok, false);
});

test("Task Contract field count change blocks", () => {
  assert.equal(validateRuntimeBSealSnapshot(snapshot({ frozen_task_contract_fields_count: 28 })).ok, false);
});

test("Plan D lease implementation blocks", () => {
  assert.equal(validateRuntimeBSealSnapshot(snapshot({ lease_state: "IMPLEMENTED" })).ok, false);
});

test("failed final readback cannot promote seal", () => {
  const receipt = buildRuntimeBSealReceipt(snapshot());
  const promoted = promoteRuntimeBSeal(receipt, { ...finalGate, source_readback: "FAIL" });
  assert.equal(promoted.ok, false);
  assert.ok(promoted.errors.includes("SOURCE_READBACK_NOT_PASS"));
});
