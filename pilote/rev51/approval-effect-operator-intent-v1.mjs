import { createHash } from "node:crypto";
import { canonicalizeExecutionV1 } from "./canonicalize-execution-v1.mjs";
import {
  REV51_CONTRACT_SET_ID,
  REV51_CONTRACT_SET_SHA256,
  REV51_CONTRACT_SET_VERSION,
  validateExecutionIntentV1,
  validateTaskContractAnchor
} from "./execution-intent-v1.mjs";

export const PILOTE_APPROVAL_EFFECT_OPERATOR_INTENT_TYPE = "PILOTE_APPROVAL_EFFECT_OPERATOR_INTENT_V1";
export const PILOTE_APPROVAL_EFFECT_OPERATOR_INTENT_VERSION = "1.0.0";
export const A4_CANONICALIZATION_ID = "ATELIER_EXECUTION_CANONICAL_JSON_V1";

export const A4_AUTHORITY_GRANT_POLICY = "DECLARATION_NEVER_GRANTS_AUTHORITY";
export const A4_FIRST_IRREVERSIBLE_REMOTE_SUBMISSION_POLICY = "ATOMIC_APPROVAL_CLAIM_REQUIRED";
export const A4_OUTCOME_UNKNOWN_APPROVAL_POLICY = "SAME_OPERATION_RECONCILE_APPROVAL_REOPEN_DENY";
export const A4_NORMAL_PATH_POLICY = "ZERO_TOUCH_AFTER_APPROVAL";
export const A4_STATE_AFFECTING_INTERVENTION_POLICY = "TRUST_RESET_REQUIRED";
export const A4_OBSERVE_ONLY_INTERVENTION_POLICY = "TRUST_PRESERVED";

const APPROVAL_MODES = new Set([
  "INHERIT_TASK",
  "EXPLICIT_HUMAN_APPROVAL",
  "NO_ADDITIONAL_APPROVAL"
]);

const OPERATOR_POLICIES = new Set([
  "ZERO_TOUCH_AFTER_APPROVAL",
  "RECOVERY_INTERACTION_ALLOWED"
]);

const REMOTE_MUTATION_INTENTS = new Set([
  "NONE",
  "DECLARED",
  "EXACT_APPROVAL_REQUIRED"
]);

const A4_KEYS = Object.freeze([
  "A4_INTENT_SHA256",
  "APPROVAL_MODE",
  "AUTHORITY_GRANT_POLICY",
  "CANONICALIZATION_ID",
  "CONTRACT_SET_REF",
  "EFFECT_CLASS_REFS",
  "EXECUTION_INTENT_SHA256",
  "FIRST_IRREVERSIBLE_REMOTE_SUBMISSION_POLICY",
  "HOST_OPERATION_INTENT",
  "INTENT_TYPE",
  "INTENT_VERSION",
  "INTERVENTION_POLICY",
  "INTERVENTION_POLICY_REF",
  "NORMAL_PATH_POLICY",
  "OBSERVE_ONLY_INTERVENTION_POLICY",
  "OPERATOR_POLICY",
  "OUTCOME_UNKNOWN_APPROVAL_POLICY",
  "PHASE_ID",
  "PROJECT_ID",
  "REMOTE_MUTATION_INTENT",
  "SCOPE_REFS",
  "STATE_AFFECTING_INTERVENTION_POLICY",
  "TASK_CONTRACT_SHA256",
  "TASK_ID"
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
  "APPROVAL_GRANT_ID",
  "APPROVAL_CLAIM_ID",
  "CLAIM_ID"
]);

const SHA256_RE = /^[0-9a-f]{64}$/;
const TOKEN_RE = /^[A-Z][A-Z0-9_.-]{0,63}$/;

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
    && value.every((item) => typeof item === "string")
    && new Set(value).size === value.length;
}

function exactArray(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((item, index) => item === right[index]);
}

function scanForbidden(value, path = "$") {
  const errors = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => errors.push(...scanForbidden(item, `${path}[${index}]`)));
  } else if (isObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_RUNTIME_OWNED_KEYS.has(key)) errors.push(`FORBIDDEN_RUNTIME_OWNED_KEY:${path}.${key}`);
      errors.push(...scanForbidden(child, `${path}.${key}`));
    }
  }
  return errors;
}

export function computeApprovalEffectOperatorIntentSha256V1(intent) {
  const copy = structuredClone(intent);
  delete copy.A4_INTENT_SHA256;
  return createHash("sha256").update(canonicalizeExecutionV1(copy)).digest("hex");
}

export function validateApprovalEffectOperatorIntentV1(intent) {
  const errors = [];

  if (!exactKeys(intent, A4_KEYS)) errors.push("A4_TOP_LEVEL_FIELDS_MISMATCH");
  errors.push(...scanForbidden(intent));

  if (intent?.INTENT_TYPE !== PILOTE_APPROVAL_EFFECT_OPERATOR_INTENT_TYPE) errors.push("A4_INTENT_TYPE_MISMATCH");
  if (intent?.INTENT_VERSION !== PILOTE_APPROVAL_EFFECT_OPERATOR_INTENT_VERSION) errors.push("A4_INTENT_VERSION_MISMATCH");
  if (intent?.CANONICALIZATION_ID !== A4_CANONICALIZATION_ID) errors.push("A4_CANONICALIZATION_ID_MISMATCH");

  for (const key of ["PROJECT_ID", "PHASE_ID", "TASK_ID"]) {
    if (typeof intent?.[key] !== "string" || intent[key].length === 0) errors.push(`${key}_INVALID`);
  }

  if (!SHA256_RE.test(intent?.TASK_CONTRACT_SHA256 ?? "")) errors.push("TASK_CONTRACT_SHA256_INVALID");
  if (!SHA256_RE.test(intent?.EXECUTION_INTENT_SHA256 ?? "")) errors.push("EXECUTION_INTENT_SHA256_INVALID");

  if (!APPROVAL_MODES.has(intent?.APPROVAL_MODE)) errors.push("APPROVAL_MODE_INVALID");
  if (!uniqueStrings(intent?.EFFECT_CLASS_REFS)) errors.push("EFFECT_CLASS_REFS_INVALID");
  if (!uniqueStrings(intent?.SCOPE_REFS)) errors.push("SCOPE_REFS_INVALID");
  if (!REMOTE_MUTATION_INTENTS.has(intent?.REMOTE_MUTATION_INTENT)) errors.push("REMOTE_MUTATION_INTENT_INVALID");
  if (typeof intent?.HOST_OPERATION_INTENT !== "string" || !TOKEN_RE.test(intent.HOST_OPERATION_INTENT)) errors.push("HOST_OPERATION_INTENT_INVALID");
  if (!OPERATOR_POLICIES.has(intent?.OPERATOR_POLICY)) errors.push("OPERATOR_POLICY_INVALID");
  if (typeof intent?.INTERVENTION_POLICY !== "string" || !TOKEN_RE.test(intent.INTERVENTION_POLICY)) errors.push("INTERVENTION_POLICY_INVALID");
  if (intent?.INTERVENTION_POLICY_REF !== "task-contract:INTERVENTION_POLICY") errors.push("INTERVENTION_POLICY_REF_MISMATCH");

  if (intent?.AUTHORITY_GRANT_POLICY !== A4_AUTHORITY_GRANT_POLICY) errors.push("AUTHORITY_GRANT_POLICY_MISMATCH");
  if (intent?.FIRST_IRREVERSIBLE_REMOTE_SUBMISSION_POLICY !== A4_FIRST_IRREVERSIBLE_REMOTE_SUBMISSION_POLICY) errors.push("FIRST_IRREVERSIBLE_REMOTE_SUBMISSION_POLICY_MISMATCH");
  if (intent?.OUTCOME_UNKNOWN_APPROVAL_POLICY !== A4_OUTCOME_UNKNOWN_APPROVAL_POLICY) errors.push("OUTCOME_UNKNOWN_APPROVAL_POLICY_MISMATCH");
  if (intent?.NORMAL_PATH_POLICY !== A4_NORMAL_PATH_POLICY) errors.push("NORMAL_PATH_POLICY_MISMATCH");
  if (intent?.STATE_AFFECTING_INTERVENTION_POLICY !== A4_STATE_AFFECTING_INTERVENTION_POLICY) errors.push("STATE_AFFECTING_INTERVENTION_POLICY_MISMATCH");
  if (intent?.OBSERVE_ONLY_INTERVENTION_POLICY !== A4_OBSERVE_ONLY_INTERVENTION_POLICY) errors.push("OBSERVE_ONLY_INTERVENTION_POLICY_MISMATCH");

  const contract = intent?.CONTRACT_SET_REF;
  if (!isObject(contract)
      || contract.ID !== REV51_CONTRACT_SET_ID
      || contract.VERSION !== REV51_CONTRACT_SET_VERSION
      || contract.SHA256 !== REV51_CONTRACT_SET_SHA256) {
    errors.push("CONTRACT_SET_REF_MISMATCH");
  }

  if (!SHA256_RE.test(intent?.A4_INTENT_SHA256 ?? "")) errors.push("A4_INTENT_SHA256_INVALID");
  else {
    try {
      if (computeApprovalEffectOperatorIntentSha256V1(intent) !== intent.A4_INTENT_SHA256) errors.push("A4_INTENT_SHA256_MISMATCH");
    } catch (error) {
      errors.push(`A4_CANONICALIZATION_REJECTED:${error.message}`);
    }
  }

  return { ok: errors.length === 0, errors };
}

export function validateA4CrossStackSemanticBindingV1(taskContract, executionIntent, a4Intent) {
  const errors = [];

  const taskCheck = validateTaskContractAnchor(taskContract);
  if (!taskCheck.ok) errors.push(...taskCheck.errors.map((error) => `TASK:${error}`));

  const executionCheck = validateExecutionIntentV1(executionIntent);
  if (!executionCheck.ok) errors.push(...executionCheck.errors.map((error) => `EXECUTION_INTENT:${error}`));

  const a4Check = validateApprovalEffectOperatorIntentV1(a4Intent);
  if (!a4Check.ok) errors.push(...a4Check.errors.map((error) => `A4:${error}`));

  if (!isObject(taskContract) || !isObject(executionIntent) || !isObject(a4Intent)) {
    return { ok: false, errors: ["A4_BINDING_INPUT_REQUIRED", ...errors] };
  }

  if (executionIntent.TASK_CONTRACT_SHA256 !== taskContract.TASK_CONTRACT_HASH) errors.push("EXECUTION_INTENT_TASK_CONTRACT_BINDING_MISMATCH");

  for (const key of ["PROJECT_ID", "PHASE_ID", "TASK_ID"]) {
    if (a4Intent[key] !== taskContract[key] || a4Intent[key] !== executionIntent[key]) errors.push(`${key}_BINDING_MISMATCH`);
  }

  if (a4Intent.TASK_CONTRACT_SHA256 !== taskContract.TASK_CONTRACT_HASH) errors.push("A4_TASK_CONTRACT_SHA256_BINDING_MISMATCH");
  if (a4Intent.EXECUTION_INTENT_SHA256 !== executionIntent.INTENT_SHA256) errors.push("EXECUTION_INTENT_SHA256_BINDING_MISMATCH");

  const boundary = executionIntent.APPROVAL_BOUNDARY;
  if (!isObject(boundary)) {
    errors.push("EXECUTION_INTENT_APPROVAL_BOUNDARY_REQUIRED");
  } else {
    if (a4Intent.APPROVAL_MODE !== boundary.MODE) errors.push("APPROVAL_MODE_BINDING_MISMATCH");
    if (!exactArray(a4Intent.EFFECT_CLASS_REFS, boundary.EFFECT_CLASS_REFS)) errors.push("APPROVAL_EFFECT_BINDING_MISMATCH");
    if (!exactArray(a4Intent.SCOPE_REFS, boundary.SCOPE_REFS)) errors.push("APPROVAL_SCOPE_BINDING_MISMATCH");
  }

  if (a4Intent.REMOTE_MUTATION_INTENT !== taskContract.REMOTE_MUTATION_INTENT) errors.push("REMOTE_MUTATION_INTENT_BINDING_MISMATCH");
  if (a4Intent.HOST_OPERATION_INTENT !== taskContract.HOST_OPERATION_INTENT) errors.push("HOST_OPERATION_INTENT_BINDING_MISMATCH");
  if (a4Intent.INTERVENTION_POLICY !== taskContract.INTERVENTION_POLICY) errors.push("INTERVENTION_POLICY_BINDING_MISMATCH");
  if (a4Intent.OPERATOR_POLICY !== executionIntent.OPERATOR_POLICY) errors.push("OPERATOR_POLICY_BINDING_MISMATCH");

  for (const effect of a4Intent.EFFECT_CLASS_REFS ?? []) {
    if (!taskContract.EFFECT_CLASSES.includes(effect)) errors.push(`EFFECT_CLASS_ESCALATION_DENY:${effect}`);
  }
  for (const scope of a4Intent.SCOPE_REFS ?? []) {
    if (!taskContract.ALLOWED_SCOPE.includes(scope)) errors.push(`SCOPE_ESCALATION_DENY:${scope}`);
  }

  if (taskContract.REMOTE_MUTATION_INTENT === "EXACT_APPROVAL_REQUIRED"
      && a4Intent.APPROVAL_MODE !== "EXPLICIT_HUMAN_APPROVAL") {
    errors.push("EXACT_APPROVAL_REQUIRED_MODE_MISMATCH");
  }

  if (a4Intent.APPROVAL_MODE === "EXPLICIT_HUMAN_APPROVAL") {
    if (!Array.isArray(a4Intent.EFFECT_CLASS_REFS) || a4Intent.EFFECT_CLASS_REFS.length === 0) errors.push("EXPLICIT_APPROVAL_EFFECT_REFS_REQUIRED");
    if (!Array.isArray(a4Intent.SCOPE_REFS) || a4Intent.SCOPE_REFS.length === 0) errors.push("EXPLICIT_APPROVAL_SCOPE_REFS_REQUIRED");
  }

  return { ok: errors.length === 0, errors };
}

export function buildApprovalEffectOperatorIntentV1(taskContract, executionIntent) {
  const taskCheck = validateTaskContractAnchor(taskContract);
  if (!taskCheck.ok) throw new Error(`INVALID_TASK_CONTRACT_ANCHOR:${taskCheck.errors.join("|")}`);

  const executionCheck = validateExecutionIntentV1(executionIntent);
  if (!executionCheck.ok) throw new Error(`INVALID_EXECUTION_INTENT:${executionCheck.errors.join("|")}`);

  if (executionIntent.TASK_CONTRACT_SHA256 !== taskContract.TASK_CONTRACT_HASH) {
    throw new Error("EXECUTION_INTENT_TASK_CONTRACT_BINDING_MISMATCH");
  }

  const boundary = executionIntent.APPROVAL_BOUNDARY;
  const intent = {
    INTENT_TYPE: PILOTE_APPROVAL_EFFECT_OPERATOR_INTENT_TYPE,
    INTENT_VERSION: PILOTE_APPROVAL_EFFECT_OPERATOR_INTENT_VERSION,
    CANONICALIZATION_ID: A4_CANONICALIZATION_ID,
    PROJECT_ID: taskContract.PROJECT_ID,
    PHASE_ID: taskContract.PHASE_ID,
    TASK_ID: taskContract.TASK_ID,
    TASK_CONTRACT_SHA256: taskContract.TASK_CONTRACT_HASH,
    EXECUTION_INTENT_SHA256: executionIntent.INTENT_SHA256,
    APPROVAL_MODE: boundary.MODE,
    EFFECT_CLASS_REFS: [...boundary.EFFECT_CLASS_REFS],
    SCOPE_REFS: [...boundary.SCOPE_REFS],
    REMOTE_MUTATION_INTENT: taskContract.REMOTE_MUTATION_INTENT,
    HOST_OPERATION_INTENT: taskContract.HOST_OPERATION_INTENT,
    OPERATOR_POLICY: executionIntent.OPERATOR_POLICY,
    INTERVENTION_POLICY: taskContract.INTERVENTION_POLICY,
    INTERVENTION_POLICY_REF: "task-contract:INTERVENTION_POLICY",
    AUTHORITY_GRANT_POLICY: A4_AUTHORITY_GRANT_POLICY,
    FIRST_IRREVERSIBLE_REMOTE_SUBMISSION_POLICY: A4_FIRST_IRREVERSIBLE_REMOTE_SUBMISSION_POLICY,
    OUTCOME_UNKNOWN_APPROVAL_POLICY: A4_OUTCOME_UNKNOWN_APPROVAL_POLICY,
    NORMAL_PATH_POLICY: A4_NORMAL_PATH_POLICY,
    STATE_AFFECTING_INTERVENTION_POLICY: A4_STATE_AFFECTING_INTERVENTION_POLICY,
    OBSERVE_ONLY_INTERVENTION_POLICY: A4_OBSERVE_ONLY_INTERVENTION_POLICY,
    CONTRACT_SET_REF: {
      ID: REV51_CONTRACT_SET_ID,
      VERSION: REV51_CONTRACT_SET_VERSION,
      SHA256: REV51_CONTRACT_SET_SHA256
    },
    A4_INTENT_SHA256: "0".repeat(64)
  };

  intent.A4_INTENT_SHA256 = computeApprovalEffectOperatorIntentSha256V1(intent);

  const binding = validateA4CrossStackSemanticBindingV1(taskContract, executionIntent, intent);
  if (!binding.ok) throw new Error(`BUILT_A4_INTENT_INVALID:${binding.errors.join("|")}`);

  return intent;
}
