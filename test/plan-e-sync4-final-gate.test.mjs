import test from "node:test";
import assert from "node:assert/strict";
import {
  validateSync4FinalGateInput,
  compileRuntimeEFinalSealCandidate,
  EXPECTED_INTERFACE_MANIFEST_SHA256,
  EXPECTED_TASK_CONTRACT_SCHEMA_SHA256,
  EXPECTED_TASK_CONTRACT_MACHINE_SCHEMA_SHA256
} from "../runtime/plan-e-sync4-final-gate.mjs";

const H = "a".repeat(64);
const identity = {
  head: "7d43bb48d12524deeae245df69e298c2f46bba0e",
  tree: "31699d0b913a02dde22443cf2e9d800a4740c02a"
};
function valid(overrides = {}) {
  return {
    input_type: "SYNC4_PILOTE_REV5_FINAL_GATE_V1",
    pilote_rev5_status: "SEALED",
    pilote_rev5_identity_sha256: H,
    pilote_rev5_package_sha256: H,
    interface_version: "1.0.0",
    interface_manifest_sha256: EXPECTED_INTERFACE_MANIFEST_SHA256,
    task_contract_schema_sha256: EXPECTED_TASK_CONTRACT_SCHEMA_SHA256,
    task_contract_machine_schema_sha256: EXPECTED_TASK_CONTRACT_MACHINE_SCHEMA_SHA256,
    frozen_27_fields_mutation: 0,
    pilote_semantic_reimplementation: 0,
    runtime_semantic_reimplementation: 0,
    runtime_e_head: identity.head,
    runtime_e_tree: identity.tree,
    cross_stack_result: "PASS",
    cross_stack_contradiction_count: 0,
    runtime_production_merge_authority: "NONE",
    final_merge_authority: "HUMAN_ONLY",
    promotion_acceptance_evidence_sha256: H,
    rollback_acceptance_evidence_sha256: H,
    bundle_evidence_sha256: H,
    ...overrides
  };
}

test("valid authoritative binding is eligible", () => {
  assert.deepEqual(validateSync4FinalGateInput(valid(), identity), { ok: true, errors: [] });
  assert.equal(compileRuntimeEFinalSealCandidate(valid(), identity).runtime_e_seal_candidate, "ELIGIBLE");
});
test("Rev5 must be sealed", () => {
  assert.ok(validateSync4FinalGateInput(valid({pilote_rev5_status:"DRAFT"}), identity).errors.includes("PILOTE_REV5_NOT_SEALED"));
});
test("Interface manifest is exact", () => {
  assert.ok(validateSync4FinalGateInput(valid({interface_manifest_sha256:H}), identity).errors.includes("INTERFACE_MANIFEST_MISMATCH"));
});
test("Task schema is exact", () => {
  assert.ok(validateSync4FinalGateInput(valid({task_contract_schema_sha256:H}), identity).errors.includes("TASK_CONTRACT_SCHEMA_MISMATCH"));
});
test("Runtime exact head is bound", () => {
  assert.ok(validateSync4FinalGateInput(valid({runtime_e_head:"1".repeat(40)}), identity).errors.includes("RUNTIME_E_HEAD_MISMATCH"));
});
test("Runtime exact tree is bound", () => {
  assert.ok(validateSync4FinalGateInput(valid({runtime_e_tree:"2".repeat(40)}), identity).errors.includes("RUNTIME_E_TREE_MISMATCH"));
});
test("27-field mutation fails closed", () => {
  assert.ok(validateSync4FinalGateInput(valid({frozen_27_fields_mutation:1}), identity).errors.includes("FROZEN_27_FIELDS_MUTATED"));
});
test("cross-stack contradiction fails closed", () => {
  assert.ok(validateSync4FinalGateInput(valid({cross_stack_contradiction_count:1}), identity).errors.includes("CROSS_STACK_CONTRADICTIONS_NONZERO"));
});
test("merge authority escalation fails closed", () => {
  assert.ok(validateSync4FinalGateInput(valid({runtime_production_merge_authority:"RUNTIME"}), identity).errors.includes("RUNTIME_MERGE_AUTHORITY_ESCALATED"));
});
test("final merge remains human only", () => {
  assert.ok(validateSync4FinalGateInput(valid({final_merge_authority:"RUNTIME"}), identity).errors.includes("FINAL_MERGE_AUTHORITY_MISMATCH"));
});
