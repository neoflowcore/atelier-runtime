import { PLAN_A_BACKEND } from "./backend-plan-a.mjs";
import { INTERFACE_MANIFEST_SHA256, INTERFACE_VERSION } from "./task-contract-v1.mjs";
import { validatePlanAFoundationReceipt } from "./plan-a-foundation.mjs";
import { validatePlanAWorkerAttestationReceipt } from "./worker-attestation-plan-a.mjs";

export const PLAN_A_EVIDENCE_BINDING_TYPE = "RUNTIME_A_EVIDENCE_BINDING_V1";
export const PLAN_A_EVIDENCE_BINDING_SCHEMA_VERSION = 1;

const SHA40_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const RESULT_STATES = new Set(["PASS", "BLOCKED", "APP_FAILURE", "INFRA_FAILURE"]);
const RECEIPT_FIELDS = Object.freeze([
  "receipt_schema_version",
  "receipt_type",
  "request_id",
  "idempotency_key",
  "interface_version",
  "interface_manifest_sha256",
  "task_contract_hash",
  "requested_sha",
  "executed_sha",
  "requested_runtime_sha",
  "runtime_engine_sha",
  "backend_id",
  "backend_kind",
  "expected_runner_labels",
  "worker_attestation_sha256",
  "foundation_receipt_sha256",
  "worker_fingerprint_sha256",
  "source_integrity",
  "lease_state",
  "remote_source_write_authority",
  "result",
  "failure_reason"
]);

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function sameArray(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function comparePlanAEvidenceReceipts(workerReceipt, foundationReceipt) {
  const errors = [];
  const workerValidation = validatePlanAWorkerAttestationReceipt(workerReceipt);
  const foundationValidation = validatePlanAFoundationReceipt(foundationReceipt);

  if (!workerValidation.ok) errors.push(`WORKER_RECEIPT_INVALID:${workerValidation.errors[0] ?? "UNKNOWN"}`);
  if (!foundationValidation.ok) errors.push(`FOUNDATION_RECEIPT_INVALID:${foundationValidation.errors[0] ?? "UNKNOWN"}`);

  if (workerReceipt?.request_id !== foundationReceipt?.request_id) errors.push("REQUEST_ID_MISMATCH");
  if (workerReceipt?.idempotency_key !== foundationReceipt?.idempotency_key) errors.push("IDEMPOTENCY_KEY_MISMATCH");
  if (workerReceipt?.requested_runtime_sha !== foundationReceipt?.requested_runtime_sha) errors.push("REQUESTED_RUNTIME_SHA_MISMATCH");
  if (workerReceipt?.runtime_engine_sha !== foundationReceipt?.runtime_engine_sha) errors.push("RUNTIME_ENGINE_SHA_MISMATCH");
  if (workerReceipt?.backend_id !== foundationReceipt?.backend_identity?.backend_id) errors.push("BACKEND_ID_MISMATCH");
  if (workerReceipt?.backend_kind !== foundationReceipt?.backend_identity?.backend_kind) errors.push("BACKEND_KIND_MISMATCH");
  if (!sameArray(workerReceipt?.expected_runner_labels, foundationReceipt?.backend_identity?.expected_runner_labels)) errors.push("RUNNER_LABEL_BINDING_MISMATCH");

  const worker = workerReceipt?.observed_worker;
  const backend = foundationReceipt?.backend_identity;
  for (const [workerField, backendField, reason] of [
    ["runner_environment", "runner_environment", "RUNNER_ENVIRONMENT_MISMATCH"],
    ["runner_os", "runner_os", "RUNNER_OS_MISMATCH"],
    ["runner_arch", "runner_arch", "RUNNER_ARCH_MISMATCH"],
    ["node_version", "node_version", "NODE_VERSION_MISMATCH"]
  ]) {
    if (worker?.[workerField] !== backend?.[backendField]) errors.push(reason);
  }

  if (workerReceipt?.lease_state !== "NOT_IMPLEMENTED_PLAN_D") errors.push("LEASE_BOUNDARY_VIOLATION");
  if (workerReceipt?.remote_source_write_authority !== "NONE") errors.push("WORKER_REMOTE_WRITE_AUTHORITY_PRESENT");
  if (foundationReceipt?.source_integrity?.remote_source_write_authority !== "NONE") errors.push("FOUNDATION_REMOTE_WRITE_AUTHORITY_PRESENT");

  return { ok: errors.length === 0, errors };
}

function terminalFromChildren(workerReceipt, foundationReceipt, pairValidation) {
  if (!pairValidation.ok) {
    return { result: "INFRA_FAILURE", failure_reason: pairValidation.errors[0] };
  }
  if (workerReceipt.result !== "PASS") {
    return {
      result: workerReceipt.result === "BLOCKED" ? "BLOCKED" : "INFRA_FAILURE",
      failure_reason: `WORKER:${workerReceipt.failure_reason ?? workerReceipt.result}`
    };
  }
  if (foundationReceipt.result !== "PASS") {
    return {
      result: foundationReceipt.result,
      failure_reason: `FOUNDATION:${foundationReceipt.failure_reason ?? foundationReceipt.result}`
    };
  }
  return { result: "PASS", failure_reason: null };
}

export function buildPlanAEvidenceBindingReceipt({
  workerReceipt,
  foundationReceipt,
  workerReceiptSha256,
  foundationReceiptSha256
}) {
  const pairValidation = comparePlanAEvidenceReceipts(workerReceipt, foundationReceipt);
  const terminal = terminalFromChildren(workerReceipt, foundationReceipt, pairValidation);
  return {
    receipt_schema_version: PLAN_A_EVIDENCE_BINDING_SCHEMA_VERSION,
    receipt_type: PLAN_A_EVIDENCE_BINDING_TYPE,
    request_id: workerReceipt?.request_id ?? foundationReceipt?.request_id ?? null,
    idempotency_key: workerReceipt?.idempotency_key ?? foundationReceipt?.idempotency_key ?? null,
    interface_version: foundationReceipt?.interface_version ?? INTERFACE_VERSION,
    interface_manifest_sha256: foundationReceipt?.interface_manifest_sha256 ?? INTERFACE_MANIFEST_SHA256,
    task_contract_hash: foundationReceipt?.task_contract_hash ?? null,
    requested_sha: foundationReceipt?.requested_sha ?? null,
    executed_sha: foundationReceipt?.executed_sha ?? null,
    requested_runtime_sha: foundationReceipt?.requested_runtime_sha ?? workerReceipt?.requested_runtime_sha ?? null,
    runtime_engine_sha: foundationReceipt?.runtime_engine_sha ?? workerReceipt?.runtime_engine_sha ?? null,
    backend_id: foundationReceipt?.backend_identity?.backend_id ?? workerReceipt?.backend_id ?? PLAN_A_BACKEND.backend_id,
    backend_kind: foundationReceipt?.backend_identity?.backend_kind ?? workerReceipt?.backend_kind ?? PLAN_A_BACKEND.backend_kind,
    expected_runner_labels: [...PLAN_A_BACKEND.runner_labels],
    worker_attestation_sha256: workerReceiptSha256,
    foundation_receipt_sha256: foundationReceiptSha256,
    worker_fingerprint_sha256: workerReceipt?.worker_fingerprint_sha256 ?? null,
    source_integrity: {
      tree_sha_before: foundationReceipt?.source_integrity?.tree_sha_before ?? null,
      tree_sha_after: foundationReceipt?.source_integrity?.tree_sha_after ?? null,
      tracked_source_mutation_detected: foundationReceipt?.source_integrity?.tracked_source_mutation_detected ?? false
    },
    lease_state: "NOT_IMPLEMENTED_PLAN_D",
    remote_source_write_authority: "NONE",
    ...terminal
  };
}

export function validatePlanAEvidenceBindingReceipt(receipt, context = null) {
  const errors = [];
  if (!exactKeys(receipt, RECEIPT_FIELDS)) errors.push("INVALID_TOP_LEVEL_FIELDS");
  if (receipt?.receipt_schema_version !== PLAN_A_EVIDENCE_BINDING_SCHEMA_VERSION) errors.push("INVALID_RECEIPT_SCHEMA_VERSION");
  if (receipt?.receipt_type !== PLAN_A_EVIDENCE_BINDING_TYPE) errors.push("INVALID_RECEIPT_TYPE");
  if (typeof receipt?.request_id !== "string" || receipt.request_id.length < 1 || receipt.request_id.length > 128) errors.push("INVALID_REQUEST_ID");
  if (typeof receipt?.idempotency_key !== "string" || receipt.idempotency_key.length < 1 || receipt.idempotency_key.length > 256) errors.push("INVALID_IDEMPOTENCY_KEY");
  if (receipt?.interface_version !== INTERFACE_VERSION) errors.push("INVALID_INTERFACE_VERSION");
  if (receipt?.interface_manifest_sha256 !== INTERFACE_MANIFEST_SHA256) errors.push("INVALID_INTERFACE_MANIFEST");
  if (!(receipt?.task_contract_hash === null || SHA256_RE.test(receipt.task_contract_hash ?? ""))) errors.push("INVALID_TASK_CONTRACT_HASH");
  if (!SHA40_RE.test(receipt?.requested_sha ?? "")) errors.push("INVALID_REQUESTED_SHA");
  if (!(receipt?.executed_sha === null || SHA40_RE.test(receipt.executed_sha ?? ""))) errors.push("INVALID_EXECUTED_SHA");
  if (!SHA40_RE.test(receipt?.requested_runtime_sha ?? "")) errors.push("INVALID_REQUESTED_RUNTIME_SHA");
  if (!SHA40_RE.test(receipt?.runtime_engine_sha ?? "")) errors.push("INVALID_RUNTIME_ENGINE_SHA");
  if (receipt?.backend_id !== PLAN_A_BACKEND.backend_id) errors.push("INVALID_BACKEND_ID");
  if (receipt?.backend_kind !== PLAN_A_BACKEND.backend_kind) errors.push("INVALID_BACKEND_KIND");
  if (!sameArray(receipt?.expected_runner_labels, [...PLAN_A_BACKEND.runner_labels])) errors.push("INVALID_RUNNER_LABELS");
  if (!SHA256_RE.test(receipt?.worker_attestation_sha256 ?? "")) errors.push("INVALID_WORKER_ATTESTATION_SHA256");
  if (!SHA256_RE.test(receipt?.foundation_receipt_sha256 ?? "")) errors.push("INVALID_FOUNDATION_RECEIPT_SHA256");
  if (!SHA256_RE.test(receipt?.worker_fingerprint_sha256 ?? "")) errors.push("INVALID_WORKER_FINGERPRINT_SHA256");

  if (!exactKeys(receipt?.source_integrity, ["tree_sha_before", "tree_sha_after", "tracked_source_mutation_detected"])) {
    errors.push("INVALID_SOURCE_INTEGRITY_FIELDS");
  } else {
    for (const field of ["tree_sha_before", "tree_sha_after"]) {
      if (!(receipt.source_integrity[field] === null || SHA40_RE.test(receipt.source_integrity[field] ?? ""))) errors.push(`INVALID_${field.toUpperCase()}`);
    }
    if (typeof receipt.source_integrity.tracked_source_mutation_detected !== "boolean") errors.push("INVALID_MUTATION_FLAG");
  }

  if (receipt?.lease_state !== "NOT_IMPLEMENTED_PLAN_D") errors.push("INVALID_LEASE_STATE");
  if (receipt?.remote_source_write_authority !== "NONE") errors.push("INVALID_REMOTE_SOURCE_WRITE_AUTHORITY");
  if (!RESULT_STATES.has(receipt?.result)) errors.push("INVALID_RESULT");
  if (!(receipt?.failure_reason === null || typeof receipt.failure_reason === "string")) errors.push("INVALID_FAILURE_REASON");

  if (receipt?.result === "PASS") {
    if (receipt.requested_sha !== receipt.executed_sha) errors.push("PASS_SHA_MISMATCH");
    if (receipt.requested_runtime_sha !== receipt.runtime_engine_sha) errors.push("PASS_RUNTIME_SHA_MISMATCH");
    if (!SHA256_RE.test(receipt.task_contract_hash ?? "")) errors.push("PASS_TASK_CONTRACT_HASH_MISSING");
    if (receipt.source_integrity?.tracked_source_mutation_detected) errors.push("PASS_WITH_SOURCE_MUTATION");
    if (receipt.source_integrity?.tree_sha_before !== receipt.source_integrity?.tree_sha_after) errors.push("PASS_TREE_SHA_MISMATCH");
    if (receipt.failure_reason !== null) errors.push("PASS_WITH_FAILURE_REASON");
  } else if (!receipt?.failure_reason) {
    errors.push("FAILURE_WITHOUT_REASON");
  }

  if (context) {
    const pairValidation = comparePlanAEvidenceReceipts(context.workerReceipt, context.foundationReceipt);
    if (!pairValidation.ok) errors.push(`CHILD_PAIR_INVALID:${pairValidation.errors[0]}`);
    if (receipt.worker_attestation_sha256 !== context.workerReceiptSha256) errors.push("WORKER_ATTESTATION_DIGEST_MISMATCH");
    if (receipt.foundation_receipt_sha256 !== context.foundationReceiptSha256) errors.push("FOUNDATION_RECEIPT_DIGEST_MISMATCH");
    if (receipt.worker_fingerprint_sha256 !== context.workerReceipt?.worker_fingerprint_sha256) errors.push("WORKER_FINGERPRINT_BINDING_MISMATCH");
    if (receipt.request_id !== context.workerReceipt?.request_id || receipt.request_id !== context.foundationReceipt?.request_id) errors.push("RECEIPT_REQUEST_BINDING_MISMATCH");
    if (receipt.idempotency_key !== context.workerReceipt?.idempotency_key || receipt.idempotency_key !== context.foundationReceipt?.idempotency_key) errors.push("RECEIPT_IDEMPOTENCY_BINDING_MISMATCH");
    if (receipt.task_contract_hash !== context.foundationReceipt?.task_contract_hash) errors.push("TASK_CONTRACT_BINDING_MISMATCH");
    if (receipt.requested_sha !== context.foundationReceipt?.requested_sha || receipt.executed_sha !== context.foundationReceipt?.executed_sha) errors.push("TARGET_IDENTITY_BINDING_MISMATCH");
    if (receipt.requested_runtime_sha !== context.workerReceipt?.requested_runtime_sha || receipt.runtime_engine_sha !== context.workerReceipt?.runtime_engine_sha) errors.push("RUNTIME_IDENTITY_BINDING_MISMATCH");
    if (receipt.source_integrity?.tree_sha_before !== context.foundationReceipt?.source_integrity?.tree_sha_before ||
        receipt.source_integrity?.tree_sha_after !== context.foundationReceipt?.source_integrity?.tree_sha_after ||
        receipt.source_integrity?.tracked_source_mutation_detected !== context.foundationReceipt?.source_integrity?.tracked_source_mutation_detected) {
      errors.push("SOURCE_INTEGRITY_BINDING_MISMATCH");
    }
    const expectedTerminal = terminalFromChildren(context.workerReceipt, context.foundationReceipt, pairValidation);
    if (receipt.result !== expectedTerminal.result || receipt.failure_reason !== expectedTerminal.failure_reason) errors.push("TERMINAL_RESULT_BINDING_MISMATCH");
  }

  return { ok: errors.length === 0, errors };
}
