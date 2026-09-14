import { createHash } from "node:crypto";
import {
  INTERFACE_VERSION,
  INTERFACE_MANIFEST_SHA256,
  TASK_CONTRACT_SCHEMA_SHA256,
  TASK_CONTRACT_MACHINE_SCHEMA_SHA256,
  FROZEN_TASK_CONTRACT_FIELDS
} from "./task-contract-v1.mjs";

export const RUNTIME_C_SEAL_RECEIPT_TYPE = "RUNTIME_C_SEAL_RECEIPT_V1";
export const RUNTIME_B3_HEAD = "9f0a6165f906fa27a6d178105d7c5faf9aae8683";
export const RUNTIME_B3_TREE = "2b6e7c597284e8ac44b2ea2a927c6699f2184bbf";
export const RUNTIME_BASELINE_MAIN_SHA = "2f82365b7270fd7b4cb15dcf4f87fe7e0e05f4d9";
export const BASELINE_EPOCH_ID = "11cfb57b2cd0f4d36e6c064ee908ab198677d5309529c2054829cc9da7f103a3";

export const RUNTIME_C_PATHS = Object.freeze([
  "docs/RUNTIME_C_DEVELOPMENT_PLANE.md",
  "docs/RUNTIME_C_GATEWAY_AND_JOURNAL.md",
  "docs/RUNTIME_C_SEAL_CANDIDATE.md",
  "runtime/plan-c-dag.mjs",
  "runtime/plan-c-dev-plane.mjs",
  "runtime/plan-c-readback-journal.mjs",
  "runtime/plan-c-seal.mjs",
  "runtime/plan-c-source-write-gateway.mjs",
  "schemas/runtime-c-dev-plane.schema.json",
  "schemas/runtime-c-mutation-envelope.schema.json",
  "schemas/runtime-c-seal.schema.json",
  "test/plan-c-dev-plane.test.mjs",
  "test/plan-c-gateway.test.mjs",
  "test/plan-c-seal.test.mjs"
]);

const SHA40 = /^[0-9a-f]{40}$/;

function sha256Json(value) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

export function validateRuntimeCSealSnapshot(snapshot) {
  const errors = [];
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return { ok: false, errors: ["SNAPSHOT_MISSING"] };
  if (snapshot.repository !== "neoflowcore/atelier-runtime") errors.push("REPOSITORY_MISMATCH");
  if (snapshot.base_b3_head !== RUNTIME_B3_HEAD) errors.push("B3_HEAD_MISMATCH");
  if (snapshot.base_b3_tree !== RUNTIME_B3_TREE) errors.push("B3_TREE_MISMATCH");
  if (snapshot.main_sha !== RUNTIME_BASELINE_MAIN_SHA) errors.push("MAIN_DRIFT");
  if (!SHA40.test(snapshot.candidate_sha ?? "")) errors.push("INVALID_CANDIDATE_SHA");
  if (!SHA40.test(snapshot.candidate_tree ?? "")) errors.push("INVALID_CANDIDATE_TREE");
  if (snapshot.ahead_by !== 1 || snapshot.behind_by !== 0 || snapshot.total_commits !== 1) errors.push("C_COMMIT_DISTANCE_MISMATCH");
  if (snapshot.workflow_runs_count !== 0) errors.push("UNEXPECTED_ACTION_RUN");
  const paths = Array.isArray(snapshot.changed_paths) ? snapshot.changed_paths : [];
  if (JSON.stringify([...paths].sort()) !== JSON.stringify([...RUNTIME_C_PATHS].sort())) errors.push("C_CHANGED_PATHS_MISMATCH");
  if (snapshot.runtime_b_sealed !== "YES") errors.push("RUNTIME_B_NOT_SEALED");
  if (snapshot.dev_plane_validation !== "PASS") errors.push("DEV_PLANE_VALIDATION_NOT_PASS");
  if (snapshot.dag_validation !== "PASS") errors.push("DAG_VALIDATION_NOT_PASS");
  if (snapshot.gateway_validation !== "PASS") errors.push("GATEWAY_VALIDATION_NOT_PASS");
  if (snapshot.provider_readback_validation !== "PASS") errors.push("PROVIDER_READBACK_VALIDATION_NOT_PASS");
  if (snapshot.mutation_journal_validation !== "PASS") errors.push("MUTATION_JOURNAL_VALIDATION_NOT_PASS");
  if (snapshot.interface_v1_unchanged !== true) errors.push("INTERFACE_V1_MUTATED");
  if (snapshot.frozen_task_contract_fields_count !== FROZEN_TASK_CONTRACT_FIELDS.length) errors.push("FROZEN_FIELD_COUNT_MISMATCH");
  if (snapshot.pilote_semantic_compiler_reimplementation !== 0) errors.push("PILOTE_SEMANTIC_REIMPLEMENTATION");
  if (snapshot.gateway_only_remote_source_write !== "PASS") errors.push("REMOTE_SOURCE_WRITE_NOT_GATEWAY_ONLY");
  if (snapshot.validation_execution_source_write !== 0) errors.push("VALIDATION_SOURCE_WRITE_NONZERO");
  if (snapshot.merge_authority !== "NONE") errors.push("MERGE_AUTHORITY_FORBIDDEN");
  if (snapshot.final_merge_authority !== "HUMAN_ONLY") errors.push("FINAL_MERGE_NOT_HUMAN_ONLY");
  if (snapshot.lease_state !== "NOT_IMPLEMENTED_PLAN_D") errors.push("PLAN_D_LEASE_FENCE_VIOLATION");
  if (snapshot.live_provider_mutation !== "NOT_RUN") errors.push("VALIDATION_MUST_NOT_LIVE_MUTATE_PROVIDER");
  return { ok: errors.length === 0, errors };
}

export function buildRuntimeCSealReceipt(snapshot) {
  const validation = validateRuntimeCSealSnapshot(snapshot);
  return {
    receipt_type: RUNTIME_C_SEAL_RECEIPT_TYPE,
    interface_version: INTERFACE_VERSION,
    interface_manifest_sha256: INTERFACE_MANIFEST_SHA256,
    task_contract_schema_sha256: TASK_CONTRACT_SCHEMA_SHA256,
    task_contract_machine_schema_sha256: TASK_CONTRACT_MACHINE_SCHEMA_SHA256,
    baseline_epoch_id: BASELINE_EPOCH_ID,
    runtime_c_candidate_sha: snapshot?.candidate_sha ?? null,
    runtime_c_candidate_tree: snapshot?.candidate_tree ?? null,
    runtime_c_snapshot_sha256: sha256Json(snapshot),
    runtime_c_implementation: validation.ok ? "COMPLETE" : "BLOCKED",
    runtime_c_sealed: "NO",
    seal_decision: "PENDING_FINAL_GATE",
    sync_3: "NOT_EVALUATED",
    phase_to_typed_tasks_to_receipts: "NOT_EVALUATED_UNTIL_SYNC_3",
    live_provider_mutation: "NOT_RUN",
    gateway_only_remote_source_write: "PASS",
    validation_execution_source_write: 0,
    merge_authority: "NONE",
    final_merge_authority: "HUMAN_ONLY",
    lease_state: "NOT_IMPLEMENTED_PLAN_D",
    result: validation.ok ? "PASS" : "BLOCKED",
    reasons: [...validation.errors]
  };
}

export function promoteRuntimeCSeal(receipt, finalGate) {
  const errors = [];
  if (receipt?.receipt_type !== RUNTIME_C_SEAL_RECEIPT_TYPE) errors.push("RECEIPT_TYPE_MISMATCH");
  if (receipt?.result !== "PASS" || receipt?.runtime_c_implementation !== "COMPLETE") errors.push("IMPLEMENTATION_NOT_COMPLETE");
  if (receipt?.runtime_c_sealed !== "NO" || receipt?.seal_decision !== "PENDING_FINAL_GATE") errors.push("PRESEAL_STATE_MISMATCH");
  if (receipt?.sync_3 !== "NOT_EVALUATED") errors.push("SYNC_3_PREMATURE");
  if (receipt?.phase_to_typed_tasks_to_receipts !== "NOT_EVALUATED_UNTIL_SYNC_3") errors.push("CROSS_STACK_GATE_PREMATURE");
  if (receipt?.lease_state !== "NOT_IMPLEMENTED_PLAN_D") errors.push("PLAN_D_LEASE_FENCE_VIOLATION");
  if (receipt?.validation_execution_source_write !== 0) errors.push("VALIDATION_SOURCE_WRITE_NONZERO");
  if (receipt?.merge_authority !== "NONE" || receipt?.final_merge_authority !== "HUMAN_ONLY") errors.push("MERGE_AUTHORITY_POLICY_MISMATCH");
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
      runtime_c_sealed: "YES",
      seal_decision: "SEALED",
      result: "PASS",
      reasons: []
    }
  };
}
