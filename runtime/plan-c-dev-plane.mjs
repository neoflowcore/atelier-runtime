import { createHash } from "node:crypto";
import {
  INTERFACE_VERSION,
  INTERFACE_MANIFEST_SHA256,
  TASK_CONTRACT_SCHEMA_SHA256,
  TASK_CONTRACT_MACHINE_SCHEMA_SHA256,
  FROZEN_TASK_CONTRACT_FIELDS,
  validateTaskContractV1
} from "./task-contract-v1.mjs";

export const RUNTIME_C_DEV_PLANE_RECEIPT_TYPE = "RUNTIME_C_DEV_PLANE_V1";
export const RUNTIME_C_EXECUTION_PROFILE = "SELF_HOSTED_LINUX_X64_DEV_WORKSPACE_V1";
export const RUNTIME_C_BACKEND_ID = "SELF_HOSTED_LINUX_X64_V1";
export const RUNTIME_C_SOURCE_WRITE_AUTHORITY = "GATEWAY_ONLY";
export const RUNTIME_C_LEASE_STATE = "NOT_IMPLEMENTED_PLAN_D";

const SHA40 = /^[0-9a-f]{40}$/;
const REQUIRED_EFFECTS = Object.freeze(["LOCAL_COMPUTE", "LOCAL_WORKSPACE_WRITE", "REMOTE_SOURCE_WRITE"]);
const FORBIDDEN_EFFECTS = new Set(["MERGE_OR_TAG", "PRODUCTION_CHANGE", "HOST_PRIVILEGED_CHANGE", "EXTERNAL_ORACLE"]);
const REQUIRED_CAPABILITIES = Object.freeze([
  "SOURCE_READ",
  "FILESYSTEM_READ",
  "FILESYSTEM_WRITE",
  "PROCESS_EXEC",
  "NETWORK_EGRESS",
  "GIT_CANDIDATE_WRITE"
]);

function sha256Json(value) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function validateRuntimeBSeal(receipt) {
  const errors = [];
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) return ["RUNTIME_B_SEAL_MISSING"];
  if (receipt.receipt_type !== "RUNTIME_B_SEAL_RECEIPT_V1") errors.push("RUNTIME_B_SEAL_TYPE_MISMATCH");
  if (receipt.runtime_b_sealed !== "YES" || receipt.seal_decision !== "SEALED" || receipt.result !== "PASS") {
    errors.push("RUNTIME_B_NOT_SEALED");
  }
  if (receipt.sync_3 !== "NOT_EVALUATED") errors.push("SYNC_3_PREMATURE");
  if (receipt.lease_state !== RUNTIME_C_LEASE_STATE) errors.push("PLAN_D_LEASE_FENCE_VIOLATION");
  if (receipt.validation_execution_source_write !== 0) errors.push("RUNTIME_B_VALIDATION_SOURCE_WRITE_NONZERO");
  if (receipt.remote_source_write_authority !== "NONE") errors.push("RUNTIME_B_SOURCE_WRITE_AUTHORITY_NOT_NONE");
  return errors;
}

export function validateRuntimeCDevelopmentTask(taskContract) {
  const validation = validateTaskContractV1(taskContract);
  const errors = [...validation.errors];
  if (!validation.ok) return { ok: false, errors };

  const resource = taskContract.RESOURCE_REQUIREMENTS;
  if (taskContract.SOURCE_IDENTITY.KIND !== "GIT") errors.push("SOURCE_IDENTITY_KIND_MUST_BE_GIT");
  if (!SHA40.test(taskContract.EXPECTED_HEAD ?? "")) errors.push("EXPECTED_HEAD_SHA_REQUIRED");
  if (resource.EXECUTION_CLASS !== "SELF_HOSTED_REQUIRED") errors.push("EXECUTION_CLASS_SELF_HOSTED_REQUIRED");
  if (!new Set(["ANY", "LINUX"]).has(resource.OS_CLASS)) errors.push("OS_CLASS_LINUX_REQUIRED");
  if (!new Set(["ANY", "X64"]).has(resource.ARCH_CLASS)) errors.push("ARCH_CLASS_X64_REQUIRED");
  if (resource.WORKSPACE_CLASS !== "ISOLATED_WRITABLE") errors.push("WORKSPACE_CLASS_ISOLATED_WRITABLE_REQUIRED");

  for (const effect of REQUIRED_EFFECTS) {
    if (!taskContract.EFFECT_CLASSES.includes(effect)) errors.push(`EFFECT_REQUIRED:${effect}`);
  }
  for (const effect of taskContract.EFFECT_CLASSES) {
    if (FORBIDDEN_EFFECTS.has(effect)) errors.push(`EFFECT_FORBIDDEN_IN_PLAN_C:${effect}`);
  }
  for (const capability of REQUIRED_CAPABILITIES) {
    if (!taskContract.CAPABILITY_REQUIREMENTS.includes(capability)) errors.push(`CAPABILITY_REQUIRED:${capability}`);
  }

  if (!taskContract.TOUCH_SET.some((entry) => entry.OPERATION !== "READ")) errors.push("TOUCH_SET_WRITE_REQUIRED");
  if (taskContract.NETWORK_CLASS !== "ALLOWLIST_MUTATE") errors.push("NETWORK_CLASS_ALLOWLIST_MUTATE_REQUIRED");
  if (!new Set(["PROJECT_INTERNAL", "PRIVATE_SOURCE"]).has(taskContract.DATA_ACCESS_CLASS)) errors.push("DATA_ACCESS_CLASS_UNSUPPORTED");
  if (taskContract.SECRET_CLASS !== "SOURCE_WRITE") errors.push("SECRET_CLASS_SOURCE_WRITE_REQUIRED");
  if (taskContract.REMOTE_MUTATION_INTENT !== "EXACT_APPROVAL_REQUIRED") errors.push("REMOTE_MUTATION_EXACT_APPROVAL_REQUIRED");
  if (taskContract.HOST_OPERATION_INTENT !== "NONE") errors.push("HOST_OPERATION_INTENT_MUST_BE_NONE");
  if (taskContract.ORACLE_REQUIREMENT !== "NONE") errors.push("ORACLE_REQUIREMENT_NOT_PLAN_C");
  if (taskContract.ECONOMY_BUDGET.MAX_PARALLELISM !== 1) errors.push("MAX_PARALLELISM_MUST_BE_ONE_BEFORE_PLAN_D");

  return { ok: errors.length === 0, errors };
}

export function compileRuntimeCDevPlane(taskContract, runtimeBSealReceipt) {
  const task = validateRuntimeCDevelopmentTask(taskContract);
  const errors = [...task.errors, ...validateRuntimeBSeal(runtimeBSealReceipt)];
  const runtimeBSealSha256 = sha256Json(runtimeBSealReceipt);
  const touchSetSha256 = sha256Json(taskContract?.TOUCH_SET ?? null);
  const workspacePayload = {
    execution_profile: RUNTIME_C_EXECUTION_PROFILE,
    backend_id: RUNTIME_C_BACKEND_ID,
    task_contract_hash: taskContract?.TASK_CONTRACT_HASH ?? null,
    source_locator: taskContract?.SOURCE_IDENTITY?.LOCATOR ?? null,
    expected_head: taskContract?.EXPECTED_HEAD ?? null,
    touch_set_sha256: touchSetSha256
  };

  return {
    receipt_type: RUNTIME_C_DEV_PLANE_RECEIPT_TYPE,
    interface_version: INTERFACE_VERSION,
    interface_manifest_sha256: INTERFACE_MANIFEST_SHA256,
    task_contract_schema_sha256: TASK_CONTRACT_SCHEMA_SHA256,
    task_contract_machine_schema_sha256: TASK_CONTRACT_MACHINE_SCHEMA_SHA256,
    frozen_task_contract_fields_count: FROZEN_TASK_CONTRACT_FIELDS.length,
    task_contract_hash: taskContract?.TASK_CONTRACT_HASH ?? null,
    runtime_b_seal_sha256: runtimeBSealSha256,
    backend_id: RUNTIME_C_BACKEND_ID,
    execution_profile: RUNTIME_C_EXECUTION_PROFILE,
    workspace_class: "ISOLATED_WRITABLE",
    workspace_identity_sha256: sha256Json(workspacePayload),
    source_locator: taskContract?.SOURCE_IDENTITY?.LOCATOR ?? null,
    expected_head: taskContract?.EXPECTED_HEAD ?? null,
    touch_set_sha256: touchSetSha256,
    remote_source_write_authority: RUNTIME_C_SOURCE_WRITE_AUTHORITY,
    validation_execution_source_write: 0,
    lease_state: RUNTIME_C_LEASE_STATE,
    result: errors.length === 0 ? "ELIGIBLE" : "BLOCKED",
    reasons: errors
  };
}
