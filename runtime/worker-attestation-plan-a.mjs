import { createHash } from "node:crypto";
import { PLAN_A_BACKEND } from "./backend-plan-a.mjs";

export const PLAN_A_WORKER_ATTESTATION_TYPE = "RUNTIME_A_WORKER_ATTESTATION_V1";
export const PLAN_A_WORKER_ATTESTATION_SCHEMA_VERSION = 1;
export const PLAN_A_WORKER_ADMISSION_SCOPE = "PLAN_A_FOUNDATION_PROBE_ONLY";
export const PLAN_A_REQUIRED_NODE_VERSION = "v22.13.0";

const RESULT_STATES = new Set(["PASS", "BLOCKED", "INFRA_FAILURE"]);
const SHA40_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const RUNNER_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const TOP_LEVEL_FIELDS = Object.freeze([
  "receipt_schema_version",
  "receipt_type",
  "request_id",
  "idempotency_key",
  "requested_runtime_sha",
  "runtime_engine_sha",
  "backend_id",
  "backend_kind",
  "expected_runner_labels",
  "observed_worker",
  "worker_fingerprint_sha256",
  "admission_scope",
  "lease_state",
  "remote_source_write_authority",
  "result",
  "failure_reason"
]);

const OBSERVED_WORKER_FIELDS = Object.freeze([
  "runner_environment",
  "runner_os",
  "runner_arch",
  "runner_name",
  "node_version"
]);

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function canonicalWorkerIdentity(observedWorker) {
  return JSON.stringify({
    backend_id: PLAN_A_BACKEND.backend_id,
    backend_kind: PLAN_A_BACKEND.backend_kind,
    expected_runner_labels: [...PLAN_A_BACKEND.runner_labels],
    node_version: observedWorker?.node_version ?? null,
    runner_arch: observedWorker?.runner_arch ?? null,
    runner_environment: observedWorker?.runner_environment ?? null,
    runner_name: observedWorker?.runner_name ?? null,
    runner_os: observedWorker?.runner_os ?? null
  });
}

export function computeWorkerFingerprint(observedWorker) {
  return createHash("sha256").update(canonicalWorkerIdentity(observedWorker), "utf8").digest("hex");
}

export function evaluatePlanAWorkerAdmission({ requestedRuntimeSha, runtimeEngineSha, observedWorker }) {
  const reasons = [];
  if (!SHA40_RE.test(requestedRuntimeSha ?? "")) reasons.push("INVALID_REQUESTED_RUNTIME_SHA");
  if (!SHA40_RE.test(runtimeEngineSha ?? "")) reasons.push("INVALID_RUNTIME_ENGINE_SHA");
  if (requestedRuntimeSha !== runtimeEngineSha) reasons.push("RUNTIME_SHA_MISMATCH");
  if (observedWorker?.runner_environment !== "self-hosted") reasons.push("RUNNER_ENVIRONMENT_NOT_SELF_HOSTED");
  if (observedWorker?.runner_os !== "Linux") reasons.push("RUNNER_OS_NOT_LINUX");
  if (observedWorker?.runner_arch !== "X64") reasons.push("RUNNER_ARCH_NOT_X64");
  if (observedWorker?.node_version !== PLAN_A_REQUIRED_NODE_VERSION) reasons.push("NODE_VERSION_NOT_22_13_0");
  if (typeof observedWorker?.runner_name !== "string" || !RUNNER_NAME_RE.test(observedWorker.runner_name)) reasons.push("RUNNER_NAME_INVALID_OR_MISSING");

  return {
    ok: reasons.length === 0,
    result: reasons.length === 0 ? "PASS" : "INFRA_FAILURE",
    reasons,
    worker_fingerprint_sha256: computeWorkerFingerprint(observedWorker)
  };
}

export function buildPlanAWorkerAttestationReceipt({
  requestId,
  idempotencyKey,
  requestedRuntimeSha,
  runtimeEngineSha,
  observedWorker
}) {
  const admission = evaluatePlanAWorkerAdmission({ requestedRuntimeSha, runtimeEngineSha, observedWorker });
  return {
    receipt_schema_version: PLAN_A_WORKER_ATTESTATION_SCHEMA_VERSION,
    receipt_type: PLAN_A_WORKER_ATTESTATION_TYPE,
    request_id: requestId,
    idempotency_key: idempotencyKey,
    requested_runtime_sha: requestedRuntimeSha,
    runtime_engine_sha: runtimeEngineSha,
    backend_id: PLAN_A_BACKEND.backend_id,
    backend_kind: PLAN_A_BACKEND.backend_kind,
    expected_runner_labels: [...PLAN_A_BACKEND.runner_labels],
    observed_worker: {
      runner_environment: observedWorker?.runner_environment ?? null,
      runner_os: observedWorker?.runner_os ?? null,
      runner_arch: observedWorker?.runner_arch ?? null,
      runner_name: observedWorker?.runner_name ?? null,
      node_version: observedWorker?.node_version ?? null
    },
    worker_fingerprint_sha256: admission.worker_fingerprint_sha256,
    admission_scope: PLAN_A_WORKER_ADMISSION_SCOPE,
    lease_state: "NOT_IMPLEMENTED_PLAN_D",
    remote_source_write_authority: "NONE",
    result: admission.result,
    failure_reason: admission.reasons[0] ?? null
  };
}

export function validatePlanAWorkerAttestationReceipt(receipt) {
  const errors = [];
  if (!exactKeys(receipt, TOP_LEVEL_FIELDS)) errors.push("INVALID_TOP_LEVEL_FIELDS");
  if (receipt?.receipt_schema_version !== PLAN_A_WORKER_ATTESTATION_SCHEMA_VERSION) errors.push("INVALID_RECEIPT_SCHEMA_VERSION");
  if (receipt?.receipt_type !== PLAN_A_WORKER_ATTESTATION_TYPE) errors.push("INVALID_RECEIPT_TYPE");
  if (typeof receipt?.request_id !== "string" || receipt.request_id.length < 1 || receipt.request_id.length > 128) errors.push("INVALID_REQUEST_ID");
  if (typeof receipt?.idempotency_key !== "string" || receipt.idempotency_key.length < 1 || receipt.idempotency_key.length > 256) errors.push("INVALID_IDEMPOTENCY_KEY");
  if (!SHA40_RE.test(receipt?.requested_runtime_sha ?? "")) errors.push("INVALID_REQUESTED_RUNTIME_SHA");
  if (!SHA40_RE.test(receipt?.runtime_engine_sha ?? "")) errors.push("INVALID_RUNTIME_ENGINE_SHA");
  if (receipt?.backend_id !== PLAN_A_BACKEND.backend_id) errors.push("INVALID_BACKEND_ID");
  if (receipt?.backend_kind !== PLAN_A_BACKEND.backend_kind) errors.push("INVALID_BACKEND_KIND");
  if (JSON.stringify(receipt?.expected_runner_labels) !== JSON.stringify([...PLAN_A_BACKEND.runner_labels])) errors.push("INVALID_RUNNER_LABELS");

  if (!exactKeys(receipt?.observed_worker, OBSERVED_WORKER_FIELDS)) {
    errors.push("INVALID_OBSERVED_WORKER_FIELDS");
  } else {
    const observed = receipt.observed_worker;
    for (const field of OBSERVED_WORKER_FIELDS) {
      if (!(observed[field] === null || typeof observed[field] === "string")) errors.push(`INVALID_${field.toUpperCase()}`);
    }
  }

  if (!SHA256_RE.test(receipt?.worker_fingerprint_sha256 ?? "")) errors.push("INVALID_WORKER_FINGERPRINT");
  if (receipt?.admission_scope !== PLAN_A_WORKER_ADMISSION_SCOPE) errors.push("INVALID_ADMISSION_SCOPE");
  if (receipt?.lease_state !== "NOT_IMPLEMENTED_PLAN_D") errors.push("INVALID_LEASE_STATE");
  if (receipt?.remote_source_write_authority !== "NONE") errors.push("INVALID_REMOTE_SOURCE_WRITE_AUTHORITY");
  if (!RESULT_STATES.has(receipt?.result)) errors.push("INVALID_RESULT");
  if (!(receipt?.failure_reason === null || typeof receipt.failure_reason === "string")) errors.push("INVALID_FAILURE_REASON");

  if (receipt?.result === "PASS") {
    if (receipt.requested_runtime_sha !== receipt.runtime_engine_sha) errors.push("PASS_RUNTIME_SHA_MISMATCH");
    if (receipt.observed_worker?.runner_environment !== "self-hosted") errors.push("PASS_NOT_SELF_HOSTED");
    if (receipt.observed_worker?.runner_os !== "Linux") errors.push("PASS_NOT_LINUX");
    if (receipt.observed_worker?.runner_arch !== "X64") errors.push("PASS_NOT_X64");
    if (receipt.observed_worker?.node_version !== PLAN_A_REQUIRED_NODE_VERSION) errors.push("PASS_NODE_VERSION_MISMATCH");
    if (typeof receipt.observed_worker?.runner_name !== "string" || !RUNNER_NAME_RE.test(receipt.observed_worker.runner_name)) errors.push("PASS_RUNNER_NAME_INVALID");
    if (receipt.failure_reason !== null) errors.push("PASS_WITH_FAILURE_REASON");
    if (computeWorkerFingerprint(receipt.observed_worker) !== receipt.worker_fingerprint_sha256) errors.push("PASS_WORKER_FINGERPRINT_MISMATCH");
  } else if (!receipt?.failure_reason) {
    errors.push("FAILURE_WITHOUT_REASON");
  }

  return { ok: errors.length === 0, errors };
}
