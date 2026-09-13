import { createHash } from "node:crypto";
import {
  INTERFACE_VERSION,
  INTERFACE_MANIFEST_SHA256,
  TASK_CONTRACT_SCHEMA_SHA256,
  TASK_CONTRACT_MACHINE_SCHEMA_SHA256,
  validateTaskContractV1
} from "./task-contract-v1.mjs";
import { PLAN_A_BACKEND, compilePlanABackendBinding } from "./backend-plan-a.mjs";

export const RUNTIME_B_SELECTION_RECEIPT_TYPE = "RUNTIME_B_BACKEND_SELECTION_V1";
export const RUNTIME_B_BINDING_TYPE = "RUNTIME_B_BACKEND_BINDING_V1";

export const V1_HOSTED_BACKEND = Object.freeze({
  backend_id: "GITHUB_HOSTED_NODE_WEB_VERIFY_V1",
  backend_kind: "GITHUB_HOSTED",
  os_class: "LINUX",
  arch_class: "X64",
  profile: "NODE_WEB_VERIFY",
  profile_version: 1,
  fallback_backend_id: null,
  target_source_write_authority: "NONE"
});

const READ_ONLY_EFFECTS = new Set(["READ_ONLY", "LOCAL_COMPUTE"]);
const VALIDATION_CAPABILITIES = new Set([
  "SOURCE_READ",
  "FILESYSTEM_READ",
  "PROCESS_EXEC",
  "BROWSER_AUTOMATION"
]);
const READ_ONLY_WORKSPACES = new Set(["NONE", "READ_ONLY"]);
const DATA_ACCESS = new Set(["PUBLIC", "PROJECT_INTERNAL"]);
const HOSTED_EXECUTION_CLASSES = new Set(["RUNTIME_DEFAULT", "HOSTED_ELIGIBLE"]);
const BACKEND_BINDING_KEYS = Object.freeze([
  "binding_type",
  "interface_version",
  "interface_manifest_sha256",
  "task_contract_schema_sha256",
  "task_contract_machine_schema_sha256",
  "task_contract_hash",
  "backend_id",
  "backend_kind",
  "target_source_write_authority",
  "backend_binding_sha256"
]);

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function sha256Json(value) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function sharedValidationReasons(taskContract) {
  const validation = validateTaskContractV1(taskContract);
  return { validation, reasons: [...validation.errors] };
}

function validateReadOnlyValidationEnvelope(taskContract, prefix) {
  const reasons = [];
  const resource = taskContract.RESOURCE_REQUIREMENTS;

  if (!new Set(["ANY", "LINUX"]).has(resource.OS_CLASS)) reasons.push(`${prefix}:RESOURCE_REQUIREMENTS.OS_CLASS:LINUX_X64_MISMATCH`);
  if (!new Set(["ANY", "X64"]).has(resource.ARCH_CLASS)) reasons.push(`${prefix}:RESOURCE_REQUIREMENTS.ARCH_CLASS:LINUX_X64_MISMATCH`);
  if (!READ_ONLY_WORKSPACES.has(resource.WORKSPACE_CLASS)) reasons.push(`${prefix}:RESOURCE_REQUIREMENTS.WORKSPACE_CLASS:READ_ONLY_REQUIRED`);

  for (const effect of taskContract.EFFECT_CLASSES) {
    if (!READ_ONLY_EFFECTS.has(effect)) reasons.push(`${prefix}:EFFECT_CLASSES:${effect}:UNSUPPORTED`);
  }
  for (const capability of taskContract.CAPABILITY_REQUIREMENTS) {
    if (!VALIDATION_CAPABILITIES.has(capability)) reasons.push(`${prefix}:CAPABILITY_REQUIREMENTS:${capability}:UNSUPPORTED`);
  }
  if (taskContract.SOURCE_IDENTITY.KIND === "GIT" && !taskContract.CAPABILITY_REQUIREMENTS.includes("SOURCE_READ")) {
    reasons.push(`${prefix}:CAPABILITY_REQUIREMENTS:SOURCE_READ_REQUIRED_FOR_GIT`);
  }
  if (taskContract.TOUCH_SET.some((entry) => entry.OPERATION !== "READ")) reasons.push(`${prefix}:TOUCH_SET:READ_ONLY_REQUIRED`);
  if (taskContract.NETWORK_CLASS !== "NONE") reasons.push(`${prefix}:NETWORK_CLASS:RUNTIME_NATIVE_POLICY_NOT_AVAILABLE_B1`);
  if (!DATA_ACCESS.has(taskContract.DATA_ACCESS_CLASS)) reasons.push(`${prefix}:DATA_ACCESS_CLASS:UNSUPPORTED`);
  if (taskContract.SECRET_CLASS !== "NONE") reasons.push(`${prefix}:SECRET_CLASS:SECRET_ISSUANCE_NOT_AVAILABLE_B1`);
  if (taskContract.REMOTE_MUTATION_INTENT !== "NONE") reasons.push(`${prefix}:REMOTE_MUTATION_INTENT:SOURCE_WRITE_ZERO`);
  if (taskContract.HOST_OPERATION_INTENT !== "NONE") reasons.push(`${prefix}:HOST_OPERATION_INTENT:HOST_PRIVILEGE_ZERO`);
  if (taskContract.ORACLE_REQUIREMENT !== "NONE") reasons.push(`${prefix}:ORACLE_REQUIREMENT:ORACLE_NOT_AVAILABLE_B1`);

  return reasons;
}

export function compileV1HostedBinding(taskContract) {
  const { validation, reasons } = sharedValidationReasons(taskContract);

  if (validation.ok) {
    if (!HOSTED_EXECUTION_CLASSES.has(taskContract.RESOURCE_REQUIREMENTS.EXECUTION_CLASS)) {
      reasons.push("HOSTED_V1:RESOURCE_REQUIREMENTS.EXECUTION_CLASS:HOSTED_NOT_DECLARED");
    }
    reasons.push(...validateReadOnlyValidationEnvelope(taskContract, "HOSTED_V1"));
  }

  return {
    ok: reasons.length === 0,
    result: reasons.length === 0 ? "ELIGIBLE" : "BLOCKED",
    reasons,
    binding: {
      interface_version: INTERFACE_VERSION,
      interface_manifest_sha256: INTERFACE_MANIFEST_SHA256,
      task_contract_hash: taskContract?.TASK_CONTRACT_HASH ?? null,
      backend_id: V1_HOSTED_BACKEND.backend_id,
      backend_kind: V1_HOSTED_BACKEND.backend_kind,
      os_class: V1_HOSTED_BACKEND.os_class,
      arch_class: V1_HOSTED_BACKEND.arch_class,
      profile: V1_HOSTED_BACKEND.profile,
      profile_version: V1_HOSTED_BACKEND.profile_version,
      fallback_backend_id: null,
      target_source_write_authority: "NONE"
    }
  };
}

function backendBindingPayload(taskContractHash, backend) {
  return {
    binding_type: RUNTIME_B_BINDING_TYPE,
    interface_version: INTERFACE_VERSION,
    interface_manifest_sha256: INTERFACE_MANIFEST_SHA256,
    task_contract_schema_sha256: TASK_CONTRACT_SCHEMA_SHA256,
    task_contract_machine_schema_sha256: TASK_CONTRACT_MACHINE_SCHEMA_SHA256,
    task_contract_hash: taskContractHash,
    backend_id: backend.backend_id,
    backend_kind: backend.backend_kind,
    target_source_write_authority: backend.target_source_write_authority
  };
}

export function buildBackendBindingIdentity(taskContractHash, backend) {
  const payload = backendBindingPayload(taskContractHash, backend);
  return {
    ...payload,
    backend_binding_sha256: sha256Json(payload)
  };
}

export function verifyBackendBoundContext(bindingIdentity, expected) {
  const errors = [];
  if (!bindingIdentity || typeof bindingIdentity !== "object" || Array.isArray(bindingIdentity)) return { ok: false, errors: ["BACKEND_BINDING_MISSING"] };
  if (!exactKeys(bindingIdentity, BACKEND_BINDING_KEYS)) errors.push("BACKEND_BINDING_FIELDS_MISMATCH");
  if (bindingIdentity.binding_type !== RUNTIME_B_BINDING_TYPE) errors.push("BACKEND_BINDING_TYPE_MISMATCH");
  if (bindingIdentity.interface_version !== INTERFACE_VERSION) errors.push("INTERFACE_VERSION_MISMATCH");
  if (bindingIdentity.interface_manifest_sha256 !== INTERFACE_MANIFEST_SHA256) errors.push("INTERFACE_MANIFEST_MISMATCH");
  if (bindingIdentity.task_contract_schema_sha256 !== TASK_CONTRACT_SCHEMA_SHA256) errors.push("TASK_CONTRACT_SCHEMA_MISMATCH");
  if (bindingIdentity.task_contract_machine_schema_sha256 !== TASK_CONTRACT_MACHINE_SCHEMA_SHA256) errors.push("TASK_CONTRACT_MACHINE_SCHEMA_MISMATCH");
  if (bindingIdentity.task_contract_hash !== expected.task_contract_hash) errors.push("TASK_CONTRACT_HASH_MISMATCH");
  if (bindingIdentity.backend_id !== expected.backend_id) errors.push("BACKEND_ID_MISMATCH");
  if (bindingIdentity.backend_kind !== expected.backend_kind) errors.push("BACKEND_KIND_MISMATCH");
  if (bindingIdentity.target_source_write_authority !== "NONE") errors.push("SOURCE_WRITE_AUTHORITY_NOT_NONE");

  const { backend_binding_sha256, ...payload } = bindingIdentity;
  if (sha256Json(payload) !== backend_binding_sha256) errors.push("BACKEND_BINDING_DIGEST_MISMATCH");
  if (expected.backend_binding_sha256 && backend_binding_sha256 !== expected.backend_binding_sha256) errors.push("BACKEND_BINDING_EXPECTED_DIGEST_MISMATCH");

  return { ok: errors.length === 0, errors };
}

function normalizedEvaluation(result, backend) {
  return {
    backend_id: backend.backend_id,
    backend_kind: backend.backend_kind,
    result: result.result,
    reasons: [...result.reasons]
  };
}

export function selectRuntimeBBackend(taskContract) {
  const validation = validateTaskContractV1(taskContract);
  const taskContractHash = taskContract?.TASK_CONTRACT_HASH ?? null;

  if (!validation.ok) {
    return {
      receipt_type: RUNTIME_B_SELECTION_RECEIPT_TYPE,
      interface_version: INTERFACE_VERSION,
      interface_manifest_sha256: INTERFACE_MANIFEST_SHA256,
      task_contract_schema_sha256: TASK_CONTRACT_SCHEMA_SHA256,
      task_contract_machine_schema_sha256: TASK_CONTRACT_MACHINE_SCHEMA_SHA256,
      task_contract_hash: taskContractHash,
      execution_class: taskContract?.RESOURCE_REQUIREMENTS?.EXECUTION_CLASS ?? null,
      selected_backend: null,
      backend_binding: null,
      candidate_evaluations: [],
      fallback_used: false,
      runtime_source_write_authority: "NONE",
      result: "BLOCKED",
      reasons: [...validation.errors]
    };
  }

  const executionClass = taskContract.RESOURCE_REQUIREMENTS.EXECUTION_CLASS;
  const hosted = compileV1HostedBinding(taskContract);
  const selfHosted = compilePlanABackendBinding(taskContract);
  let selected = null;
  let selectedDescriptor = null;
  const reasons = [];

  if (executionClass === "RUNTIME_DEFAULT" || executionClass === "HOSTED_ELIGIBLE") {
    if (hosted.ok) {
      selected = hosted.binding;
      selectedDescriptor = V1_HOSTED_BACKEND;
    } else {
      reasons.push(...hosted.reasons);
    }
  } else if (executionClass === "SELF_HOSTED_REQUIRED") {
    if (selfHosted.ok) {
      selected = selfHosted.binding;
      selectedDescriptor = PLAN_A_BACKEND;
    } else {
      reasons.push(...selfHosted.reasons);
    }
  } else if (executionClass === "HOST_LOCAL_REQUIRED") {
    reasons.push("RUNTIME_B:NO_BACKEND_FOR_HOST_LOCAL_REQUIRED");
  } else {
    reasons.push("RUNTIME_B:UNSUPPORTED_EXECUTION_CLASS");
  }

  const backendBinding = selectedDescriptor ? buildBackendBindingIdentity(taskContractHash, selectedDescriptor) : null;

  return {
    receipt_type: RUNTIME_B_SELECTION_RECEIPT_TYPE,
    interface_version: INTERFACE_VERSION,
    interface_manifest_sha256: INTERFACE_MANIFEST_SHA256,
    task_contract_schema_sha256: TASK_CONTRACT_SCHEMA_SHA256,
    task_contract_machine_schema_sha256: TASK_CONTRACT_MACHINE_SCHEMA_SHA256,
    task_contract_hash: taskContractHash,
    execution_class: executionClass,
    selected_backend: selected,
    backend_binding: backendBinding,
    candidate_evaluations: [
      normalizedEvaluation(hosted, V1_HOSTED_BACKEND),
      normalizedEvaluation(selfHosted, PLAN_A_BACKEND)
    ],
    fallback_used: false,
    runtime_source_write_authority: "NONE",
    result: selected ? "SELECTED" : "BLOCKED",
    reasons
  };
}
