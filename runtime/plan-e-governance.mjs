import { createHash } from "node:crypto";

export const RUNTIME_E_GOVERNANCE_REQUEST_TYPE = "RUNTIME_E_GOVERNANCE_REQUEST_V1";
export const RUNTIME_E_GOVERNANCE_DECISION_TYPE = "RUNTIME_E_GOVERNANCE_DECISION_V1";
export const RUNTIME_E_AUDIT_EVENT_TYPE = "RUNTIME_E_AUDIT_EVENT_V1";
export const RUNTIME_E_ADMIN_OPERATIONS = Object.freeze([
  "READ_PROVIDER_POLICY",
  "APPLY_RULESET",
  "APPLY_BRANCH_PROTECTION"
]);

const SHA256_RE = /^[0-9a-f]{64}$/;
const SHA40_RE = /^[0-9a-f]{40}$/;
const REPOSITORY_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const REF_RE = /^(refs\/heads\/)?(?!\/)(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9._/-]{1,200}$/;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

function sha256Json(value) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

export function validateRuntimeEGovernanceRequest(request) {
  const keys = [
    "request_id",
    "repository",
    "target_ref",
    "expected_head",
    "operation",
    "desired_policy_sha256",
    "authority_evidence_sha256",
    "caller_id",
    "change_ticket_id",
    "readback_required"
  ];
  if (!exactKeys(request, keys)) return { ok: false, errors: ["GOVERNANCE_REQUEST_FIELDS_MISMATCH"] };
  const errors = [];
  if (!ID_RE.test(request.request_id ?? "")) errors.push("REQUEST_ID_INVALID");
  if (!REPOSITORY_RE.test(request.repository ?? "")) errors.push("REPOSITORY_INVALID");
  if (!REF_RE.test(request.target_ref ?? "")) errors.push("TARGET_REF_INVALID");
  if (!SHA40_RE.test(request.expected_head ?? "")) errors.push("EXPECTED_HEAD_INVALID");
  if (!RUNTIME_E_ADMIN_OPERATIONS.includes(request.operation)) errors.push("ADMIN_OPERATION_INVALID");
  if (!SHA256_RE.test(request.desired_policy_sha256 ?? "")) errors.push("DESIRED_POLICY_SHA256_INVALID");
  if (!SHA256_RE.test(request.authority_evidence_sha256 ?? "")) errors.push("AUTHORITY_EVIDENCE_SHA256_INVALID");
  if (!ID_RE.test(request.caller_id ?? "")) errors.push("CALLER_ID_INVALID");
  if (!ID_RE.test(request.change_ticket_id ?? "")) errors.push("CHANGE_TICKET_ID_INVALID");
  if (request.readback_required !== true) errors.push("PROVIDER_READBACK_REQUIRED");
  return { ok: errors.length === 0, errors };
}

export function compileRuntimeEGovernanceDecision(request, runtimeDSealReceipt) {
  const validation = validateRuntimeEGovernanceRequest(request);
  const errors = [...validation.errors];
  if (runtimeDSealReceipt?.receipt_type !== "RUNTIME_D_FINAL_SEAL_RECEIPT_V1") errors.push("RUNTIME_D_SEAL_TYPE_MISMATCH");
  if (runtimeDSealReceipt?.runtime_d_sealed !== "YES" || runtimeDSealReceipt?.result !== "PASS") errors.push("RUNTIME_D_NOT_SEALED");

  const isMutation = request?.operation !== "READ_PROVIDER_POLICY";
  const payload = {
    decision_type: RUNTIME_E_GOVERNANCE_DECISION_TYPE,
    request_sha256: sha256Json(request ?? null),
    runtime_d_seal_sha256: sha256Json(runtimeDSealReceipt ?? null),
    repository: request?.repository ?? null,
    target_ref: request?.target_ref ?? null,
    expected_head: request?.expected_head ?? null,
    operation: request?.operation ?? null,
    authority_evidence_sha256: request?.authority_evidence_sha256 ?? null,
    provider_admin_mutation: isMutation,
    exact_external_authority_required: isMutation,
    provider_readback_required: true,
    source_tree_write_authority: "NONE_FROM_E1",
    production_promotion_authority: "NONE_IN_E1",
    production_rollback_authority: "NONE_IN_E1",
    production_merge_authority: "NONE_THROUGH_REV5",
    final_merge_authority: "HUMAN_ONLY",
    force_push: false,
    result: errors.length === 0 ? "PREPARED" : "BLOCKED",
    reasons: errors
  };
  return { ...payload, decision_sha256: sha256Json(payload) };
}

export function verifyRuntimeEGovernanceDecision(decision) {
  const errors = [];
  if (!decision || typeof decision !== "object" || Array.isArray(decision)) return { ok: false, errors: ["DECISION_MISSING"] };
  const { decision_sha256, ...payload } = decision;
  if (!SHA256_RE.test(decision_sha256 ?? "")) errors.push("DECISION_SHA256_INVALID");
  else if (sha256Json(payload) !== decision_sha256) errors.push("DECISION_SHA256_MISMATCH");
  if (decision.decision_type !== RUNTIME_E_GOVERNANCE_DECISION_TYPE) errors.push("DECISION_TYPE_MISMATCH");
  if (decision.source_tree_write_authority !== "NONE_FROM_E1") errors.push("SOURCE_TREE_WRITE_AUTHORITY_FORBIDDEN");
  if (decision.production_promotion_authority !== "NONE_IN_E1") errors.push("PRODUCTION_PROMOTION_AUTHORITY_FORBIDDEN");
  if (decision.production_rollback_authority !== "NONE_IN_E1") errors.push("PRODUCTION_ROLLBACK_AUTHORITY_FORBIDDEN");
  if (decision.production_merge_authority !== "NONE_THROUGH_REV5") errors.push("PRODUCTION_MERGE_AUTHORITY_FORBIDDEN");
  if (decision.final_merge_authority !== "HUMAN_ONLY") errors.push("FINAL_MERGE_MUST_BE_HUMAN_ONLY");
  if (decision.force_push !== false) errors.push("FORCE_PUSH_FORBIDDEN");
  return { ok: errors.length === 0, errors };
}

export function appendRuntimeEAuditEvent(previousEvent, input) {
  const keys = ["event_id","request_sha256","decision_sha256","provider_readback_sha256","actor_id","event_class","timestamp_ms"];
  if (!exactKeys(input, keys)) throw new Error("AUDIT_INPUT_FIELDS_MISMATCH");
  for (const field of ["request_sha256","decision_sha256","provider_readback_sha256"]) {
    if (!SHA256_RE.test(input[field] ?? "")) throw new Error(`${field.toUpperCase()}_INVALID`);
  }
  if (!ID_RE.test(input.event_id ?? "") || !ID_RE.test(input.actor_id ?? "")) throw new Error("AUDIT_ID_INVALID");
  if (!new Set(["PROVIDER_POLICY_READ","PROVIDER_ADMIN_PREPARE","PROVIDER_ADMIN_READBACK","SECURITY_POLICY_DECISION"]).has(input.event_class)) throw new Error("AUDIT_EVENT_CLASS_INVALID");
  if (!Number.isSafeInteger(input.timestamp_ms) || input.timestamp_ms < 0) throw new Error("AUDIT_TIMESTAMP_INVALID");
  const previous_sha256 = previousEvent?.event_sha256 ?? null;
  if (previousEvent && !SHA256_RE.test(previous_sha256)) throw new Error("PREVIOUS_EVENT_SHA256_INVALID");
  const payload = {
    event_type: RUNTIME_E_AUDIT_EVENT_TYPE,
    previous_event_sha256: previous_sha256,
    ...input,
    secret_material_present: false
  };
  return { ...payload, event_sha256: sha256Json(payload) };
}
