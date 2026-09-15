import { createHash } from "node:crypto";

export const RUNTIME_E_RELEASE_REQUEST_TYPE = "RUNTIME_E_RELEASE_REQUEST_V1";
export const RUNTIME_E_RELEASE_DECISION_TYPE = "RUNTIME_E_RELEASE_DECISION_V1";
export const RUNTIME_E_RELEASE_OPERATIONS = Object.freeze(["PROMOTE", "ROLLBACK"]);

const SHA256_RE = /^[0-9a-f]{64}$/;
const SHA40_RE = /^[0-9a-f]{40}$/;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const TAG_RE = /^(?!-)[A-Za-z0-9._-]{1,128}$/;
const ENV_RE = /^[A-Z][A-Z0-9_]{1,63}$/;

function sha256Json(value) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

export function validateRuntimeEReleaseRequest(request) {
  const keys = [
    "request_type","request_id","operation","environment","candidate_tag","candidate_commit",
    "artifact_sha256","expected_current_release_sha256","desired_release_sha256",
    "governance_decision_sha256","security_decision_sha256","authority_evidence_sha256",
    "change_ticket_id","readback_required"
  ];
  if (!exactKeys(request, keys)) return { ok: false, errors: ["RELEASE_REQUEST_FIELDS_MISMATCH"] };
  const errors = [];
  if (request.request_type !== RUNTIME_E_RELEASE_REQUEST_TYPE) errors.push("RELEASE_REQUEST_TYPE_MISMATCH");
  if (!ID_RE.test(request.request_id ?? "")) errors.push("REQUEST_ID_INVALID");
  if (!RUNTIME_E_RELEASE_OPERATIONS.includes(request.operation)) errors.push("RELEASE_OPERATION_INVALID");
  if (!ENV_RE.test(request.environment ?? "")) errors.push("ENVIRONMENT_INVALID");
  if (!TAG_RE.test(request.candidate_tag ?? "")) errors.push("CANDIDATE_TAG_INVALID");
  if (!SHA40_RE.test(request.candidate_commit ?? "")) errors.push("CANDIDATE_COMMIT_INVALID");
  for (const field of ["artifact_sha256","expected_current_release_sha256","desired_release_sha256","governance_decision_sha256","security_decision_sha256","authority_evidence_sha256"]) {
    if (!SHA256_RE.test(request[field] ?? "")) errors.push(`${field.toUpperCase()}_INVALID`);
  }
  if (!ID_RE.test(request.change_ticket_id ?? "")) errors.push("CHANGE_TICKET_ID_INVALID");
  if (request.readback_required !== true) errors.push("PROVIDER_READBACK_REQUIRED");
  if (request.operation === "PROMOTE" && request.expected_current_release_sha256 === request.desired_release_sha256) errors.push("PROMOTION_MUST_CHANGE_RELEASE");
  if (request.operation === "ROLLBACK" && request.expected_current_release_sha256 === request.desired_release_sha256) errors.push("ROLLBACK_TARGET_MUST_DIFFER");
  return { ok: errors.length === 0, errors };
}

export function compileRuntimeEReleaseDecision(request, runtimeE1ReadbackReceipt) {
  const errors = [...validateRuntimeEReleaseRequest(request).errors];
  if (runtimeE1ReadbackReceipt?.receipt_type !== "RUNTIME_E1_REMOTE_READBACK_RECEIPT_V1" || runtimeE1ReadbackReceipt?.result !== "PASS") {
    errors.push("RUNTIME_E1_REMOTE_READBACK_REQUIRED");
  }
  const payload = {
    decision_type: RUNTIME_E_RELEASE_DECISION_TYPE,
    request_sha256: sha256Json(request ?? null),
    runtime_e1_readback_sha256: sha256Json(runtimeE1ReadbackReceipt ?? null),
    operation: request?.operation ?? null,
    environment: request?.environment ?? null,
    candidate_tag: request?.candidate_tag ?? null,
    candidate_commit: request?.candidate_commit ?? null,
    artifact_sha256: request?.artifact_sha256 ?? null,
    expected_current_release_sha256: request?.expected_current_release_sha256 ?? null,
    desired_release_sha256: request?.desired_release_sha256 ?? null,
    governance_decision_sha256: request?.governance_decision_sha256 ?? null,
    security_decision_sha256: request?.security_decision_sha256 ?? null,
    authority_evidence_sha256: request?.authority_evidence_sha256 ?? null,
    exact_external_authority_required: true,
    provider_readback_required: true,
    source_tree_write_authority: "NONE_FROM_E2",
    merge_authority: "NONE",
    final_merge_authority: "HUMAN_ONLY",
    live_provider_mutation_authority: "NONE_UNTIL_RUNTIME_E_FINAL_SEAL",
    activation_state: "PRE_FINAL_MECHANICS_ONLY",
    result: errors.length === 0 ? "PREPARED" : "BLOCKED",
    reasons: errors
  };
  return { ...payload, decision_sha256: sha256Json(payload) };
}

export function verifyRuntimeEReleaseDecision(decision) {
  const errors = [];
  if (!decision || typeof decision !== "object" || Array.isArray(decision)) return { ok: false, errors: ["RELEASE_DECISION_MISSING"] };
  const { decision_sha256, ...payload } = decision;
  if (!SHA256_RE.test(decision_sha256 ?? "")) errors.push("DECISION_SHA256_INVALID");
  else if (sha256Json(payload) !== decision_sha256) errors.push("DECISION_SHA256_MISMATCH");
  if (decision.decision_type !== RUNTIME_E_RELEASE_DECISION_TYPE) errors.push("DECISION_TYPE_MISMATCH");
  if (decision.source_tree_write_authority !== "NONE_FROM_E2") errors.push("SOURCE_TREE_WRITE_AUTHORITY_FORBIDDEN");
  if (decision.merge_authority !== "NONE") errors.push("MERGE_AUTHORITY_FORBIDDEN");
  if (decision.final_merge_authority !== "HUMAN_ONLY") errors.push("FINAL_MERGE_MUST_BE_HUMAN_ONLY");
  if (decision.live_provider_mutation_authority !== "NONE_UNTIL_RUNTIME_E_FINAL_SEAL") errors.push("PREMATURE_PROVIDER_MUTATION_AUTHORITY");
  return { ok: errors.length === 0, errors };
}
