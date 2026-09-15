import { createHash } from "node:crypto";

export const SYNC4_INPUT_TYPE = "SYNC4_PILOTE_REV5_FINAL_GATE_V1";
export const EXPECTED_INTERFACE_VERSION = "1.0.0";
export const EXPECTED_INTERFACE_MANIFEST_SHA256 =
  "90b016211babd4f10b7de7700c54ea6e2db9179563d88502fc1d9983ad47b617";
export const EXPECTED_TASK_CONTRACT_SCHEMA_SHA256 =
  "6afcf7aa1b7d3d73b28d6195326db22c82774de308664ce85ba52e42fba640e8";
export const EXPECTED_TASK_CONTRACT_MACHINE_SCHEMA_SHA256 =
  "3bdbb85a7879c8cee2c7eb2f18c3936fac7a44389ec0ae61f0954b9c19660b65";

const SHA256 = /^[0-9a-f]{64}$/;
const SHA40 = /^[0-9a-f]{40}$/;

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

export function validateSync4FinalGateInput(input, runtimeIdentity) {
  const errors = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, errors: ["INPUT_MISSING"] };
  }
  if (input.input_type !== SYNC4_INPUT_TYPE) errors.push("INPUT_TYPE_MISMATCH");
  if (input.pilote_rev5_status !== "SEALED") errors.push("PILOTE_REV5_NOT_SEALED");
  for (const key of [
    "pilote_rev5_identity_sha256",
    "pilote_rev5_package_sha256",
    "promotion_acceptance_evidence_sha256",
    "rollback_acceptance_evidence_sha256",
    "bundle_evidence_sha256"
  ]) {
    if (!SHA256.test(input[key] ?? "")) errors.push(`INVALID_SHA256:${key}`);
  }
  if (input.interface_version !== EXPECTED_INTERFACE_VERSION) errors.push("INTERFACE_VERSION_MISMATCH");
  if (input.interface_manifest_sha256 !== EXPECTED_INTERFACE_MANIFEST_SHA256) {
    errors.push("INTERFACE_MANIFEST_MISMATCH");
  }
  if (input.task_contract_schema_sha256 !== EXPECTED_TASK_CONTRACT_SCHEMA_SHA256) {
    errors.push("TASK_CONTRACT_SCHEMA_MISMATCH");
  }
  if (input.task_contract_machine_schema_sha256 !== EXPECTED_TASK_CONTRACT_MACHINE_SCHEMA_SHA256) {
    errors.push("TASK_CONTRACT_MACHINE_SCHEMA_MISMATCH");
  }
  if (input.frozen_27_fields_mutation !== 0) errors.push("FROZEN_27_FIELDS_MUTATED");
  if (input.pilote_semantic_reimplementation !== 0) errors.push("PILOTE_SEMANTIC_REIMPLEMENTATION_NONZERO");
  if (input.runtime_semantic_reimplementation !== 0) errors.push("RUNTIME_SEMANTIC_REIMPLEMENTATION_NONZERO");
  if (!SHA40.test(input.runtime_e_head ?? "")) errors.push("RUNTIME_E_HEAD_INVALID");
  if (!SHA40.test(input.runtime_e_tree ?? "")) errors.push("RUNTIME_E_TREE_INVALID");
  if (input.runtime_e_head !== runtimeIdentity?.head) errors.push("RUNTIME_E_HEAD_MISMATCH");
  if (input.runtime_e_tree !== runtimeIdentity?.tree) errors.push("RUNTIME_E_TREE_MISMATCH");
  if (input.cross_stack_result !== "PASS") errors.push("CROSS_STACK_RESULT_NOT_PASS");
  if (input.cross_stack_contradiction_count !== 0) errors.push("CROSS_STACK_CONTRADICTIONS_NONZERO");
  if (input.runtime_production_merge_authority !== "NONE") errors.push("RUNTIME_MERGE_AUTHORITY_ESCALATED");
  if (input.final_merge_authority !== "HUMAN_ONLY") errors.push("FINAL_MERGE_AUTHORITY_MISMATCH");
  return { ok: errors.length === 0, errors };
}

export function compileRuntimeEFinalSealCandidate(input, runtimeIdentity) {
  const validation = validateSync4FinalGateInput(input, runtimeIdentity);
  const payload = {
    receipt_type: "RUNTIME_E_FINAL_SEAL_CANDIDATE_V1",
    runtime_e_head: runtimeIdentity?.head ?? null,
    runtime_e_tree: runtimeIdentity?.tree ?? null,
    pilote_rev5_identity_sha256: input?.pilote_rev5_identity_sha256 ?? null,
    pilote_rev5_package_sha256: input?.pilote_rev5_package_sha256 ?? null,
    bundle_evidence_sha256: input?.bundle_evidence_sha256 ?? null,
    promotion_acceptance_evidence_sha256: input?.promotion_acceptance_evidence_sha256 ?? null,
    rollback_acceptance_evidence_sha256: input?.rollback_acceptance_evidence_sha256 ?? null,
    interface_v1_mutation: 0,
    frozen_27_fields_mutation: 0,
    pilote_semantic_reimplementation: 0,
    runtime_semantic_reimplementation: 0,
    source_write_authority: "NONE_FROM_FINAL_GATE_RECEIVER",
    merge_authority: "NONE",
    final_merge_authority: "HUMAN_ONLY",
    runtime_e_seal_candidate: validation.ok ? "ELIGIBLE" : "BLOCKED",
    reasons: validation.errors
  };
  return { ...payload, receipt_sha256: digest(payload) };
}
