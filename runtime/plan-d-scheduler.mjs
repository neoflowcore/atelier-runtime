import { createHash } from "node:crypto";
import { deriveRuntimeDLeaseScope, validateRuntimeDLease } from "./plan-d-lease.mjs";

export const RUNTIME_D_SCHEDULER_DECISION_TYPE = "RUNTIME_D_SCHEDULER_DECISION_V1";
export const RUNTIME_D_OPERATION_CLASSES = Object.freeze(["READ_ONLY", "CANDIDATE_WRITE"]);

const SHA256_RE = /^[0-9a-f]{64}$/;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const REPOSITORY_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const BRANCH_RE = /^(?!\/)(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9._/-]{1,200}$/;

function sha256Json(value) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function validateId(errors, field, value) {
  if (typeof value !== "string" || !ID_RE.test(value)) errors.push(`${field}:INVALID`);
}

export function validateRuntimeDScheduleRequest(request) {
  const errors = [];
  const keys = [
    "caller_id",
    "task_contract_hash",
    "approval_id",
    "dispatch_nonce",
    "execution_id",
    "generation",
    "repository",
    "branch",
    "workspace_id",
    "operation_class",
    "max_parallelism",
    "now_ms"
  ];
  if (!exactKeys(request, keys)) return { ok: false, errors: ["SCHEDULE_REQUEST_FIELDS_MISMATCH"] };
  for (const field of ["caller_id", "approval_id", "dispatch_nonce", "execution_id", "workspace_id"]) validateId(errors, field.toUpperCase(), request[field]);
  if (!SHA256_RE.test(request.task_contract_hash ?? "")) errors.push("TASK_CONTRACT_HASH_INVALID");
  if (!Number.isInteger(request.generation) || request.generation < 1) errors.push("GENERATION_INVALID");
  if (!REPOSITORY_RE.test(request.repository ?? "")) errors.push("REPOSITORY_INVALID");
  if (!BRANCH_RE.test(request.branch ?? "")) errors.push("BRANCH_INVALID");
  if (!RUNTIME_D_OPERATION_CLASSES.includes(request.operation_class)) errors.push("OPERATION_CLASS_INVALID");
  if (!Number.isInteger(request.max_parallelism) || request.max_parallelism < 1 || request.max_parallelism > 1024) errors.push("MAX_PARALLELISM_INVALID");
  if (!Number.isSafeInteger(request.now_ms) || request.now_ms < 0) errors.push("NOW_MS_INVALID");
  return { ok: errors.length === 0, errors };
}

export function deriveRuntimeDIdempotencyKey(request) {
  const validation = validateRuntimeDScheduleRequest(request);
  if (!validation.ok) throw new Error(`SCHEDULE_REQUEST_INVALID:${validation.errors.join(",")}`);
  return sha256Json({
    caller_id: request.caller_id,
    task_contract_hash: request.task_contract_hash,
    approval_id: request.approval_id,
    dispatch_nonce: request.dispatch_nonce,
    execution_id: request.execution_id,
    generation: request.generation,
    repository: request.repository,
    branch: request.branch,
    workspace_id: request.workspace_id,
    operation_class: request.operation_class
  });
}

function leaseMatchesRequest(lease, request) {
  const validation = validateRuntimeDLease(lease);
  if (!validation.ok || lease.state !== "ACTIVE" || lease.expires_at_ms <= request.now_ms) return false;
  const expectedMode = request.operation_class === "CANDIDATE_WRITE" ? "WRITE_EXCLUSIVE" : "READ_SHARED";
  return lease.task_contract_hash === request.task_contract_hash &&
    lease.approval_id === request.approval_id &&
    lease.dispatch_nonce === request.dispatch_nonce &&
    lease.execution_id === request.execution_id &&
    lease.generation === request.generation &&
    lease.caller_id === request.caller_id &&
    lease.repository === request.repository &&
    lease.branch === request.branch &&
    lease.workspace_id === request.workspace_id &&
    lease.mode === expectedMode &&
    lease.scope_sha256 === deriveRuntimeDLeaseScope(request);
}

export function evaluateRuntimeDSchedule(history, activeLeases, request) {
  const validation = validateRuntimeDScheduleRequest(request);
  if (!validation.ok) return { ok: false, result: "BLOCKED", errors: validation.errors, decision: null };
  if (!Array.isArray(history)) return { ok: false, result: "BLOCKED", errors: ["HISTORY_NOT_ARRAY"], decision: null };
  if (!Array.isArray(activeLeases)) return { ok: false, result: "BLOCKED", errors: ["LEASE_SET_NOT_ARRAY"], decision: null };

  const idempotencyKey = deriveRuntimeDIdempotencyKey(request);
  const prior = history.find((entry) => entry?.idempotency_key === idempotencyKey && ["SCHEDULED", "COMPLETED"].includes(entry?.result));
  if (prior) {
    const { decision_sha256: _priorSha, ...priorPayload } = prior;
    const replayPayload = {
      ...priorPayload,
      result: "IDEMPOTENT_REUSE",
      new_execution_created: false,
      source_write_authority: "NONE_FROM_SCHEDULER",
      merge_authority: "NONE",
      final_merge_authority: "HUMAN_ONLY"
    };
    return {
      ok: true,
      result: "IDEMPOTENT_REUSE",
      errors: [],
      decision: { ...replayPayload, decision_sha256: sha256Json(replayPayload) }
    };
  }

  const matchingLease = activeLeases.find((lease) => leaseMatchesRequest(lease, request));
  if (!matchingLease) return { ok: false, result: "BLOCKED", errors: ["MATCHING_ACTIVE_LEASE_REQUIRED"], decision: null };

  const activeForCaller = history.filter((entry) => entry?.caller_id === request.caller_id && entry?.result === "SCHEDULED" && entry?.completed !== true).length;
  if (activeForCaller >= request.max_parallelism) return { ok: false, result: "BLOCKED", errors: ["MAX_PARALLELISM_REACHED"], decision: null };

  const scopeSha256 = deriveRuntimeDLeaseScope(request);
  const decisionPayload = {
    decision_type: RUNTIME_D_SCHEDULER_DECISION_TYPE,
    idempotency_key: idempotencyKey,
    caller_id: request.caller_id,
    task_contract_hash: request.task_contract_hash,
    approval_id: request.approval_id,
    dispatch_nonce: request.dispatch_nonce,
    execution_id: request.execution_id,
    generation: request.generation,
    repository: request.repository,
    branch: request.branch,
    workspace_id: request.workspace_id,
    scope_sha256: scopeSha256,
    operation_class: request.operation_class,
    lease_id: matchingLease.lease_id,
    runtime_c_source_write_gateway_required: request.operation_class === "CANDIDATE_WRITE",
    source_write_authority: "NONE_FROM_SCHEDULER",
    merge_authority: "NONE",
    final_merge_authority: "HUMAN_ONLY",
    new_execution_created: true,
    completed: false,
    result: "SCHEDULED"
  };
  return { ok: true, result: "SCHEDULED", errors: [], decision: { ...decisionPayload, decision_sha256: sha256Json(decisionPayload) } };
}

export function verifyRuntimeDSchedulerDecision(decision) {
  const errors = [];
  if (!decision || typeof decision !== "object" || Array.isArray(decision)) return { ok: false, errors: ["DECISION_MISSING"] };
  const { decision_sha256, ...payload } = decision;
  if (!SHA256_RE.test(decision_sha256 ?? "")) errors.push("DECISION_SHA256_INVALID");
  else if (sha256Json(payload) !== decision_sha256) errors.push("DECISION_SHA256_MISMATCH");
  if (decision.decision_type !== RUNTIME_D_SCHEDULER_DECISION_TYPE) errors.push("DECISION_TYPE_MISMATCH");
  if (decision.source_write_authority !== "NONE_FROM_SCHEDULER") errors.push("SCHEDULER_SOURCE_WRITE_AUTHORITY_FORBIDDEN");
  if (decision.merge_authority !== "NONE") errors.push("MERGE_AUTHORITY_FORBIDDEN");
  if (decision.final_merge_authority !== "HUMAN_ONLY") errors.push("FINAL_MERGE_MUST_BE_HUMAN_ONLY");
  return { ok: errors.length === 0, errors };
}
