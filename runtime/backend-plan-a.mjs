import {
  INTERFACE_VERSION,
  INTERFACE_MANIFEST_SHA256,
  validateTaskContractV1
} from "./task-contract-v1.mjs";

export const PLAN_A_BACKEND = Object.freeze({
  backend_id: "SELF_HOSTED_LINUX_X64_V1",
  backend_kind: "SELF_HOSTED",
  os_class: "LINUX",
  arch_class: "X64",
  runner_labels: Object.freeze(["self-hosted", "linux", "x64", "atelier-runtime-v1"]),
  fallback_backend_id: null,
  target_source_write_authority: "NONE"
});

const SUPPORTED_EFFECTS = new Set(["READ_ONLY", "LOCAL_COMPUTE"]);
const SUPPORTED_CAPABILITIES = new Set(["SOURCE_READ", "FILESYSTEM_READ", "PROCESS_EXEC", "BROWSER_AUTOMATION"]);
const SUPPORTED_WORKSPACES = new Set(["NONE", "READ_ONLY"]);
const SUPPORTED_DATA_ACCESS = new Set(["PUBLIC", "PROJECT_INTERNAL"]);

export function compilePlanABackendBinding(taskContract) {
  const validation = validateTaskContractV1(taskContract);
  const reasons = [...validation.errors];

  if (validation.ok) {
    const resource = taskContract.RESOURCE_REQUIREMENTS;
    if (resource.EXECUTION_CLASS !== "SELF_HOSTED_REQUIRED") reasons.push("RESOURCE_REQUIREMENTS.EXECUTION_CLASS:PLAN_A_REQUIRES_SELF_HOSTED_REQUIRED");
    if (!new Set(["ANY", "LINUX"]).has(resource.OS_CLASS)) reasons.push("RESOURCE_REQUIREMENTS.OS_CLASS:PLAN_A_LINUX_X64_MISMATCH");
    if (!new Set(["ANY", "X64"]).has(resource.ARCH_CLASS)) reasons.push("RESOURCE_REQUIREMENTS.ARCH_CLASS:PLAN_A_LINUX_X64_MISMATCH");
    if (!SUPPORTED_WORKSPACES.has(resource.WORKSPACE_CLASS)) reasons.push("RESOURCE_REQUIREMENTS.WORKSPACE_CLASS:PLAN_A_UNSUPPORTED");

    for (const effect of taskContract.EFFECT_CLASSES) {
      if (!SUPPORTED_EFFECTS.has(effect)) reasons.push(`EFFECT_CLASSES:${effect}:PLAN_A_UNSUPPORTED`);
    }
    for (const capability of taskContract.CAPABILITY_REQUIREMENTS) {
      if (!SUPPORTED_CAPABILITIES.has(capability)) reasons.push(`CAPABILITY_REQUIREMENTS:${capability}:PLAN_A_UNSUPPORTED`);
    }

    if (taskContract.NETWORK_CLASS !== "NONE") reasons.push("NETWORK_CLASS:PLAN_A_EGRESS_ENFORCEMENT_NOT_AVAILABLE");
    if (!SUPPORTED_DATA_ACCESS.has(taskContract.DATA_ACCESS_CLASS)) reasons.push("DATA_ACCESS_CLASS:PLAN_A_UNSUPPORTED");
    if (taskContract.SECRET_CLASS !== "NONE") reasons.push("SECRET_CLASS:PLAN_A_SECRET_ISSUANCE_NOT_AVAILABLE");
    if (taskContract.REMOTE_MUTATION_INTENT !== "NONE") reasons.push("REMOTE_MUTATION_INTENT:PLAN_A_SOURCE_WRITE_ZERO");
    if (taskContract.HOST_OPERATION_INTENT !== "NONE") reasons.push("HOST_OPERATION_INTENT:PLAN_A_HOST_PRIVILEGE_ZERO");
    if (taskContract.ORACLE_REQUIREMENT !== "NONE") reasons.push("ORACLE_REQUIREMENT:PLAN_A_ORACLE_NOT_AVAILABLE");
  }

  return {
    ok: reasons.length === 0,
    result: reasons.length === 0 ? "ELIGIBLE" : "BLOCKED",
    reasons,
    binding: {
      interface_version: INTERFACE_VERSION,
      interface_manifest_sha256: INTERFACE_MANIFEST_SHA256,
      task_contract_hash: taskContract?.TASK_CONTRACT_HASH ?? null,
      backend_id: PLAN_A_BACKEND.backend_id,
      backend_kind: PLAN_A_BACKEND.backend_kind,
      os_class: PLAN_A_BACKEND.os_class,
      arch_class: PLAN_A_BACKEND.arch_class,
      runner_labels: [...PLAN_A_BACKEND.runner_labels],
      fallback_backend_id: PLAN_A_BACKEND.fallback_backend_id,
      target_source_write_authority: PLAN_A_BACKEND.target_source_write_authority
    }
  };
}

export function buildPlanABackendReceipt(taskContract) {
  const plan = compilePlanABackendBinding(taskContract);
  return {
    receipt_type: "RUNTIME_A_BACKEND_BINDING_V1",
    interface_version: INTERFACE_VERSION,
    interface_manifest_sha256: INTERFACE_MANIFEST_SHA256,
    task_contract_hash: taskContract?.TASK_CONTRACT_HASH ?? null,
    backend_identity: {
      backend_id: PLAN_A_BACKEND.backend_id,
      backend_kind: PLAN_A_BACKEND.backend_kind,
      os_class: PLAN_A_BACKEND.os_class,
      arch_class: PLAN_A_BACKEND.arch_class,
      runner_labels: [...PLAN_A_BACKEND.runner_labels]
    },
    fallback_backend_id: null,
    target_source_write_authority: "NONE",
    result: plan.result,
    reasons: [...plan.reasons]
  };
}
