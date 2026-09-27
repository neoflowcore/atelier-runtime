export const NORMAL_PATH_POLICY = "ZERO_TOUCH_AFTER_APPROVAL";

export const COMPUTE_PROVIDERS = Object.freeze(["LOCAL", "VMWARE", "DIGITALOCEAN"]);
export const EXECUTION_TRANSPORTS = Object.freeze(["DIRECT_WORKER", "GITHUB_SELF_HOSTED_JIT"]);
export const VERIFIER_POLICIES = Object.freeze([
  "RUNTIME_REQUIRED",
  "PROJECT_CI_REQUIRED",
  "RUNTIME_PLUS_PROJECT_CI"
]);
export const OPERATOR_INTERACTION_CLASSES = Object.freeze([
  "OBSERVE_ONLY",
  "STATE_AFFECTING",
  "PRIVILEGED_MUTATION",
  "RECOVERY_MUTATION"
]);

const ZERO_TOUCH_FIELDS = Object.freeze([
  "OPERATOR_ACTIONS_AFTER_APPROVAL",
  "MANUAL_SSH_COUNT",
  "MANUAL_TERMUX_COMMAND_COUNT",
  "MANUAL_SECRET_COPY_COUNT",
  "MANUAL_RUNNER_REGISTRATION_COUNT",
  "WORKER_GITHUB_DEVICE_LOGIN_COUNT",
  "MANUAL_RERUN_COUNT"
]);

const PREFLIGHT_FLAGS = Object.freeze([
  "READY_ATTESTATION_VALID",
  "SOURCE_IDENTITY_EXACT",
  "EXECUTION_PLAN_VALID",
  "APPROVAL_VALID",
  "BUDGET_RESERVATION_VALID",
  "VERIFIER_POLICY_EXACT",
  "EXECUTION_TRANSPORT_READY"
]);

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function validateExecutionAxes(value) {
  const errors = [];
  if (!plainObject(value)) return { ok: false, errors: ["EXECUTION_AXES_NOT_OBJECT"] };
  if (!COMPUTE_PROVIDERS.includes(value.COMPUTE_PROVIDER)) errors.push("UNSUPPORTED_COMPUTE_PROVIDER");
  if (!EXECUTION_TRANSPORTS.includes(value.EXECUTION_TRANSPORT)) errors.push("UNSUPPORTED_EXECUTION_TRANSPORT");
  if (!VERIFIER_POLICIES.includes(value.VERIFIER_POLICY)) errors.push("UNSUPPORTED_VERIFIER_POLICY");
  if (value.COMPUTE_PROVIDER === "GITHUB_SELF_HOSTED_JIT") {
    errors.push("TRANSPORT_MISCLASSIFIED_AS_COMPUTE_PROVIDER");
  }
  return { ok: errors.length === 0, errors };
}

export function validateZeroTouchNormalPath(value) {
  const errors = [];
  if (!plainObject(value)) return { ok: false, errors: ["ZERO_TOUCH_METRICS_NOT_OBJECT"] };
  if (value.NORMAL_PATH_POLICY !== NORMAL_PATH_POLICY) errors.push("NORMAL_PATH_POLICY_MISMATCH");
  for (const field of ZERO_TOUCH_FIELDS) {
    if (value[field] !== 0) errors.push(`${field}_NONZERO`);
  }
  return { ok: errors.length === 0, errors };
}

export function validateWorkerReadyAttestation(attestation, nowMs) {
  const errors = [];
  if (!plainObject(attestation)) return { ok: false, errors: ["READY_ATTESTATION_NOT_OBJECT"] };
  if (attestation.ATTESTATION_STATE !== "READY") errors.push("READY_ATTESTATION_STATE_INVALID");
  if (typeof attestation.WORKER_ID !== "string" || !attestation.WORKER_ID) errors.push("WORKER_ID_MISSING");
  if (typeof attestation.EXECUTION_PLAN_HASH !== "string" || !/^[0-9a-f]{64}$/.test(attestation.EXECUTION_PLAN_HASH)) {
    errors.push("EXECUTION_PLAN_HASH_INVALID");
  }
  const expiresAtMs = Date.parse(attestation.EXPIRES_AT ?? "");
  if (!Number.isFinite(expiresAtMs)) errors.push("READY_ATTESTATION_EXPIRES_AT_INVALID");
  if (!Number.isSafeInteger(nowMs)) errors.push("RUNTIME_NOW_INVALID");
  if (Number.isFinite(expiresAtMs) && Number.isSafeInteger(nowMs) && expiresAtMs <= nowMs) {
    errors.push("READY_ATTESTATION_EXPIRED");
  }
  return { ok: errors.length === 0, errors };
}

export function validateExecutionPreflight(value, nowMs) {
  const errors = [];
  if (!plainObject(value)) return { ok: false, errors: ["PREFLIGHT_NOT_OBJECT"] };
  for (const field of PREFLIGHT_FLAGS) {
    if (value[field] !== true) errors.push(`PREFLIGHT_FAIL:${field}`);
  }
  const attestation = validateWorkerReadyAttestation(value.WORKER_READY_ATTESTATION, nowMs);
  errors.push(...attestation.errors);
  if (value.WORKER_READY_ATTESTATION?.EXECUTION_PLAN_HASH !== value.EXECUTION_PLAN_HASH) {
    errors.push("READY_ATTESTATION_PLAN_HASH_MISMATCH");
  }
  if (value.GATE_TRIGGERED === true && errors.length > 0) errors.push("GATE_TRIGGERED_WITH_FAILED_PREFLIGHT");
  return { ok: errors.length === 0, errors };
}

export function operatorInteractionEffect(interactionClass) {
  if (!OPERATOR_INTERACTION_CLASSES.includes(interactionClass)) {
    return { ok: false, code: "UNKNOWN_INTERACTION_CLASS" };
  }
  if (interactionClass === "OBSERVE_ONLY") {
    return {
      ok: true,
      ATTESTATION_INVALIDATION: "NO",
      FENCE_ADVANCE: "NO",
      AUTOMATIC_RESULT_ACCEPTANCE: "UNCHANGED",
      REATTESTATION_REQUIRED: "NO",
      NEW_ATTEMPT_REQUIRED: "NO"
    };
  }
  return {
    ok: true,
    ATTESTATION_INVALIDATION: "YES",
    FENCE_ADVANCE: "YES",
    AUTOMATIC_RESULT_ACCEPTANCE: "SUSPENDED",
    REATTESTATION_REQUIRED: "YES",
    NEW_ATTEMPT_REQUIRED: "YES"
  };
}

export function validateDurableSessionConnectivity(value) {
  const errors = [];
  if (!plainObject(value)) return { ok: false, errors: ["SESSION_CONNECTIVITY_NOT_OBJECT"] };
  for (const field of ["CHAT_DISCONNECTED", "ANDROID_OFFLINE", "SSH_DISCONNECTED"]) {
    if (value[field] !== "NO_EFFECT") errors.push(`${field}_MUST_BE_NO_EFFECT`);
  }
  return { ok: errors.length === 0, errors };
}
