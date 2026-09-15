import { createHash } from "node:crypto";
import { validateRuntimeCTaskDag } from "./plan-c-dag.mjs";

export const RUNTIME_C_MUTATION_ENVELOPE_TYPE = "RUNTIME_C_SOURCE_WRITE_GATEWAY_ENVELOPE_V1";
export const RUNTIME_C_ALLOWED_MUTATIONS = Object.freeze(["CANDIDATE_BRANCH_PUSH", "DRAFT_PR_CREATE"]);

const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const BRANCH = /^(?!\/)(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9._/-]{1,200}$/;
const PROTECTED_DIRECT_WRITE_REFS = new Set(["main", "master"]);

function sha256Json(value) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function allowedRepo(taskContract, repository) {
  return Array.isArray(taskContract?.ALLOWED_SCOPE) && taskContract.ALLOWED_SCOPE.includes(`repo:${repository}`);
}

function validateCommon(taskContract, devPlaneReceipt, dagReceipt, authorityEvidenceSha256, operation) {
  const errors = [];
  if (!taskContract || devPlaneReceipt?.task_contract_hash !== taskContract.TASK_CONTRACT_HASH) errors.push("TASK_CONTRACT_BINDING_MISMATCH");
  if (devPlaneReceipt?.result !== "ELIGIBLE") errors.push("DEV_PLANE_NOT_ELIGIBLE");
  if (devPlaneReceipt?.remote_source_write_authority !== "GATEWAY_ONLY") errors.push("GATEWAY_ONLY_AUTHORITY_REQUIRED");
  const dag = validateRuntimeCTaskDag(dagReceipt);
  errors.push(...dag.errors.map((error) => `DAG:${error}`));
  if (dagReceipt?.task_contract_hash !== taskContract?.TASK_CONTRACT_HASH) errors.push("DAG_TASK_CONTRACT_HASH_MISMATCH");
  if (!SHA256.test(authorityEvidenceSha256 ?? "")) errors.push("AUTHORITY_EVIDENCE_SHA256_INVALID");
  if (!RUNTIME_C_ALLOWED_MUTATIONS.includes(operation)) errors.push("MUTATION_OPERATION_NOT_ALLOWED");
  if (taskContract?.REMOTE_MUTATION_INTENT !== "EXACT_APPROVAL_REQUIRED") errors.push("EXACT_APPROVAL_REQUIRED");
  return errors;
}

function validatePushTarget(taskContract, target, errors) {
  const keys = ["repository", "base_ref", "candidate_ref", "expected_base_head", "candidate_commit_sha", "force"];
  if (!target || JSON.stringify(Object.keys(target).sort()) !== JSON.stringify(keys.sort())) {
    errors.push("PUSH_TARGET_FIELDS_MISMATCH");
    return;
  }
  if (!REPOSITORY.test(target.repository)) errors.push("REPOSITORY_INVALID");
  if (!allowedRepo(taskContract, target.repository)) errors.push("REPOSITORY_OUTSIDE_ALLOWED_SCOPE");
  if (!BRANCH.test(target.base_ref) || !BRANCH.test(target.candidate_ref)) errors.push("BRANCH_INVALID");
  if (PROTECTED_DIRECT_WRITE_REFS.has(target.candidate_ref)) errors.push("PROTECTED_DIRECT_WRITE_DENY");
  if (target.candidate_ref === target.base_ref) errors.push("CANDIDATE_REF_EQUALS_BASE_REF");
  if (target.expected_base_head !== taskContract.EXPECTED_HEAD) errors.push("EXPECTED_BASE_HEAD_MISMATCH");
  if (!SHA40.test(target.candidate_commit_sha ?? "")) errors.push("CANDIDATE_COMMIT_SHA_INVALID");
  if (target.force !== false) errors.push("FORCE_PUSH_DENY");
}

function validateDraftPrTarget(taskContract, target, errors) {
  const keys = ["repository", "base_ref", "head_ref", "head_sha", "draft"];
  if (!target || JSON.stringify(Object.keys(target).sort()) !== JSON.stringify(keys.sort())) {
    errors.push("DRAFT_PR_TARGET_FIELDS_MISMATCH");
    return;
  }
  if (!REPOSITORY.test(target.repository)) errors.push("REPOSITORY_INVALID");
  if (!allowedRepo(taskContract, target.repository)) errors.push("REPOSITORY_OUTSIDE_ALLOWED_SCOPE");
  if (!BRANCH.test(target.base_ref) || !BRANCH.test(target.head_ref)) errors.push("BRANCH_INVALID");
  if (target.head_ref === target.base_ref) errors.push("HEAD_REF_EQUALS_BASE_REF");
  if (!SHA40.test(target.head_sha ?? "")) errors.push("HEAD_SHA_INVALID");
  if (target.draft !== true) errors.push("DRAFT_PR_REQUIRED");
}

export function buildRuntimeCMutationEnvelope({ task_contract, dev_plane_receipt, dag_receipt, authority_evidence_sha256, operation, target }) {
  const errors = validateCommon(task_contract, dev_plane_receipt, dag_receipt, authority_evidence_sha256, operation);
  if (operation === "CANDIDATE_BRANCH_PUSH") validatePushTarget(task_contract, target, errors);
  if (operation === "DRAFT_PR_CREATE") validateDraftPrTarget(task_contract, target, errors);
  if (errors.length > 0) return { ok: false, result: "BLOCKED", errors, envelope: null };

  const payload = {
    envelope_type: RUNTIME_C_MUTATION_ENVELOPE_TYPE,
    operation,
    task_contract_hash: task_contract.TASK_CONTRACT_HASH,
    expected_head: task_contract.EXPECTED_HEAD,
    touch_set_sha256: dev_plane_receipt.touch_set_sha256,
    workspace_identity_sha256: dev_plane_receipt.workspace_identity_sha256,
    dag_sha256: dag_receipt.dag_sha256,
    authority_evidence_sha256,
    repository: target.repository,
    target,
    source_write_authority: "GATEWAY_ONLY",
    candidate_push_only: operation === "CANDIDATE_BRANCH_PUSH",
    draft_pr_only: operation === "DRAFT_PR_CREATE",
    merge_authority: "NONE",
    final_merge_authority: "HUMAN_ONLY",
    force_push: false,
    lease_state: "NOT_IMPLEMENTED_PLAN_D"
  };
  return {
    ok: true,
    result: "BOUND",
    errors: [],
    envelope: { ...payload, envelope_sha256: sha256Json(payload) }
  };
}

export function verifyRuntimeCMutationEnvelope(envelope) {
  const errors = [];
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) return { ok: false, errors: ["ENVELOPE_MISSING"] };
  if (envelope.envelope_type !== RUNTIME_C_MUTATION_ENVELOPE_TYPE) errors.push("ENVELOPE_TYPE_MISMATCH");
  if (!RUNTIME_C_ALLOWED_MUTATIONS.includes(envelope.operation)) errors.push("MUTATION_OPERATION_NOT_ALLOWED");
  if (envelope.source_write_authority !== "GATEWAY_ONLY") errors.push("SOURCE_WRITE_NOT_GATEWAY_ONLY");
  if (envelope.merge_authority !== "NONE") errors.push("MERGE_AUTHORITY_FORBIDDEN");
  if (envelope.final_merge_authority !== "HUMAN_ONLY") errors.push("FINAL_MERGE_MUST_BE_HUMAN_ONLY");
  if (envelope.force_push !== false) errors.push("FORCE_PUSH_DENY");
  if (envelope.lease_state !== "NOT_IMPLEMENTED_PLAN_D") errors.push("PLAN_D_LEASE_FENCE_VIOLATION");
  const { envelope_sha256, ...payload } = envelope;
  if (sha256Json(payload) !== envelope_sha256) errors.push("ENVELOPE_DIGEST_MISMATCH");
  return { ok: errors.length === 0, errors };
}
