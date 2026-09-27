import {
  computeRev51ObjectHash,
  validateContractEnvelope,
  validateExecutionAxes,
  validateExecutionInputMode
} from "./contract-core.mjs";

export const A2_AUTHORITATIVE_BINDING = Object.freeze({
  REPOSITORY: "neoflowcore/atelier-runtime",
  BRANCH: "pilote-r51-a2-execution-intent",
  HEAD: "53716039bb0df7d725bf8d8b791f376ee17d9551",
  TREE: "071d6a4e08fe97d32775336eddaf703535fa6871",
  CONTRACT_SET_ID: "ATELIER_REV51_CONTRACT_SET_V1",
  CONTRACT_SET_SHA256: "a8b220c92a47306061e9aca1c65077d357b00bda12e9daad4f37215256083f4a",
  INTENT_SCHEMA_SHA256: "31fd4c004726434c9b01614aa6f1d2b58409e58dd2af09d492a4a79f483bd82a",
  CANONICALIZATION_ID: "ATELIER_EXECUTION_CANONICAL_JSON_V1",
  TEST_VECTOR_SET_SHA256: "9bde23ef29b9af96a741a3e49a0a4776760472430e393899f19383764730f6ad",
  EXPECTED_RESULT_SET_SHA256: "584a728d6a2ea2222fd4596b8c25756d84577c3fb31d29c93a87c7a4403c2a5b",
  AUTHORITATIVE_MANIFEST_SHA256: "7432af5cbb98e2bbc1ffba8911a75df3f054419024be9641076ea7c894fb875d"
});

export const RUNTIME_PLAN_CANONICALIZATION_ID = "ATELIER_REV51_JCS_V1";

const SHA256_RE = /^[0-9a-f]{64}$/;
const FORBIDDEN_CONCRETE_INFRA_KEYS = new Set([
  "PROVIDER_ID","PROVIDER_ACCOUNT_OR_TENANT_ID","PROVIDER_RESOURCE_ID","WORKER_ID","VM_ID","DROPLET_ID",
  "RUNNER_ID","JIT_REGISTRATION_ID","LEASE_ID","EXECUTION_ID","ATTEMPT_ID","FENCE_TOKEN","OPERATION_ID",
  "IDEMPOTENCY_KEY","SECRET_VALUE","BACKEND_INSTANCE_ID"
]);

function isObject(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
function scanForbidden(value, path = "$") {
  const errors = [];
  if (Array.isArray(value)) {
    value.forEach((v, i) => errors.push(...scanForbidden(v, `${path}[${i}]`)));
  } else if (isObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_CONCRETE_INFRA_KEYS.has(key)) errors.push(`FORBIDDEN_CONCRETE_INFRASTRUCTURE:${path}.${key}`);
      errors.push(...scanForbidden(child, `${path}.${key}`));
    }
  }
  return errors;
}

export function validateAuthoritativeIntentBinding(intent) {
  const errors = [];
  if (!isObject(intent)) return { ok: false, errors: ["INTENT_NOT_OBJECT"] };
  if (intent.INTENT_TYPE !== "PILOTE_EXECUTION_INTENT_V1") errors.push("INTENT_TYPE_MISMATCH");
  if (intent.INTENT_VERSION !== "1.0.0") errors.push("INTENT_VERSION_MISMATCH");
  if (intent.INPUT_MODE !== "NATIVE_REV51") errors.push("INPUT_MODE_MUST_BE_NATIVE_REV51");
  if (intent.CANONICALIZATION_ID !== A2_AUTHORITATIVE_BINDING.CANONICALIZATION_ID) errors.push("CANONICALIZATION_ID_MISMATCH");
  if (!SHA256_RE.test(intent.INTENT_SHA256 ?? "")) errors.push("INTENT_SHA256_INVALID");
  if (!SHA256_RE.test(intent.TASK_CONTRACT_SHA256 ?? "")) errors.push("TASK_CONTRACT_SHA256_INVALID");
  if (!isObject(intent.CONTRACT_SET_REF)) errors.push("CONTRACT_SET_REF_MISSING");
  else {
    if (intent.CONTRACT_SET_REF.ID !== A2_AUTHORITATIVE_BINDING.CONTRACT_SET_ID) errors.push("CONTRACT_SET_ID_MISMATCH");
    if (intent.CONTRACT_SET_REF.SHA256 !== A2_AUTHORITATIVE_BINDING.CONTRACT_SET_SHA256) errors.push("CONTRACT_SET_SHA256_MISMATCH");
  }
  errors.push(...scanForbidden(intent));
  return { ok: errors.length === 0, errors };
}

function validateExecutionPathBinding(intent, selection) {
  const errors = [];
  if (intent.EXECUTION_PATH_POLICY === "GITHUB_GATE_REQUIRED" && selection.EXECUTION_TRANSPORT !== "GITHUB_SELF_HOSTED_JIT") {
    errors.push("GITHUB_GATE_REQUIRED_TRANSPORT_MISMATCH");
  }
  if (intent.EXECUTION_PATH_POLICY === "DIRECT_REMOTE_REQUIRED" && selection.EXECUTION_TRANSPORT !== "DIRECT_WORKER") {
    errors.push("DIRECT_REMOTE_REQUIRED_TRANSPORT_MISMATCH");
  }
  return errors;
}

export function createRuntimeExecutionPlanV1(intent, selection) {
  const binding = validateAuthoritativeIntentBinding(intent);
  if (!binding.ok) throw new Error(`A2_INTENT_BINDING_REJECTED:${binding.errors.join("|")}`);
  if (!isObject(selection)) throw new Error("RUNTIME_SELECTION_REQUIRED");

  const axes = validateExecutionAxes(selection);
  if (!axes.ok) throw new Error(`RUNTIME_SELECTION_REJECTED:${axes.errors.join("|")}`);

  const pathErrors = validateExecutionPathBinding(intent, selection);
  if (pathErrors.length) throw new Error(`EXECUTION_PATH_BINDING_REJECTED:${pathErrors.join("|")}`);

  if (selection.VERIFIER_POLICY_REF_SHA256 !== intent.VERIFIER_POLICY_REF?.SHA256) {
    throw new Error("VERIFIER_POLICY_REF_HASH_MISMATCH");
  }

  const plan = {
    SCHEMA_ID: "RUNTIME_EXECUTION_PLAN_V1",
    SCHEMA_VERSION: "1",
    CANONICALIZATION_ID: RUNTIME_PLAN_CANONICALIZATION_ID,
    UPSTREAM_OBJECT_SHA256: intent.INTENT_SHA256,
    OBJECT_SHA256: "0".repeat(64),
    CONTRACT_SET_ID: A2_AUTHORITATIVE_BINDING.CONTRACT_SET_ID,
    CONTRACT_SET_SHA256: A2_AUTHORITATIVE_BINDING.CONTRACT_SET_SHA256,
    EXECUTION_INTENT_SCHEMA_SHA256: A2_AUTHORITATIVE_BINDING.INTENT_SCHEMA_SHA256,
    EXECUTION_INTENT_CANONICALIZATION_ID: A2_AUTHORITATIVE_BINDING.CANONICALIZATION_ID,
    EXECUTION_INTENT_SHA256: intent.INTENT_SHA256,
    TASK_CONTRACT_SHA256: intent.TASK_CONTRACT_SHA256,
    COMPUTE_PROVIDER: selection.COMPUTE_PROVIDER,
    EXECUTION_TRANSPORT: selection.EXECUTION_TRANSPORT,
    VERIFIER_POLICY: selection.VERIFIER_POLICY,
    VERIFIER_POLICY_REF_SHA256: selection.VERIFIER_POLICY_REF_SHA256,
    INPUT_MODE: "NATIVE_REV51",
    EXECUTION_PATH_POLICY: intent.EXECUTION_PATH_POLICY,
    OPERATOR_POLICY: intent.OPERATOR_POLICY,
    CHECKPOINT_POLICY: intent.CHECKPOINT_POLICY,
    CACHE_POLICY: intent.CACHE_POLICY,
    DATA_LOCALITY_POLICY: intent.DATA_LOCALITY_POLICY,
    RESOURCE_INTENT: structuredClone(intent.RESOURCE_INTENT),
    SECURITY_REQUIREMENT: structuredClone(intent.SECURITY_REQUIREMENT),
    BUDGET_INTENT: structuredClone(intent.BUDGET_INTENT),
    ACCEPTANCE_REQUIREMENT_REF: intent.ACCEPTANCE_REQUIREMENT_REF,
    APPROVAL_BOUNDARY: structuredClone(intent.APPROVAL_BOUNDARY),
    SEMANTIC_DEPENDENCY_REFS: [...intent.SEMANTIC_DEPENDENCY_REFS],
    PARALLELISM_INTENT: intent.PARALLELISM_INTENT,
    EXPECTED_OUTPUT_CLASSES: [...intent.EXPECTED_OUTPUT_CLASSES],
    EXPECTED_EVIDENCE_CLASSES: [...intent.EXPECTED_EVIDENCE_CLASSES]
  };
  plan.OBJECT_SHA256 = computeRev51ObjectHash(plan);

  const envelope = validateContractEnvelope(plan, {
    schemaId: "RUNTIME_EXECUTION_PLAN_V1",
    schemaVersion: "1",
    canonicalizationId: RUNTIME_PLAN_CANONICALIZATION_ID,
    upstreamObjectSha256: intent.INTENT_SHA256
  });
  if (!envelope.ok) throw new Error(`RUNTIME_PLAN_ENVELOPE_INVALID:${envelope.errors.join("|")}`);

  const inputMode = validateExecutionInputMode(plan);
  if (!inputMode.ok) throw new Error(`RUNTIME_PLAN_INPUT_MODE_INVALID:${inputMode.errors.join("|")}`);

  return plan;
}
