import { createHash } from "node:crypto";

export const A5_AUTHORITATIVE_BINDING = Object.freeze({
  REPOSITORY: "neoflowcore/atelier-runtime",
  BRANCH: "pilote-r51-a5-capability-resource-security-intent",
  HEAD: "47607a346f57077b46f3df527fae5a51e960243b",
  TREE: "22871e691daedc9a922de95f6d7820b93c136e81",
  MODULE_SHA256: "a38d88c13f497007a6903297713d064f5f71188aa5a734423f3a7d0838fed1eb",
  SCHEMA_SHA256: "1bbcd5a6acf38f677527ad69117c210b0c114754ba96c36edc268f7cffd948f8",
  CANONICALIZATION_ID: "ATELIER_EXECUTION_CANONICAL_JSON_V1",
  TEST_VECTOR_SET_SHA256: "1b48f197728e418a4941dfe758c71842aae94fb83f2106d8bfcaf3ccd37af1ee",
  EXPECTED_RESULT_SET_SHA256: "0da554f47146a075e239d9cb60eeccffbe1002f98ce99306bcb3674ebeaae109",
  AUTHORITATIVE_MANIFEST_SHA256: "59a9b26f59fbe2a9c452e6f86313a86d7d0e6635a43f9a3198a5af4634d5fe11",
  CONTRACT_SET_ID: "ATELIER_REV51_CONTRACT_SET_V1",
  CONTRACT_SET_VERSION: "1.0.0",
  CONTRACT_SET_SHA256: "a8b220c92a47306061e9aca1c65077d357b00bda12e9daad4f37215256083f4a"
});

export const A5_POLICY = Object.freeze({
  CAPABILITY_ATTESTATION_POLICY: "STATIC_AND_DYNAMIC_REQUIRED",
  CAPABILITY_DRIFT_POLICY: "FAIL_CLOSED",
  RESOURCE_OWNERSHIP_PROOF_POLICY: "DURABLE_PROOF_REQUIRED_BEFORE_DESTRUCTIVE_ACTION",
  HOST_MOUNT_POLICY: "DENY_DEFAULT",
  HOST_SECRET_INHERITANCE: "DENY",
  PRIVILEGED_WORKER: "DENY_DEFAULT",
  UNTRUSTED_CODE_ON_PERSISTENT_WORKER: "DENY",
  JOB_SCOPED_CREDENTIAL_LEASE: "REQUIRED",
  BOOTSTRAP_CREDENTIAL_PRIVILEGED_JOB_EQUIVALENCE: "DENY",
  UNATTESTED_WORKER_PRIVILEGED_JOB_CREDENTIAL: "DENY",
  WARM_REUSE_SANITATION_RECEIPT: "REQUIRED",
  STRUCTURED_ENTRYPOINT: "REQUIRED",
  SHELL_EXECUTION: "DENY_DEFAULT",
  SECRET_PERSISTENCE: "DENY"
});

const A5_KEYS = Object.freeze([
  "A5_INTENT_SHA256",
  "BOOTSTRAP_CREDENTIAL_PRIVILEGED_JOB_EQUIVALENCE",
  "CANONICALIZATION_ID",
  "CAPABILITY_ATTESTATION_POLICY",
  "CAPABILITY_DRIFT_POLICY",
  "CAPABILITY_REQUIREMENT_REFS",
  "CONTRACT_SET_REF",
  "EXECUTION_INTENT_SHA256",
  "HOST_MOUNT_POLICY",
  "HOST_SECRET_INHERITANCE",
  "INTENT_TYPE",
  "INTENT_VERSION",
  "JOB_SCOPED_CREDENTIAL_LEASE",
  "PHASE_ID",
  "PRIVILEGED_WORKER",
  "PROJECT_ID",
  "RESOURCE_INTENT",
  "RESOURCE_OWNERSHIP_PROOF_POLICY",
  "SECRET_PERSISTENCE",
  "SECURITY_REQUIREMENT",
  "SHELL_EXECUTION",
  "STRUCTURED_ENTRYPOINT",
  "TASK_CONTRACT_SHA256",
  "TASK_ID",
  "UNATTESTED_WORKER_PRIVILEGED_JOB_CREDENTIAL",
  "UNTRUSTED_CODE_ON_PERSISTENT_WORKER",
  "WARM_REUSE_SANITATION_RECEIPT"
]);

const FORBIDDEN_RUNTIME_OWNED_KEYS = new Set([
  "PROVIDER_ID","PROVIDER_ACCOUNT_OR_TENANT_ID","PROVIDER_RESOURCE_ID","WORKER_ID","VM_ID","DROPLET_ID",
  "RUNNER_ID","JIT_REGISTRATION_ID","LEASE_ID","EXECUTION_ID","ATTEMPT_ID","FENCE_TOKEN","OPERATION_ID",
  "IDEMPOTENCY_KEY","SECRET_VALUE","BACKEND_INSTANCE_ID","ATTESTATION_ID","RESOURCE_BINDING_HASH",
  "DURABLE_CREATION_RECEIPT_HASH","CREDENTIAL_LEASE_ID"
]);

const RESOURCE_KEYS = Object.freeze([
  "CPU_MIN_MILLICORES","MEMORY_MIN_MIB","DISK_MIN_MIB","GPU_COUNT","GPU_MEMORY_MIN_MIB","GPU_CAPABILITY_CLASS"
]);
const SECURITY_KEYS = Object.freeze(["ISOLATION_CLASS","NETWORK_CLASS","DATA_ACCESS_CLASS","SECRET_CLASS"]);
const SHA256_RE = /^[0-9a-f]{64}$/;

function isObject(value) { return !!value && typeof value === "object" && !Array.isArray(value); }
function exactKeys(value, expected) {
  if (!isObject(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}
function uniqueStrings(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0) && new Set(value).size === value.length;
}
function exactArray(left, right) {
  return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((item, index) => item === right[index]);
}
function canonicalize(value) {
  if (value === null) return "null";
  if (typeof value === "string") {
    if (!/^[\x20-\x7E]*$/.test(value)) throw new Error("NON_ASCII_STRING_NOT_ALLOWED_BY_V1_REFERENCE_PROFILE");
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("ONLY_SAFE_INTEGERS_ALLOWED");
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  throw new Error("UNSUPPORTED_JSON_TYPE");
}
function exactJson(left, right) {
  try { return canonicalize(left) === canonicalize(right); } catch { return false; }
}
function scanForbidden(value, path = "$") {
  const errors = [];
  if (Array.isArray(value)) value.forEach((item, index) => errors.push(...scanForbidden(item, `${path}[${index}]`)));
  else if (isObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_RUNTIME_OWNED_KEYS.has(key)) errors.push(`FORBIDDEN_RUNTIME_OWNED_KEY:${path}.${key}`);
      errors.push(...scanForbidden(child, `${path}.${key}`));
    }
  }
  return errors;
}
function validateResource(resource) {
  const errors = [];
  if (!exactKeys(resource, RESOURCE_KEYS)) return ["RESOURCE_INTENT_FIELDS_MISMATCH"];
  for (const key of ["CPU_MIN_MILLICORES","MEMORY_MIN_MIB","DISK_MIN_MIB","GPU_COUNT","GPU_MEMORY_MIN_MIB"]) {
    const value = resource[key];
    if (value !== null && (!Number.isSafeInteger(value) || value < 0)) errors.push(`RESOURCE_INTENT_INVALID:${key}`);
  }
  if (resource.GPU_CAPABILITY_CLASS !== null && typeof resource.GPU_CAPABILITY_CLASS !== "string") errors.push("RESOURCE_INTENT_INVALID:GPU_CAPABILITY_CLASS");
  return errors;
}
function validateSecurity(security) {
  if (!exactKeys(security, SECURITY_KEYS)) return ["SECURITY_REQUIREMENT_FIELDS_MISMATCH"];
  for (const key of SECURITY_KEYS) if (typeof security[key] !== "string" || security[key].length === 0) return [`SECURITY_REQUIREMENT_INVALID:${key}`];
  return [];
}

export function computePiloteA5IntentSha256V1(intent) {
  const copy = structuredClone(intent);
  delete copy.A5_INTENT_SHA256;
  return createHash("sha256").update(canonicalize(copy), "utf8").digest("hex");
}

export function validatePiloteA5IntentV1(intent) {
  const errors = [];
  if (!exactKeys(intent, A5_KEYS)) errors.push("A5_TOP_LEVEL_FIELDS_MISMATCH");
  errors.push(...scanForbidden(intent));
  if (intent?.INTENT_TYPE !== "PILOTE_CAPABILITY_RESOURCE_SECURITY_INTENT_V1") errors.push("A5_INTENT_TYPE_MISMATCH");
  if (intent?.INTENT_VERSION !== "1.0.0") errors.push("A5_INTENT_VERSION_MISMATCH");
  if (intent?.CANONICALIZATION_ID !== A5_AUTHORITATIVE_BINDING.CANONICALIZATION_ID) errors.push("A5_CANONICALIZATION_ID_MISMATCH");
  for (const key of ["PROJECT_ID","PHASE_ID","TASK_ID"]) if (typeof intent?.[key] !== "string" || !intent[key]) errors.push(`${key}_INVALID`);
  if (!SHA256_RE.test(intent?.TASK_CONTRACT_SHA256 ?? "")) errors.push("TASK_CONTRACT_SHA256_INVALID");
  if (!SHA256_RE.test(intent?.EXECUTION_INTENT_SHA256 ?? "")) errors.push("EXECUTION_INTENT_SHA256_INVALID");
  if (!uniqueStrings(intent?.CAPABILITY_REQUIREMENT_REFS)) errors.push("CAPABILITY_REQUIREMENT_REFS_INVALID");
  errors.push(...validateResource(intent?.RESOURCE_INTENT));
  errors.push(...validateSecurity(intent?.SECURITY_REQUIREMENT));
  for (const [key, expected] of Object.entries(A5_POLICY)) if (intent?.[key] !== expected) errors.push(`${key}_MISMATCH`);
  const contract = intent?.CONTRACT_SET_REF;
  if (!isObject(contract)
      || contract.ID !== A5_AUTHORITATIVE_BINDING.CONTRACT_SET_ID
      || contract.VERSION !== A5_AUTHORITATIVE_BINDING.CONTRACT_SET_VERSION
      || contract.SHA256 !== A5_AUTHORITATIVE_BINDING.CONTRACT_SET_SHA256) errors.push("CONTRACT_SET_REF_MISMATCH");
  if (!SHA256_RE.test(intent?.A5_INTENT_SHA256 ?? "")) errors.push("A5_INTENT_SHA256_INVALID");
  else {
    try { if (computePiloteA5IntentSha256V1(intent) !== intent.A5_INTENT_SHA256) errors.push("A5_INTENT_SHA256_MISMATCH"); }
    catch (error) { errors.push(`A5_CANONICALIZATION_REJECTED:${error.message}`); }
  }
  return { ok: errors.length === 0, errors };
}

export function validateA5CrossStackBindingV1(taskContract, executionIntent, runtimePlan, a5Intent) {
  const errors = [];
  const a5 = validatePiloteA5IntentV1(a5Intent);
  if (!a5.ok) errors.push(...a5.errors.map((error) => `A5:${error}`));
  if (![taskContract,executionIntent,runtimePlan,a5Intent].every(isObject)) return { ok:false, errors:["A5_BINDING_INPUT_REQUIRED",...errors] };
  if (executionIntent.TASK_CONTRACT_SHA256 !== taskContract.TASK_CONTRACT_HASH) errors.push("EXECUTION_INTENT_TASK_CONTRACT_BINDING_MISMATCH");
  for (const key of ["PROJECT_ID","PHASE_ID","TASK_ID"]) {
    if (a5Intent[key] !== taskContract[key] || a5Intent[key] !== executionIntent[key]) errors.push(`${key}_BINDING_MISMATCH`);
  }
  if (a5Intent.TASK_CONTRACT_SHA256 !== taskContract.TASK_CONTRACT_HASH) errors.push("A5_TASK_CONTRACT_SHA256_BINDING_MISMATCH");
  if (a5Intent.EXECUTION_INTENT_SHA256 !== executionIntent.INTENT_SHA256) errors.push("EXECUTION_INTENT_SHA256_BINDING_MISMATCH");
  if (!exactArray(a5Intent.CAPABILITY_REQUIREMENT_REFS, taskContract.CAPABILITY_REQUIREMENTS)
      || !exactArray(a5Intent.CAPABILITY_REQUIREMENT_REFS, executionIntent.CAPABILITY_REQUIREMENTS)) errors.push("CAPABILITY_REQUIREMENT_BINDING_MISMATCH");
  if (!exactJson(a5Intent.RESOURCE_INTENT, executionIntent.RESOURCE_INTENT) || !exactJson(a5Intent.RESOURCE_INTENT, runtimePlan.RESOURCE_INTENT)) errors.push("RESOURCE_INTENT_BINDING_MISMATCH");
  if (!exactJson(a5Intent.SECURITY_REQUIREMENT, executionIntent.SECURITY_REQUIREMENT) || !exactJson(a5Intent.SECURITY_REQUIREMENT, runtimePlan.SECURITY_REQUIREMENT)) errors.push("SECURITY_REQUIREMENT_BINDING_MISMATCH");
  if (runtimePlan.EXECUTION_INTENT_SHA256 !== executionIntent.INTENT_SHA256) errors.push("RUNTIME_PLAN_EXECUTION_INTENT_HASH_MISMATCH");
  if (runtimePlan.CONTRACT_SET_SHA256 !== A5_AUTHORITATIVE_BINDING.CONTRACT_SET_SHA256) errors.push("RUNTIME_PLAN_CONTRACT_SET_SHA256_MISMATCH");
  return { ok: errors.length === 0, errors };
}

export function validateRuntimeA5EnforcementBoundaryV1(observed) {
  const errors = [];
  if (!isObject(observed)) return { ok:false, errors:["RUNTIME_A5_ENFORCEMENT_REQUIRED"] };
  if (observed.STATIC_CAPABILITY_ATTESTATION_VALID !== true) errors.push("STATIC_CAPABILITY_ATTESTATION_REQUIRED");
  if (observed.DYNAMIC_CAPABILITY_ATTESTATION_VALID !== true) errors.push("DYNAMIC_CAPABILITY_ATTESTATION_REQUIRED");
  if (observed.CAPABILITY_DRIFT_DETECTED !== false) errors.push("CAPABILITY_DRIFT_FAIL_CLOSED");
  if (observed.DESTRUCTIVE_ACTION === true && observed.RESOURCE_OWNERSHIP_PROOF_DURABLE !== true) errors.push("DURABLE_RESOURCE_OWNERSHIP_PROOF_REQUIRED");
  if (observed.BOOTSTRAP_CREDENTIAL_CLASS === "PRIVILEGED_JOB") errors.push("BOOTSTRAP_CREDENTIAL_PRIVILEGED_JOB_EQUIVALENCE_DENIED");
  if (observed.JOB_CREDENTIAL_LEASE_SCOPE !== "JOB_SCOPED") errors.push("JOB_SCOPED_CREDENTIAL_LEASE_REQUIRED");
  if (observed.WORKER_ATTESTED !== true && observed.PRIVILEGED_JOB_CREDENTIAL_PRESENT === true) errors.push("UNATTESTED_WORKER_PRIVILEGED_JOB_CREDENTIAL_DENIED");
  if (observed.WORKER_PRIVILEGED === true) errors.push("PRIVILEGED_WORKER_DENY_DEFAULT");
  if (observed.HOST_MOUNT_GRANTED === true) errors.push("HOST_MOUNT_DENY_DEFAULT");
  if (observed.HOST_SECRET_INHERITED === true) errors.push("HOST_SECRET_INHERITANCE_DENIED");
  if (observed.UNTRUSTED_CODE_ON_PERSISTENT_WORKER === true) errors.push("UNTRUSTED_CODE_ON_PERSISTENT_WORKER_DENIED");
  if (observed.WARM_REUSE === true && observed.SANITATION_RECEIPT_VALID !== true) errors.push("WARM_REUSE_SANITATION_RECEIPT_REQUIRED");
  if (observed.STRUCTURED_ENTRYPOINT_USED !== true) errors.push("STRUCTURED_ENTRYPOINT_REQUIRED");
  if (observed.SHELL_EXECUTION_USED === true) errors.push("SHELL_EXECUTION_DENY_DEFAULT");
  if (observed.SECRET_PERSISTED === true) errors.push("SECRET_PERSISTENCE_DENIED");
  return { ok: errors.length === 0, errors };
}

export function createA5CrossStackBindingReceiptV1(taskContract, executionIntent, runtimePlan, a5Intent, observed) {
  const binding = validateA5CrossStackBindingV1(taskContract, executionIntent, runtimePlan, a5Intent);
  if (!binding.ok) throw new Error(`A5_CROSS_STACK_BIND_REJECTED:${binding.errors.join("|")}`);
  const enforcement = validateRuntimeA5EnforcementBoundaryV1(observed);
  if (!enforcement.ok) throw new Error(`A5_RUNTIME_ENFORCEMENT_REJECTED:${enforcement.errors.join("|")}`);
  return Object.freeze({
    BINDING_TYPE: "RUNTIME_A5_CAPABILITY_RESOURCE_SECURITY_BINDING_V1",
    PILOTE_A5_HEAD: A5_AUTHORITATIVE_BINDING.HEAD,
    PILOTE_A5_TREE: A5_AUTHORITATIVE_BINDING.TREE,
    A5_INTENT_SHA256: a5Intent.A5_INTENT_SHA256,
    CAPABILITY_REQUIREMENT_BINDING: "PASS",
    RESOURCE_INTENT_BINDING: "PASS",
    SECURITY_REQUIREMENT_BINDING: "PASS",
    CAPABILITY_ATTESTATION_BOUNDARY: "PASS",
    CAPABILITY_DRIFT_BOUNDARY: "PASS",
    RESOURCE_OWNERSHIP_PROOF_BOUNDARY: "PASS",
    CREDENTIAL_CLASS_SEPARATION: "PASS",
    WORKER_PRIVILEGE_BOUNDARY: "PASS",
    SECRET_PERSISTENCE_BOUNDARY: "PASS",
    TASK_CONTRACT_V1_MUTATION: 0,
    FROZEN_27_FIELDS_MUTATION: 0,
    INTERFACE_V1_MUTATION: 0,
    SHARED_CONTRACT_REDESIGN: 0,
    PILOTE_SEMANTIC_REINTERPRETATION: 0,
    RUNTIME_OWNED_PROVIDER_ID_EMISSION: 0,
    RUNTIME_OWNED_WORKER_ID_EMISSION: 0,
    RUNTIME_OWNED_ATTESTATION_ID_EMISSION: 0,
    RUNTIME_OWNED_CREDENTIAL_LEASE_ID_EMISSION: 0
  });
}
