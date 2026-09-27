import { createHash } from "node:crypto";
import { canonicalizeExecutionV1 } from "./canonicalize-execution-v1.mjs";

export const PILOTE_VERIFIER_POLICY_TYPE = "PILOTE_VERIFIER_POLICY_V1";
export const PILOTE_VERIFIER_POLICY_VERSION = "1.0.0";
export const EXECUTION_CANONICALIZATION_ID = "ATELIER_EXECUTION_CANONICAL_JSON_V1";
export const REV51_CONTRACT_SET_ID = "ATELIER_REV51_CONTRACT_SET_V1";
export const REV51_CONTRACT_SET_VERSION = "1.0.0";
export const REV51_CONTRACT_SET_SHA256 = "a8b220c92a47306061e9aca1c65077d357b00bda12e9daad4f37215256083f4a";

export const VERIFIER_POLICIES = Object.freeze([
  "RUNTIME_REQUIRED",
  "PROJECT_CI_REQUIRED",
  "RUNTIME_PLUS_PROJECT_CI"
]);

const POLICY_ID_BY_MODE = Object.freeze({
  RUNTIME_REQUIRED: "verifier.runtime.required",
  PROJECT_CI_REQUIRED: "verifier.project-ci.required",
  RUNTIME_PLUS_PROJECT_CI: "verifier.runtime-plus-project-ci"
});

const POLICY_KEYS = Object.freeze([
  "ACCEPTANCE_REQUIREMENT_REF",
  "CANONICALIZATION_ID",
  "CONTRACT_SET_REF",
  "POLICY_TYPE",
  "POLICY_VERSION",
  "RAW_WORKER_SUCCESS_DIRECT_ACCEPTANCE",
  "RUNTIME_DEFINED_ACCEPTANCE_SEMANTICS",
  "RUNTIME_DEFINED_TOLERANCE",
  "VERIFIER_POLICY",
  "VERIFIER_POLICY_ID",
  "VERIFIER_POLICY_SHA256",
  "VERIFIER_POLICY_VERSION"
]);

const FORBIDDEN_KEYS = new Set([
  "PROVIDER_ID","PROVIDER_ACCOUNT_OR_TENANT_ID","PROVIDER_RESOURCE_ID","WORKER_ID","VM_ID","DROPLET_ID",
  "RUNNER_ID","JIT_REGISTRATION_ID","LEASE_ID","EXECUTION_ID","ATTEMPT_ID","FENCE_TOKEN","OPERATION_ID",
  "IDEMPOTENCY_KEY","SECRET_VALUE","BACKEND_INSTANCE_ID"
]);

const SHA256_RE = /^[0-9a-f]{64}$/;
const SEMVER_RE = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/;
const REF_RE = /^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,255}$/;
const ALLOWED_ACCEPTANCE_OWNERS = new Set(["task-contract", "project", "phase", "framework"]);

function isObject(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
function exactKeys(obj, expected) {
  if (!isObject(obj)) return false;
  const actual = Object.keys(obj).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((x, i) => x === wanted[i]);
}
function scanForbidden(value, path = "$") {
  const errors = [];
  if (Array.isArray(value)) {
    value.forEach((v, i) => errors.push(...scanForbidden(v, `${path}[${i}]`)));
  } else if (isObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key)) errors.push(`FORBIDDEN_INFRASTRUCTURE_KEY:${path}.${key}`);
      errors.push(...scanForbidden(child, `${path}.${key}`));
    }
  }
  return errors;
}

export function validateAcceptanceRequirementRefV1(ref) {
  const errors = [];
  if (typeof ref !== "string" || !REF_RE.test(ref)) return { ok: false, errors: ["ACCEPTANCE_REQUIREMENT_REF_INVALID"] };
  const separator = ref.indexOf(":");
  if (separator <= 0) return { ok: false, errors: ["ACCEPTANCE_REQUIREMENT_OWNER_REQUIRED"] };
  const owner = ref.slice(0, separator);
  if (!ALLOWED_ACCEPTANCE_OWNERS.has(owner)) errors.push("ACCEPTANCE_REQUIREMENT_OWNER_NOT_PILOTE_SEMANTIC");
  return { ok: errors.length === 0, errors };
}

export function computeVerifierPolicySha256(policy) {
  const copy = structuredClone(policy);
  delete copy.VERIFIER_POLICY_SHA256;
  return createHash("sha256").update(canonicalizeExecutionV1(copy)).digest("hex");
}

export function buildVerifierPolicyV1({
  verifierPolicy,
  acceptanceRequirementRef = "task-contract:ACCEPTANCE_REQUIREMENTS",
  verifierPolicyId = undefined,
  verifierPolicyVersion = PILOTE_VERIFIER_POLICY_VERSION
} = {}) {
  if (!VERIFIER_POLICIES.includes(verifierPolicy)) throw new Error("VERIFIER_POLICY_INVALID");
  const acceptance = validateAcceptanceRequirementRefV1(acceptanceRequirementRef);
  if (!acceptance.ok) throw new Error(`ACCEPTANCE_REQUIREMENT_REF_REJECTED:${acceptance.errors.join("|")}`);
  if (typeof verifierPolicyVersion !== "string" || !SEMVER_RE.test(verifierPolicyVersion)) throw new Error("VERIFIER_POLICY_VERSION_INVALID");

  const policy = {
    POLICY_TYPE: PILOTE_VERIFIER_POLICY_TYPE,
    POLICY_VERSION: PILOTE_VERIFIER_POLICY_VERSION,
    CANONICALIZATION_ID: EXECUTION_CANONICALIZATION_ID,
    VERIFIER_POLICY_ID: verifierPolicyId ?? POLICY_ID_BY_MODE[verifierPolicy],
    VERIFIER_POLICY_VERSION: verifierPolicyVersion,
    VERIFIER_POLICY: verifierPolicy,
    ACCEPTANCE_REQUIREMENT_REF: acceptanceRequirementRef,
    RUNTIME_DEFINED_ACCEPTANCE_SEMANTICS: "DENY",
    RUNTIME_DEFINED_TOLERANCE: "DENY",
    RAW_WORKER_SUCCESS_DIRECT_ACCEPTANCE: "DENY",
    CONTRACT_SET_REF: {
      ID: REV51_CONTRACT_SET_ID,
      VERSION: REV51_CONTRACT_SET_VERSION,
      SHA256: REV51_CONTRACT_SET_SHA256
    },
    VERIFIER_POLICY_SHA256: "0".repeat(64)
  };
  policy.VERIFIER_POLICY_SHA256 = computeVerifierPolicySha256(policy);
  const checked = validateVerifierPolicyV1(policy);
  if (!checked.ok) throw new Error(`BUILT_VERIFIER_POLICY_INVALID:${checked.errors.join("|")}`);
  return policy;
}

export function validateVerifierPolicyV1(policy) {
  const errors = [];
  if (!exactKeys(policy, POLICY_KEYS)) errors.push("VERIFIER_POLICY_TOP_LEVEL_FIELDS_MISMATCH");
  errors.push(...scanForbidden(policy));
  if (policy?.POLICY_TYPE !== PILOTE_VERIFIER_POLICY_TYPE) errors.push("POLICY_TYPE_MISMATCH");
  if (policy?.POLICY_VERSION !== PILOTE_VERIFIER_POLICY_VERSION) errors.push("POLICY_VERSION_MISMATCH");
  if (policy?.CANONICALIZATION_ID !== EXECUTION_CANONICALIZATION_ID) errors.push("CANONICALIZATION_ID_MISMATCH");
  if (typeof policy?.VERIFIER_POLICY_ID !== "string" || policy.VERIFIER_POLICY_ID.length === 0) errors.push("VERIFIER_POLICY_ID_INVALID");
  if (typeof policy?.VERIFIER_POLICY_VERSION !== "string" || !SEMVER_RE.test(policy.VERIFIER_POLICY_VERSION)) errors.push("VERIFIER_POLICY_VERSION_INVALID");
  if (!VERIFIER_POLICIES.includes(policy?.VERIFIER_POLICY)) errors.push("VERIFIER_POLICY_INVALID");

  const acceptance = validateAcceptanceRequirementRefV1(policy?.ACCEPTANCE_REQUIREMENT_REF);
  if (!acceptance.ok) errors.push(...acceptance.errors);

  if (policy?.RUNTIME_DEFINED_ACCEPTANCE_SEMANTICS !== "DENY") errors.push("RUNTIME_DEFINED_ACCEPTANCE_SEMANTICS_MUST_BE_DENY");
  if (policy?.RUNTIME_DEFINED_TOLERANCE !== "DENY") errors.push("RUNTIME_DEFINED_TOLERANCE_MUST_BE_DENY");
  if (policy?.RAW_WORKER_SUCCESS_DIRECT_ACCEPTANCE !== "DENY") errors.push("RAW_WORKER_SUCCESS_DIRECT_ACCEPTANCE_MUST_BE_DENY");

  const contract = policy?.CONTRACT_SET_REF;
  if (!isObject(contract) || contract.ID !== REV51_CONTRACT_SET_ID || contract.VERSION !== REV51_CONTRACT_SET_VERSION || contract.SHA256 !== REV51_CONTRACT_SET_SHA256) {
    errors.push("CONTRACT_SET_REF_MISMATCH");
  }

  if (!SHA256_RE.test(policy?.VERIFIER_POLICY_SHA256 ?? "")) errors.push("VERIFIER_POLICY_SHA256_INVALID");
  else if (computeVerifierPolicySha256(policy) !== policy.VERIFIER_POLICY_SHA256) errors.push("VERIFIER_POLICY_SHA256_MISMATCH");

  try { canonicalizeExecutionV1(policy); } catch (e) { errors.push(`CANONICALIZATION_REJECTED:${e.message}`); }
  return { ok: errors.length === 0, errors };
}

export function toVerifierPolicyRefV1(policy) {
  const checked = validateVerifierPolicyV1(policy);
  if (!checked.ok) throw new Error(`VERIFIER_POLICY_REF_SOURCE_INVALID:${checked.errors.join("|")}`);
  return {
    ID: policy.VERIFIER_POLICY_ID,
    VERSION: policy.VERIFIER_POLICY_VERSION,
    SHA256: policy.VERIFIER_POLICY_SHA256
  };
}

export function validateExecutionIntentVerifierBindingV1(intent, policy) {
  const errors = [];
  const checked = validateVerifierPolicyV1(policy);
  if (!checked.ok) errors.push(...checked.errors.map(x => `POLICY:${x}`));
  if (!isObject(intent)) return { ok: false, errors: ["EXECUTION_INTENT_REQUIRED", ...errors] };

  const expectedRef = checked.ok ? toVerifierPolicyRefV1(policy) : null;
  const actualRef = intent.VERIFIER_POLICY_REF;
  if (!isObject(actualRef) || !expectedRef || actualRef.ID !== expectedRef.ID || actualRef.VERSION !== expectedRef.VERSION || actualRef.SHA256 !== expectedRef.SHA256) {
    errors.push("VERIFIER_POLICY_REF_BINDING_MISMATCH");
  }
  if (intent.ACCEPTANCE_REQUIREMENT_REF !== policy?.ACCEPTANCE_REQUIREMENT_REF) errors.push("ACCEPTANCE_REQUIREMENT_REF_BINDING_MISMATCH");
  return { ok: errors.length === 0, errors };
}
