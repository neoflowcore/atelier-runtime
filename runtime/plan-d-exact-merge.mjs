import { createHash } from "node:crypto";
import { validateRuntimeDLease } from "./plan-d-lease.mjs";
import { verifyRuntimeDSchedulerDecision } from "./plan-d-scheduler.mjs";

export const RUNTIME_D_EXACT_MERGE_ENVELOPE_TYPE = "RUNTIME_D_EXACT_MERGE_ENVELOPE_V1";
export const RUNTIME_D_MERGE_METHODS = Object.freeze(["MERGE", "SQUASH", "REBASE"]);
export const RUNTIME_D_MERGE_SAFETY_CLASSES = Object.freeze(["FIXTURE", "SAFE_TARGET"]);

const SHA40_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const REPOSITORY_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const BRANCH_RE = /^(?!\/)(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9._/-]{1,200}$/;

function sha256Json(value) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function validateRequest(request) {
  const errors = [];
  const keys = [
    "repository",
    "pr_number",
    "base_ref",
    "expected_base_head",
    "head_ref",
    "expected_head_sha",
    "merge_method",
    "safety_class"
  ];
  if (!exactKeys(request, keys)) return ["MERGE_REQUEST_FIELDS_MISMATCH"];
  if (!REPOSITORY_RE.test(request.repository ?? "")) errors.push("REPOSITORY_INVALID");
  if (!Number.isInteger(request.pr_number) || request.pr_number < 1) errors.push("PR_NUMBER_INVALID");
  if (!BRANCH_RE.test(request.base_ref ?? "")) errors.push("BASE_REF_INVALID");
  if (!SHA40_RE.test(request.expected_base_head ?? "")) errors.push("EXPECTED_BASE_HEAD_INVALID");
  if (!BRANCH_RE.test(request.head_ref ?? "")) errors.push("HEAD_REF_INVALID");
  if (!SHA40_RE.test(request.expected_head_sha ?? "")) errors.push("EXPECTED_HEAD_SHA_INVALID");
  if (!RUNTIME_D_MERGE_METHODS.includes(request.merge_method)) errors.push("MERGE_METHOD_INVALID");
  if (!RUNTIME_D_MERGE_SAFETY_CLASSES.includes(request.safety_class)) errors.push("PRODUCTION_MERGE_NOT_ACTIVATED_THROUGH_REV5");
  if (request.base_ref === request.head_ref) errors.push("HEAD_REF_EQUALS_BASE_REF");
  return errors;
}

function validateReadback(readback, request) {
  const errors = [];
  const keys = ["repository", "pr_number", "state", "base_ref", "base_head", "head_ref", "head_sha", "draft"];
  if (!exactKeys(readback, keys)) return ["PROVIDER_READBACK_FIELDS_MISMATCH"];
  if (readback.repository !== request.repository) errors.push("READBACK_REPOSITORY_MISMATCH");
  if (readback.pr_number !== request.pr_number) errors.push("READBACK_PR_NUMBER_MISMATCH");
  if (readback.state !== "OPEN") errors.push("READBACK_PR_NOT_OPEN");
  if (readback.base_ref !== request.base_ref) errors.push("READBACK_BASE_REF_MISMATCH");
  if (readback.base_head !== request.expected_base_head) errors.push("READBACK_BASE_HEAD_MISMATCH");
  if (readback.head_ref !== request.head_ref) errors.push("READBACK_HEAD_REF_MISMATCH");
  if (readback.head_sha !== request.expected_head_sha) errors.push("READBACK_HEAD_SHA_MISMATCH");
  if (typeof readback.draft !== "boolean") errors.push("READBACK_DRAFT_INVALID");
  return errors;
}

function validateCoordination(lease, decision, taskContractHash, request) {
  const errors = [];
  const leaseValidation = validateRuntimeDLease(lease);
  errors.push(...leaseValidation.errors.map((error) => `LEASE:${error}`));
  const decisionValidation = verifyRuntimeDSchedulerDecision(decision);
  errors.push(...decisionValidation.errors.map((error) => `SCHEDULER:${error}`));
  if (lease?.state !== "ACTIVE") errors.push("LEASE_NOT_ACTIVE");
  if (lease?.mode !== "WRITE_EXCLUSIVE") errors.push("WRITE_EXCLUSIVE_LEASE_REQUIRED");
  if (decision?.operation_class !== "CANDIDATE_WRITE") errors.push("CANDIDATE_WRITE_DECISION_REQUIRED");
  if (decision?.lease_id !== lease?.lease_id) errors.push("LEASE_DECISION_BINDING_MISMATCH");
  if (lease?.task_contract_hash !== taskContractHash || decision?.task_contract_hash !== taskContractHash) errors.push("TASK_CONTRACT_HASH_BINDING_MISMATCH");
  if (lease?.repository !== request.repository || decision?.repository !== request.repository) errors.push("REPOSITORY_BINDING_MISMATCH");
  if (lease?.branch !== request.head_ref || decision?.branch !== request.head_ref) errors.push("HEAD_REF_LEASE_SCOPE_MISMATCH");
  if (decision?.source_write_authority !== "NONE_FROM_SCHEDULER") errors.push("SCHEDULER_SOURCE_WRITE_AUTHORITY_FORBIDDEN");
  if (decision?.merge_authority !== "NONE") errors.push("SCHEDULER_MERGE_AUTHORITY_FORBIDDEN");
  return errors;
}

export function buildRuntimeDExactMergeEnvelope({
  task_contract_hash,
  lease,
  scheduler_decision,
  approval_evidence_sha256,
  provider_readback,
  request
}) {
  const errors = [];
  if (!SHA256_RE.test(task_contract_hash ?? "")) errors.push("TASK_CONTRACT_HASH_INVALID");
  if (!SHA256_RE.test(approval_evidence_sha256 ?? "")) errors.push("APPROVAL_EVIDENCE_SHA256_INVALID");
  errors.push(...validateRequest(request));
  if (errors.length === 0) {
    errors.push(...validateReadback(provider_readback, request));
    errors.push(...validateCoordination(lease, scheduler_decision, task_contract_hash, request));
  }
  if (errors.length > 0) return { ok: false, result: "BLOCKED", errors, envelope: null };

  const payload = {
    envelope_type: RUNTIME_D_EXACT_MERGE_ENVELOPE_TYPE,
    task_contract_hash,
    approval_evidence_sha256,
    lease_id: lease.lease_id,
    scheduler_decision_sha256: scheduler_decision.decision_sha256,
    repository: request.repository,
    pr_number: request.pr_number,
    base_ref: request.base_ref,
    expected_base_head: request.expected_base_head,
    head_ref: request.head_ref,
    expected_head_sha: request.expected_head_sha,
    merge_method: request.merge_method,
    safety_class: request.safety_class,
    provider_readback_sha256: sha256Json(provider_readback),
    exact_subject_bound: true,
    provider_merge_mutation_authority: "NONE_THROUGH_REV5",
    pilote_merge_authority: "NONE",
    runtime_production_merge_authority: "NONE",
    final_merge_authority: "HUMAN_ONLY",
    production_activation: "DEFERRED_THROUGH_REV5",
    result: "PREPARED_DEFERRED"
  };
  return {
    ok: true,
    result: "PREPARED_DEFERRED",
    errors: [],
    envelope: { ...payload, envelope_sha256: sha256Json(payload) }
  };
}

export function verifyRuntimeDExactMergeEnvelope(envelope) {
  const errors = [];
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) return { ok: false, errors: ["MERGE_ENVELOPE_MISSING"] };
  const { envelope_sha256, ...payload } = envelope;
  if (!SHA256_RE.test(envelope_sha256 ?? "")) errors.push("MERGE_ENVELOPE_SHA256_INVALID");
  else if (sha256Json(payload) !== envelope_sha256) errors.push("MERGE_ENVELOPE_SHA256_MISMATCH");
  if (envelope.envelope_type !== RUNTIME_D_EXACT_MERGE_ENVELOPE_TYPE) errors.push("MERGE_ENVELOPE_TYPE_MISMATCH");
  if (envelope.exact_subject_bound !== true) errors.push("EXACT_SUBJECT_BINDING_REQUIRED");
  if (envelope.provider_merge_mutation_authority !== "NONE_THROUGH_REV5") errors.push("PROVIDER_MERGE_AUTHORITY_FORBIDDEN");
  if (envelope.pilote_merge_authority !== "NONE") errors.push("PILOTE_MERGE_AUTHORITY_FORBIDDEN");
  if (envelope.runtime_production_merge_authority !== "NONE") errors.push("RUNTIME_PRODUCTION_MERGE_AUTHORITY_FORBIDDEN");
  if (envelope.final_merge_authority !== "HUMAN_ONLY") errors.push("FINAL_MERGE_MUST_BE_HUMAN_ONLY");
  if (envelope.production_activation !== "DEFERRED_THROUGH_REV5") errors.push("PRODUCTION_ACTIVATION_FORBIDDEN");
  if (envelope.result !== "PREPARED_DEFERRED") errors.push("MERGE_RESULT_MUST_REMAIN_DEFERRED");
  return { ok: errors.length === 0, errors };
}

export function evaluateRuntimeDMechanicalMergeActivation(envelope) {
  const checked = verifyRuntimeDExactMergeEnvelope(envelope);
  if (!checked.ok) return { ok: false, result: "BLOCKED", errors: checked.errors, provider_mutation_allowed: false };
  return {
    ok: true,
    result: "DEFERRED_THROUGH_REV5",
    errors: [],
    provider_mutation_allowed: false,
    final_merge_authority: "HUMAN_ONLY"
  };
}
