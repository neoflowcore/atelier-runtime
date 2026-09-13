import { createHash } from "node:crypto";
import {
  INTERFACE_VERSION,
  INTERFACE_MANIFEST_SHA256,
  TASK_CONTRACT_SCHEMA_SHA256,
  TASK_CONTRACT_MACHINE_SCHEMA_SHA256,
  FROZEN_TASK_CONTRACT_FIELDS
} from "./task-contract-v1.mjs";

export const RUNTIME_B_SEAL_RECEIPT_TYPE = "RUNTIME_B_SEAL_RECEIPT_V1";
export const RUNTIME_B2_HEAD = "743e14f9292100752c8352b862e3a3e25153be87";
export const RUNTIME_B2_TREE = "8e7a9d9a2e92dbc9c751cef512670955155604db";
export const RUNTIME_BASELINE_MAIN_SHA = "2f82365b7270fd7b4cb15dcf4f87fe7e0e05f4d9";
export const BASELINE_EPOCH_ID = "11cfb57b2cd0f4d36e6c064ee908ab198677d5309529c2054829cc9da7f103a3";

export const RUNTIME_B3_PATHS = Object.freeze([
  "docs/RUNTIME_B_AUTHORITY_BINDING.md",
  "docs/RUNTIME_B_SEAL_CANDIDATE.md",
  "runtime/backend-authority-guard.mjs",
  "runtime/plan-b-seal.mjs",
  "schemas/runtime-b-authority-binding.schema.json",
  "schemas/runtime-b-seal.schema.json",
  "test/backend-authority-guard.test.mjs",
  "test/plan-b-seal.test.mjs"
]);

const SHA40 = /^[0-9a-f]{40}$/;

function sha256Json(value) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

export function validateRuntimeBSealSnapshot(snapshot) {
  const errors = [];
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return { ok: false, errors: ["SNAPSHOT_MISSING"] };
  if (snapshot.repository !== "neoflowcore/atelier-runtime") errors.push("REPOSITORY_MISMATCH");
  if (snapshot.base_b2_head !== RUNTIME_B2_HEAD) errors.push("B2_HEAD_MISMATCH");
  if (snapshot.base_b2_tree !== RUNTIME_B2_TREE) errors.push("B2_TREE_MISMATCH");
  if (snapshot.main_sha !== RUNTIME_BASELINE_MAIN_SHA) errors.push("MAIN_DRIFT");
  if (!SHA40.test(snapshot.candidate_sha ?? "")) errors.push("INVALID_CANDIDATE_SHA");
  if (!SHA40.test(snapshot.candidate_tree ?? "")) errors.push("INVALID_CANDIDATE_TREE");
  if (snapshot.ahead_by !== 1 || snapshot.behind_by !== 0 || snapshot.total_commits !== 1) errors.push("B3_COMMIT_DISTANCE_MISMATCH");
  if (snapshot.workflow_runs_count !== 0) errors.push("UNEXPECTED_ACTION_RUN");
  const paths = Array.isArray(snapshot.changed_paths) ? snapshot.changed_paths : [];
  if (JSON.stringify([...paths].sort()) !== JSON.stringify([...RUNTIME_B3_PATHS].sort())) errors.push("B3_CHANGED_PATHS_MISMATCH");
  if (snapshot.authority_guard_validation !== "PASS") errors.push("AUTHORITY_GUARD_VALIDATION_NOT_PASS");
  if (snapshot.backend_selector_validation !== "PASS") errors.push("BACKEND_SELECTOR_VALIDATION_NOT_PASS");
  if (snapshot.interface_v1_unchanged !== true) errors.push("INTERFACE_V1_MUTATED");
  if (snapshot.frozen_task_contract_fields_count !== FROZEN_TASK_CONTRACT_FIELDS.length) errors.push("FROZEN_FIELD_COUNT_MISMATCH");
  if (snapshot.pilote_semantic_compiler_reimplementation !== 0) errors.push("PILOTE_SEMANTIC_REIMPLEMENTATION");
  if (snapshot.lease_state !== "NOT_IMPLEMENTED_PLAN_D") errors.push("PLAN_D_LEASE_FENCE_VIOLATION");
  if (snapshot.validation_execution_source_write !== 0) errors.push("VALIDATION_SOURCE_WRITE_NONZERO");
  if (snapshot.remote_source_write_authority !== "NONE") errors.push("REMOTE_SOURCE_WRITE_AUTHORITY_NOT_NONE");
  return { ok: errors.length === 0, errors };
}

export function buildRuntimeBSealReceipt(snapshot) {
  const validation = validateRuntimeBSealSnapshot(snapshot);
  return {
    receipt_type: RUNTIME_B_SEAL_RECEIPT_TYPE,
    interface_version: INTERFACE_VERSION,
    interface_manifest_sha256: INTERFACE_MANIFEST_SHA256,
    task_contract_schema_sha256: TASK_CONTRACT_SCHEMA_SHA256,
    task_contract_machine_schema_sha256: TASK_CONTRACT_MACHINE_SCHEMA_SHA256,
    baseline_epoch_id: BASELINE_EPOCH_ID,
    runtime_b_candidate_sha: snapshot?.candidate_sha ?? null,
    runtime_b_candidate_tree: snapshot?.candidate_tree ?? null,
    runtime_b_snapshot_sha256: sha256Json(snapshot),
    runtime_b_implementation: validation.ok ? "COMPLETE" : "BLOCKED",
    runtime_b_sealed: "NO",
    seal_decision: "PENDING_FINAL_GATE",
    pilote_rev45_final_seal_dependency: "NONE_FOR_RUNTIME_B_IMPLEMENTATION",
    sync_3: "NOT_EVALUATED",
    live_self_hosted_invocation: "NOT_RUN",
    authority_semantics: "OPAQUE_EXTERNAL_EVIDENCE_ONLY",
    lease_state: "NOT_IMPLEMENTED_PLAN_D",
    validation_execution_source_write: 0,
    remote_source_write_authority: "NONE",
    result: validation.ok ? "PASS" : "BLOCKED",
    reasons: [...validation.errors]
  };
}

export function promoteRuntimeBSeal(receipt, finalGate) {
  const errors = [];
  if (receipt?.receipt_type !== RUNTIME_B_SEAL_RECEIPT_TYPE) errors.push("RECEIPT_TYPE_MISMATCH");
  if (receipt?.result !== "PASS" || receipt?.runtime_b_implementation !== "COMPLETE") errors.push("IMPLEMENTATION_NOT_COMPLETE");
  if (receipt?.runtime_b_sealed !== "NO" || receipt?.seal_decision !== "PENDING_FINAL_GATE") errors.push("PRESEAL_STATE_MISMATCH");
  if (receipt?.sync_3 !== "NOT_EVALUATED") errors.push("SYNC_3_PREMATURE");
  if (receipt?.lease_state !== "NOT_IMPLEMENTED_PLAN_D") errors.push("PLAN_D_LEASE_FENCE_VIOLATION");
  if (receipt?.validation_execution_source_write !== 0) errors.push("VALIDATION_SOURCE_WRITE_NONZERO");
  if (receipt?.remote_source_write_authority !== "NONE") errors.push("REMOTE_SOURCE_WRITE_AUTHORITY_NOT_NONE");
  if (finalGate?.targeted_tests !== "PASS") errors.push("TARGETED_TESTS_NOT_PASS");
  if (finalGate?.source_readback !== "PASS") errors.push("SOURCE_READBACK_NOT_PASS");
  if (finalGate?.workflow_runs_count !== 0) errors.push("UNEXPECTED_ACTION_RUN");
  if (finalGate?.main_drift !== "NONE") errors.push("MAIN_DRIFT");
  if (errors.length > 0) return { ok: false, errors, receipt: null };

  return {
    ok: true,
    errors: [],
    receipt: {
      ...receipt,
      runtime_b_sealed: "YES",
      seal_decision: "SEALED",
      result: "PASS",
      reasons: []
    }
  };
}
