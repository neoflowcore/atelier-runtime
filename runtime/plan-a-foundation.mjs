import { createHash } from "node:crypto";
import { PLAN_A_BACKEND, compilePlanABackendBinding } from "./backend-plan-a.mjs";
import { INTERFACE_MANIFEST_SHA256, INTERFACE_VERSION } from "./task-contract-v1.mjs";

export const PLAN_A_RECEIPT_TYPE = "RUNTIME_A_SELF_HOSTED_FOUNDATION_V1";
export const PLAN_A_RECEIPT_SCHEMA_VERSION = 1;
export const PLAN_A_NODE_VERSION = "v22.13.0";

const SHA40_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const RESULT_STATES = new Set(["PASS", "BLOCKED", "APP_FAILURE", "INFRA_FAILURE"]);
const RECEIPT_FIELDS = Object.freeze([
  "receipt_schema_version",
  "receipt_type",
  "request_id",
  "idempotency_key",
  "repository",
  "requested_sha",
  "executed_sha",
  "requested_runtime_sha",
  "runtime_engine_sha",
  "interface_version",
  "interface_manifest_sha256",
  "task_contract_hash",
  "backend_identity",
  "source_integrity",
  "probe_scope",
  "result",
  "failure_reason"
]);

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function observedBackendErrors(observed) {
  const errors = [];
  if (observed?.runner_environment !== "self-hosted") errors.push("RUNNER_ENVIRONMENT_NOT_SELF_HOSTED");
  if (observed?.runner_os !== "Linux") errors.push("RUNNER_OS_NOT_LINUX");
  if (observed?.runner_arch !== "X64") errors.push("RUNNER_ARCH_NOT_X64");
  if (observed?.node_version !== PLAN_A_NODE_VERSION) errors.push("NODE_VERSION_NOT_22_13_0");
  return errors;
}

function identityErrors({ contract, repository, requestedSha, executedSha, requestedRuntimeSha, runtimeEngineSha }) {
  const errors = [];
  if (!contract || typeof contract !== "object") return ["TASK_CONTRACT_MISSING"];
  if (contract.SOURCE_IDENTITY?.KIND !== "GIT") errors.push("SOURCE_IDENTITY_KIND_NOT_GIT");
  if (contract.SOURCE_IDENTITY?.LOCATOR !== `github:${repository}`) errors.push("SOURCE_IDENTITY_LOCATOR_MISMATCH");
  if (!Array.isArray(contract.ALLOWED_SCOPE) || !contract.ALLOWED_SCOPE.includes(`repo:${repository}`)) errors.push("ALLOWED_SCOPE_REPOSITORY_MISSING");
  if (contract.EXPECTED_HEAD !== requestedSha) errors.push("TASK_EXPECTED_HEAD_REQUEST_MISMATCH");
  if (executedSha !== requestedSha) errors.push("TARGET_SHA_MISMATCH");
  if (runtimeEngineSha !== requestedRuntimeSha) errors.push("RUNTIME_SHA_MISMATCH");
  return errors;
}

export function buildPlanAFoundationReceipt({
  requestId,
  idempotencyKey,
  repository,
  requestedSha,
  executedSha,
  requestedRuntimeSha,
  runtimeEngineSha,
  taskContract,
  observedBackend,
  sourceBefore,
  sourceAfter
}) {
  const binding = compilePlanABackendBinding(taskContract);
  const contractErrors = [...binding.reasons, ...identityErrors({ contract: taskContract, repository, requestedSha, executedSha, requestedRuntimeSha, runtimeEngineSha })];
  const backendErrors = observedBackendErrors(observedBackend);
  const sourceChanged = Boolean(
    sourceBefore && sourceAfter && (
      sourceBefore.head_sha !== sourceAfter.head_sha ||
      sourceBefore.tree_sha !== sourceAfter.tree_sha ||
      sourceBefore.tracked_status !== sourceAfter.tracked_status
    )
  );

  let result = "PASS";
  let failureReason = null;
  if (contractErrors.length) {
    result = "BLOCKED";
    failureReason = contractErrors[0];
  } else if (backendErrors.length) {
    result = "INFRA_FAILURE";
    failureReason = backendErrors[0];
  } else if (!sourceBefore || !sourceAfter) {
    result = "INFRA_FAILURE";
    failureReason = "SOURCE_EVIDENCE_MISSING";
  } else if (sourceChanged) {
    result = "APP_FAILURE";
    failureReason = "TRACKED_SOURCE_MUTATION";
  }

  return {
    receipt_schema_version: PLAN_A_RECEIPT_SCHEMA_VERSION,
    receipt_type: PLAN_A_RECEIPT_TYPE,
    request_id: requestId,
    idempotency_key: idempotencyKey,
    repository,
    requested_sha: requestedSha,
    executed_sha: executedSha ?? null,
    requested_runtime_sha: requestedRuntimeSha,
    runtime_engine_sha: runtimeEngineSha ?? null,
    interface_version: INTERFACE_VERSION,
    interface_manifest_sha256: INTERFACE_MANIFEST_SHA256,
    task_contract_hash: taskContract?.TASK_CONTRACT_HASH ?? null,
    backend_identity: {
      backend_id: PLAN_A_BACKEND.backend_id,
      backend_kind: PLAN_A_BACKEND.backend_kind,
      expected_runner_labels: [...PLAN_A_BACKEND.runner_labels],
      runner_environment: observedBackend?.runner_environment ?? null,
      runner_os: observedBackend?.runner_os ?? null,
      runner_arch: observedBackend?.runner_arch ?? null,
      node_version: observedBackend?.node_version ?? null,
      fallback_backend_id: PLAN_A_BACKEND.fallback_backend_id
    },
    source_integrity: {
      tree_sha_before: sourceBefore?.tree_sha ?? null,
      tree_sha_after: sourceAfter?.tree_sha ?? null,
      tracked_source_mutation_detected: sourceChanged,
      remote_source_write_authority: "NONE"
    },
    probe_scope: "BACKEND_FOUNDATION_READ_ONLY_PROBE",
    result,
    failure_reason: failureReason
  };
}

export function validatePlanAFoundationReceipt(receipt) {
  const errors = [];
  if (!exactKeys(receipt, RECEIPT_FIELDS)) errors.push("INVALID_TOP_LEVEL_FIELDS");
  if (receipt?.receipt_schema_version !== 1) errors.push("INVALID_RECEIPT_SCHEMA_VERSION");
  if (receipt?.receipt_type !== PLAN_A_RECEIPT_TYPE) errors.push("INVALID_RECEIPT_TYPE");
  if (typeof receipt?.request_id !== "string" || receipt.request_id.length < 1 || receipt.request_id.length > 128) errors.push("INVALID_REQUEST_ID");
  if (typeof receipt?.idempotency_key !== "string" || receipt.idempotency_key.length < 1 || receipt.idempotency_key.length > 256) errors.push("INVALID_IDEMPOTENCY_KEY");
  if (typeof receipt?.repository !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(receipt.repository)) errors.push("INVALID_REPOSITORY");
  if (!SHA40_RE.test(receipt?.requested_sha ?? "")) errors.push("INVALID_REQUESTED_SHA");
  if (!(receipt?.executed_sha === null || SHA40_RE.test(receipt.executed_sha ?? ""))) errors.push("INVALID_EXECUTED_SHA");
  if (!SHA40_RE.test(receipt?.requested_runtime_sha ?? "")) errors.push("INVALID_REQUESTED_RUNTIME_SHA");
  if (!(receipt?.runtime_engine_sha === null || SHA40_RE.test(receipt.runtime_engine_sha ?? ""))) errors.push("INVALID_RUNTIME_ENGINE_SHA");
  if (receipt?.interface_version !== INTERFACE_VERSION) errors.push("INVALID_INTERFACE_VERSION");
  if (receipt?.interface_manifest_sha256 !== INTERFACE_MANIFEST_SHA256) errors.push("INVALID_INTERFACE_MANIFEST");
  if (!(receipt?.task_contract_hash === null || SHA256_RE.test(receipt.task_contract_hash ?? ""))) errors.push("INVALID_TASK_CONTRACT_HASH");

  const backend = receipt?.backend_identity;
  if (!exactKeys(backend, ["backend_id", "backend_kind", "expected_runner_labels", "runner_environment", "runner_os", "runner_arch", "node_version", "fallback_backend_id"])) {
    errors.push("INVALID_BACKEND_IDENTITY_FIELDS");
  } else {
    if (backend.backend_id !== PLAN_A_BACKEND.backend_id) errors.push("INVALID_BACKEND_ID");
    if (backend.backend_kind !== PLAN_A_BACKEND.backend_kind) errors.push("INVALID_BACKEND_KIND");
    if (JSON.stringify(backend.expected_runner_labels) !== JSON.stringify([...PLAN_A_BACKEND.runner_labels])) errors.push("INVALID_RUNNER_LABELS");
    if (backend.fallback_backend_id !== null) errors.push("INVALID_FALLBACK_BACKEND");
  }

  const integrity = receipt?.source_integrity;
  if (!exactKeys(integrity, ["tree_sha_before", "tree_sha_after", "tracked_source_mutation_detected", "remote_source_write_authority"])) {
    errors.push("INVALID_SOURCE_INTEGRITY_FIELDS");
  } else {
    for (const field of ["tree_sha_before", "tree_sha_after"]) {
      if (!(integrity[field] === null || SHA40_RE.test(integrity[field] ?? ""))) errors.push(`INVALID_${field.toUpperCase()}`);
    }
    if (typeof integrity.tracked_source_mutation_detected !== "boolean") errors.push("INVALID_MUTATION_FLAG");
    if (integrity.remote_source_write_authority !== "NONE") errors.push("INVALID_REMOTE_SOURCE_WRITE_AUTHORITY");
  }

  if (receipt?.probe_scope !== "BACKEND_FOUNDATION_READ_ONLY_PROBE") errors.push("INVALID_PROBE_SCOPE");
  if (!RESULT_STATES.has(receipt?.result)) errors.push("INVALID_RESULT");
  if (!(receipt?.failure_reason === null || typeof receipt.failure_reason === "string")) errors.push("INVALID_FAILURE_REASON");
  if (receipt?.result === "PASS") {
    if (receipt.requested_sha !== receipt.executed_sha) errors.push("PASS_SHA_MISMATCH");
    if (receipt.requested_runtime_sha !== receipt.runtime_engine_sha) errors.push("PASS_RUNTIME_SHA_MISMATCH");
    if (receipt.backend_identity?.runner_environment !== "self-hosted") errors.push("PASS_NOT_SELF_HOSTED");
    if (receipt.backend_identity?.runner_os !== "Linux") errors.push("PASS_NOT_LINUX");
    if (receipt.backend_identity?.runner_arch !== "X64") errors.push("PASS_NOT_X64");
    if (receipt.backend_identity?.node_version !== PLAN_A_NODE_VERSION) errors.push("PASS_NODE_VERSION_MISMATCH");
    if (receipt.source_integrity?.tracked_source_mutation_detected) errors.push("PASS_WITH_SOURCE_MUTATION");
    if (receipt.failure_reason !== null) errors.push("PASS_WITH_FAILURE_REASON");
  } else if (!receipt?.failure_reason) {
    errors.push("FAILURE_WITHOUT_REASON");
  }

  return { ok: errors.length === 0, errors };
}

export function digestReceipt(receipt) {
  return createHash("sha256").update(JSON.stringify(receipt), "utf8").digest("hex");
}
