import { createHash } from "node:crypto";
import { canonicalizeExecutionV1 } from "./canonicalize-execution-v1.mjs";
import {
  REV51_CONTRACT_SET_ID,
  REV51_CONTRACT_SET_SHA256,
  REV51_CONTRACT_SET_VERSION,
  validateExecutionIntentV1,
  validateTaskContractAnchor
} from "./execution-intent-v1.mjs";

export const PILOTE_CHECKPOINT_CACHE_DATA_LOCALITY_INTENT_TYPE =
  "PILOTE_CHECKPOINT_CACHE_DATA_LOCALITY_INTENT_V1";
export const PILOTE_CHECKPOINT_CACHE_DATA_LOCALITY_INTENT_VERSION = "1.0.0";
export const A7_CANONICALIZATION_ID = "ATELIER_EXECUTION_CANONICAL_JSON_V1";

export const TRI_POLICIES = Object.freeze(["NOT_REQUESTED", "ELIGIBLE", "REQUIRED"]);
export const DATA_LOCALITY_POLICIES = Object.freeze([
  "NONE",
  "COLOCATE_WITH_INPUT_SET",
  "EGRESS_RESTRICTED"
]);

export const CHECKPOINT_STRONG_IDENTITY = "REQUIRED";
export const CHECKPOINT_RESUME_NEW_ATTEMPT = "REQUIRED";
export const CHECKPOINT_RESUME_NEW_LEASE_GENERATION = "REQUIRED";
export const CHECKPOINT_RESUME_FENCE_ADVANCE = "REQUIRED";
export const CHECKPOINT_STALE_ATTEMPT_ACCEPTANCE = "DENY";

export const CACHE_IMMUTABLE_CAS = "REQUIRED";
export const CACHE_PRODUCER_RECEIPT = "REQUIRED";
export const CACHE_SECURITY_DOMAIN_MATCH = "REQUIRED";
export const CACHE_HIT_VERIFIER_EQUIVALENCE = "DENY";
export const CACHE_FINAL_GATE_BYPASS = "DENY";
export const CACHE_OBJECT_AUTHORITATIVE_EVIDENCE = "DENY";

export const DATA_LOCALITY_PROVIDER_SELECTION = "RUNTIME_OWNED";
export const DATA_LOCALITY_SECURITY_WEAKENING = "DENY";
export const EGRESS_RESTRICTED_FAIL_CLOSED = "REQUIRED";
export const RUNTIME_STRICTER_LOCALITY = "ALLOW";

const TRI_POLICY_SET = new Set(TRI_POLICIES);
const LOCALITY_SET = new Set(DATA_LOCALITY_POLICIES);
const SHA256_RE = /^[0-9a-f]{64}$/;

const A7_KEYS = Object.freeze([
  "A7_INTENT_SHA256",
  "CACHE_FINAL_GATE_BYPASS",
  "CACHE_HIT_VERIFIER_EQUIVALENCE",
  "CACHE_IMMUTABLE_CAS",
  "CACHE_OBJECT_AUTHORITATIVE_EVIDENCE",
  "CACHE_POLICY",
  "CACHE_POLICY_SOURCE_REF",
  "CACHE_PRODUCER_RECEIPT",
  "CACHE_SECURITY_DOMAIN_MATCH",
  "CANONICALIZATION_ID",
  "CHECKPOINT_POLICY",
  "CHECKPOINT_POLICY_SOURCE_REF",
  "CHECKPOINT_RESUME_FENCE_ADVANCE",
  "CHECKPOINT_RESUME_NEW_ATTEMPT",
  "CHECKPOINT_RESUME_NEW_LEASE_GENERATION",
  "CHECKPOINT_STALE_ATTEMPT_ACCEPTANCE",
  "CHECKPOINT_STRONG_IDENTITY",
  "CONTRACT_SET_REF",
  "DATA_LOCALITY_POLICY",
  "DATA_LOCALITY_POLICY_SOURCE_REF",
  "DATA_LOCALITY_PROVIDER_SELECTION",
  "DATA_LOCALITY_SECURITY_WEAKENING",
  "EGRESS_RESTRICTED_FAIL_CLOSED",
  "EXECUTION_INTENT_SHA256",
  "INTENT_TYPE",
  "INTENT_VERSION",
  "PHASE_ID",
  "PROJECT_ID",
  "RUNTIME_STRICTER_LOCALITY",
  "TASK_CONTRACT_SHA256",
  "TASK_ID"
]);

const CONTRACT_REF_KEYS = Object.freeze(["ID", "SHA256", "VERSION"]);

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
  "LEASE_GENERATION",
  "EXECUTION_ID",
  "ATTEMPT_ID",
  "FENCE_TOKEN",
  "OPERATION_ID",
  "IDEMPOTENCY_KEY",
  "SECRET_VALUE",
  "BACKEND_INSTANCE_ID",
  "CHECKPOINT_ID",
  "CACHE_ENTRY_ID",
  "CACHE_KEY",
  "SECURITY_DOMAIN_ID",
  "INPUT_SET_ID"
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

export function deriveCheckpointPolicyProjectionV1(policy) {
  if (!TRI_POLICY_SET.has(policy)) throw new Error("CHECKPOINT_POLICY_UNSUPPORTED");
  if (policy === "NOT_REQUESTED") {
    return Object.freeze({
      CHECKPOINT_USAGE: "DISABLED",
      CHECKPOINT_CAPABILITY_REQUIRED: false,
      RESUME_FROM_CHECKPOINT_PERMITTED: false
    });
  }
  if (policy === "ELIGIBLE") {
    return Object.freeze({
      CHECKPOINT_USAGE: "OPTIONAL",
      CHECKPOINT_CAPABILITY_REQUIRED: false,
      RESUME_FROM_CHECKPOINT_PERMITTED: true
    });
  }
  return Object.freeze({
    CHECKPOINT_USAGE: "REQUIRED",
    CHECKPOINT_CAPABILITY_REQUIRED: true,
    RESUME_FROM_CHECKPOINT_PERMITTED: true
  });
}

export function deriveCachePolicyProjectionV1(policy) {
  if (!TRI_POLICY_SET.has(policy)) throw new Error("CACHE_POLICY_UNSUPPORTED");
  if (policy === "NOT_REQUESTED") {
    return Object.freeze({
      CACHE_USAGE: "DISABLED",
      CACHE_CAPABILITY_REQUIRED: false,
      CACHE_REUSE_PERMITTED: false
    });
  }
  if (policy === "ELIGIBLE") {
    return Object.freeze({
      CACHE_USAGE: "OPTIONAL",
      CACHE_CAPABILITY_REQUIRED: false,
      CACHE_REUSE_PERMITTED: true
    });
  }
  return Object.freeze({
    CACHE_USAGE: "REQUIRED",
    CACHE_CAPABILITY_REQUIRED: true,
    CACHE_REUSE_PERMITTED: true
  });
}

export function deriveDataLocalityProjectionV1(policy) {
  if (!LOCALITY_SET.has(policy)) throw new Error("DATA_LOCALITY_POLICY_UNSUPPORTED");
  if (policy === "COLOCATE_WITH_INPUT_SET") {
    return Object.freeze({
      PLACEMENT_CONSTRAINT: "INPUT_SET_COLOCATION_REQUIRED",
      EGRESS_CONSTRAINT: "INHERIT_SECURITY_REQUIREMENTS",
      CONCRETE_PROVIDER_SELECTION: "RUNTIME_OWNED"
    });
  }
  if (policy === "EGRESS_RESTRICTED") {
    return Object.freeze({
      PLACEMENT_CONSTRAINT: "RUNTIME_DECIDES_WITHIN_SECURITY_BOUNDARY",
      EGRESS_CONSTRAINT: "RESTRICTED_FAIL_CLOSED",
      CONCRETE_PROVIDER_SELECTION: "RUNTIME_OWNED"
    });
  }
  return Object.freeze({
    PLACEMENT_CONSTRAINT: "NONE_ADDITIONAL",
    EGRESS_CONSTRAINT: "INHERIT_SECURITY_REQUIREMENTS",
    CONCRETE_PROVIDER_SELECTION: "RUNTIME_OWNED"
  });
}

export function computeCheckpointCacheDataLocalityIntentSha256V1(intent) {
  const copy = structuredClone(intent);
  delete copy.A7_INTENT_SHA256;
  return createHash("sha256")
    .update(canonicalizeExecutionV1(copy))
    .digest("hex");
}

export function validateCheckpointCacheDataLocalityIntentV1(intent) {
  const errors = [];

  if (!exactKeys(intent, A7_KEYS)) errors.push("A7_TOP_LEVEL_FIELDS_MISMATCH");
  errors.push(...scanForbidden(intent));

  if (intent?.INTENT_TYPE !== PILOTE_CHECKPOINT_CACHE_DATA_LOCALITY_INTENT_TYPE) {
    errors.push("A7_INTENT_TYPE_MISMATCH");
  }
  if (intent?.INTENT_VERSION !== PILOTE_CHECKPOINT_CACHE_DATA_LOCALITY_INTENT_VERSION) {
    errors.push("A7_INTENT_VERSION_MISMATCH");
  }
  if (intent?.CANONICALIZATION_ID !== A7_CANONICALIZATION_ID) {
    errors.push("A7_CANONICALIZATION_ID_MISMATCH");
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

  if (!TRI_POLICY_SET.has(intent?.CHECKPOINT_POLICY)) errors.push("CHECKPOINT_POLICY_INVALID");
  if (!TRI_POLICY_SET.has(intent?.CACHE_POLICY)) errors.push("CACHE_POLICY_INVALID");
  if (!LOCALITY_SET.has(intent?.DATA_LOCALITY_POLICY)) errors.push("DATA_LOCALITY_POLICY_INVALID");

  if (intent?.CHECKPOINT_POLICY_SOURCE_REF !== "execution-intent:CHECKPOINT_POLICY") {
    errors.push("CHECKPOINT_POLICY_SOURCE_REF_MISMATCH");
  }
  if (intent?.CACHE_POLICY_SOURCE_REF !== "execution-intent:CACHE_POLICY") {
    errors.push("CACHE_POLICY_SOURCE_REF_MISMATCH");
  }
  if (intent?.DATA_LOCALITY_POLICY_SOURCE_REF !== "execution-intent:DATA_LOCALITY_POLICY") {
    errors.push("DATA_LOCALITY_POLICY_SOURCE_REF_MISMATCH");
  }

  if (intent?.CHECKPOINT_STRONG_IDENTITY !== CHECKPOINT_STRONG_IDENTITY) {
    errors.push("CHECKPOINT_STRONG_IDENTITY_MISMATCH");
  }
  if (intent?.CHECKPOINT_RESUME_NEW_ATTEMPT !== CHECKPOINT_RESUME_NEW_ATTEMPT) {
    errors.push("CHECKPOINT_RESUME_NEW_ATTEMPT_MISMATCH");
  }
  if (intent?.CHECKPOINT_RESUME_NEW_LEASE_GENERATION !== CHECKPOINT_RESUME_NEW_LEASE_GENERATION) {
    errors.push("CHECKPOINT_RESUME_NEW_LEASE_GENERATION_MISMATCH");
  }
  if (intent?.CHECKPOINT_RESUME_FENCE_ADVANCE !== CHECKPOINT_RESUME_FENCE_ADVANCE) {
    errors.push("CHECKPOINT_RESUME_FENCE_ADVANCE_MISMATCH");
  }
  if (intent?.CHECKPOINT_STALE_ATTEMPT_ACCEPTANCE !== CHECKPOINT_STALE_ATTEMPT_ACCEPTANCE) {
    errors.push("CHECKPOINT_STALE_ATTEMPT_ACCEPTANCE_MISMATCH");
  }

  if (intent?.CACHE_IMMUTABLE_CAS !== CACHE_IMMUTABLE_CAS) {
    errors.push("CACHE_IMMUTABLE_CAS_MISMATCH");
  }
  if (intent?.CACHE_PRODUCER_RECEIPT !== CACHE_PRODUCER_RECEIPT) {
    errors.push("CACHE_PRODUCER_RECEIPT_MISMATCH");
  }
  if (intent?.CACHE_SECURITY_DOMAIN_MATCH !== CACHE_SECURITY_DOMAIN_MATCH) {
    errors.push("CACHE_SECURITY_DOMAIN_MATCH_MISMATCH");
  }
  if (intent?.CACHE_HIT_VERIFIER_EQUIVALENCE !== CACHE_HIT_VERIFIER_EQUIVALENCE) {
    errors.push("CACHE_HIT_VERIFIER_EQUIVALENCE_MISMATCH");
  }
  if (intent?.CACHE_FINAL_GATE_BYPASS !== CACHE_FINAL_GATE_BYPASS) {
    errors.push("CACHE_FINAL_GATE_BYPASS_MISMATCH");
  }
  if (intent?.CACHE_OBJECT_AUTHORITATIVE_EVIDENCE !== CACHE_OBJECT_AUTHORITATIVE_EVIDENCE) {
    errors.push("CACHE_OBJECT_AUTHORITATIVE_EVIDENCE_MISMATCH");
  }

  if (intent?.DATA_LOCALITY_PROVIDER_SELECTION !== DATA_LOCALITY_PROVIDER_SELECTION) {
    errors.push("DATA_LOCALITY_PROVIDER_SELECTION_MISMATCH");
  }
  if (intent?.DATA_LOCALITY_SECURITY_WEAKENING !== DATA_LOCALITY_SECURITY_WEAKENING) {
    errors.push("DATA_LOCALITY_SECURITY_WEAKENING_MISMATCH");
  }
  if (intent?.EGRESS_RESTRICTED_FAIL_CLOSED !== EGRESS_RESTRICTED_FAIL_CLOSED) {
    errors.push("EGRESS_RESTRICTED_FAIL_CLOSED_MISMATCH");
  }
  if (intent?.RUNTIME_STRICTER_LOCALITY !== RUNTIME_STRICTER_LOCALITY) {
    errors.push("RUNTIME_STRICTER_LOCALITY_MISMATCH");
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

  if (!SHA256_RE.test(intent?.A7_INTENT_SHA256 ?? "")) {
    errors.push("A7_INTENT_SHA256_INVALID");
  } else {
    try {
      if (computeCheckpointCacheDataLocalityIntentSha256V1(intent) !== intent.A7_INTENT_SHA256) {
        errors.push("A7_INTENT_SHA256_MISMATCH");
      }
    } catch (error) {
      errors.push("A7_CANONICALIZATION_REJECTED:" + error.message);
    }
  }

  return { ok: errors.length === 0, errors };
}

export function validateA7CrossStackSemanticBindingV1(taskContract, executionIntent, a7Intent) {
  const errors = [];

  const taskCheck = validateTaskContractAnchor(taskContract);
  if (!taskCheck.ok) errors.push(...taskCheck.errors.map((error) => "TASK:" + error));

  const executionCheck = validateExecutionIntentV1(executionIntent);
  if (!executionCheck.ok) {
    errors.push(...executionCheck.errors.map((error) => "EXECUTION_INTENT:" + error));
  }

  const a7Check = validateCheckpointCacheDataLocalityIntentV1(a7Intent);
  if (!a7Check.ok) errors.push(...a7Check.errors.map((error) => "A7:" + error));

  if (!isObject(taskContract) || !isObject(executionIntent) || !isObject(a7Intent)) {
    return { ok: false, errors: ["A7_BINDING_INPUT_REQUIRED", ...errors] };
  }

  if (executionIntent.TASK_CONTRACT_SHA256 !== taskContract.TASK_CONTRACT_HASH) {
    errors.push("EXECUTION_INTENT_TASK_CONTRACT_BINDING_MISMATCH");
  }

  for (const key of ["PROJECT_ID", "PHASE_ID", "TASK_ID"]) {
    if (a7Intent[key] !== taskContract[key] || a7Intent[key] !== executionIntent[key]) {
      errors.push(key + "_BINDING_MISMATCH");
    }
  }

  if (a7Intent.TASK_CONTRACT_SHA256 !== taskContract.TASK_CONTRACT_HASH) {
    errors.push("A7_TASK_CONTRACT_SHA256_BINDING_MISMATCH");
  }
  if (a7Intent.EXECUTION_INTENT_SHA256 !== executionIntent.INTENT_SHA256) {
    errors.push("EXECUTION_INTENT_SHA256_BINDING_MISMATCH");
  }
  if (a7Intent.CHECKPOINT_POLICY !== executionIntent.CHECKPOINT_POLICY) {
    errors.push("CHECKPOINT_POLICY_BINDING_MISMATCH");
  }
  if (a7Intent.CACHE_POLICY !== executionIntent.CACHE_POLICY) {
    errors.push("CACHE_POLICY_BINDING_MISMATCH");
  }
  if (a7Intent.DATA_LOCALITY_POLICY !== executionIntent.DATA_LOCALITY_POLICY) {
    errors.push("DATA_LOCALITY_POLICY_BINDING_MISMATCH");
  }

  return { ok: errors.length === 0, errors };
}

export function buildCheckpointCacheDataLocalityIntentV1(taskContract, executionIntent) {
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

  const intent = {
    INTENT_TYPE: PILOTE_CHECKPOINT_CACHE_DATA_LOCALITY_INTENT_TYPE,
    INTENT_VERSION: PILOTE_CHECKPOINT_CACHE_DATA_LOCALITY_INTENT_VERSION,
    CANONICALIZATION_ID: A7_CANONICALIZATION_ID,
    PROJECT_ID: taskContract.PROJECT_ID,
    PHASE_ID: taskContract.PHASE_ID,
    TASK_ID: taskContract.TASK_ID,
    TASK_CONTRACT_SHA256: taskContract.TASK_CONTRACT_HASH,
    EXECUTION_INTENT_SHA256: executionIntent.INTENT_SHA256,
    CHECKPOINT_POLICY: executionIntent.CHECKPOINT_POLICY,
    CHECKPOINT_POLICY_SOURCE_REF: "execution-intent:CHECKPOINT_POLICY",
    CACHE_POLICY: executionIntent.CACHE_POLICY,
    CACHE_POLICY_SOURCE_REF: "execution-intent:CACHE_POLICY",
    DATA_LOCALITY_POLICY: executionIntent.DATA_LOCALITY_POLICY,
    DATA_LOCALITY_POLICY_SOURCE_REF: "execution-intent:DATA_LOCALITY_POLICY",
    CHECKPOINT_STRONG_IDENTITY,
    CHECKPOINT_RESUME_NEW_ATTEMPT,
    CHECKPOINT_RESUME_NEW_LEASE_GENERATION,
    CHECKPOINT_RESUME_FENCE_ADVANCE,
    CHECKPOINT_STALE_ATTEMPT_ACCEPTANCE,
    CACHE_IMMUTABLE_CAS,
    CACHE_PRODUCER_RECEIPT,
    CACHE_SECURITY_DOMAIN_MATCH,
    CACHE_HIT_VERIFIER_EQUIVALENCE,
    CACHE_FINAL_GATE_BYPASS,
    CACHE_OBJECT_AUTHORITATIVE_EVIDENCE,
    DATA_LOCALITY_PROVIDER_SELECTION,
    DATA_LOCALITY_SECURITY_WEAKENING,
    EGRESS_RESTRICTED_FAIL_CLOSED,
    RUNTIME_STRICTER_LOCALITY,
    CONTRACT_SET_REF: {
      ID: REV51_CONTRACT_SET_ID,
      VERSION: REV51_CONTRACT_SET_VERSION,
      SHA256: REV51_CONTRACT_SET_SHA256
    },
    A7_INTENT_SHA256: "0".repeat(64)
  };

  intent.A7_INTENT_SHA256 =
    computeCheckpointCacheDataLocalityIntentSha256V1(intent);

  const binding = validateA7CrossStackSemanticBindingV1(
    taskContract,
    executionIntent,
    intent
  );
  if (!binding.ok) {
    throw new Error("BUILT_A7_INTENT_INVALID:" + binding.errors.join("|"));
  }

  return intent;
}
