import { createHash } from "node:crypto";
import {
  INTERFACE_VERSION,
  INTERFACE_MANIFEST_SHA256,
  TASK_CONTRACT_SCHEMA_SHA256,
  TASK_CONTRACT_MACHINE_SCHEMA_SHA256
} from "./task-contract-v1.mjs";

export const RUNTIME_B_CLOSURE_RECEIPT_TYPE = "RUNTIME_B_STATIC_CLOSURE_V1";
export const RUNTIME_B_CANDIDATE_CLASS = "COMPATIBLE_FINAL_CANDIDATE_STATIC";
export const RUNTIME_A_HEAD = "c18800c0c8c2fe55c017e5a8c970a29daf42410f";
export const RUNTIME_A_TREE = "89bde4de3808d9715e002833f24c618cee52c440";
export const RUNTIME_BASELINE_MAIN_SHA = "2f82365b7270fd7b4cb15dcf4f87fe7e0e05f4d9";
export const BASELINE_EPOCH_ID = "11cfb57b2cd0f4d36e6c064ee908ab198677d5309529c2054829cc9da7f103a3";
export const APPROVAL_EXTENSION_STATE = "NOT_FROZEN_NOT_CONSUMED";
export const RUNTIME_B_SEAL_BLOCKER = "APPROVAL_ENVELOPE_SEMANTICS_NOT_FROZEN";

export const RUNTIME_B1_PATHS = Object.freeze([
  "docs/RUNTIME_B_HYBRID_BACKEND_SELECTION.md",
  "runtime/backend-plan-b.mjs",
  "schemas/runtime-b-backend-selection.schema.json",
  "test/backend-plan-b.test.mjs"
]);

const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;

function sha256Json(value) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

export function validateRuntimeBRemoteSnapshot(snapshot) {
  const errors = [];
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return { ok: false, errors: ["SNAPSHOT_MISSING"] };
  if (snapshot.repository !== "neoflowcore/atelier-runtime") errors.push("REPOSITORY_MISMATCH");
  if (snapshot.runtime_a_head !== RUNTIME_A_HEAD) errors.push("RUNTIME_A_HEAD_MISMATCH");
  if (snapshot.runtime_a_tree !== RUNTIME_A_TREE) errors.push("RUNTIME_A_TREE_MISMATCH");
  if (snapshot.main_sha !== RUNTIME_BASELINE_MAIN_SHA) errors.push("MAIN_DRIFT");
  if (!SHA40.test(snapshot.candidate_sha ?? "")) errors.push("INVALID_CANDIDATE_SHA");
  if (!SHA40.test(snapshot.candidate_tree ?? "")) errors.push("INVALID_CANDIDATE_TREE");
  if (snapshot.ahead_by !== 1 || snapshot.behind_by !== 0 || snapshot.total_commits !== 1) errors.push("RUNTIME_B1_COMMIT_DISTANCE_MISMATCH");
  if (snapshot.workflow_runs_count !== 0) errors.push("UNEXPECTED_ACTION_RUN");
  const paths = Array.isArray(snapshot.changed_paths) ? snapshot.changed_paths : [];
  if (JSON.stringify([...paths].sort()) !== JSON.stringify([...RUNTIME_B1_PATHS].sort())) errors.push("RUNTIME_B1_CHANGED_PATHS_MISMATCH");
  if (snapshot.component_binding !== "PASS") errors.push("COMPONENT_BINDING_NOT_PASS");
  return { ok: errors.length === 0, errors };
}

export function buildRuntimeBStaticClosure(snapshot, componentManifestSha256) {
  const validation = validateRuntimeBRemoteSnapshot(snapshot);
  if (!SHA256.test(componentManifestSha256 ?? "")) {
    validation.errors.push("INVALID_COMPONENT_MANIFEST_SHA256");
    validation.ok = false;
  }
  const snapshotSha256 = sha256Json(snapshot);
  return {
    receipt_type: RUNTIME_B_CLOSURE_RECEIPT_TYPE,
    candidate_class: RUNTIME_B_CANDIDATE_CLASS,
    interface_version: INTERFACE_VERSION,
    interface_manifest_sha256: INTERFACE_MANIFEST_SHA256,
    task_contract_schema_sha256: TASK_CONTRACT_SCHEMA_SHA256,
    task_contract_machine_schema_sha256: TASK_CONTRACT_MACHINE_SCHEMA_SHA256,
    baseline_epoch_id: BASELINE_EPOCH_ID,
    runtime_a_head: RUNTIME_A_HEAD,
    runtime_a_tree: RUNTIME_A_TREE,
    runtime_b_candidate_sha: snapshot?.candidate_sha ?? null,
    runtime_b_candidate_tree: snapshot?.candidate_tree ?? null,
    component_manifest_sha256: componentManifestSha256 ?? null,
    remote_snapshot_sha256: snapshotSha256,
    sync_2: "PASS",
    sync_3: "NOT_EVALUATED",
    approval_extension_state: APPROVAL_EXTENSION_STATE,
    runtime_b_sealed: "NO",
    seal_blocker: RUNTIME_B_SEAL_BLOCKER,
    lease_state: "NOT_IMPLEMENTED_PLAN_D",
    validation_execution_source_write: 0,
    remote_source_write_authority: "NONE",
    result: validation.ok ? "PASS" : "BLOCKED",
    reasons: [...validation.errors]
  };
}

export function validateRuntimeBStaticClosure(receipt) {
  const errors = [];
  if (receipt?.receipt_type !== RUNTIME_B_CLOSURE_RECEIPT_TYPE) errors.push("RECEIPT_TYPE_MISMATCH");
  if (receipt?.candidate_class !== RUNTIME_B_CANDIDATE_CLASS) errors.push("CANDIDATE_CLASS_MISMATCH");
  if (receipt?.interface_version !== INTERFACE_VERSION) errors.push("INTERFACE_VERSION_MISMATCH");
  if (receipt?.interface_manifest_sha256 !== INTERFACE_MANIFEST_SHA256) errors.push("INTERFACE_MANIFEST_MISMATCH");
  if (receipt?.task_contract_schema_sha256 !== TASK_CONTRACT_SCHEMA_SHA256) errors.push("TASK_CONTRACT_SCHEMA_MISMATCH");
  if (receipt?.task_contract_machine_schema_sha256 !== TASK_CONTRACT_MACHINE_SCHEMA_SHA256) errors.push("TASK_CONTRACT_MACHINE_SCHEMA_MISMATCH");
  if (receipt?.baseline_epoch_id !== BASELINE_EPOCH_ID) errors.push("BASELINE_EPOCH_MISMATCH");
  if (receipt?.runtime_b_sealed !== "NO") errors.push("RUNTIME_B_SEAL_MUST_REMAIN_NO");
  if (receipt?.seal_blocker !== RUNTIME_B_SEAL_BLOCKER) errors.push("SEAL_BLOCKER_MISMATCH");
  if (receipt?.approval_extension_state !== APPROVAL_EXTENSION_STATE) errors.push("APPROVAL_EXTENSION_STATE_MISMATCH");
  if (receipt?.sync_2 !== "PASS") errors.push("SYNC_2_MUST_PASS");
  if (receipt?.sync_3 !== "NOT_EVALUATED") errors.push("SYNC_3_PREMATURE");
  if (receipt?.lease_state !== "NOT_IMPLEMENTED_PLAN_D") errors.push("PLAN_D_LEASE_FENCE_VIOLATION");
  if (receipt?.validation_execution_source_write !== 0) errors.push("VALIDATION_SOURCE_WRITE_NONZERO");
  if (receipt?.remote_source_write_authority !== "NONE") errors.push("REMOTE_SOURCE_WRITE_AUTHORITY_NOT_NONE");
  if (receipt?.result !== "PASS") errors.push("CLOSURE_NOT_PASS");
  return { ok: errors.length === 0, errors };
}
