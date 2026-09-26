import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { validateContractEnvelope } from "./contract-core.mjs";
import {
  A3_AUTHORITATIVE_BINDING,
  PILOTE_VERIFIER_POLICIES,
  validatePiloteVerifierPolicyV1
} from "./pilote-verifier-acceptance-consumer-v1.mjs";
import {
  readDurableResultCollectionV1,
  validateDurableResultCollectionV1
} from "./durable-result-collection-v1.mjs";

export const DURABLE_RESULT_VERIFICATION_SCHEMA_ID = "DURABLE_RESULT_VERIFICATION_V1";
export const DURABLE_RESULT_VERIFICATION_SCHEMA_VERSION = "1";
export const DURABLE_RESULT_VERIFICATION_POLICY = "A3_POLICY_BOUND_COLLECTION_TERMINAL_VERIFICATION";
export const DURABLE_RESULT_VERIFICATION_RESULTS = Object.freeze(["PASS", "FAIL", "BLOCKED"]);

const SHA256_RE = /^[0-9a-f]{64}$/;
const VERIFICATION_CHECKS = Object.freeze([
  "CONTENT_VERIFIED",
  "FENCE_VERIFIED",
  "WORKER_JOB_VERIFIED",
  "EXECUTION_PLAN_VERIFIED",
  "SECURITY_OUTPUT_CONTRACT_VERIFIED"
]);
const FORBIDDEN_MATERIAL_KEYS = new Set([
  "SECRET_VALUE",
  "CREDENTIAL_VALUE",
  "RUNNER_REGISTRATION_TOKEN",
  "JIT_REGISTRATION_TOKEN",
  "JIT_REGISTRATION_ID",
  "PROVIDER_RESOURCE_ID",
  "VM_ID",
  "DROPLET_ID"
]);

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
function requireString(value, code) {
  if (typeof value !== "string" || value.length === 0) throw new Error(code);
  return value;
}
function requireSha256(value, code) {
  if (!SHA256_RE.test(value ?? "")) throw new Error(code);
  return value;
}
function requirePositiveInteger(value, code) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(code);
  return value;
}
function requireNonNegativeInteger(value, code) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(code);
  return value;
}
function runtimeIso(runtimeNowMs) {
  if (!Number.isSafeInteger(runtimeNowMs)) throw new Error("RUNTIME_AUTHORITATIVE_TIME_REQUIRED");
  return new Date(runtimeNowMs).toISOString();
}
function stripUndefined(value) {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (isObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .map(([key, child]) => [key, stripUndefined(child)])
    );
  }
  return value;
}
function canonicalize(value) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("DURABLE_RESULT_VERIFICATION_NON_SAFE_INTEGER");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  }
  throw new Error("DURABLE_RESULT_VERIFICATION_UNSUPPORTED_CANONICAL_TYPE");
}
function hashObject(value) {
  return createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
}
function requestFingerprint(request) {
  const copy = stripUndefined(clone(request));
  delete copy.RUNTIME_NOW_MS;
  return hashObject(copy);
}
function recordHash(record) {
  const copy = clone(record);
  delete copy.VERIFICATION_RECORD_SHA256;
  return hashObject(copy);
}
function scanForbiddenMaterial(value, path = "$") {
  const errors = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => errors.push(...scanForbiddenMaterial(item, `${path}[${index}]`)));
  } else if (isObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_MATERIAL_KEYS.has(key)) errors.push(`FORBIDDEN_RESULT_VERIFICATION_MATERIAL:${path}.${key}`);
      errors.push(...scanForbiddenMaterial(child, `${path}.${key}`));
    }
  }
  return errors;
}
function artifactBindingsFromCollection(collection) {
  return collection.QUARANTINED_ARTIFACTS.map((artifact) => ({
    ARTIFACT_ID: artifact.ARTIFACT_ID,
    CONTENT_SHA256: artifact.CONTENT_SHA256
  }));
}
function validateArtifactBindings(bindings, collection, requireExactContent) {
  if (!Array.isArray(bindings)) throw new Error("RESULT_VERIFICATION_ARTIFACT_CONTENT_BINDINGS_REQUIRED");
  const expected = new Map(collection.QUARANTINED_ARTIFACTS.map((artifact) => [artifact.ARTIFACT_ID, artifact.CONTENT_SHA256]));
  const seen = new Set();
  for (const binding of bindings) {
    if (!isObject(binding)) throw new Error("RESULT_VERIFICATION_ARTIFACT_CONTENT_BINDING_INVALID");
    const id = requireString(binding.ARTIFACT_ID, "RESULT_VERIFICATION_ARTIFACT_CONTENT_BINDING_ID_REQUIRED");
    const sha = requireSha256(binding.CONTENT_SHA256, "RESULT_VERIFICATION_ARTIFACT_CONTENT_BINDING_SHA256_INVALID");
    if (seen.has(id)) throw new Error("RESULT_VERIFICATION_ARTIFACT_CONTENT_BINDING_DUPLICATE_ID");
    if (!expected.has(id)) throw new Error("RESULT_VERIFICATION_ARTIFACT_CONTENT_BINDING_UNKNOWN_ID");
    if (requireExactContent && expected.get(id) !== sha) throw new Error("RESULT_VERIFICATION_ARTIFACT_CONTENT_BINDING_MISMATCH");
    seen.add(id);
  }
  if (seen.size !== expected.size) throw new Error("RESULT_VERIFICATION_ARTIFACT_CONTENT_BINDING_COUNT_MISMATCH");
}
function validatePlanWorkerAndPolicy(collection, plan, workerJob, policy) {
  if (!isObject(plan)) throw new Error("RESULT_VERIFICATION_PLAN_REQUIRED");
  const planEnvelope = validateContractEnvelope(plan, {
    schemaId: "RUNTIME_EXECUTION_PLAN_V1",
    schemaVersion: "1",
    canonicalizationId: "ATELIER_REV51_JCS_V1"
  });
  if (!planEnvelope.ok) throw new Error(`RESULT_VERIFICATION_PLAN_INVALID:${planEnvelope.errors.join("|")}`);

  if (!isObject(workerJob)) throw new Error("RESULT_VERIFICATION_WORKER_JOB_REQUIRED");
  const workerEnvelope = validateContractEnvelope(workerJob, {
    schemaId: "WORKER_JOB_V1",
    schemaVersion: "1",
    canonicalizationId: "ATELIER_REV51_JCS_V1",
    upstreamObjectSha256: plan.OBJECT_SHA256
  });
  if (!workerEnvelope.ok) throw new Error(`RESULT_VERIFICATION_WORKER_JOB_INVALID:${workerEnvelope.errors.join("|")}`);
  if (workerJob.EXECUTION_PLAN_HASH !== plan.OBJECT_SHA256) throw new Error("RESULT_VERIFICATION_WORKER_PLAN_HASH_MISMATCH");
  if (workerJob.OBJECT_SHA256 !== collection.WORKER_JOB_SHA256) throw new Error("RESULT_VERIFICATION_COLLECTION_WORKER_JOB_HASH_MISMATCH");
  if (workerJob.EXECUTION_ID !== collection.EXECUTION_ID) throw new Error("RESULT_VERIFICATION_COLLECTION_EXECUTION_ID_MISMATCH");
  if (workerJob.ATTEMPT_ID !== collection.ATTEMPT_ID) throw new Error("RESULT_VERIFICATION_COLLECTION_ATTEMPT_ID_MISMATCH");
  if (workerJob.FENCE_TOKEN !== collection.FENCE_TOKEN) throw new Error("RESULT_VERIFICATION_COLLECTION_FENCE_TOKEN_MISMATCH");

  const policyCheck = validatePiloteVerifierPolicyV1(policy);
  if (!policyCheck.ok) throw new Error(`RESULT_VERIFICATION_PILOTE_POLICY_INVALID:${policyCheck.errors.join("|")}`);
  if (plan.VERIFIER_POLICY !== policy.VERIFIER_POLICY) throw new Error("RESULT_VERIFICATION_PLAN_POLICY_MODE_MISMATCH");
  if (plan.VERIFIER_POLICY_REF_SHA256 !== policy.VERIFIER_POLICY_SHA256) throw new Error("RESULT_VERIFICATION_PLAN_POLICY_HASH_MISMATCH");
  if (plan.ACCEPTANCE_REQUIREMENT_REF !== policy.ACCEPTANCE_REQUIREMENT_REF) throw new Error("RESULT_VERIFICATION_ACCEPTANCE_REQUIREMENT_REF_MISMATCH");
  if (plan.CONTRACT_SET_SHA256 !== A3_AUTHORITATIVE_BINDING.CONTRACT_SET_SHA256) throw new Error("RESULT_VERIFICATION_CONTRACT_SET_SHA256_MISMATCH");
}
function validateVerificationPayload(payload, collection, plan, workerJob) {
  if (!isObject(payload)) throw new Error("RESULT_VERIFICATION_PAYLOAD_REQUIRED");
  if (!DURABLE_RESULT_VERIFICATION_RESULTS.includes(payload.VERIFICATION_RESULT)) throw new Error("RESULT_VERIFICATION_RESULT_INVALID");
  if (payload.EXECUTION_ID !== collection.EXECUTION_ID) throw new Error("RESULT_VERIFICATION_EXECUTION_ID_MISMATCH");
  if (payload.ATTEMPT_ID !== collection.ATTEMPT_ID) throw new Error("RESULT_VERIFICATION_ATTEMPT_ID_MISMATCH");
  if (payload.FENCE_TOKEN !== collection.FENCE_TOKEN) throw new Error("RESULT_VERIFICATION_FENCE_TOKEN_MISMATCH");
  if (payload.WORKER_JOB_HASH !== workerJob.OBJECT_SHA256) throw new Error("RESULT_VERIFICATION_WORKER_JOB_HASH_MISMATCH");
  if (payload.EXECUTION_PLAN_HASH !== plan.OBJECT_SHA256) throw new Error("RESULT_VERIFICATION_EXECUTION_PLAN_HASH_MISMATCH");
  for (const key of VERIFICATION_CHECKS) {
    if (typeof payload[key] !== "boolean") throw new Error(`RESULT_VERIFICATION_CHECK_NOT_BOOLEAN:${key}`);
  }
  validateArtifactBindings(payload.ARTIFACT_CONTENT_BINDINGS, collection, payload.VERIFICATION_RESULT === "PASS");
  if (payload.VERIFICATION_RESULT === "PASS") {
    for (const key of VERIFICATION_CHECKS) {
      if (payload[key] !== true) throw new Error(`RESULT_VERIFICATION_PASS_CHECK_FAILED:${key}`);
    }
  }
}
function validateStoredVerificationPayload(payload, record) {
  if (!isObject(payload)) throw new Error("DURABLE_RESULT_VERIFICATION_PAYLOAD_REQUIRED");
  if (payload.VERIFICATION_RESULT !== record.VERIFICATION_RESULT) throw new Error("DURABLE_RESULT_VERIFICATION_PAYLOAD_RESULT_MISMATCH");
  if (payload.EXECUTION_ID !== record.EXECUTION_ID) throw new Error("DURABLE_RESULT_VERIFICATION_PAYLOAD_EXECUTION_ID_MISMATCH");
  if (payload.ATTEMPT_ID !== record.ATTEMPT_ID) throw new Error("DURABLE_RESULT_VERIFICATION_PAYLOAD_ATTEMPT_ID_MISMATCH");
  if (payload.FENCE_TOKEN !== record.FENCE_TOKEN) throw new Error("DURABLE_RESULT_VERIFICATION_PAYLOAD_FENCE_TOKEN_MISMATCH");
  if (payload.WORKER_JOB_HASH !== record.WORKER_JOB_SHA256) throw new Error("DURABLE_RESULT_VERIFICATION_PAYLOAD_WORKER_JOB_HASH_MISMATCH");
  if (payload.EXECUTION_PLAN_HASH !== record.EXECUTION_PLAN_SHA256) throw new Error("DURABLE_RESULT_VERIFICATION_PAYLOAD_PLAN_HASH_MISMATCH");
  for (const key of VERIFICATION_CHECKS) {
    if (typeof payload[key] !== "boolean") throw new Error(`DURABLE_RESULT_VERIFICATION_CHECK_NOT_BOOLEAN:${key}`);
  }
  if (!Array.isArray(payload.ARTIFACT_CONTENT_BINDINGS)) throw new Error("DURABLE_RESULT_VERIFICATION_ARTIFACT_BINDINGS_REQUIRED");
  const seen = new Set();
  for (const binding of payload.ARTIFACT_CONTENT_BINDINGS) {
    if (!isObject(binding)) throw new Error("DURABLE_RESULT_VERIFICATION_ARTIFACT_BINDING_INVALID");
    const id = requireString(binding.ARTIFACT_ID, "DURABLE_RESULT_VERIFICATION_ARTIFACT_BINDING_ID_REQUIRED");
    requireSha256(binding.CONTENT_SHA256, "DURABLE_RESULT_VERIFICATION_ARTIFACT_BINDING_SHA256_INVALID");
    if (seen.has(id)) throw new Error("DURABLE_RESULT_VERIFICATION_ARTIFACT_BINDING_DUPLICATE_ID");
    seen.add(id);
  }
  if (record.VERIFICATION_RESULT === "PASS") {
    for (const key of VERIFICATION_CHECKS) {
      if (payload[key] !== true) throw new Error(`DURABLE_RESULT_VERIFICATION_PASS_CHECK_FAILED:${key}`);
    }
    const sorted = [...payload.ARTIFACT_CONTENT_BINDINGS].sort((a, b) => a.ARTIFACT_ID.localeCompare(b.ARTIFACT_ID));
    if (hashObject(sorted) !== record.ARTIFACT_MANIFEST_SHA256) throw new Error("DURABLE_RESULT_VERIFICATION_ARTIFACT_MANIFEST_HASH_MISMATCH");
  }
}
function validateVerificationRecord(record) {
  if (!isObject(record)) throw new Error("DURABLE_RESULT_VERIFICATION_NOT_OBJECT");
  if (record.VERIFICATION_SCHEMA_ID !== DURABLE_RESULT_VERIFICATION_SCHEMA_ID) throw new Error("DURABLE_RESULT_VERIFICATION_SCHEMA_ID_MISMATCH");
  if (record.VERIFICATION_SCHEMA_VERSION !== DURABLE_RESULT_VERIFICATION_SCHEMA_VERSION) throw new Error("DURABLE_RESULT_VERIFICATION_SCHEMA_VERSION_MISMATCH");
  if (record.VERIFICATION_POLICY !== DURABLE_RESULT_VERIFICATION_POLICY) throw new Error("DURABLE_RESULT_VERIFICATION_POLICY_MISMATCH");
  if (!DURABLE_RESULT_VERIFICATION_RESULTS.includes(record.VERIFICATION_RESULT)) throw new Error("DURABLE_RESULT_VERIFICATION_RESULT_INVALID");
  requireString(record.IDEMPOTENCY_KEY, "DURABLE_RESULT_VERIFICATION_IDEMPOTENCY_KEY_REQUIRED");
  requireSha256(record.REQUEST_SHA256, "DURABLE_RESULT_VERIFICATION_REQUEST_SHA256_INVALID");
  requireSha256(record.COLLECTION_RECORD_SHA256, "DURABLE_RESULT_VERIFICATION_COLLECTION_RECORD_SHA256_INVALID");
  requireString(record.EXECUTION_ID, "DURABLE_RESULT_VERIFICATION_EXECUTION_ID_REQUIRED");
  requirePositiveInteger(record.EXECUTION_EPOCH, "DURABLE_RESULT_VERIFICATION_EXECUTION_EPOCH_INVALID");
  requireString(record.ATTEMPT_ID, "DURABLE_RESULT_VERIFICATION_ATTEMPT_ID_REQUIRED");
  requirePositiveInteger(record.LEASE_GENERATION, "DURABLE_RESULT_VERIFICATION_LEASE_GENERATION_INVALID");
  requireString(record.FENCE_TOKEN, "DURABLE_RESULT_VERIFICATION_FENCE_TOKEN_REQUIRED");
  requireSha256(record.WORKER_JOB_SHA256, "DURABLE_RESULT_VERIFICATION_WORKER_JOB_SHA256_INVALID");
  requireSha256(record.EXECUTION_PLAN_SHA256, "DURABLE_RESULT_VERIFICATION_EXECUTION_PLAN_SHA256_INVALID");
  requireString(record.VERIFIER_POLICY_MODE, "DURABLE_RESULT_VERIFICATION_POLICY_MODE_REQUIRED");
  if (!PILOTE_VERIFIER_POLICIES.includes(record.VERIFIER_POLICY_MODE)) throw new Error("DURABLE_RESULT_VERIFICATION_POLICY_MODE_INVALID");
  requireSha256(record.VERIFIER_POLICY_REF_SHA256, "DURABLE_RESULT_VERIFICATION_POLICY_REF_SHA256_INVALID");
  requireString(record.ACCEPTANCE_REQUIREMENT_REF, "DURABLE_RESULT_VERIFICATION_ACCEPTANCE_REQUIREMENT_REF_REQUIRED");
  requireSha256(record.CONTRACT_SET_SHA256, "DURABLE_RESULT_VERIFICATION_CONTRACT_SET_SHA256_INVALID");
  if (record.CONTRACT_SET_SHA256 !== A3_AUTHORITATIVE_BINDING.CONTRACT_SET_SHA256) throw new Error("DURABLE_RESULT_VERIFICATION_CONTRACT_SET_SHA256_MISMATCH");
  requireSha256(record.RESULT_EVIDENCE_SHA256, "DURABLE_RESULT_VERIFICATION_RESULT_EVIDENCE_SHA256_INVALID");
  requireSha256(record.VERIFIER_EVIDENCE_SHA256, "DURABLE_RESULT_VERIFICATION_VERIFIER_EVIDENCE_SHA256_INVALID");
  requireSha256(record.ARTIFACT_MANIFEST_SHA256, "DURABLE_RESULT_VERIFICATION_ARTIFACT_MANIFEST_SHA256_INVALID");
  validateStoredVerificationPayload(record.VERIFICATION_PAYLOAD, record);
  requireSha256(record.VERIFICATION_PAYLOAD_SHA256, "DURABLE_RESULT_VERIFICATION_PAYLOAD_SHA256_INVALID");
  if (hashObject(record.VERIFICATION_PAYLOAD) !== record.VERIFICATION_PAYLOAD_SHA256) throw new Error("DURABLE_RESULT_VERIFICATION_PAYLOAD_HASH_MISMATCH");
  if (typeof record.VERIFIED_AT !== "string" || Number.isNaN(Date.parse(record.VERIFIED_AT))) throw new Error("DURABLE_RESULT_VERIFICATION_VERIFIED_AT_INVALID");
  requireSha256(record.VERIFICATION_RECORD_SHA256, "DURABLE_RESULT_VERIFICATION_RECORD_SHA256_INVALID");
  if (recordHash(record) !== record.VERIFICATION_RECORD_SHA256) throw new Error("DURABLE_RESULT_VERIFICATION_RECORD_HASH_MISMATCH");
  return record;
}
async function fsyncDirectory(path) {
  const handle = await open(path, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}
async function acquireLock(lockPath, code) {
  try {
    const handle = await open(lockPath, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify({ pid: process.pid })}\n`, "utf8");
    await handle.sync();
    return { lockPath, handle };
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error(code);
    throw error;
  }
}
async function releaseLock(lock) {
  if (!lock) return;
  try { await lock.handle.close(); } finally { await unlink(lock.lockPath).catch(() => {}); }
}
async function atomicWriteRecord(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}-${value.REQUEST_SHA256.slice(0, 12)}`;
  await unlink(temp).catch((error) => { if (error?.code !== "ENOENT") throw error; });
  const handle = await open(temp, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temp, path);
    await fsyncDirectory(dirname(path));
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
}
async function readVerificationIfPresent(path) {
  try {
    return validateVerificationRecord(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function readDurableResultVerificationV1(path) {
  return validateVerificationRecord(JSON.parse(await readFile(path, "utf8")));
}

export async function commitDurableResultVerificationV1(collectionPath, verificationPath, request) {
  if (!isObject(request)) throw new Error("DURABLE_RESULT_VERIFICATION_REQUEST_REQUIRED");
  const forbidden = scanForbiddenMaterial(request);
  if (forbidden.length) throw new Error(forbidden[0]);
  const idempotencyKey = requireString(request.IDEMPOTENCY_KEY, "IDEMPOTENCY_KEY_REQUIRED");
  const requestSha256 = requestFingerprint(request);
  const verifiedAt = runtimeIso(request.RUNTIME_NOW_MS);
  const verifierEvidenceSha256 = requireSha256(request.VERIFIER_EVIDENCE_SHA256, "DURABLE_RESULT_VERIFICATION_VERIFIER_EVIDENCE_SHA256_INVALID");

  let collectionLock = null;
  let verificationLock = null;
  try {
    collectionLock = await acquireLock(`${collectionPath}.lock`, "DURABLE_RESULT_COLLECTION_LOCKED_FOR_VERIFICATION");
    verificationLock = await acquireLock(`${verificationPath}.lock`, "DURABLE_RESULT_VERIFICATION_LOCKED");

    const existing = await readVerificationIfPresent(verificationPath);
    if (existing) {
      if (existing.IDEMPOTENCY_KEY === idempotencyKey && existing.REQUEST_SHA256 === requestSha256) {
        return { ok: true, replay: true, verification: clone(existing) };
      }
      if (existing.IDEMPOTENCY_KEY === idempotencyKey) throw new Error("DURABLE_RESULT_VERIFICATION_IDEMPOTENCY_KEY_CONFLICT");
      throw new Error("DURABLE_RESULT_ALREADY_VERIFIED");
    }

    const collection = await readDurableResultCollectionV1(collectionPath);
    const collectionCheck = validateDurableResultCollectionV1(collection);
    if (!collectionCheck.ok) throw new Error(`DURABLE_RESULT_COLLECTION_INVALID:${collectionCheck.errors.join("|")}`);
    validatePlanWorkerAndPolicy(collection, request.PLAN, request.WORKER_JOB, request.PILOTE_VERIFIER_POLICY);
    validateVerificationPayload(request.VERIFICATION, collection, request.PLAN, request.WORKER_JOB);

    const record = {
      VERIFICATION_SCHEMA_ID: DURABLE_RESULT_VERIFICATION_SCHEMA_ID,
      VERIFICATION_SCHEMA_VERSION: DURABLE_RESULT_VERIFICATION_SCHEMA_VERSION,
      VERIFICATION_POLICY: DURABLE_RESULT_VERIFICATION_POLICY,
      VERIFICATION_RESULT: request.VERIFICATION.VERIFICATION_RESULT,
      IDEMPOTENCY_KEY: idempotencyKey,
      REQUEST_SHA256: requestSha256,
      COLLECTION_RECORD_SHA256: collection.COLLECTION_RECORD_SHA256,
      EXECUTION_ID: collection.EXECUTION_ID,
      EXECUTION_EPOCH: collection.EXECUTION_EPOCH,
      ATTEMPT_ID: collection.ATTEMPT_ID,
      LEASE_GENERATION: collection.LEASE_GENERATION,
      FENCE_TOKEN: collection.FENCE_TOKEN,
      WORKER_JOB_SHA256: collection.WORKER_JOB_SHA256,
      EXECUTION_PLAN_SHA256: request.PLAN.OBJECT_SHA256,
      VERIFIER_POLICY_MODE: request.PILOTE_VERIFIER_POLICY.VERIFIER_POLICY,
      VERIFIER_POLICY_REF_SHA256: request.PILOTE_VERIFIER_POLICY.VERIFIER_POLICY_SHA256,
      ACCEPTANCE_REQUIREMENT_REF: request.PILOTE_VERIFIER_POLICY.ACCEPTANCE_REQUIREMENT_REF,
      CONTRACT_SET_SHA256: request.PLAN.CONTRACT_SET_SHA256,
      RESULT_EVIDENCE_SHA256: collection.RESULT_EVIDENCE_SHA256,
      VERIFIER_EVIDENCE_SHA256: verifierEvidenceSha256,
      ARTIFACT_MANIFEST_SHA256: hashObject(artifactBindingsFromCollection(collection)),
      VERIFICATION_PAYLOAD: clone(request.VERIFICATION),
      VERIFICATION_PAYLOAD_SHA256: hashObject(request.VERIFICATION),
      VERIFIED_AT: verifiedAt,
      VERIFICATION_RECORD_SHA256: "0".repeat(64)
    };
    record.VERIFICATION_RECORD_SHA256 = recordHash(record);
    validateVerificationRecord(record);
    await atomicWriteRecord(verificationPath, record);
    return { ok: true, replay: false, verification: clone(record) };
  } finally {
    await releaseLock(verificationLock);
    await releaseLock(collectionLock);
  }
}

export function buildDurableResultAcceptanceRequestFromVerificationV1(collection, verificationRecord, input) {
  const collectionCheck = validateDurableResultCollectionV1(collection);
  if (!collectionCheck.ok) throw new Error(`DURABLE_RESULT_COLLECTION_INVALID:${collectionCheck.errors.join("|")}`);
  validateVerificationRecord(verificationRecord);
  if (!isObject(input)) throw new Error("RESULT_ACCEPTANCE_INPUT_REQUIRED");
  if (verificationRecord.VERIFICATION_RESULT !== "PASS") throw new Error("RESULT_ACCEPTANCE_REQUIRES_DURABLE_VERIFICATION_PASS");
  if (verificationRecord.COLLECTION_RECORD_SHA256 !== collection.COLLECTION_RECORD_SHA256) throw new Error("RESULT_ACCEPTANCE_VERIFICATION_COLLECTION_HASH_MISMATCH");
  if (verificationRecord.RESULT_EVIDENCE_SHA256 !== collection.RESULT_EVIDENCE_SHA256) throw new Error("RESULT_ACCEPTANCE_VERIFICATION_RESULT_EVIDENCE_MISMATCH");
  const plan = input.PLAN;
  const workerJob = input.WORKER_JOB;
  if (!isObject(plan)) throw new Error("RESULT_ACCEPTANCE_PLAN_REQUIRED");
  if (!isObject(workerJob)) throw new Error("RESULT_ACCEPTANCE_WORKER_JOB_REQUIRED");
  if (plan.OBJECT_SHA256 !== verificationRecord.EXECUTION_PLAN_SHA256) throw new Error("RESULT_ACCEPTANCE_VERIFICATION_PLAN_HASH_MISMATCH");
  if (workerJob.OBJECT_SHA256 !== verificationRecord.WORKER_JOB_SHA256) throw new Error("RESULT_ACCEPTANCE_VERIFICATION_WORKER_JOB_HASH_MISMATCH");
  if (workerJob.EXECUTION_ID !== collection.EXECUTION_ID) throw new Error("RESULT_ACCEPTANCE_COLLECTION_EXECUTION_ID_MISMATCH");
  if (workerJob.ATTEMPT_ID !== collection.ATTEMPT_ID) throw new Error("RESULT_ACCEPTANCE_COLLECTION_ATTEMPT_ID_MISMATCH");
  if (workerJob.FENCE_TOKEN !== collection.FENCE_TOKEN) throw new Error("RESULT_ACCEPTANCE_COLLECTION_FENCE_TOKEN_MISMATCH");
  runtimeIso(input.RUNTIME_NOW_MS);
  return {
    IDEMPOTENCY_KEY: requireString(input.IDEMPOTENCY_KEY, "RESULT_ACCEPTANCE_IDEMPOTENCY_KEY_REQUIRED"),
    EXPECTED_STATE_VERSION: collection.SOURCE_STATE_VERSION,
    EXPECTED_EXECUTION_EPOCH: collection.EXECUTION_EPOCH,
    EXPECTED_LEASE_GENERATION: collection.LEASE_GENERATION,
    SUBMITTED_FENCE_TOKEN: collection.FENCE_TOKEN,
    RUNTIME_NOW_MS: input.RUNTIME_NOW_MS,
    PLAN: clone(plan),
    WORKER_JOB: clone(workerJob),
    QUARANTINED_ARTIFACTS: clone(collection.QUARANTINED_ARTIFACTS),
    VERIFICATION: clone(verificationRecord.VERIFICATION_PAYLOAD)
  };
}

export function validateDurableResultVerificationV1(record) {
  try {
    validateVerificationRecord(record);
    return { ok: true, errors: [] };
  } catch (error) {
    return { ok: false, errors: [error.message] };
  }
}
