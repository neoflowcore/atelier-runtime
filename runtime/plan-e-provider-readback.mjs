import { createHash } from "node:crypto";

export const RUNTIME_E_PROVIDER_READBACK_TYPE = "RUNTIME_E_PROVIDER_READBACK_V1";
const SHA256_RE = /^[0-9a-f]{64}$/;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

function sha256Json(value) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}
function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

export function verifyRuntimeEProviderReadback(readback, releaseDecision) {
  const keys = ["readback_type","provider_request_id","release_decision_sha256","observed_environment","observed_release_sha256","observed_artifact_sha256","observed_candidate_tag","provider_state_sha256","status"];
  if (!exactKeys(readback, keys)) return { ok: false, result: "BLOCKED", errors: ["PROVIDER_READBACK_FIELDS_MISMATCH"], evidence: null };
  const errors = [];
  if (readback.readback_type !== RUNTIME_E_PROVIDER_READBACK_TYPE) errors.push("PROVIDER_READBACK_TYPE_MISMATCH");
  if (!ID_RE.test(readback.provider_request_id ?? "")) errors.push("PROVIDER_REQUEST_ID_INVALID");
  for (const field of ["release_decision_sha256","observed_release_sha256","observed_artifact_sha256","provider_state_sha256"]) {
    if (!SHA256_RE.test(readback[field] ?? "")) errors.push(`${field.toUpperCase()}_INVALID`);
  }
  if (readback.release_decision_sha256 !== releaseDecision?.decision_sha256) errors.push("RELEASE_DECISION_BINDING_MISMATCH");
  if (readback.observed_environment !== releaseDecision?.environment) errors.push("ENVIRONMENT_READBACK_MISMATCH");
  if (readback.observed_release_sha256 !== releaseDecision?.desired_release_sha256) errors.push("RELEASE_READBACK_MISMATCH");
  if (readback.observed_artifact_sha256 !== releaseDecision?.artifact_sha256) errors.push("ARTIFACT_READBACK_MISMATCH");
  if (readback.observed_candidate_tag !== releaseDecision?.candidate_tag) errors.push("CANDIDATE_TAG_READBACK_MISMATCH");
  if (readback.status !== "CONFIRMED") errors.push("PROVIDER_STATE_NOT_CONFIRMED");
  const payload = {
    release_decision_sha256: releaseDecision?.decision_sha256 ?? null,
    provider_state_sha256: readback.provider_state_sha256,
    exact_subject_match: errors.length === 0,
    source_tree_write: 0,
    merge_authority: "NONE",
    final_merge_authority: "HUMAN_ONLY",
    result: errors.length === 0 ? "CONFIRMED" : "BLOCKED",
    reasons: errors
  };
  return { ok: errors.length === 0, result: payload.result, errors, evidence: { ...payload, evidence_sha256: sha256Json(payload) } };
}
