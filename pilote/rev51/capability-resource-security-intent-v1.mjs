import { createHash } from "node:crypto";
import { canonicalizeExecutionV1 } from "./canonicalize-execution-v1.mjs";
import {
  REV51_CONTRACT_SET_ID,
  REV51_CONTRACT_SET_SHA256,
  REV51_CONTRACT_SET_VERSION,
  validateExecutionIntentV1,
  validateTaskContractAnchor
} from "./execution-intent-v1.mjs";

export const PILOTE_CAPABILITY_RESOURCE_SECURITY_INTENT_TYPE = "PILOTE_CAPABILITY_RESOURCE_SECURITY_INTENT_V1";
export const PILOTE_CAPABILITY_RESOURCE_SECURITY_INTENT_VERSION = "1.0.0";
export const A5_CANONICALIZATION_ID = "ATELIER_EXECUTION_CANONICAL_JSON_V1";

export const A5_CAPABILITY_ATTESTATION_POLICY = "STATIC_AND_DYNAMIC_REQUIRED";
export const A5_CAPABILITY_DRIFT_POLICY = "FAIL_CLOSED";
export const A5_RESOURCE_OWNERSHIP_PROOF_POLICY = "DURABLE_PROOF_REQUIRED_BEFORE_DESTRUCTIVE_ACTION";
export const A5_HOST_MOUNT_POLICY = "DENY_DEFAULT";
export const A5_HOST_SECRET_INHERITANCE = "DENY";
export const A5_PRIVILEGED_WORKER = "DENY_DEFAULT";
export const A5_UNTRUSTED_CODE_ON_PERSISTENT_WORKER = "DENY";
export const A5_JOB_SCOPED_CREDENTIAL_LEASE = "REQUIRED";
export const A5_BOOTSTRAP_CREDENTIAL_PRIVILEGED_JOB_EQUIVALENCE = "DENY";
export const A5_UNATTESTED_WORKER_PRIVILEGED_JOB_CREDENTIAL = "DENY";
export const A5_WARM_REUSE_SANITATION_RECEIPT = "REQUIRED";
export const A5_STRUCTURED_ENTRYPOINT = "REQUIRED";
export const A5_SHELL_EXECUTION = "DENY_DEFAULT";
export const A5_SECRET_PERSISTENCE = "DENY";

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
  "PROVIDER_ID",
  "PROVIDER_ACCOUNT_OR_TENANT_ID",
  "PROVIDER_RESOURCE_ID",
  "WORKER_ID",
  "VM_ID",
  "DROPLET_ID",
  "RUNNER_ID",
  "JIT_REGISTRATION_ID",
  "LEASE_ID",
  "EXECUTION_ID",
  "ATTEMPT_ID",
  "FENCE_TOKEN",
  "OPERATION_ID",
  "IDEMPOTENCY_KEY",
  "SECRET_VALUE",
  "BACKEND_INSTANCE_ID",
  "ATTESTATION_ID",
  "RESOURCE_BINDING_HASH",
  "DURABLE_CREATION_RECEIPT_HASH",
  "CREDENTIAL_LEASE_ID"
]);

const RESOURCE_KEYS = Object.freeze([
  "CPU_MIN_MILLICORES",
  "MEMORY_MIN_MIB",
  "DISK_MIN_MIB",
  "GPU_COUNT",
  "GPU_MEMORY_MIN_MIB",
  "GPU_CAPABILITY_CLASS"
]);

const SECURITY_KEYS = Object.freeze([
  "ISOLATION_CLASS",
  "NETWORK_CLASS",
  "DATA_ACCESS_CLASS",
  "SECRET_CLASS"
]);

const SHA256_RE = /^[0-9a-f]{64}$/;

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected) {
  if (!isObject(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function uniqueStrings(value) {
  return Array.isArray(value)
    && value.every((item) => typeof item === "string" && item.length > 0)
    && new Set(value).size === value.length;
}

function exactArray(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((item, index) => item === right[index]);
}

function exactJson(left, right) {
  try {
    return canonicalizeExecutionV1(left) === canonicalizeExecutionV1(right);
  } catch {
    return false;
  }
}

function scanForbidden(value, path = "$") {
  const errors = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => errors.push(...scanForbidden(item, path + "[" + index + "]")));
  } else if (isObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_RUNTIME_OWNED_KEYS.has(key)) errors.push("FORBIDDEN_RUNTIME_OWNED_KEY:" + path + "." + key);
      errors.push(...scanForbidden(child, path + "." + key));
    }
  }
  return errors;
}

function validateResourceIntentShape(resource) {
  const errors = [];
  if (!exactKeys(resource, RESOURCE_KEYS)) return ["RESOURCE_INTENT_FIELDS_MISMATCH"];
  for (const key of ["CPU_MIN_MILLICORES", "MEMORY_MIN_MIB", "DISK_MIN_MIB", "GPU_COUNT", "GPU_MEMORY_MIN_MIB"]) {
    const value = resource[key];
    if (value !== null && (!Number.isSafeInteger(value) || value < 0)) errors.push("RESOURCE_INTENT_INVALID:" + key);
  }
  if (resource.GPU_CAPABILITY_CLASS !== null && typeof resource.GPU_CAPABILITY_CLASS !== "string") {
    errors.push("RESOURCE_INTENT_INVALID:GPU_CAPABILITY_CLASS");
  }
  return errors;
}

function validateSecurityRequirementShape(security) {
  if (!exactKeys(security, SECURITY_KEYS)) return ["SECURITY_REQUIREMENT_FIELDS_MISMATCH"];
  for (const key of SECURITY_KEYS) {
    if (typeof security[key] !== "string" || security[key].length === 0) return ["SECURITY_REQUIREMENT_INVALID:" + key];
  }
  return [];
}

export function computeCapabilityResourceSecurityIntentSha256V1(intent) {
  const copy = structuredClone(intent);
  delete copy.A5_INTENT_SHA256;
  return createHash("sha256").update(canonicalizeExecutionV1(copy)).digest("hex");
}

export function validateCapabilityResourceSecurityIntentV1(intent) {
  const errors = [];

  if (!exactKeys(intent, A5_KEYS)) errors.push("A5_TOP_LEVEL_FIELDS_MISMATCH");
  errors.push(...scanForbidden(intent));

  if (intent?.INTENT_TYPE !== PILOTE_CAPABILITY_RESOURCE_SECURITY_INTENT_TYPE) errors.push("A5_INTENT_TYPE_MISMATCH");
  if (intent?.INTENT_VERSION !== PILOTE_CAPABILITY_RESOURCE_SECURITY_INTENT_VERSION) errors.push("A5_INTENT_VERSION_MISMATCH");
  if (intent?.CANONICALIZATION_ID !== A5_CANONICALIZATION_ID) errors.push("A5_CANONICALIZATION_ID_MISMATCH");

  for (const key of ["PROJECT_ID", "PHASE_ID", "TASK_ID"]) {
    if (typeof intent?.[key] !== "string" || intent[key].length === 0) errors.push(key + "_INVALID");
  }

  if (!SHA256_RE.test(intent?.TASK_CONTRACT_SHA256 ?? "")) errors.push("TASK_CONTRACT_SHA256_INVALID");
  if (!SHA256_RE.test(intent?.EXECUTION_INTENT_SHA256 ?? "")) errors.push("EXECUTION_INTENT_SHA256_INVALID");
  if (!uniqueStrings(intent?.CAPABILITY_REQUIREMENT_REFS)) errors.push("CAPABILITY_REQUIREMENT_REFS_INVALID");

  errors.push(...validateResourceIntentShape(intent?.RESOURCE_INTENT));
  errors.push(...validateSecurityRequirementShape(intent?.SECURITY_REQUIREMENT));

  if (intent?.CAPABILITY_ATTESTATION_POLICY !== A5_CAPABILITY_ATTESTATION_POLICY) errors.push("CAPABILITY_ATTESTATION_POLICY_MISMATCH");
  if (intent?.CAPABILITY_DRIFT_POLICY !== A5_CAPABILITY_DRIFT_POLICY) errors.push("CAPABILITY_DRIFT_POLICY_MISMATCH");
  if (intent?.RESOURCE_OWNERSHIP_PROOF_POLICY !== A5_RESOURCE_OWNERSHIP_PROOF_POLICY) errors.push("RESOURCE_OWNERSHIP_PROOF_POLICY_MISMATCH");
  if (intent?.HOST_MOUNT_POLICY !== A5_HOST_MOUNT_POLICY) errors.push("HOST_MOUNT_POLICY_MISMATCH");
  if (intent?.HOST_SECRET_INHERITANCE !== A5_HOST_SECRET_INHERITANCE) errors.push("HOST_SECRET_INHERITANCE_MISMATCH");
  if (intent?.PRIVILEGED_WORKER !== A5_PRIVILEGED_WORKER) errors.push("PRIVILEGED_WORKER_MISMATCH");
  if (intent?.UNTRUSTED_CODE_ON_PERSISTENT_WORKER !== A5_UNTRUSTED_CODE_ON_PERSISTENT_WORKER) errors.push("UNTRUSTED_CODE_ON_PERSISTENT_WORKER_MISMATCH");
  if (intent?.JOB_SCOPED_CREDENTIAL_LEASE !== A5_JOB_SCOPED_CREDENTIAL_LEASE) errors.push("JOB_SCOPED_CREDENTIAL_LEASE_MISMATCH");
  if (intent?.BOOTSTRAP_CREDENTIAL_PRIVILEGED_JOB_EQUIVALENCE !== A5_BOOTSTRAP_CREDENTIAL_PRIVILEGED_JOB_EQUIVALENCE) errors.push("BOOTSTRAP_CREDENTIAL_PRIVILEGED_JOB_EQUIVALENCE_MISMATCH");
  if (intent?.UNATTESTED_WORKER_PRIVILEGED_JOB_CREDENTIAL !== A5_UNATTESTED_WORKER_PRIVILEGED_JOB_CREDENTIAL) errors.push("UNATTESTED_WORKER_PRIVILEGED_JOB_CREDENTIAL_MISMATCH");
  if (intent?.WARM_REUSE_SANITATION_RECEIPT !== A5_WARM_REUSE_SANITATION_RECEIPT) errors.push("WARM_REUSE_SANITATION_RECEIPT_MISMATCH");
  if (intent?.STRUCTURED_ENTRYPOINT !== A5_STRUCTURED_ENTRYPOINT) errors.push("STRUCTURED_ENTRYPOINT_MISMATCH");
  if (intent?.SHELL_EXECUTION !== A5_SHELL_EXECUTION) errors.push("SHELL_EXECUTION_MISMATCH");
  if (intent?.SECRET_PERSISTENCE !== A5_SECRET_PERSISTENCE) errors.push("SECRET_PERSISTENCE_MISMATCH");

  const contract = intent?.CONTRACT_SET_REF;
  if (!isObject(contract)
      || contract.ID !== REV51_CONTRACT_SET_ID
      || contract.VERSION !== REV51_CONTRACT_SET_VERSION
      || contract.SHA256 !== REV51_CONTRACT_SET_SHA256) {
    errors.push("CONTRACT_SET_REF_MISMATCH");
  }

  if (!SHA256_RE.test(intent?.A5_INTENT_SHA256 ?? "")) errors.push("A5_INTENT_SHA256_INVALID");
  else {
    try {
      if (computeCapabilityResourceSecurityIntentSha256V1(intent) !== intent.A5_INTENT_SHA256) errors.push("A5_INTENT_SHA256_MISMATCH");
    } catch (error) {
      errors.push("A5_CANONICALIZATION_REJECTED:" + error.message);
    }
  }

  return { ok: errors.length === 0, errors };
}

export function validateA5CrossStackSemanticBindingV1(taskContract, executionIntent, a5Intent) {
  const errors = [];

  const taskCheck = validateTaskContractAnchor(taskContract);
  if (!taskCheck.ok) errors.push(...taskCheck.errors.map((error) => "TASK:" + error));

  const executionCheck = validateExecutionIntentV1(executionIntent);
  if (!executionCheck.ok) errors.push(...executionCheck.errors.map((error) => "EXECUTION_INTENT:" + error));

  const a5Check = validateCapabilityResourceSecurityIntentV1(a5Intent);
  if (!a5Check.ok) errors.push(...a5Check.errors.map((error) => "A5:" + error));

  if (!isObject(taskContract) || !isObject(executionIntent) || !isObject(a5Intent)) {
    return { ok: false, errors: ["A5_BINDING_INPUT_REQUIRED", ...errors] };
  }

  if (executionIntent.TASK_CONTRACT_SHA256 !== taskContract.TASK_CONTRACT_HASH) {
    errors.push("EXECUTION_INTENT_TASK_CONTRACT_BINDING_MISMATCH");
  }

  for (const key of ["PROJECT_ID", "PHASE_ID", "TASK_ID"]) {
    if (a5Intent[key] !== taskContract[key] || a5Intent[key] !== executionIntent[key]) {
      errors.push(key + "_BINDING_MISMATCH");
    }
  }

  if (a5Intent.TASK_CONTRACT_SHA256 !== taskContract.TASK_CONTRACT_HASH) errors.push("A5_TASK_CONTRACT_SHA256_BINDING_MISMATCH");
  if (a5Intent.EXECUTION_INTENT_SHA256 !== executionIntent.INTENT_SHA256) errors.push("EXECUTION_INTENT_SHA256_BINDING_MISMATCH");

  if (!exactArray(a5Intent.CAPABILITY_REQUIREMENT_REFS, taskContract.CAPABILITY_REQUIREMENTS)
      || !exactArray(a5Intent.CAPABILITY_REQUIREMENT_REFS, executionIntent.CAPABILITY_REQUIREMENTS)) {
    errors.push("CAPABILITY_REQUIREMENT_BINDING_MISMATCH");
  }

  if (!exactJson(a5Intent.RESOURCE_INTENT, executionIntent.RESOURCE_INTENT)) errors.push("RESOURCE_INTENT_BINDING_MISMATCH");
  if (!exactJson(a5Intent.SECURITY_REQUIREMENT, executionIntent.SECURITY_REQUIREMENT)) errors.push("SECURITY_REQUIREMENT_BINDING_MISMATCH");

  for (const capability of a5Intent.CAPABILITY_REQUIREMENT_REFS ?? []) {
    if (!taskContract.CAPABILITY_REQUIREMENTS.includes(capability)) errors.push("CAPABILITY_ESCALATION_DENY:" + capability);
  }

  return { ok: errors.length === 0, errors };
}

export function buildCapabilityResourceSecurityIntentV1(taskContract, executionIntent) {
  const taskCheck = validateTaskContractAnchor(taskContract);
  if (!taskCheck.ok) throw new Error("INVALID_TASK_CONTRACT_ANCHOR:" + taskCheck.errors.join("|"));

  const executionCheck = validateExecutionIntentV1(executionIntent);
  if (!executionCheck.ok) throw new Error("INVALID_EXECUTION_INTENT:" + executionCheck.errors.join("|"));

  if (executionIntent.TASK_CONTRACT_SHA256 !== taskContract.TASK_CONTRACT_HASH) {
    throw new Error("EXECUTION_INTENT_TASK_CONTRACT_BINDING_MISMATCH");
  }

  const intent = {
    INTENT_TYPE: PILOTE_CAPABILITY_RESOURCE_SECURITY_INTENT_TYPE,
    INTENT_VERSION: PILOTE_CAPABILITY_RESOURCE_SECURITY_INTENT_VERSION,
    CANONICALIZATION_ID: A5_CANONICALIZATION_ID,
    PROJECT_ID: taskContract.PROJECT_ID,
    PHASE_ID: taskContract.PHASE_ID,
    TASK_ID: taskContract.TASK_ID,
    TASK_CONTRACT_SHA256: taskContract.TASK_CONTRACT_HASH,
    EXECUTION_INTENT_SHA256: executionIntent.INTENT_SHA256,
    CAPABILITY_REQUIREMENT_REFS: [...executionIntent.CAPABILITY_REQUIREMENTS],
    RESOURCE_INTENT: structuredClone(executionIntent.RESOURCE_INTENT),
    SECURITY_REQUIREMENT: structuredClone(executionIntent.SECURITY_REQUIREMENT),
    CAPABILITY_ATTESTATION_POLICY: A5_CAPABILITY_ATTESTATION_POLICY,
    CAPABILITY_DRIFT_POLICY: A5_CAPABILITY_DRIFT_POLICY,
    RESOURCE_OWNERSHIP_PROOF_POLICY: A5_RESOURCE_OWNERSHIP_PROOF_POLICY,
    HOST_MOUNT_POLICY: A5_HOST_MOUNT_POLICY,
    HOST_SECRET_INHERITANCE: A5_HOST_SECRET_INHERITANCE,
    PRIVILEGED_WORKER: A5_PRIVILEGED_WORKER,
    UNTRUSTED_CODE_ON_PERSISTENT_WORKER: A5_UNTRUSTED_CODE_ON_PERSISTENT_WORKER,
    JOB_SCOPED_CREDENTIAL_LEASE: A5_JOB_SCOPED_CREDENTIAL_LEASE,
    BOOTSTRAP_CREDENTIAL_PRIVILEGED_JOB_EQUIVALENCE: A5_BOOTSTRAP_CREDENTIAL_PRIVILEGED_JOB_EQUIVALENCE,
    UNATTESTED_WORKER_PRIVILEGED_JOB_CREDENTIAL: A5_UNATTESTED_WORKER_PRIVILEGED_JOB_CREDENTIAL,
    WARM_REUSE_SANITATION_RECEIPT: A5_WARM_REUSE_SANITATION_RECEIPT,
    STRUCTURED_ENTRYPOINT: A5_STRUCTURED_ENTRYPOINT,
    SHELL_EXECUTION: A5_SHELL_EXECUTION,
    SECRET_PERSISTENCE: A5_SECRET_PERSISTENCE,
    CONTRACT_SET_REF: {
      ID: REV51_CONTRACT_SET_ID,
      VERSION: REV51_CONTRACT_SET_VERSION,
      SHA256: REV51_CONTRACT_SET_SHA256
    },
    A5_INTENT_SHA256: "0".repeat(64)
  };

  intent.A5_INTENT_SHA256 = computeCapabilityResourceSecurityIntentSha256V1(intent);

  const binding = validateA5CrossStackSemanticBindingV1(taskContract, executionIntent, intent);
  if (!binding.ok) throw new Error("BUILT_A5_INTENT_INVALID:" + binding.errors.join("|"));

  return intent;
}
