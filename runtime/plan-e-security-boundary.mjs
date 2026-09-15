import { createHash } from "node:crypto";

export const RUNTIME_E_CREDENTIAL_GRANT_TYPE = "RUNTIME_E_CREDENTIAL_GRANT_V1";
export const RUNTIME_E_SECURITY_DECISION_TYPE = "RUNTIME_E_SECURITY_DECISION_V1";

const SHA256_RE = /^[0-9a-f]{64}$/;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const HOST_RE = /^(?=.{1,253}$)(?!-)[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
const TOOL_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._+:-]{0,63}$/;
const ALLOWED_CREDENTIAL_PURPOSES = new Set(["PROVIDER_ADMIN_READ","PROVIDER_ADMIN_WRITE","PRODUCTION_READBACK"]);
const ALLOWED_OPERATIONS = new Set(["GET_POLICY","PUT_RULESET","PUT_BRANCH_PROTECTION","GET_PRODUCTION_STATE"]);

function sha256Json(value) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

export function validateRuntimeECredentialGrant(grant) {
  const keys = ["grant_type","credential_ref","credential_material","purpose","allowed_hosts","allowed_operations","issued_at_ms","expires_at_ms","authority_evidence_sha256"];
  if (!exactKeys(grant, keys)) return { ok: false, errors: ["CREDENTIAL_GRANT_FIELDS_MISMATCH"] };
  const errors = [];
  if (grant.grant_type !== RUNTIME_E_CREDENTIAL_GRANT_TYPE) errors.push("CREDENTIAL_GRANT_TYPE_MISMATCH");
  if (!ID_RE.test(grant.credential_ref ?? "")) errors.push("CREDENTIAL_REF_INVALID");
  if (grant.credential_material !== null) errors.push("CREDENTIAL_MATERIAL_MUST_NOT_BE_EMBEDDED");
  if (!ALLOWED_CREDENTIAL_PURPOSES.has(grant.purpose)) errors.push("CREDENTIAL_PURPOSE_INVALID");
  if (!Array.isArray(grant.allowed_hosts) || grant.allowed_hosts.length === 0) errors.push("ALLOWED_HOSTS_REQUIRED");
  else if (grant.allowed_hosts.some((host) => host === "*" || !HOST_RE.test(host))) errors.push("WILDCARD_OR_INVALID_EGRESS_HOST");
  if (!Array.isArray(grant.allowed_operations) || grant.allowed_operations.length === 0) errors.push("ALLOWED_OPERATIONS_REQUIRED");
  else if (grant.allowed_operations.some((op) => !ALLOWED_OPERATIONS.has(op))) errors.push("CREDENTIAL_OPERATION_INVALID");
  if (!Number.isSafeInteger(grant.issued_at_ms) || grant.issued_at_ms < 0) errors.push("ISSUED_AT_MS_INVALID");
  if (!Number.isSafeInteger(grant.expires_at_ms) || grant.expires_at_ms <= grant.issued_at_ms) errors.push("EXPIRES_AT_MS_INVALID");
  if (!SHA256_RE.test(grant.authority_evidence_sha256 ?? "")) errors.push("AUTHORITY_EVIDENCE_SHA256_INVALID");
  return { ok: errors.length === 0, errors };
}

export function evaluateRuntimeESecurityBoundary({ grant, requested_host, requested_operation, toolchain, now_ms }) {
  const errors = [...validateRuntimeECredentialGrant(grant).errors];
  if (!HOST_RE.test(requested_host ?? "")) errors.push("REQUESTED_HOST_INVALID");
  if (!ALLOWED_OPERATIONS.has(requested_operation)) errors.push("REQUESTED_OPERATION_INVALID");
  if (!Number.isSafeInteger(now_ms) || now_ms < 0) errors.push("NOW_MS_INVALID");
  if (grant && Number.isSafeInteger(now_ms) && now_ms >= grant.expires_at_ms) errors.push("CREDENTIAL_GRANT_EXPIRED");
  if (grant && !grant.allowed_hosts.includes(requested_host)) errors.push("EGRESS_HOST_NOT_ALLOWLISTED");
  if (grant && !grant.allowed_operations.includes(requested_operation)) errors.push("OPERATION_NOT_ALLOWED_BY_CREDENTIAL_GRANT");

  if (!toolchain || typeof toolchain !== "object" || Array.isArray(toolchain)) errors.push("TOOLCHAIN_MISSING");
  else {
    if (!TOOL_RE.test(toolchain.tool ?? "")) errors.push("TOOLCHAIN_TOOL_INVALID");
    if (!VERSION_RE.test(toolchain.version ?? "")) errors.push("TOOLCHAIN_VERSION_UNPINNED_OR_INVALID");
    if (!SHA256_RE.test(toolchain.binary_sha256 ?? "")) errors.push("TOOLCHAIN_BINARY_SHA256_INVALID");
  }

  const payload = {
    decision_type: RUNTIME_E_SECURITY_DECISION_TYPE,
    credential_ref: grant?.credential_ref ?? null,
    credential_material_present: grant?.credential_material !== null,
    purpose: grant?.purpose ?? null,
    requested_host,
    requested_operation,
    toolchain: toolchain ?? null,
    egress_policy: "EXACT_ALLOWLIST_ONLY",
    wildcard_egress: false,
    secret_material_in_receipt: false,
    result: errors.length === 0 ? "ALLOWED" : "BLOCKED",
    reasons: errors
  };
  return { ...payload, decision_sha256: sha256Json(payload) };
}
