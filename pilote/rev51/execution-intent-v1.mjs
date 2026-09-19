import { createHash } from "node:crypto";
import { canonicalizeExecutionV1, computeExecutionIntentSha256 } from "./canonicalize-execution-v1.mjs";

export const PILOTE_EXECUTION_INTENT_TYPE = "PILOTE_EXECUTION_INTENT_V1";
export const PILOTE_EXECUTION_INTENT_VERSION = "1.0.0";
export const EXECUTION_CANONICALIZATION_ID = "ATELIER_EXECUTION_CANONICAL_JSON_V1";
export const REV51_CONTRACT_SET_ID = "ATELIER_REV51_CONTRACT_SET_V1";
export const REV51_CONTRACT_SET_VERSION = "1.0.0";
export const REV51_CONTRACT_SET_SHA256 = "a8b220c92a47306061e9aca1c65077d357b00bda12e9daad4f37215256083f4a";

export const FROZEN_TASK_CONTRACT_FIELDS = Object.freeze([
  "TASK_ID","PROJECT_ID","PHASE_ID","TASK_CLASS","WORKLOAD_CLASS","SOURCE_IDENTITY","EXPECTED_HEAD",
  "EFFECT_CLASSES","ALLOWED_SCOPE","TOUCH_SET","CAPABILITY_REQUIREMENTS","RESOURCE_REQUIREMENTS",
  "NETWORK_CLASS","DATA_ACCESS_CLASS","SECRET_CLASS","REMOTE_MUTATION_INTENT","HOST_OPERATION_INTENT",
  "ORACLE_REQUIREMENT","ACCEPTANCE_REQUIREMENTS","VERIFIER_REQUIREMENTS","ECONOMY_BUDGET","INTERVENTION_POLICY",
  "REPLAN_BOUNDARY","EXPECTED_OUTPUTS","EXPECTED_EVIDENCE","CONTRACT_VERSION","TASK_CONTRACT_HASH"
]);

const SHA256_RE = /^[0-9a-f]{64}$/;
const EXEC_PATHS = new Set(["RUNTIME_DECIDES","DIRECT_REMOTE_ALLOWED","DIRECT_REMOTE_REQUIRED","GITHUB_GATE_REQUIRED"]);
const TRI_POLICY = new Set(["NOT_REQUESTED","ELIGIBLE","REQUIRED"]);
const LOCALITY = new Set(["NONE","COLOCATE_WITH_INPUT_SET","EGRESS_RESTRICTED"]);
const OPERATOR = new Set(["ZERO_TOUCH_AFTER_APPROVAL","RECOVERY_INTERACTION_ALLOWED"]);
const PARALLEL = new Set(["INHERIT_DAG","PARALLEL_ALLOWED","SERIAL_REQUIRED"]);
const ISOLATION = new Set(["DEFAULT","ISOLATED","HIGH_ISOLATION"]);
const NETWORK = new Set(["INHERIT_TASK","NONE","LOOPBACK_ONLY","ALLOWLIST_READ","ALLOWLIST_MUTATE"]);
const DATA = new Set(["INHERIT_TASK","PUBLIC","PROJECT_INTERNAL","PRIVATE_SOURCE","PRODUCTION"]);
const SECRET = new Set(["INHERIT_TASK","NONE","SOURCE_READ","SOURCE_WRITE","PROVIDER_MUTATION","PRODUCTION_CONTROL"]);
const APPROVAL_MODE = new Set(["INHERIT_TASK","EXPLICIT_HUMAN_APPROVAL","NO_ADDITIONAL_APPROVAL"]);

const FORBIDDEN_KEYS = new Set([
  "PROVIDER_ID","PROVIDER_ACCOUNT_OR_TENANT_ID","PROVIDER_RESOURCE_ID","WORKER_ID","VM_ID","DROPLET_ID",
  "RUNNER_ID","JIT_REGISTRATION_ID","LEASE_ID","EXECUTION_ID","ATTEMPT_ID","FENCE_TOKEN","OPERATION_ID",
  "IDEMPOTENCY_KEY","SECRET_VALUE","BACKEND_INSTANCE_ID"
]);

const TOP_LEVEL_KEYS = Object.freeze([
  "ACCEPTANCE_REQUIREMENT_REF","APPROVAL_BOUNDARY","BUDGET_INTENT","CACHE_POLICY","CANONICALIZATION_ID",
  "CAPABILITY_REQUIREMENTS","CHECKPOINT_POLICY","CONTRACT_SET_REF","DATA_LOCALITY_POLICY","EXECUTION_PATH_POLICY",
  "EXPECTED_EVIDENCE_CLASSES","EXPECTED_OUTPUT_CLASSES","INPUT_MODE","INTENT_SHA256","INTENT_TYPE","INTENT_VERSION",
  "OPERATOR_POLICY","PARALLELISM_INTENT","PHASE_ID","PROJECT_ID","RESOURCE_INTENT","SECURITY_REQUIREMENT",
  "SEMANTIC_DEPENDENCY_REFS","TASK_CONTRACT_SHA256","TASK_ID","VERIFIER_POLICY_REF"
]);

function isObject(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
function exactKeys(obj, expected) {
  if (!isObject(obj)) return false;
  const a = Object.keys(obj).sort();
  const b = [...expected].sort();
  return a.length === b.length && a.every((x,i) => x === b[i]);
}
function uniqueStrings(xs) {
  return Array.isArray(xs) && xs.every(x => typeof x === "string") && new Set(xs).size === xs.length;
}
function scanForbidden(value, path = "$") {
  const errors = [];
  if (Array.isArray(value)) {
    value.forEach((v,i) => errors.push(...scanForbidden(v, `${path}[${i}]`)));
  } else if (isObject(value)) {
    for (const [k,v] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(k)) errors.push(`FORBIDDEN_INFRASTRUCTURE_KEY:${path}.${k}`);
      errors.push(...scanForbidden(v, `${path}.${k}`));
    }
  }
  return errors;
}
function taskCanon(v) {
  if (v === null) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v)) throw new Error("TASK_CONTRACT_NON_SAFE_INTEGER");
    return String(v);
  }
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(taskCanon).join(",")}]`;
  if (isObject(v)) return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${taskCanon(v[k])}`).join(",")}}`;
  throw new Error("TASK_CONTRACT_UNSUPPORTED_JSON_TYPE");
}
export function computeTaskContractHashV1(taskContract) {
  const copy = structuredClone(taskContract);
  delete copy.TASK_CONTRACT_HASH;
  return createHash("sha256").update(taskCanon(copy), "utf8").digest("hex");
}
export function validateTaskContractAnchor(taskContract) {
  const errors = [];
  if (!exactKeys(taskContract, FROZEN_TASK_CONTRACT_FIELDS)) errors.push("TASK_CONTRACT_FROZEN_27_FIELDS_MISMATCH");
  if (taskContract?.CONTRACT_VERSION !== "1.0.0") errors.push("TASK_CONTRACT_VERSION_MISMATCH");
  if (!SHA256_RE.test(taskContract?.TASK_CONTRACT_HASH ?? "")) errors.push("TASK_CONTRACT_HASH_INVALID");
  else if (computeTaskContractHashV1(taskContract) !== taskContract.TASK_CONTRACT_HASH) errors.push("TASK_CONTRACT_HASH_MISMATCH");
  return { ok: errors.length === 0, errors };
}

function normalizeResourceIntent(v = {}) {
  return {
    CPU_MIN_MILLICORES: v.CPU_MIN_MILLICORES ?? null,
    MEMORY_MIN_MIB: v.MEMORY_MIN_MIB ?? null,
    DISK_MIN_MIB: v.DISK_MIN_MIB ?? null,
    GPU_COUNT: v.GPU_COUNT ?? null,
    GPU_MEMORY_MIN_MIB: v.GPU_MEMORY_MIN_MIB ?? null,
    GPU_CAPABILITY_CLASS: v.GPU_CAPABILITY_CLASS ?? null
  };
}
function normalizeSecurityRequirement(v = {}) {
  return {
    ISOLATION_CLASS: v.ISOLATION_CLASS ?? "DEFAULT",
    NETWORK_CLASS: v.NETWORK_CLASS ?? "INHERIT_TASK",
    DATA_ACCESS_CLASS: v.DATA_ACCESS_CLASS ?? "INHERIT_TASK",
    SECRET_CLASS: v.SECRET_CLASS ?? "INHERIT_TASK"
  };
}
function normalizeBudget(v = {}) {
  return {
    MAX_RUNTIME_SECONDS: v.MAX_RUNTIME_SECONDS ?? null,
    MAX_COST_MICRO_USD: v.MAX_COST_MICRO_USD ?? null
  };
}
function defaultApprovalBoundary(task) {
  return {
    MODE: task.REMOTE_MUTATION_INTENT === "EXACT_APPROVAL_REQUIRED" ? "EXPLICIT_HUMAN_APPROVAL" : "INHERIT_TASK",
    EFFECT_CLASS_REFS: [...task.EFFECT_CLASSES],
    SCOPE_REFS: [...task.ALLOWED_SCOPE]
  };
}

export function buildExecutionIntentV1(taskContract, options = {}) {
  const anchor = validateTaskContractAnchor(taskContract);
  if (!anchor.ok) throw new Error(`INVALID_TASK_CONTRACT_ANCHOR:${anchor.errors.join("|")}`);
  if (!isObject(options.verifierPolicyRef)) throw new Error("VERIFIER_POLICY_REF_REQUIRED");

  const intent = {
    INTENT_TYPE: PILOTE_EXECUTION_INTENT_TYPE,
    INTENT_VERSION: PILOTE_EXECUTION_INTENT_VERSION,
    INPUT_MODE: "NATIVE_REV51",
    CANONICALIZATION_ID: EXECUTION_CANONICALIZATION_ID,
    PROJECT_ID: taskContract.PROJECT_ID,
    PHASE_ID: taskContract.PHASE_ID,
    TASK_ID: taskContract.TASK_ID,
    TASK_CONTRACT_SHA256: taskContract.TASK_CONTRACT_HASH,
    EXECUTION_PATH_POLICY: options.executionPathPolicy ?? "RUNTIME_DECIDES",
    CAPABILITY_REQUIREMENTS: [...taskContract.CAPABILITY_REQUIREMENTS],
    RESOURCE_INTENT: normalizeResourceIntent(options.resourceIntent),
    SECURITY_REQUIREMENT: normalizeSecurityRequirement(options.securityRequirement),
    BUDGET_INTENT: normalizeBudget(options.budgetIntent),
    CHECKPOINT_POLICY: options.checkpointPolicy ?? "NOT_REQUESTED",
    CACHE_POLICY: options.cachePolicy ?? "NOT_REQUESTED",
    DATA_LOCALITY_POLICY: options.dataLocalityPolicy ?? "NONE",
    VERIFIER_POLICY_REF: structuredClone(options.verifierPolicyRef),
    ACCEPTANCE_REQUIREMENT_REF: options.acceptanceRequirementRef ?? "task-contract:ACCEPTANCE_REQUIREMENTS",
    APPROVAL_BOUNDARY: structuredClone(options.approvalBoundary ?? defaultApprovalBoundary(taskContract)),
    OPERATOR_POLICY: options.operatorPolicy ?? "ZERO_TOUCH_AFTER_APPROVAL",
    SEMANTIC_DEPENDENCY_REFS: [...(options.semanticDependencyRefs ?? [])],
    PARALLELISM_INTENT: options.parallelismIntent ?? "INHERIT_DAG",
    EXPECTED_OUTPUT_CLASSES: [...(options.expectedOutputClasses ?? ["TASK_DECLARED_OUTPUTS"])],
    EXPECTED_EVIDENCE_CLASSES: [...(options.expectedEvidenceClasses ?? ["TASK_DECLARED_EVIDENCE"])],
    CONTRACT_SET_REF: {
      ID: REV51_CONTRACT_SET_ID,
      VERSION: REV51_CONTRACT_SET_VERSION,
      SHA256: REV51_CONTRACT_SET_SHA256
    },
    INTENT_SHA256: "0".repeat(64)
  };
  intent.INTENT_SHA256 = computeExecutionIntentSha256(intent);
  const checked = validateExecutionIntentV1(intent);
  if (!checked.ok) throw new Error(`BUILT_INTENT_INVALID:${checked.errors.join("|")}`);
  return intent;
}

export function validateExecutionIntentV1(intent) {
  const errors = [];
  if (!exactKeys(intent, TOP_LEVEL_KEYS)) errors.push("INTENT_TOP_LEVEL_FIELDS_MISMATCH");
  errors.push(...scanForbidden(intent));
  if (intent?.INTENT_TYPE !== PILOTE_EXECUTION_INTENT_TYPE) errors.push("INTENT_TYPE_MISMATCH");
  if (intent?.INTENT_VERSION !== PILOTE_EXECUTION_INTENT_VERSION) errors.push("INTENT_VERSION_MISMATCH");
  if (intent?.INPUT_MODE !== "NATIVE_REV51") errors.push("INPUT_MODE_MUST_BE_NATIVE_REV51");
  if (intent?.CANONICALIZATION_ID !== EXECUTION_CANONICALIZATION_ID) errors.push("CANONICALIZATION_ID_MISMATCH");
  if (!SHA256_RE.test(intent?.TASK_CONTRACT_SHA256 ?? "")) errors.push("TASK_CONTRACT_SHA256_INVALID");
  if (!EXEC_PATHS.has(intent?.EXECUTION_PATH_POLICY)) errors.push("EXECUTION_PATH_POLICY_INVALID");
  if (!uniqueStrings(intent?.CAPABILITY_REQUIREMENTS)) errors.push("CAPABILITY_REQUIREMENTS_INVALID");
  if (!TRI_POLICY.has(intent?.CHECKPOINT_POLICY)) errors.push("CHECKPOINT_POLICY_INVALID");
  if (!TRI_POLICY.has(intent?.CACHE_POLICY)) errors.push("CACHE_POLICY_INVALID");
  if (!LOCALITY.has(intent?.DATA_LOCALITY_POLICY)) errors.push("DATA_LOCALITY_POLICY_INVALID");
  if (!OPERATOR.has(intent?.OPERATOR_POLICY)) errors.push("OPERATOR_POLICY_INVALID");
  if (!PARALLEL.has(intent?.PARALLELISM_INTENT)) errors.push("PARALLELISM_INTENT_INVALID");
  if (!uniqueStrings(intent?.SEMANTIC_DEPENDENCY_REFS)) errors.push("SEMANTIC_DEPENDENCY_REFS_INVALID");
  if (!uniqueStrings(intent?.EXPECTED_OUTPUT_CLASSES)) errors.push("EXPECTED_OUTPUT_CLASSES_INVALID");
  if (!uniqueStrings(intent?.EXPECTED_EVIDENCE_CLASSES)) errors.push("EXPECTED_EVIDENCE_CLASSES_INVALID");

  if (!isObject(intent?.CONTRACT_SET_REF) ||
      intent.CONTRACT_SET_REF.ID !== REV51_CONTRACT_SET_ID ||
      intent.CONTRACT_SET_REF.VERSION !== REV51_CONTRACT_SET_VERSION ||
      intent.CONTRACT_SET_REF.SHA256 !== REV51_CONTRACT_SET_SHA256) errors.push("CONTRACT_SET_REF_MISMATCH");

  const s = intent?.SECURITY_REQUIREMENT;
  if (!isObject(s) || !ISOLATION.has(s.ISOLATION_CLASS) || !NETWORK.has(s.NETWORK_CLASS) || !DATA.has(s.DATA_ACCESS_CLASS) || !SECRET.has(s.SECRET_CLASS)) errors.push("SECURITY_REQUIREMENT_INVALID");

  const a = intent?.APPROVAL_BOUNDARY;
  if (!isObject(a) || !APPROVAL_MODE.has(a.MODE) || !uniqueStrings(a.EFFECT_CLASS_REFS) || !uniqueStrings(a.SCOPE_REFS)) errors.push("APPROVAL_BOUNDARY_INVALID");

  const r = intent?.RESOURCE_INTENT;
  if (!isObject(r)) errors.push("RESOURCE_INTENT_INVALID");
  else {
    for (const key of ["CPU_MIN_MILLICORES","MEMORY_MIN_MIB","DISK_MIN_MIB","GPU_COUNT","GPU_MEMORY_MIN_MIB"]) {
      if (r[key] !== null && (!Number.isSafeInteger(r[key]) || r[key] < 0)) errors.push(`RESOURCE_INTENT_INVALID:${key}`);
    }
    if (r.GPU_CAPABILITY_CLASS !== null && typeof r.GPU_CAPABILITY_CLASS !== "string") errors.push("RESOURCE_INTENT_INVALID:GPU_CAPABILITY_CLASS");
  }

  const b = intent?.BUDGET_INTENT;
  if (!isObject(b)) errors.push("BUDGET_INTENT_INVALID");
  else {
    if (b.MAX_RUNTIME_SECONDS !== null && (!Number.isSafeInteger(b.MAX_RUNTIME_SECONDS) || b.MAX_RUNTIME_SECONDS < 1)) errors.push("BUDGET_INTENT_INVALID:MAX_RUNTIME_SECONDS");
    if (b.MAX_COST_MICRO_USD !== null && (!Number.isSafeInteger(b.MAX_COST_MICRO_USD) || b.MAX_COST_MICRO_USD < 0)) errors.push("BUDGET_INTENT_INVALID:MAX_COST_MICRO_USD");
  }

  const v = intent?.VERIFIER_POLICY_REF;
  if (!isObject(v) || typeof v.ID !== "string" || typeof v.VERSION !== "string" || !SHA256_RE.test(v.SHA256 ?? "")) errors.push("VERIFIER_POLICY_REF_INVALID");
  if (typeof intent?.ACCEPTANCE_REQUIREMENT_REF !== "string" || intent.ACCEPTANCE_REQUIREMENT_REF.length === 0) errors.push("ACCEPTANCE_REQUIREMENT_REF_INVALID");

  if (!SHA256_RE.test(intent?.INTENT_SHA256 ?? "")) errors.push("INTENT_SHA256_INVALID");
  else if (computeExecutionIntentSha256(intent) !== intent.INTENT_SHA256) errors.push("INTENT_SHA256_MISMATCH");

  try { canonicalizeExecutionV1(intent); } catch (e) { errors.push(`CANONICALIZATION_REJECTED:${e.message}`); }
  return { ok: errors.length === 0, errors };
}
