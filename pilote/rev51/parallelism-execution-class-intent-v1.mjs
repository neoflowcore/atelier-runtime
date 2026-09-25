import { createHash } from "node:crypto";
import { canonicalizeExecutionV1 } from "./canonicalize-execution-v1.mjs";
import {
  REV51_CONTRACT_SET_ID,
  REV51_CONTRACT_SET_SHA256,
  REV51_CONTRACT_SET_VERSION,
  validateExecutionIntentV1,
  validateTaskContractAnchor
} from "./execution-intent-v1.mjs";

export const PILOTE_PARALLELISM_EXECUTION_CLASS_INTENT_TYPE =
  "PILOTE_PARALLELISM_EXECUTION_CLASS_INTENT_V1";
export const PILOTE_PARALLELISM_EXECUTION_CLASS_INTENT_VERSION = "1.0.0";
export const A6_CANONICALIZATION_ID = "ATELIER_EXECUTION_CANONICAL_JSON_V1";

export const EXECUTION_CLASSES = Object.freeze([
  "RUNTIME_DEFAULT",
  "HOSTED_ELIGIBLE",
  "SELF_HOSTED_REQUIRED",
  "HOST_LOCAL_REQUIRED"
]);

export const PARALLELISM_INTENTS = Object.freeze([
  "INHERIT_DAG",
  "PARALLEL_ALLOWED",
  "SERIAL_REQUIRED"
]);

export const PARALLEL_ALLOWED_POLICY = "PERMISSION_NOT_OBLIGATION";
export const INHERIT_DAG_POLICY = "FOLLOW_SEMANTIC_DAG";
export const SERIAL_REQUIRED_POLICY = "EFFECTIVE_CAP_ONE";
export const RUNTIME_STRICTER_LIMIT_POLICY = "ALLOW";
export const RUNTIME_SEMANTIC_EDGE_ADD_POLICY = "DENY";
export const RUNTIME_SEMANTIC_EDGE_REMOVE_POLICY = "DENY";
export const RUNTIME_EXECUTION_ONLY_EDGE_ADD_POLICY = "ALLOW";
export const HARD_EXECUTION_CLASS_DOWNGRADE_POLICY = "DENY";
export const EXECUTION_CLASS_PROVIDER_SELECTION_POLICY = "RUNTIME_OWNED";
export const PROVIDER_TRANSPORT_INDEPENDENCE_POLICY = "REQUIRED";
export const ADMISSION_INTERSECTION_POLICY = "ALL_APPLICABLE_LIMITS_MUST_PASS";

const A6_KEYS = Object.freeze([
  "A6_INTENT_SHA256",
  "ADMISSION_INTERSECTION_POLICY",
  "CANONICALIZATION_ID",
  "CONTRACT_SET_REF",
  "EFFECTIVE_PARALLELISM_CAP",
  "EXECUTION_CLASS",
  "EXECUTION_CLASS_PROVIDER_SELECTION",
  "EXECUTION_CLASS_SOURCE_REF",
  "EXECUTION_INTENT_SHA256",
  "HARD_EXECUTION_CLASS_DOWNGRADE",
  "INHERIT_DAG_POLICY",
  "INTENT_TYPE",
  "INTENT_VERSION",
  "MAX_PARALLELISM",
  "MAX_PARALLELISM_SOURCE_REF",
  "PARALLELISM_INTENT",
  "PARALLELISM_INTENT_SOURCE_REF",
  "PARALLEL_ALLOWED_POLICY",
  "PHASE_ID",
  "PROJECT_ID",
  "PROVIDER_TRANSPORT_INDEPENDENCE",
  "RUNTIME_EXECUTION_ONLY_EDGE_ADD",
  "RUNTIME_SEMANTIC_EDGE_ADD",
  "RUNTIME_SEMANTIC_EDGE_REMOVE",
  "RUNTIME_STRICTER_LIMIT",
  "SEMANTIC_DEPENDENCY_REFS",
  "SEMANTIC_DEPENDENCY_REFS_SOURCE_REF",
  "SERIAL_REQUIRED_POLICY",
  "TASK_CONTRACT_SHA256",
  "TASK_ID"
]);

const CONTRACT_REF_KEYS = Object.freeze(["ID", "SHA256", "VERSION"]);
const EXECUTION_CLASS_SET = new Set(EXECUTION_CLASSES);
const PARALLELISM_SET = new Set(PARALLELISM_INTENTS);
const SHA256_RE = /^[0-9a-f]{64}$/;

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
  "RESERVATION_ID",
  "SCHEDULER_ID",
  "QUEUE_ID"
]);

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected) {
  if (!isObject(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index]);
}

function exactArray(left, right) {
  return Array.isArray(left)
    && left.length === right.length
    && left.every((item, index) => item === right[index]);
}

function uniqueStrings(value) {
  return Array.isArray(value)
    && value.every((item) => typeof item === "string" && item.length > 0)
    && new Set(value).size === value.length;
}

function scanForbidden(value, path = "$") {
  const errors = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => errors.push(...scanForbidden(item, path + "[" + index + "]")));
  } else if (isObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_RUNTIME_OWNED_KEYS.has(key)) {
        errors.push("FORBIDDEN_RUNTIME_OWNED_KEY:" + path + "." + key);
      }
      errors.push(...scanForbidden(child, path + "." + key));
    }
  }
  return errors;
}

export function deriveParallelismProjectionV1(parallelismIntent, maxParallelism) {
  if (!PARALLELISM_SET.has(parallelismIntent)) {
    throw new Error("PARALLELISM_INTENT_UNSUPPORTED");
  }
  if (!Number.isSafeInteger(maxParallelism) || maxParallelism < 1 || maxParallelism > 1024) {
    throw new Error("MAX_PARALLELISM_INVALID");
  }

  if (parallelismIntent === "SERIAL_REQUIRED") {
    return Object.freeze({
      SCHEDULING_MODE: "SERIAL_ONLY",
      EFFECTIVE_PARALLELISM_CAP: 1,
      PARALLELISM_IS_PERMISSION_ONLY: false,
      SEMANTIC_DAG_MUST_BE_PRESERVED: true
    });
  }

  if (parallelismIntent === "PARALLEL_ALLOWED") {
    return Object.freeze({
      SCHEDULING_MODE: "PARALLEL_PERMITTED",
      EFFECTIVE_PARALLELISM_CAP: maxParallelism,
      PARALLELISM_IS_PERMISSION_ONLY: true,
      SEMANTIC_DAG_MUST_BE_PRESERVED: true
    });
  }

  return Object.freeze({
    SCHEDULING_MODE: "DAG_CONSTRAINED",
    EFFECTIVE_PARALLELISM_CAP: maxParallelism,
    PARALLELISM_IS_PERMISSION_ONLY: true,
    SEMANTIC_DAG_MUST_BE_PRESERVED: true
  });
}

export function deriveExecutionClassProjectionV1(executionClass) {
  if (!EXECUTION_CLASS_SET.has(executionClass)) {
    throw new Error("EXECUTION_CLASS_UNSUPPORTED");
  }

  if (executionClass === "SELF_HOSTED_REQUIRED") {
    return Object.freeze({
      CONSTRAINT_KIND: "HARD_REQUIREMENT",
      REQUIRED_CLASS: "SELF_HOSTED",
      HOSTED_ELIGIBLE: false,
      CONCRETE_PROVIDER_SELECTION: "RUNTIME_OWNED",
      SILENT_DOWNGRADE_ALLOWED: false
    });
  }

  if (executionClass === "HOST_LOCAL_REQUIRED") {
    return Object.freeze({
      CONSTRAINT_KIND: "HARD_REQUIREMENT",
      REQUIRED_CLASS: "HOST_LOCAL",
      HOSTED_ELIGIBLE: false,
      CONCRETE_PROVIDER_SELECTION: "RUNTIME_OWNED",
      SILENT_DOWNGRADE_ALLOWED: false
    });
  }

  if (executionClass === "HOSTED_ELIGIBLE") {
    return Object.freeze({
      CONSTRAINT_KIND: "ELIGIBILITY",
      REQUIRED_CLASS: null,
      HOSTED_ELIGIBLE: true,
      CONCRETE_PROVIDER_SELECTION: "RUNTIME_OWNED",
      SILENT_DOWNGRADE_ALLOWED: false
    });
  }

  return Object.freeze({
    CONSTRAINT_KIND: "RUNTIME_DEFAULT",
    REQUIRED_CLASS: null,
    HOSTED_ELIGIBLE: null,
    CONCRETE_PROVIDER_SELECTION: "RUNTIME_OWNED",
    SILENT_DOWNGRADE_ALLOWED: false
  });
}

export function computeParallelismExecutionClassIntentSha256V1(intent) {
  const copy = structuredClone(intent);
  delete copy.A6_INTENT_SHA256;
  return createHash("sha256")
    .update(canonicalizeExecutionV1(copy))
    .digest("hex");
}

export function validateParallelismExecutionClassIntentV1(intent) {
  const errors = [];

  if (!exactKeys(intent, A6_KEYS)) errors.push("A6_TOP_LEVEL_FIELDS_MISMATCH");
  errors.push(...scanForbidden(intent));

  if (intent?.INTENT_TYPE !== PILOTE_PARALLELISM_EXECUTION_CLASS_INTENT_TYPE) {
    errors.push("A6_INTENT_TYPE_MISMATCH");
  }
  if (intent?.INTENT_VERSION !== PILOTE_PARALLELISM_EXECUTION_CLASS_INTENT_VERSION) {
    errors.push("A6_INTENT_VERSION_MISMATCH");
  }
  if (intent?.CANONICALIZATION_ID !== A6_CANONICALIZATION_ID) {
    errors.push("A6_CANONICALIZATION_ID_MISMATCH");
  }

  for (const key of ["PROJECT_ID", "PHASE_ID", "TASK_ID"]) {
    if (typeof intent?.[key] !== "string" || intent[key].length === 0) {
      errors.push(key + "_INVALID");
    }
  }

  if (!SHA256_RE.test(intent?.TASK_CONTRACT_SHA256 ?? "")) {
    errors.push("TASK_CONTRACT_SHA256_INVALID");
  }
  if (!SHA256_RE.test(intent?.EXECUTION_INTENT_SHA256 ?? "")) {
    errors.push("EXECUTION_INTENT_SHA256_INVALID");
  }
  if (!EXECUTION_CLASS_SET.has(intent?.EXECUTION_CLASS)) {
    errors.push("EXECUTION_CLASS_INVALID");
  }
  if (!PARALLELISM_SET.has(intent?.PARALLELISM_INTENT)) {
    errors.push("PARALLELISM_INTENT_INVALID");
  }
  if (!Number.isSafeInteger(intent?.MAX_PARALLELISM)
      || intent.MAX_PARALLELISM < 1
      || intent.MAX_PARALLELISM > 1024) {
    errors.push("MAX_PARALLELISM_INVALID");
  }
  if (!uniqueStrings(intent?.SEMANTIC_DEPENDENCY_REFS)) {
    errors.push("SEMANTIC_DEPENDENCY_REFS_INVALID");
  }

  if (intent?.EXECUTION_CLASS_SOURCE_REF !== "task-contract:RESOURCE_REQUIREMENTS.EXECUTION_CLASS") {
    errors.push("EXECUTION_CLASS_SOURCE_REF_MISMATCH");
  }
  if (intent?.PARALLELISM_INTENT_SOURCE_REF !== "execution-intent:PARALLELISM_INTENT") {
    errors.push("PARALLELISM_INTENT_SOURCE_REF_MISMATCH");
  }
  if (intent?.SEMANTIC_DEPENDENCY_REFS_SOURCE_REF !== "execution-intent:SEMANTIC_DEPENDENCY_REFS") {
    errors.push("SEMANTIC_DEPENDENCY_REFS_SOURCE_REF_MISMATCH");
  }
  if (intent?.MAX_PARALLELISM_SOURCE_REF !== "task-contract:ECONOMY_BUDGET.MAX_PARALLELISM") {
    errors.push("MAX_PARALLELISM_SOURCE_REF_MISMATCH");
  }

  try {
    const projection = deriveParallelismProjectionV1(intent.PARALLELISM_INTENT, intent.MAX_PARALLELISM);
    if (intent.EFFECTIVE_PARALLELISM_CAP !== projection.EFFECTIVE_PARALLELISM_CAP) {
      errors.push("EFFECTIVE_PARALLELISM_CAP_MISMATCH");
    }
  } catch (error) {
    errors.push("PARALLELISM_PROJECTION_REJECTED:" + error.message);
  }

  if (intent?.PARALLEL_ALLOWED_POLICY !== PARALLEL_ALLOWED_POLICY) {
    errors.push("PARALLEL_ALLOWED_POLICY_MISMATCH");
  }
  if (intent?.INHERIT_DAG_POLICY !== INHERIT_DAG_POLICY) {
    errors.push("INHERIT_DAG_POLICY_MISMATCH");
  }
  if (intent?.SERIAL_REQUIRED_POLICY !== SERIAL_REQUIRED_POLICY) {
    errors.push("SERIAL_REQUIRED_POLICY_MISMATCH");
  }
  if (intent?.RUNTIME_STRICTER_LIMIT !== RUNTIME_STRICTER_LIMIT_POLICY) {
    errors.push("RUNTIME_STRICTER_LIMIT_MISMATCH");
  }
  if (intent?.RUNTIME_SEMANTIC_EDGE_ADD !== RUNTIME_SEMANTIC_EDGE_ADD_POLICY) {
    errors.push("RUNTIME_SEMANTIC_EDGE_ADD_MISMATCH");
  }
  if (intent?.RUNTIME_SEMANTIC_EDGE_REMOVE !== RUNTIME_SEMANTIC_EDGE_REMOVE_POLICY) {
    errors.push("RUNTIME_SEMANTIC_EDGE_REMOVE_MISMATCH");
  }
  if (intent?.RUNTIME_EXECUTION_ONLY_EDGE_ADD !== RUNTIME_EXECUTION_ONLY_EDGE_ADD_POLICY) {
    errors.push("RUNTIME_EXECUTION_ONLY_EDGE_ADD_MISMATCH");
  }
  if (intent?.HARD_EXECUTION_CLASS_DOWNGRADE !== HARD_EXECUTION_CLASS_DOWNGRADE_POLICY) {
    errors.push("HARD_EXECUTION_CLASS_DOWNGRADE_MISMATCH");
  }
  if (intent?.EXECUTION_CLASS_PROVIDER_SELECTION !== EXECUTION_CLASS_PROVIDER_SELECTION_POLICY) {
    errors.push("EXECUTION_CLASS_PROVIDER_SELECTION_MISMATCH");
  }
  if (intent?.PROVIDER_TRANSPORT_INDEPENDENCE !== PROVIDER_TRANSPORT_INDEPENDENCE_POLICY) {
    errors.push("PROVIDER_TRANSPORT_INDEPENDENCE_MISMATCH");
  }
  if (intent?.ADMISSION_INTERSECTION_POLICY !== ADMISSION_INTERSECTION_POLICY) {
    errors.push("ADMISSION_INTERSECTION_POLICY_MISMATCH");
  }

  const contract = intent?.CONTRACT_SET_REF;
  if (
    !exactKeys(contract, CONTRACT_REF_KEYS)
    || contract.ID !== REV51_CONTRACT_SET_ID
    || contract.VERSION !== REV51_CONTRACT_SET_VERSION
    || contract.SHA256 !== REV51_CONTRACT_SET_SHA256
  ) {
    errors.push("CONTRACT_SET_REF_MISMATCH");
  }

  if (!SHA256_RE.test(intent?.A6_INTENT_SHA256 ?? "")) {
    errors.push("A6_INTENT_SHA256_INVALID");
  } else {
    try {
      if (computeParallelismExecutionClassIntentSha256V1(intent) !== intent.A6_INTENT_SHA256) {
        errors.push("A6_INTENT_SHA256_MISMATCH");
      }
    } catch (error) {
      errors.push("A6_CANONICALIZATION_REJECTED:" + error.message);
    }
  }

  return { ok: errors.length === 0, errors };
}

export function validateA6CrossStackSemanticBindingV1(taskContract, executionIntent, a6Intent) {
  const errors = [];

  const taskCheck = validateTaskContractAnchor(taskContract);
  if (!taskCheck.ok) errors.push(...taskCheck.errors.map((error) => "TASK:" + error));

  const executionCheck = validateExecutionIntentV1(executionIntent);
  if (!executionCheck.ok) {
    errors.push(...executionCheck.errors.map((error) => "EXECUTION_INTENT:" + error));
  }

  const a6Check = validateParallelismExecutionClassIntentV1(a6Intent);
  if (!a6Check.ok) errors.push(...a6Check.errors.map((error) => "A6:" + error));

  if (!isObject(taskContract) || !isObject(executionIntent) || !isObject(a6Intent)) {
    return { ok: false, errors: ["A6_BINDING_INPUT_REQUIRED", ...errors] };
  }

  if (executionIntent.TASK_CONTRACT_SHA256 !== taskContract.TASK_CONTRACT_HASH) {
    errors.push("EXECUTION_INTENT_TASK_CONTRACT_BINDING_MISMATCH");
  }

  for (const key of ["PROJECT_ID", "PHASE_ID", "TASK_ID"]) {
    if (a6Intent[key] !== taskContract[key] || a6Intent[key] !== executionIntent[key]) {
      errors.push(key + "_BINDING_MISMATCH");
    }
  }

  if (a6Intent.TASK_CONTRACT_SHA256 !== taskContract.TASK_CONTRACT_HASH) {
    errors.push("A6_TASK_CONTRACT_SHA256_BINDING_MISMATCH");
  }
  if (a6Intent.EXECUTION_INTENT_SHA256 !== executionIntent.INTENT_SHA256) {
    errors.push("EXECUTION_INTENT_SHA256_BINDING_MISMATCH");
  }
  if (a6Intent.EXECUTION_CLASS !== taskContract.RESOURCE_REQUIREMENTS.EXECUTION_CLASS) {
    errors.push("EXECUTION_CLASS_BINDING_MISMATCH");
  }
  if (a6Intent.PARALLELISM_INTENT !== executionIntent.PARALLELISM_INTENT) {
    errors.push("PARALLELISM_INTENT_BINDING_MISMATCH");
  }
  if (!exactArray(a6Intent.SEMANTIC_DEPENDENCY_REFS, executionIntent.SEMANTIC_DEPENDENCY_REFS)) {
    errors.push("SEMANTIC_DEPENDENCY_REFS_BINDING_MISMATCH");
  }
  if (a6Intent.MAX_PARALLELISM !== taskContract.ECONOMY_BUDGET.MAX_PARALLELISM) {
    errors.push("MAX_PARALLELISM_BINDING_MISMATCH");
  }

  return { ok: errors.length === 0, errors };
}

export function buildParallelismExecutionClassIntentV1(taskContract, executionIntent) {
  const taskCheck = validateTaskContractAnchor(taskContract);
  if (!taskCheck.ok) {
    throw new Error("INVALID_TASK_CONTRACT_ANCHOR:" + taskCheck.errors.join("|"));
  }

  const executionCheck = validateExecutionIntentV1(executionIntent);
  if (!executionCheck.ok) {
    throw new Error("INVALID_EXECUTION_INTENT:" + executionCheck.errors.join("|"));
  }

  if (executionIntent.TASK_CONTRACT_SHA256 !== taskContract.TASK_CONTRACT_HASH) {
    throw new Error("EXECUTION_INTENT_TASK_CONTRACT_BINDING_MISMATCH");
  }

  const projection = deriveParallelismProjectionV1(
    executionIntent.PARALLELISM_INTENT,
    taskContract.ECONOMY_BUDGET.MAX_PARALLELISM
  );

  const intent = {
    INTENT_TYPE: PILOTE_PARALLELISM_EXECUTION_CLASS_INTENT_TYPE,
    INTENT_VERSION: PILOTE_PARALLELISM_EXECUTION_CLASS_INTENT_VERSION,
    CANONICALIZATION_ID: A6_CANONICALIZATION_ID,
    PROJECT_ID: taskContract.PROJECT_ID,
    PHASE_ID: taskContract.PHASE_ID,
    TASK_ID: taskContract.TASK_ID,
    TASK_CONTRACT_SHA256: taskContract.TASK_CONTRACT_HASH,
    EXECUTION_INTENT_SHA256: executionIntent.INTENT_SHA256,
    EXECUTION_CLASS: taskContract.RESOURCE_REQUIREMENTS.EXECUTION_CLASS,
    EXECUTION_CLASS_SOURCE_REF: "task-contract:RESOURCE_REQUIREMENTS.EXECUTION_CLASS",
    PARALLELISM_INTENT: executionIntent.PARALLELISM_INTENT,
    PARALLELISM_INTENT_SOURCE_REF: "execution-intent:PARALLELISM_INTENT",
    SEMANTIC_DEPENDENCY_REFS: [...executionIntent.SEMANTIC_DEPENDENCY_REFS],
    SEMANTIC_DEPENDENCY_REFS_SOURCE_REF: "execution-intent:SEMANTIC_DEPENDENCY_REFS",
    MAX_PARALLELISM: taskContract.ECONOMY_BUDGET.MAX_PARALLELISM,
    MAX_PARALLELISM_SOURCE_REF: "task-contract:ECONOMY_BUDGET.MAX_PARALLELISM",
    EFFECTIVE_PARALLELISM_CAP: projection.EFFECTIVE_PARALLELISM_CAP,
    PARALLEL_ALLOWED_POLICY,
    INHERIT_DAG_POLICY,
    SERIAL_REQUIRED_POLICY,
    RUNTIME_STRICTER_LIMIT: RUNTIME_STRICTER_LIMIT_POLICY,
    RUNTIME_SEMANTIC_EDGE_ADD: RUNTIME_SEMANTIC_EDGE_ADD_POLICY,
    RUNTIME_SEMANTIC_EDGE_REMOVE: RUNTIME_SEMANTIC_EDGE_REMOVE_POLICY,
    RUNTIME_EXECUTION_ONLY_EDGE_ADD: RUNTIME_EXECUTION_ONLY_EDGE_ADD_POLICY,
    HARD_EXECUTION_CLASS_DOWNGRADE: HARD_EXECUTION_CLASS_DOWNGRADE_POLICY,
    EXECUTION_CLASS_PROVIDER_SELECTION: EXECUTION_CLASS_PROVIDER_SELECTION_POLICY,
    PROVIDER_TRANSPORT_INDEPENDENCE: PROVIDER_TRANSPORT_INDEPENDENCE_POLICY,
    ADMISSION_INTERSECTION_POLICY,
    CONTRACT_SET_REF: {
      ID: REV51_CONTRACT_SET_ID,
      VERSION: REV51_CONTRACT_SET_VERSION,
      SHA256: REV51_CONTRACT_SET_SHA256
    },
    A6_INTENT_SHA256: "0".repeat(64)
  };

  intent.A6_INTENT_SHA256 =
    computeParallelismExecutionClassIntentSha256V1(intent);

  const binding = validateA6CrossStackSemanticBindingV1(
    taskContract,
    executionIntent,
    intent
  );
  if (!binding.ok) {
    throw new Error("BUILT_A6_INTENT_INVALID:" + binding.errors.join("|"));
  }
  return intent;
}
