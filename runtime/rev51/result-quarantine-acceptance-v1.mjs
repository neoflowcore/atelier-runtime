import {
  computeRev51ObjectHash,
  validateContractEnvelope
} from "./contract-core.mjs";

export const RESULT_ACCEPTANCE_CANONICALIZATION_ID = "ATELIER_REV51_JCS_V1";
export const RESULT_ACCEPTANCE_POLICY = "QUARANTINE_VERIFY_ATOMIC_ACCEPT";

const SHA256_RE = /^[0-9a-f]{64}$/;
const RETENTION_CLASSES = new Set([
  "PINNED",
  "UNTIL_FINAL_ACCEPTANCE",
  "UNTIL_ROLLBACK_WINDOW_END",
  "CACHE_EVICTABLE",
  "CHECKPOINT_LATEST_N",
  "TEMPORARY",
  "AUDIT_LONG_TERM"
]);
const ARTIFACT_STATES = new Set(["STAGING", "IMMUTABLE", "QUARALINED", "GC_ELIGIBLE"]);
const ARTIFACT_KEYS = new Set([
  "ARTIFACT_ID",
  "CONTENT_SHA256",
  "SIZE_BYTES",
  "MEDIA_TYPE",
  "STORAGE_CLASS",
  "SECURITY_DOMAIN",
  "ORIGIN_EXECUTION_ID",
  "CREATED_AT",
  "RETENTION_CLASS",
  "LOCATIONS",
  "ARTIFACT_STATE"
]);

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function requireNonEmptyString(value, code) {
  if (typeof value !== "string" || value.length === 0) throw new Error(code);
  return value;
}

function validateArtifactStoreRecord(artifact, executionId) {
  if (!isObject(artifact)) throw new Error("ARTIFACT_RECORD_REQUIRED");
  for (const key of Object.keys(artifact)) {
    if (!ARTIFACT_KEYS.has(key)) throw new Error(`ARTIFACT_UNKNOWN_FIELD:${key}`);
  }
  requireNonEmptyString(artifact.ARTIFACT_ID, "ARTIFACT_ID_REQUIRED");
  if (!SHA256_RE.test(artifact.CONTENT_SHA256 ?? "")) throw new Error("ARTIFACT_CONTENT_SHA256_INVALID");
  if (!Number.isSafeInteger(artifact.SIZE_BYTES) || artifact.SIZE_BYTES < 0) throw new Error("ARTIFACT_SIZE_BYTES_INVALID");
  requireNonEmptyString(artifact.MEDIA_TYPE, "ARTIFACT_MEDIA_TYPE_REQUIRED");
  requireNonEmptyString(artifact.STORAGE_CLASS, "ARTIFACT_STORAGE_CLASS_REQUIRED");
  requireNonEmptyString(artifact.SECURITY_DOMAIN, "ARTIFACT_SECURITY_DOMAIN_REQUIRED");
  if (artifact.ORIGIN_EXECUTION_ID !== executionId) throw new Error("ARTIFACT_ORIGIN_EXECUTION_ID_MISMATCH");
  if (typeof artifact.CREATED_AT !== "string" || Number.isNaN(Date.parse(artifact.CREATED_AT))) throw new Error("ARTIFACT_CREATED_AT_INVALID");
  if (!RETENTION_CLASSES.has(artifact.RETENTION_CLASS)) throw new Error("ARTIFACT_RETENTION_CLASS_INVALID");
  if (!Array.isArray(artifact.LOCATIONS) || artifact.LOCATIONS.length === 0 || artifact.LOCATIONS.some((v) => typeof v !== "string" || v.length === 0)) {
    throw new Error("ARTIFACT_LOCATIONS_INVALID");
  }
  if (new Set(artifact.LOCATIONS).size !== artifact.LOCATIONS.length) throw new Error("ARTIFACT_LOCATIONS_NOT_UNIQUE");
  if (!ARTIFACT_STATES.has(artifact.ARTIFACT_STATE)) throw new Error("ARTIFACT_STATE_INVALID");
  if (artifact.ARTIFACT_STATE !== "QUARANTINED") throw new Error("ARTIFACT_NOT_QUARANTINED");
}

function validateVerificationBinding(plan, workerJob, artifacts, verification) {
  if (!isObject(verification)) throw new Error("RESULT_VERIFICATION_REQUIRED");
  if (verification.VERIFICATION_RESULT !== "PASS") throw new Error("RESULT_VERIFICATION_MUST_PASS");
  if (verification.EXECUTION_ID !== workerJob.EXECUTION_ID) throw new Error("VERIFICATION_EXECUTION_ID_MISMATCH");
  if (verification.ATTEMPT_ID !== workerJob.ATTEMPT_ID) throw new Error("VERIFICATION_ATTEMPT_ID_MISMATCH");
  if (verification.FENCE_TOKEN !== workerJob.FENCE_TOKEN) throw new Error("VERIFICATION_FENCE_TOKEN_MISMATCH");
  if (verification.WORKER_JOB_HASH !== workerJob.OBJECT_SHA256) throw new Error("VERIFICATION_WORKER_JOB_HASH_MISMATCH");
  if (verification.EXECUTION_PLAN_HASH !== plan.OBJECT_SHA256) throw new Error("VERIFICATION_EXECUTION_PLAN_HASH_MISMATCH");

  for (const key of [
    "CONTENT_VERIFIED",
    "FENCE_VERIFIED",
    "WORKER_JOB_VERIFIED",
    "EXECUTION_PLAN_VERIFIED",
    "SECURITY_OUTPUT_CONTRACT_VERIFIED"
  ]) {
    if (verification[key] !== true) throw new Error(`RESULT_ACCEPTANCE_CHECK_FAILED:${key}`);
  }

  if (!Array.isArray(verification.ARTIFACT_CONTENT_BINDINGS)) throw new Error("ARTIFACT_CONTENT_BINDINGS_REQUIRED");
  const expected = new Map();
  for (const binding of verification.ARTIFACT_CONTENT_BINDINGS) {
    if (!isObject(binding)) throw new Error("ARTIFACT_CONTENT_BINDING_INVALID");
    const id = requireNonEmptyString(binding.ARTIFACT_ID, "ARTIFACT_CONTENT_BINDING_ID_REQUIRED");
    if (!SHA256_RE.test(binding.CONTENT_SHA256 ?? "")) throw new Error("ARTIFACT_CONTENT_BINDING_SHA256_INVALID");
    if (expected.has(id)) throw new Error("ARTIFACT_CONTENT_BINDING_DUPLICATE_ID");
    expected.set(id, binding.CONTENT_SHA256);
  }
  if (expected.size !== artifacts.length) throw new Error("ARTIFACT_CONTENT_BINDING_COUNT_MISMATCH");
  for (const artifact of artifacts) {
    if (expected.get(artifact.ARTIFACT_ID) !== artifact.CONTENT_SHA256) throw new Error("ARTIFACT_CONTENT_BINDING_MISMATCH");
  }
}

export function acceptQuarantinedResultV1(plan, workerJob, artifacts, verification) {
  const planEnvelope = validateContractEnvelope(plan, {
    schemaId: "RUNTIME_EXECUTION_PLAN_V1",
    schemaVersion: "1",
    canonicalizationId: RESULT_ACCEPTANCE_CANONICALIZATION_ID
  });
  if (!planEnvelope.ok) throw new Error(`RUNTIME_EXECUTION_PLAN_REJECTED:${planEnvelope.errors.join("|")}`);

  const workerEnvelope = validateContractEnvelope(workerJob, {
    schemaId: "WORKER_JOB_V1",
    schemaVersion: "1",
    canonicalizationId: RESULT_ACCEPTANCE_CANONICALIZATION_ID,
    upstreamObjectSha256: plan.OBJECT_SHA256
  });
  if (!workerEnvelope.ok) throw new Error(`WORKER_JOB_REJECTED:${workerEnvelope.errors.join("|")}`);
  if (workerJob.EXECUTION_PLAN_HASH !== plan.OBJECT_SHA256) throw new Error("WORKER_JOB_EXECUTION_PLAN_HASH_MISMATCH");

  const executionId = requireNonEmptyString(workerJob.EXECUTION_ID, "WORKER_JOB_EXECUTION_ID_REQUIRED");
  const attemptId = requireNonEmptyString(workerJob.ATTEMPT_ID, "WORKER_JOB_ATTEMPT_ID_REQUIRED");
  const fenceToken = requireNonEmptyString(workerJob.FENCE_TOKEN, "WORKER_JOB_FENCE_TOKEN_REQUIRED");

  if (!Array.isArray(artifacts)) throw new Error("ARTIFACTS_ARRAY_REQUIRED");
  const artifactIds = new Set();
  for (const artifact of artifacts) {
    validateArtifactStoreRecord(artifact, executionId);
    if (artifactIds.has(artifact.ARTIFACT_ID)) throw new Error("ARTIFACT_ID_DUPLICATE");
    artifactIds.add(artifact.ARTIFACT_ID);
  }

  validateVerificationBinding(plan, workerJob, artifacts, verification);

  const acceptedArtifacts = artifacts
    .map((artifact) => ({ ...artifact, LOCATIONS: [...artifact.LOCATIONS], ARTIFACT_STATE: "IMMUTABLE" }))
    .sort((a, b) => a.ARTIFACT_ID.localeCompare(b.ARTIFACT_ID));

  const receipt = {
    SCHEMA_ID: "EXECUTION_RECEIPT_V1",
    SCHEMA_VERSION: "1",
    CANONICALIZATION_ID: RESULT_ACCEPTANCE_CANONICALIZATION_ID,
    UPSTREAM_OBJECT_SHA256: workerJob.OBJECT_SHA256,
    OBJECT_SHA256: "0".repeat(64),
    WORKER_JOB_HASH: workerJob.OBJECT_SHA256,
    EXECUTION_PLAN_HASH: plan.OBJECT_SHA256,
    EXECUTION_ID: executionId,
    ATTEMPT_ID: attemptId,
    FENCE_TOKEN: fenceToken,
    VERIFICATION_RESULT: "PASS",
    RUNTIME_SEALED: true,
    ACCEPTED_ARTIFACT_IDS: acceptedArtifacts.map((artifact) => artifact.ARTIFACT_ID)
  };
  receipt.OBJECT_SHA256 = computeRev51ObjectHash(receipt);

  const receiptEnvelope = validateContractEnvelope(receipt, {
    schemaId: "EXECUTION_RECEIPT_V1",
    schemaVersion: "1",
    canonicalizationId: RESULT_ACCEPTANCE_CANONICALIZATION_ID,
    upstreamObjectSha256: workerJob.OBJECT_SHA256
  });
  if (!receiptEnvelope.ok) throw new Error(`EXECUTION_RECEIPT_INVALID:${receiptEnvelope.errors.join("|")}`);

  return {
    policy: RESULT_ACCEPTANCE_POLICY,
    acceptedArtifacts,
    receipt
  };
}
