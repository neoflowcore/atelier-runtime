import { createHash } from "node:crypto";

export const A3_AUTHORITATIVE_BINDING = Object.freeze({
  REPOSITORY: "neoflowcore/atelier-runtime",
  BRANCH: "pilote-r51-a3-verifier-acceptance-intent",
  HEAD: "8a87ddb7fba03165339f86b26047417624b43899",
  TREE: "fc8ce3ce6c7a1650c2894937699c51876b6428bc",
  SCHEMA_SHA256: "59652f22bbf361b496947b26671aae81d58ff79c579561c050bf0e54b830cf58",
  CANONICALIZATION_ID: "ATELIER_EXECUTION_CANONICAL_JSON_V1",
  PILOTE_VERIFIER_POLICY_MODULE_SHA256: "a3d086939dc5e08e5ec20beb85b30a0e0d5275c2d165c24d97e563d339786c5a",
  SOURCE_FIXTURE_SET_SHA256: "5b661b9eb0cc9e982e4915787a04dcb0286b8fe7c03f3dd68618c361a8c2dce2",
  TEST_VECTOR_SET_SHA256: "080b23a76005d83bfdd8495c51c486959d6ba53e6be9181e460e01fa0202e61f",
  EXPECTED_RESULT_SET_SHA256: "7d884b47d4c2f1c47f404dd3bf148036447324d86ef93e88be34a1b4f77c93bd",
  AUTHORITATIVE_MANIFEST_SHA256: "ad914089dec666fb5befc4ba9084736043bd1466b3f543a11823c3a6e4fab6ca",
  CONTRACT_SET_ID: "ATELIER_REV51_CONTRACT_SET_V1",
  CONTRACT_SET_VERSION: "1.0.0",
  CONTRACT_SET_SHA256: "a8b220c92a47306061e9aca1c65077d357b00bda12e9daad4f37215256083f4a"
});

export const PILOTE_VERIFIER_POLICIES = Object.freeze([
  "RUNTIME_REQUIRED",
  "PROJECT_CI_REQUIRED",
  "RUNTIME_PLUS_PROJECT_CI"
]);

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

const FORBIDDEN_INFRASTRUCTURE_KEYS = new Set([
  "PROVIDER_ID","PROVIDER_ACCOUNT_OR_TENANT_ID","PROVIDER_RESOURCE_ID","WORKER_ID","VM_ID","DROPLET_ID",
  "RUNNER_ID","JIT_REGISTRATION_ID","LEASE_ID","EXECUTION_ID","ATTEMPT_ID","FENCE_TOKEN","OPERATION_ID",
  "IDEMPOTENCY_KEY","SECRET_VALUE","BACKEND_INSTANCE_ID"
]);

const ALLOWED_ACCEPTANCE_OWNERS = new Set(["task-contract", "project", "phase", "framework"]);
const SHA256_RE = /^[0-9a-f]{64}$/;
const SEMVER_RE = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/;
const REF_RE = /^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,255}$/;

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected) {
  if (!isObject(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function scanForbidden(value, path = "$") {
  const errors = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => errors.push(...scanForbidden(item, `${path}[${index}]`)));
  } else if (isObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_INFRASTRUCTURE_KEYS.has(key)) errors.push(`FORBIDDEN_INFRASTRUCTURE_KEY:${path}.${key}`);
      errors.push(...scanForbidden(child, `${path}.${key}`));
    }
  }
  return errors;
}

function canonicalizeExecutionV1(value) {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("ONLY_SAFE_INTEGERS_ALLOWED");
    return String(value);
  }
  if (typeof value === "string") {
    if (!/^[\x20-\x7E]*$/.test(value)) throw new Error("NON_ASCII_STRING_NOT_ALLOWED_BY_V1_REFERENCE_PROFILE");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalizeExecutionV1).join(",")}]`;
  if (isObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalizeExecutionV1(value[key])}`).join(",")}}`;
  }
  throw new Error("UNSUPPORTED_JSON_TYPE");
}

export function computePiloteVerifierPolicySha256V1(policy) {
  const copy = structuredClone(policy);
  delete copy.VERIFIER_POLICY_SHA256;
  return createHash("sha256").update(canonicalizeExecutionV1(copy), "utf8").digest("hex");
}

export function validatePiloteAcceptanceRequirementRefV1(ref) {
  if (typeof ref !== "string" || !REF_RE.test(ref)) return { ok: false, errors: ["ACCEPTANCE_REQUIREMENT_REF_INVALID"] };
  const separator = ref.indexOf(":");
  if (separator <= 0) return { ok: false, errors: ["ACCEPTANCE_REQUIREMENT_OWNER_REQUIRED"] };
  const owner = ref.slice(0, separator);
  if (!ALLOWED_ACCEPTANCE_OWNERS.has(owner)) return { ok: false, errors: ["ACCEPTANCE_REQUIREMENT_OWNER_NOT_PILOTE_SEMANTIC"] };
  return { ok: true, errors: [] };
}

export function validatePiloteVerifierPolicyV1(policy) {
  const errors = [];
  if (!exactKeys(policy, POLICY_KEYS)) errors.push("VERIFIER_POLICY_TOP_LEVEL_FIELDS_MISMATCH");
  errors.push(...scanForbidden(policy));
  if (policy?.POLICY_TYPE !== "PILOTE_VERIFIER_POLICY_V1") errors.push("POLICY_TYPE_MISMATCH");
  if (policy?.POLICY_VERSION !== "1.0.0") errors.push("POLICY_VERSION_MISMATCH");
  if (policy?.CANONICALIZATION_ID !== A3_AUTHORITATIVE_BINDING.CANONICALIZATION_ID) errors.push("CANONICALIZATION_ID_MISMATCH");
  if (typeof policy?.VERIFIER_POLICY_ID !== "string" || policy.VERIFIER_POLICY_ID.length === 0 || policy.VERIFIER_POLICY_ID.length > 128) errors.push("VERIFIER_POLICY_ID_INVALID");
  if (typeof policy?.VERIFIER_POLICY_VERSION !== "string" || !SEMVER_RE.test(policy.VERIFIER_POLICY_VERSION)) errors.push("VERIFIER_POLICY_VERSION_INVALID");
  if (!PILOTE_VERIFIER_POLICIES.includes(policy?.VERIFIER_POLICY)) errors.push("VERIFIER_POLICY_INVALID");

  const acceptance = validatePiloteAcceptanceRequirementRefV1(policy?.ACCEPTANCE_REQUIREMENT_REF);
  if (!acceptance.ok) errors.push(...acceptance.errors);

  if (policy?.RUNTIME_DEFINED_ACCEPTANCE_SEMANTICS !== "DENY") errors.push("RUNTIME_DEFINED_ACCEPTANCE_SEMANTICS_MUST_BE_DENY");
  if (policy?.RUNTIME_DEFINED_TOLERANCE !== "DENY") errors.push("RUNTIME_DEFINED_TOLERANCE_MUST_BE_DENY");
  if (policy?.RAW_WORKER_SUCCESS_DIRECT_ACCEPTANCE !== "DENY") errors.push("RAW_WORKER_SUCCESS_DIRECT_ACCEPTANCE_MUST_BE_DENY");

  const contract = policy?.CONTRACT_SET_REF;
  if (!isObject(contract)
      || contract.ID !== A3_AUTHORITATIVE_BINDING.CONTRACT_SET_ID
      || contract.VERSION !== A3_AUTHORITATIVE_BINDING.CONTRACT_SET_VERSION
      || contract.SHA256 !== A3_AUTHORITATIVE_BINDING.CONTRACT_SET_SHA256) {
    errors.push("CONTRACT_SET_REF_MISMATCH");
  }

  if (!SHA256_RE.test(policy?.VERIFIER_POLICY_SHA256 ?? "")) errors.push("VERIFIER_POLICY_SHA256_INVALID");
  else {
    try {
      if (computePiloteVerifierPolicySha256V1(policy) !== policy.VERIFIER_POLICY_SHA256) errors.push("VERIFIER_POLICY_SHA256_MISMATCH");
    } catch (error) {
      errors.push(`CANONICALIZATION_REJECTED:${error.message}`);
    }
  }

  return { ok: errors.length === 0, errors };
}

export function validateA3CrossStackBindingV1(intent, policy, runtimePlan) {
  const errors = [];
  const policyCheck = validatePiloteVerifierPolicyV1(policy);
  if (!policyCheck.ok) errors.push(...policyCheck.errors.map((error) => `POLICY:${error}`));

  if (!isObject(intent)) return { ok: false, errors: ["EXECUTION_INTENT_REQUIRED", ...errors] };
  if (!isObject(runtimePlan)) return { ok: false, errors: ["RUNTIME_EXECUTION_PLAN_REQUIRED", ...errors] };

  const ref = intent.VERIFIER_POLICY_REF;
  if (!isObject(ref)
      || ref.ID !== policy?.VERIFIER_POLICY_ID
      || ref.VERSION !== policy?.VERIFIER_POLICY_VERSION
      || ref.SHA256 !== policy?.VERIFIER_POLICY_SHA256) {
    errors.push("VERIFIER_POLICY_REF_BINDING_MISMATCH");
  }

  if (intent.ACCEPTANCE_REQUIREMENT_REF !== policy?.ACCEPTANCE_REQUIREMENT_REF) {
    errors.push("ACCEPTANCE_REQUIREMENT_REF_BINDING_MISMATCH");
  }

  if (runtimePlan.VERIFIER_POLICY !== policy?.VERIFIER_POLICY) errors.push("RUNTIME_PLAN_VERIFIER_POLICY_MISMATCH");
  if (runtimePlan.VERIFIER_POLICY_REF_SHA256 !== policy?.VERIFIER_POLICY_SHA256) errors.push("RUNTIME_PLAN_VERIFIER_POLICY_HASH_MISMATCH");
  if (runtimePlan.ACCEPTANCE_REQUIREMENT_REF !== policy?.ACCEPTANCE_REQUIREMENT_REF) errors.push("RUNTIME_PLAN_ACCEPTANCE_REQUIREMENT_REF_MISMATCH");
  if (runtimePlan.EXECUTION_INTENT_SHA256 !== intent.INTENT_SHA256) errors.push("RUNTIME_PLAN_EXECUTION_INTENT_HASH_MISMATCH");
  if (runtimePlan.CONTRACT_SET_SHA256 !== A3_AUTHORITATIVE_BINDING.CONTRACT_SET_SHA256) errors.push("RUNTIME_PLAN_CONTRACT_SET_SHA256_MISMATCH");

  return { ok: errors.length === 0, errors };
}

export function createA3CrossStackBindingReceiptV1(intent, policy, runtimePlan) {
  const result = validateA3CrossStackBindingV1(intent, policy, runtimePlan);
  if (!result.ok) throw new Error(`A3_CROSS_STACK_BIND_REJECTED:${result.errors.join("|")}`);
  return Object.freeze({
    BINDING_TYPE: "RUNTIME_A3_VERIFIER_ACCEPTANCE_BINDING_V1",
    PILOTE_A3_HEAD: A3_AUTHORITATIVE_BINDING.HEAD,
    PILOTE_A3_TREE: A3_AUTHORITATIVE_BINDING.TREE,
    EXECUTION_INTENT_SHA256: intent.INTENT_SHA256,
    VERIFIER_POLICY_REF: Object.freeze({ ...intent.VERIFIER_POLICY_REF }),
    VERIFIER_POLICY: policy.VERIFIER_POLICY,
    ACCEPTANCE_REQUIREMENT_REF: policy.ACCEPTANCE_REQUIREMENT_REF,
    RUNTIME_DEFINED_ACCEPTANCE_SEMANTICS: 0,
    RUNTIME_DEFINED_TOLERANCE: 0,
    RAW_WORKER_SUCCESS_DIRECT_PROJECT_ACCEPTANCE: 0,
    CONTRACT_SET_SHA256: A3_AUTHORITATIVE_BINDING.CONTRACT_SET_SHA256
  });
}
