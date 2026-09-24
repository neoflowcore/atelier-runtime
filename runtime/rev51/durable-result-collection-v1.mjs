import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import {
  readDurableExecutionStateV1,
  validateDurableExecutionStateV1,
  validateAuthoritativeFenceV1
} from "./durable-execution-state-v1.mjs";
import {
  readDurableExecutionTransportV1,
  validateDurableExecutionTransportV1
} from "./durable-execution-transport-v1.mjs";

export const DURABLE_RESULT_COLLECTION_SCHEMA_ID = "DURABLE_RESULT_COLLECTION_V1";
export const DURABLE_RESULT_COLLECTION_SCHEMA_VERSION = "1";
export const DURABLE_RESULT_COLLECTION_POLICY = "CURRENT_FENCE_ACTIVE_TRANSPORT_EXACTLY_ONCE_QUARANTINE_ADMISSION";

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
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, stripUndefined(item)])
    );
  }
  return value;
}
function canonicalize(value) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("DURABLE_RESULT_COLLECTION_NON_SAFE_INTEGER");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  }
  throw new Error("DURABLE_RESULT_COLLECTION_UNSUPPORTED_CANONICAL_TYPE");
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
  delete copy.COLLECTION_RECORD_SHA256;
  return hashObject(copy);
}
function scanForbiddenMaterial(value, path = "$") {
  const errors = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => errors.push(...scanForbiddenMaterial(item, `${path}[${index}]`)));
  } else if (isObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_MATERIAL_KEYS.has(key)) errors.push(`FORBIDDEN_RESULT_COLLECTION_MATERIAL:${path}.${key}`);
      errors.push(...scanForbiddenMaterial(child, `${path}.${key}`));
    }
  }
  return errors;
}
function validateArtifactRecord(artifact, executionId, expectedState) {
  if (!isObject(artifact)) throw new Error("RESULT_COLLECTION_ARTIFACT_RECORD_REQUIRED");
  for (const key of Object.keys(artifact)) {
    if (!ARTIFACT_KEYS.has(key)) throw new Error(`RESULT_COLLECTION_ARTIFACT_UNKNOWN_FIELD:${key}`);
  }
  requireString(artifact.ARTIFACT_ID, "RESULT_COLLECTION_ARTIFACT_ID_REQUIRED");
  requireSha256(artifact.CONTENT_SHA256, "RESULT_COLLECTION_ARTIFACT_CONTENT_SHA256_INVALID");
  if (!Number.isSafeInteger(artifact.SIZE_BYTES) || artifact.SIZE_BYTES < 0) throw new Error("RESULT_COLLECTION_ARTIFACT_SIZE_INVALID");
  requireString(artifact.MEDIA_TYPE, "RESULT_COLLECTION_ARTIFACT_MEDIA_TYPE_REQUIRED");
  requireString(artifact.STORAGE_CLASS, "RESULT_COLLECTION_ARTIFACT_STORAGE_CLASS_REQUIRED");
  requireString(artifact.SECURITY_DOMAIN, "RESULT_COLLECTION_ARTIFACT_SECURITY_DOMAIN_REQUIRED");
  if (artifact.ORIGIN_EXECUTION_ID !== executionId) throw new Error("RESULT_COLLECTION_ARTIFACT_EXECUTION_MISMATCH");
  if (typeof artifact.CREATED_AT !== "string" || Number.isNaN(Date.parse(artifact.CREATED_AT))) throw new Error("RESULT_COLLECTION_ARTIFACT_CREATED_AT_INVALID");
  if (!RETENTION_CLASSES.has(artifact.RETENTION_CLASS)) throw new Error("RESULT_COLLECTION_ARTIFACT_RETENTION_CLASS_INVALID");
  if (!Array.isArray(artifact.LOCATIONS) || artifact.LOCATIONS.length === 0 || artifact.LOCATIONS.some((v) => typeof v !== "string" || v.length === 0)) {
    throw new Error("RESULT_COLLECTION_ARTIFACT_LOCATIONS_INVALID");
  }
  if (new Set(artifact.LOCATIONS).size !== artifact.LOCATIONS.length) throw new Error("RESULT_COLLECTION_ARTIFACT_LOCATIONS_NOT_UNIQUE");
  if (artifact.ARTIFACT_STATE !== expectedState) throw new Error(`RESULT_COLLECTION_ARTIFACT_STATE_MUST_BE_${expectedState}`);
}
function normalizeStagingArtifacts(artifacts, executionId) {
  if (!Array.isArray(artifacts)) throw new Error("STAGING_ARTIFACTS_ARRAY_REQUIRED");
  const ids = new Set();
  const admitted = artifacts.map((artifact) => {
    validateArtifactRecord(artifact, executionId, "STAGING");
    if (ids.has(artifact.ARTIFACT_ID)) throw new Error("RESULT_COLLECTION_ARTIFACT_ID_DUPLICATE");
    ids.add(artifact.ARTIFACT_ID);
    return { ...clone(artifact), ARTIFACT_STATE: "QUARANTINED" };
  });
  admitted.sort((a, b) => a.ARTIFACT_ID.localeCompare(b.ARTIFACT_ID));
  return admitted;
}
function validateQuarantinedArtifacts(artifacts, executionId) {
  if (!Array.isArray(artifacts)) throw new Error("QUARANTINED_ARTIFACTS_ARRAY_REQUIRED");
  const ids = [];
  for (const artifact of artifacts) {
    validateArtifactRecord(artifact, executionId, "QUARANTINED");
    ids.push(artifact.ARTIFACT_ID);
  }
  if (new Set(ids).size !== ids.length) throw new Error("RESULT_COLLECTION_ARTIFACT_ID_DUPLICATE");
  const sorted = [...ids].sort((a, b) => a.localeCompare(b));
  if (JSON.stringify(ids) !== JSON.stringify(sorted)) throw new Error("RESULT_COLLECTION_ARTIFACT_MANIFEST_NOT_SORTED");
}
function validateCollectionRecord(record) {
  if (!isObject(record)) throw new Error("DURABLE_RESULT_COLLECTION_NOT_OBJECT");
  if (record.COLLECTION_SCHEMA_ID !== DURABLE_RESULT_COLLECTION_SCHEMA_ID) throw new Error("DURABLE_RESULT_COLLECTION_SCHEMA_ID_MISMATCH");
  if (record.COLLECTION_SCHEMA_VERSION !== DURABLE_RESULT_COLLECTION_SCHEMA_VERSION) throw new Error("DURABLE_RESULT_COLLECTION_SCHEMA_VERSION_MISMATCH");
  if (record.COLLECTION_POLICY !== DURABLE_RESULT_COLLECTION_POLICY) throw new Error("DURABLE_RESULT_COLLECTION_POLICY_MISMATCH");
  if (record.COLLECTION_STATE !== "QUARANTINED") throw new Error("DURABLE_RESULT_COLLECTION_STATE_INVALID");
  requireString(record.IDEMPOTENCY_KEY, "DURABLE_RESULT_COLLECTION_IDEMPOTENCY_KEY_REQUIRED");
  requireSha256(record.REQUEST_SHA256, "DURABLE_RESULT_COLLECTION_REQUEST_SHA256_INVALID");
  requireString(record.EXECUTION_ID, "DURABLE_RESULT_COLLECTION_EXECUTION_ID_REQUIRED");
  requirePositiveInteger(record.EXECUTION_EPOCH, "DURABLE_RESULT_COLLECTION_EXECUTION_EPOCH_INVALID");
  requireString(record.ATTEMPT_ID, "DURABLE_RESULT_COLLECTION_ATTEMPT_ID_REQUIRED");
  requirePositiveInteger(record.LEASE_GENERATION, "DURABLE_RESULT_COLLECTION_LEASE_GENERATION_INVALID");
  requireString(record.FENCE_TOKEN, "DURABLE_RESULT_COLLECTION_FENCE_TOKEN_REQUIRED");
  requireString(record.WORKER_ID, "DURABLE_RESULT_COLLECTION_WORKER_ID_REQUIRED");
  requireSha256(record.WORKER_JOB_SHA256, "DURABLE_RESULT_COLLECTION_WORKER_JOB_SHA256_INVALID");
  requireNonNegativeInteger(record.SOURCE_STATE_VERSION, "DURABLE_RESULT_COLLECTION_SOURCE_STATE_VERSION_INVALID");
  requirePositiveInteger(record.SOURCE_EVENT_SEQUENCE, "DURABLE_RESULT_COLLECTION_SOURCE_EVENT_SEQUENCE_INVALID");
  requireSha256(record.SOURCE_EVENT_SHA256, "DURABLE_RESULT_COLLECTION_SOURCE_EVENT_SHA256_INVALID");
  requireNonNegativeInteger(record.TRANSPORT_STATE_VERSION, "DURABLE_RESULT_COLLECTION_TRANSPORT_STATE_VERSION_INVALID");
  requirePositiveInteger(record.TRANSPORT_EVENT_SEQUENCE, "DURABLE_RESULT_COLLECTION_TRANSPORT_EVENT_SEQUENCE_INVALID");
  requireSha256(record.TRANSPORT_EVENT_SHA256, "DURABLE_RESULT_COLLECTION_TRANSPORT_EVENT_SHA256_INVALID");
  requireSha256(record.TRANSPORT_STORE_SHA256, "DURABLE_RESULT_COLLECTION_TRANSPORT_STORE_SHA256_INVALID");
  requireSha256(record.RESULT_EVIDENCE_SHA256, "DURABLE_RESULT_COLLECTION_RESULT_EVIDENCE_SHA256_INVALID");
  validateQuarantinedArtifacts(record.QUARANTINED_ARTIFACTS, record.EXECUTION_ID);
  if (typeof record.COLLECTED_AT !== "string" || Number.isNaN(Date.parse(record.COLLECTED_AT))) throw new Error("DURABLE_RESULT_COLLECTION_COLLECTED_AT_INVALID");
  requireSha256(record.COLLECTION_RECORD_SHA256, "DURABLE_RESULT_COLLECTION_RECORD_SHA256_INVALID");
  if (recordHash(record) !== record.COLLECTION_RECORD_SHA256) throw new Error("DURABLE_RESULT_COLLECTION_RECORD_HASH_MISMATCH");
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
async function readCollectionIfPresent(path) {
  try {
    return validateCollectionRecord(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}
function assertStateAndTransport(state, transport, request) {
  const stateValidation = validateDurableExecutionStateV1(state);
  if (!stateValidation.ok) throw new Error(`DURABLE_EXECUTION_STATE_INVALID:${stateValidation.errors.join("|")}`);
  const transportValidation = validateDurableExecutionTransportV1(transport);
  if (!transportValidation.ok) throw new Error(`DURABLE_EXECUTION_TRANSPORT_INVALID:${transportValidation.errors.join("|")}`);
  if (request.EXPECTED_STATE_VERSION !== state.STATE_VERSION) throw new Error("DURABLE_RESULT_COLLECTION_STATE_CAS_MISMATCH");
  if (request.EXPECTED_EXECUTION_EPOCH !== state.EXECUTION_EPOCH) throw new Error("DURABLE_RESULT_COLLECTION_EXECUTION_EPOCH_MISMATCH");
  if (request.EXPECTED_LEASE_GENERATION !== state.LEASE_GENERATION) throw new Error("DURABLE_RESULT_COLLECTION_LEASE_GENERATION_MISMATCH");
  const fence = validateAuthoritativeFenceV1(state, request.SUBMITTED_FENCE_TOKEN);
  if (!fence.ok) throw new Error("DURABLE_RESULT_COLLECTION_STALE_FENCE_REJECTED");
  if (state.RECONCILIATION_REQUIRED === true || state.PROVIDER_OPERATION_STATE === "OUTCOME_UNKNOWN") throw new Error("DURABLE_RESULT_COLLECTION_RECONCILIATION_REQUIRED");
  if (request.EXPECTED_TRANSPORT_STATE_VERSION !== transport.STATE_VERSION) throw new Error("DURABLE_RESULT_COLLECTION_TRANSPORT_STATE_CAS_MISMATCH");
  if (transport.TRANSPORT_STATE === "OUTCOME_UNKNOWN") throw new Error("DURABLE_RESULT_COLLECTION_TRANSPORT_RECONCILIATION_REQUIRED");
  if (transport.TRANSPORT_STATE !== "ACTIVE") throw new Error("DURABLE_RESULT_COLLECTION_TRANSPORT_NOT_ACTIVE");
  if (transport.CONFORMANCE_RESULT !== "PASS") throw new Error("DURABLE_RESULT_COLLECTION_TRANSPORT_CONFORMANCE_REQUIRED");
  if (transport.ACTIVE_OPERATION !== null) throw new Error("DURABLE_RESULT_COLLECTION_TRANSPORT_OPERATION_NOT_TERMINAL");
  if (transport.EXECUTION_ID !== state.EXECUTION_ID) throw new Error("DURABLE_RESULT_COLLECTION_EXECUTION_ID_MISMATCH");
  if (transport.ATTEMPT_ID !== state.ATTEMPT_ID) throw new Error("DURABLE_RESULT_COLLECTION_ATTEMPT_ID_MISMATCH");
  if (transport.FENCE_TOKEN !== state.FENCE_TOKEN) throw new Error("DURABLE_RESULT_COLLECTION_TRANSPORT_FENCE_MISMATCH");
  if (request.WORKER_ID !== transport.WORKER_ID) throw new Error("DURABLE_RESULT_COLLECTION_WORKER_ID_MISMATCH");
  if (request.WORKER_JOB_SHA256 !== transport.WORKER_JOB_SHA256) throw new Error("DURABLE_RESULT_COLLECTION_WORKER_JOB_SHA256_MISMATCH");
}

export async function readDurableResultCollectionV1(path) {
  return validateCollectionRecord(JSON.parse(await readFile(path, "utf8")));
}

export async function commitDurableResultCollectionV1(statePath, transportPath, collectionPath, request) {
  if (!isObject(request)) throw new Error("DURABLE_RESULT_COLLECTION_REQUEST_REQUIRED");
  const forbidden = scanForbiddenMaterial(request);
  if (forbidden.length) throw new Error(forbidden[0]);
  const idempotencyKey = requireString(request.IDEMPOTENCY_KEY, "IDEMPOTENCY_KEY_REQUIRED");
  const requestSha256 = requestFingerprint(request);
  const collectedAt = runtimeIso(request.RUNTIME_NOW_MS);
  requireString(request.WORKER_ID, "DURABLE_RESULT_COLLECTION_WORKER_ID_REQUIRED");
  requireSha256(request.WORKER_JOB_SHA256, "DURABLE_RESULT_COLLECTION_WORKER_JOB_SHA256_INVALID");
  const resultEvidenceSha256 = requireSha256(request.RESULT_EVIDENCE_SHA256, "DURABLE_RESULT_COLLECTION_RESULT_EVIDENCE_SHA256_INVALID");

  let stateLock = null;
  let transportLock = null;
  let collectionLock = null;
  try {
    stateLock = await acquireLock(`${statePath}.lock`, "DURABLE_EXECUTION_STATE_LOCKED_FOR_RESULT_COLLECTION");
    transportLock = await acquireLock(`${transportPath}.lock`, "DURABLE_EXECUTION_TRANSPORT_LOCKED_FOR_RESULT_COLLECTION");
    collectionLock = await acquireLock(`${collectionPath}.lock`, "DURABLE_RESULT_COLLECTION_LOCKED");

    const existing = await readCollectionIfPresent(collectionPath);
    if (existing) {
      if (existing.IDEMPOTENCY_KEY === idempotencyKey && existing.REQUEST_SHA256 === requestSha256) {
        return { ok: true, replay: true, collection: clone(existing) };
      }
      if (existing.IDEMPOTENCY_KEY === idempotencyKey) throw new Error("DURABLE_RESULT_COLLECTION_IDEMPOTENCY_KEY_CONFLICT");
      throw new Error("DURABLE_RESULT_ALREADY_COLLECTED");
    }

    const state = await readDurableExecutionStateV1(statePath);
    const transport = await readDurableExecutionTransportV1(transportPath);
    assertStateAndTransport(state, transport, request);
    const quarantinedArtifacts = normalizeStagingArtifacts(request.STAGING_ARTIFACTS, state.EXECUTION_ID);
    const sourceEvent = state.EVENT_LEDGER.at(-1);
    const transportEvent = transport.EVENT_LEDGER.at(-1);
    const record = {
      COLLECTION_SCHEMA_ID: DURABLE_RESULT_COLLECTION_SCHEMA_ID,
      COLLECTION_SCHEMA_VERSION: DURABLE_RESULT_COLLECTION_SCHEMA_VERSION,
      COLLECTION_POLICY: DURABLE_RESULT_COLLECTION_POLICY,
      COLLECTION_STATE: "QUARANTINED",
      IDEMPOTENCY_KEY: idempotencyKey,
      REQUEST_SHA256: requestSha256,
      EXECUTION_ID: state.EXECUTION_ID,
      EXECUTION_EPOCH: state.EXECUTION_EPOCH,
      ATTEMPT_ID: state.ATTEMPT_ID,
      LEASE_GENERATION: state.LEASE_GENERATION,
      FENCE_TOKEN: state.FENCE_TOKEN,
      WORKER_ID: transport.WORKER_ID,
      WORKER_JOB_SHA256: transport.WORKER_JOB_SHA256,
      SOURCE_STATE_VERSION: state.STATE_VERSION,
      SOURCE_EVENT_SEQUENCE: state.LAST_EVENT_SEQUENCE,
      SOURCE_EVENT_SHA256: sourceEvent.EVENT_SHA256,
      TRANSPORT_STATE_VERSION: transport.STATE_VERSION,
      TRANSPORT_EVENT_SEQUENCE: transport.LAST_EVENT_SEQUENCE,
      TRANSPORT_EVENT_SHA256: transportEvent.EVENT_SHA256,
      TRANSPORT_STORE_SHA256: hashObject(transport),
      RESULT_EVIDENCE_SHA256: resultEvidenceSha256,
      QUARANTINED_ARTIFACTS: quarantinedArtifacts,
      COLLECTED_AT: collectedAt,
      COLLECTION_RECORD_SHA256: "0".repeat(64)
    };
    record.COLLECTION_RECORD_SHA256 = recordHash(record);
    validateCollectionRecord(record);
    await atomicWriteRecord(collectionPath, record);
    return { ok: true, replay: false, collection: clone(record) };
  } finally {
    await releaseLock(collectionLock);
    await releaseLock(transportLock);
    await releaseLock(stateLock);
  }
}

export function buildDurableResultAcceptanceRequestV1(collection, input) {
  validateCollectionRecord(collection);
  if (!isObject(input)) throw new Error("RESULT_ACCEPTANCE_INPUT_REQUIRED");
  if (!isObject(input.PLAN)) throw new Error("RESULT_ACCEPTANCE_PLAN_REQUIRED");
  if (!isObject(input.VERIFICATION)) throw new Error("RESULT_ACCEPTANCE_VERIFICATION_REQUIRED");
  runtimeIso(input.RUNTIME_NOW_MS);
  const workerJob = input.WORKER_JOB;
  if (!isObject(workerJob)) throw new Error("RESULT_ACCEPTANCE_WORKER_JOB_REQUIRED");
  if (workerJob.OBJECT_SHA256 !== collection.WORKER_JOB_SHA256) throw new Error("RESULT_ACCEPTANCE_COLLECTION_WORKER_JOB_HASH_MISMATCH");
  if (workerJob.EXECUTION_ID !== collection.EXECUTION_ID) throw new Error("RESULT_ACCEPTANCE_COLLECTION_EXECUTION_ID_MISMATCH");
  if (workerJob.ATTEMPT_ID !== collection.ATTEMPT_ID) throw new Error("RESULT_ACCEPTANCE_COLLECTION_ATTEMPT_ID_MISMATCH");
  if (workerJob.FENCE_TOKEN !== collection.FENCE_TOKEN) throw new Error("RESULT_ACCEPTANCE_COLLECTION_FENCE_TOKEN_MISMATCH");
  return {
    IDEMPOTENCY_KEY: requireString(input.IDEMPOTENCY_KEY, "RESULT_ACCEPTANCE_IDEMPOTENCY_KEY_REQUIRED"),
    EXPECTED_STATE_VERSION: collection.SOURCE_STATE_VERSION,
    EXPECTED_EXECUTION_EPOCH: collection.EXECUTION_EPOCH,
    EXPECTED_LEASE_GENERATION: collection.LEASE_GENERATION,
    SUBMITTED_FENCE_TOKEN: collection.FENCE_TOKEN,
    RUNTIME_NOW_MS: input.RUNTIME_NOW_MS,
    PLAN: clone(input.PLAN),
    WORKER_JOB: clone(workerJob),
    QUARANTINED_ARTIFACTS: clone(collection.QUARANTINED_ARTIFACTS),
    VERIFICATION: clone(input.VERIFICATION)
  };
}

export function validateDurableResultCollectionV1(record) {
  try {
    validateCollectionRecord(record);
    return { ok: true, errors: [] };
  } catch (error) {
    return { ok: false, errors: [error.message] };
  }
}
