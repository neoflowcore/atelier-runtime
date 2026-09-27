import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { validateDurableExecutionStateV1 } from "./durable-execution-state-v1.mjs";
import { validateContractEnvelope } from "./contract-core.mjs";
import { acceptQuarantinedResultV1 } from "./result-quarantine-acceptance-v1.mjs";

export const DURABLE_RESULT_ACCEPTANCE_SCHEMA_ID = "DURABLE_RESULT_ACCEPTANCE_V1";
export const DURABLE_RESULT_ACCEPTANCE_SCHEMA_VERSION = "1";
export const DURABLE_RESULT_ACCEPTANCE_POLICY = "CURRENT_FENCE_CAS_QUARANTINE_ATOMIC_COMMIT";

const SHA256_RE = /^[0-9a-f]{64}$/;

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
    if (!Number.isSafeInteger(value)) throw new Error("DURABLE_RESULT_ACCEPTANCE_NON_SAFE_INTEGER");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  }
  throw new Error("DURABLE_RESULT_ACCEPTANCE_UNSUPPORTED_CANONICAL_TYPE");
}

function hashObject(value) {
  return createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
}

function requestFingerprint(request) {
  const copy = stripUndefined(clone(request));
  delete copy.RUNTIME_NOW_MS;
  return hashObject(copy);
}

function acceptanceRecordHash(record) {
  const copy = clone(record);
  delete copy.ACCEPTANCE_RECORD_SHA256;
  return hashObject(copy);
}

function validateArtifactManifest(manifest, receipt, executionId) {
  if (!Array.isArray(manifest)) throw new Error("ACCEPTED_ARTIFACT_MANIFEST_REQUIRED");
  const ids = [];
  for (const artifact of manifest) {
    if (!isObject(artifact)) throw new Error("ACCEPTED_ARTIFACT_RECORD_INVALID");
    requireString(artifact.ARTIFACT_ID, "ACCEPTED_ARTIFACT_ID_REQUIRED");
    requireSha256(artifact.CONTENT_SHA256, "ACCEPTED_ARTIFACT_CONTENT_SHA256_INVALID");
    if (!Number.isSafeInteger(artifact.SIZE_BYTES) || artifact.SIZE_BYTES < 0) throw new Error("ACCEPTED_ARTIFACT_SIZE_INVALID");
    if (artifact.ORIGIN_EXECUTION_ID !== executionId) throw new Error("ACCEPTED_ARTIFACT_EXECUTION_MISMATCH");
    if (artifact.ARTIFACT_STATE !== "IMMUTABLE") throw new Error("ACCEPTED_ARTIFACT_NOT_IMMUTABLE");
    ids.push(artifact.ARTIFACT_ID);
  }
  if (new Set(ids).size !== ids.length) throw new Error("ACCEPTED_ARTIFACT_ID_DUPLICATE");
  const sorted = [...ids].sort((a, b) => a.localeCompare(b));
  if (JSON.stringify(ids) !== JSON.stringify(sorted)) throw new Error("ACCEPTED_ARTIFACT_MANIFEST_NOT_SORTED");
  if (JSON.stringify(ids) !== JSON.stringify(receipt.ACCEPTED_ARTIFACT_IDS)) throw new Error("ACCEPTED_ARTIFACT_RECEIPT_MISMATCH");
}

function validateReceipt(receipt, record) {
  if (!isObject(receipt)) throw new Error("EXECUTION_RECEIPT_REQUIRED");
  if (receipt.SCHEMA_ID !== "EXECUTION_RECEIPT_V1") throw new Error("EXECUTION_RECEIPT_SCHEMA_ID_MISMATCH");
  if (receipt.SCHEMA_VERSION !== "1") throw new Error("EXECUTION_RECEIPT_SCHEMA_VERSION_MISMATCH");
  if (receipt.RUNTIME_SEALED !== true) throw new Error("EXECUTION_RECEIPT_NOT_RUNTIME_SEALED");
  if (receipt.VERIFICATION_RESULT !== "PASS") throw new Error("EXECUTION_RECEIPT_NOT_PASS");
  requireSha256(receipt.OBJECT_SHA256, "EXECUTION_RECEIPT_HASH_INVALID");
  if (receipt.EXECUTION_ID !== record.EXECUTION_ID) throw new Error("EXECUTION_RECEIPT_EXECUTION_ID_MISMATCH");
  if (receipt.ATTEMPT_ID !== record.ATTEMPT_ID) throw new Error("EXECUTION_RECEIPT_ATTEMPT_ID_MISMATCH");
  if (receipt.FENCE_TOKEN !== record.FENCE_TOKEN) throw new Error("EXECUTION_RECEIPT_FENCE_TOKEN_MISMATCH");
  if (receipt.WORKER_JOB_HASH !== record.WORKER_JOB_HASH) throw new Error("EXECUTION_RECEIPT_WORKER_JOB_HASH_MISMATCH");
  if (receipt.EXECUTION_PLAN_HASH !== record.EXECUTION_PLAN_HASH) throw new Error("EXECUTION_RECEIPT_PLAN_HASH_MISMATCH");
  if (!Array.isArray(receipt.ACCEPTED_ARTIFACT_IDS)) throw new Error("EXECUTION_RECEIPT_ARTIFACT_IDS_REQUIRED");
  const envelope = validateContractEnvelope(receipt, {
    schemaId: "EXECUTION_RECEIPT_V1",
    schemaVersion: "1",
    canonicalizationId: "ATELIER_REV51_JCS_V1",
    upstreamObjectSha256: record.WORKER_JOB_HASH
  });
  if (!envelope.ok) throw new Error(`EXECUTION_RECEIPT_INVALID:${envelope.errors.join("|")}`);
}

function validateAcceptanceRecord(record) {
  if (!isObject(record)) throw new Error("DURABLE_RESULT_ACCEPTANCE_NOT_OBJECT");
  if (record.ACCEPTANCE_SCHEMA_ID !== DURABLE_RESULT_ACCEPTANCE_SCHEMA_ID) throw new Error("DURABLE_RESULT_ACCEPTANCE_SCHEMA_ID_MISMATCH");
  if (record.ACCEPTANCE_SCHEMA_VERSION !== DURABLE_RESULT_ACCEPTANCE_SCHEMA_VERSION) throw new Error("DURABLE_RESULT_ACCEPTANCE_SCHEMA_VERSION_MISMATCH");
  if (record.ACCEPTANCE_POLICY !== DURABLE_RESULT_ACCEPTANCE_POLICY) throw new Error("DURABLE_RESULT_ACCEPTANCE_POLICY_MISMATCH");
  if (record.ACCEPTANCE_STATE !== "ACCEPTED") throw new Error("DURABLE_RESULT_ACCEPTANCE_STATE_INVALID");
  requireString(record.IDEMPOTENCY_KEY, "DURABLE_RESULT_ACCEPTANCE_IDEMPOTENCY_KEY_REQUIRED");
  requireSha256(record.REQUEST_SHA256, "DURABLE_RESULT_ACCEPTANCE_REQUEST_SHA256_INVALID");
  requireString(record.EXECUTION_ID, "DURABLE_RESULT_ACCEPTANCE_EXECUTION_ID_REQUIRED");
  requireSha256(record.EXECUTION_PLAN_HASH, "DURABLE_RESULT_ACCEPTANCE_PLAN_HASH_INVALID");
  requireSha256(record.WORKER_JOB_HASH, "DURABLE_RESULT_ACCEPTANCE_WORKER_JOB_HASH_INVALID");
  requirePositiveInteger(record.EXECUTION_EPOCH, "DURABLE_RESULT_ACCEPTANCE_EXECUTION_EPOCH_INVALID");
  requireString(record.ATTEMPT_ID, "DURABLE_RESULT_ACCEPTANCE_ATTEMPT_ID_REQUIRED");
  requirePositiveInteger(record.LEASE_GENERATION, "DURABLE_RESULT_ACCEPTANCE_LEASE_GENERATION_INVALID");
  requireString(record.FENCE_TOKEN, "DURABLE_RESULT_ACCEPTANCE_FENCE_TOKEN_REQUIRED");
  requireNonNegativeInteger(record.SOURCE_STATE_VERSION, "DURABLE_RESULT_ACCEPTANCE_SOURCE_STATE_VERSION_INVALID");
  requirePositiveInteger(record.SOURCE_EVENT_SEQUENCE, "DURABLE_RESULT_ACCEPTANCE_SOURCE_EVENT_SEQUENCE_INVALID");
  requireSha256(record.SOURCE_EVENT_SHA256, "DURABLE_RESULT_ACCEPTANCE_SOURCE_EVENT_SHA256_INVALID");
  if (typeof record.COMMITTED_AT !== "string" || Number.isNaN(Date.parse(record.COMMITTED_AT))) throw new Error("DURABLE_RESULT_ACCEPTANCE_COMMITTED_AT_INVALID");
  validateReceipt(record.EXECUTION_RECEIPT, record);
  validateArtifactManifest(record.ACCEPTED_ARTIFACT_MANIFEST, record.EXECUTION_RECEIPT, record.EXECUTION_ID);
  requireSha256(record.ACCEPTANCE_RECORD_SHA256, "DURABLE_RESULT_ACCEPTANCE_RECORD_SHA256_INVALID");
  if (acceptanceRecordHash(record) !== record.ACCEPTANCE_RECORD_SHA256) throw new Error("DURABLE_RESULT_ACCEPTANCE_RECORD_HASH_MISMATCH");
  return record;
}

async function fsyncDirectory(path) {
  const handle = await open(path, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}

async function acquireLock(lockPath, errorCode) {
  try {
    const handle = await open(lockPath, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify({ pid: process.pid })}\n`, "utf8");
    await handle.sync();
    return { lockPath, handle };
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error(errorCode);
    throw error;
  }
}

async function releaseLock(lock) {
  if (!lock) return;
  try { await lock.handle.close(); } finally { await unlink(lock.lockPath).catch(() => {}); }
}

async function readDurableStateUnlocked(statePath) {
  const state = JSON.parse(await readFile(statePath, "utf8"));
  const result = validateDurableExecutionStateV1(state);
  if (!result.ok) throw new Error(`DURABLE_EXECUTION_STATE_INVALID:${result.errors.join("|")}`);
  return state;
}

async function readAcceptanceIfPresent(journalPath) {
  try {
    return validateAcceptanceRecord(JSON.parse(await readFile(journalPath, "utf8")));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function atomicWriteAcceptance(journalPath, value) {
  await mkdir(dirname(journalPath), { recursive: true });
  const temp = `${journalPath}.tmp-${process.pid}-${value.REQUEST_SHA256.slice(0, 12)}`;
  await unlink(temp).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
  const handle = await open(temp, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temp, journalPath);
    await fsyncDirectory(dirname(journalPath));
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
}

export async function readDurableResultAcceptanceV1(journalPath) {
  return validateAcceptanceRecord(JSON.parse(await readFile(journalPath, "utf8")));
}

export async function commitDurableResultAcceptanceV1(statePath, journalPath, request) {
  if (!isObject(request)) throw new Error("DURABLE_RESULT_ACCEPTANCE_REQUEST_REQUIRED");
  const idempotencyKey = requireString(request.IDEMPOTENCY_KEY, "IDEMPOTENCY_KEY_REQUIRED");
  const requestSha256 = requestFingerprint(request);
  const committedAt = runtimeIso(request.RUNTIME_NOW_MS);

  let stateLock = null;
  let journalLock = null;
  try {
    stateLock = await acquireLock(`${statePath}.lock`, "DURABLE_EXECUTION_STATE_LOCKED");
    journalLock = await acquireLock(`${journalPath}.lock`, "DURABLE_RESULT_ACCEPTANCE_LOCKED");

    const existing = await readAcceptanceIfPresent(journalPath);
    if (existing) {
      if (existing.IDEMPOTENCY_KEY === idempotencyKey && existing.REQUEST_SHA256 === requestSha256) {
        return { ok: true, replay: true, acceptance: clone(existing) };
      }
      if (existing.IDEMPOTENCY_KEY === idempotencyKey) throw new Error("DURABLE_RESULT_ACCEPTANCE_IDEMPOTENCY_KEY_CONFLICT");
      throw new Error("DURABLE_RESULT_ALREADY_ACCEPTED");
    }

    const state = await readDurableStateUnlocked(statePath);
    if (request.EXPECTED_STATE_VERSION !== state.STATE_VERSION) throw new Error("DURABLE_RESULT_ACCEPTANCE_STATE_CAS_MISMATCH");
    if (request.EXPECTED_EXECUTION_EPOCH !== state.EXECUTION_EPOCH) throw new Error("DURABLE_RESULT_ACCEPTANCE_EXECUTION_EPOCH_MISMATCH");
    if (request.EXPECTED_LEASE_GENERATION !== state.LEASE_GENERATION) throw new Error("DURABLE_RESULT_ACCEPTANCE_LEASE_GENERATION_MISMATCH");
    if (request.SUBMITTED_FENCE_TOKEN !== state.FENCE_TOKEN) throw new Error("DURABLE_RESULT_ACCEPTANCE_STALE_FENCE_REJECTED");
    if (state.RECONCILIATION_REQUIRED === true || state.PROVIDER_OPERATION_STATE === "OUTCOME_UNKNOWN") throw new Error("DURABLE_RESULT_ACCEPTANCE_RECONCILIATION_REQUIRED");

    if (!isObject(request.WORKER_JOB)) throw new Error("DURABLE_RESULT_ACCEPTANCE_WORKER_JOB_REQUIRED");
    if (request.WORKER_JOB.EXECUTION_ID !== state.EXECUTION_ID) throw new Error("DURABLE_RESULT_ACCEPTANCE_EXECUTION_ID_MISMATCH");
    if (request.WORKER_JOB.ATTEMPT_ID !== state.ATTEMPT_ID) throw new Error("DURABLE_RESULT_ACCEPTANCE_ATTEMPT_ID_MISMATCH");
    if (request.WORKER_JOB.FENCE_TOKEN !== state.FENCE_TOKEN) throw new Error("DURABLE_RESULT_ACCEPTANCE_WORKER_FENCE_MISMATCH");

    const accepted = acceptQuarantinedResultV1(
      request.PLAN,
      request.WORKER_JOB,
      request.QUARANTINED_ARTIFACTS,
      request.VERIFICATION
    );

    const lastEvent = state.EVENT_LEDGER.at(-1);
    const record = {
      ACCEPTANCE_SCHEMA_ID: DURABLE_RESULT_ACCEPTANCE_SCHEMA_ID,
      ACCEPTANCE_SCHEMA_VERSION: DURABLE_RESULT_ACCEPTANCE_SCHEMA_VERSION,
      ACCEPTANCE_POLICY: DURABLE_RESULT_ACCEPTANCE_POLICY,
      ACCEPTANCE_STATE: "ACCEPTED",
      IDEMPOTENCY_KEY: idempotencyKey,
      REQUEST_SHA256: requestSha256,
      EXECUTION_ID: state.EXECUTION_ID,
      EXECUTION_PLAN_HASH: request.PLAN.OBJECT_SHA256,
      WORKER_JOB_HASH: request.WORKER_JOB.OBJECT_SHA256,
      EXECUTION_EPOCH: state.EXECUTION_EPOCH,
      ATTEMPT_ID: state.ATTEMPT_ID,
      LEASE_GENERATION: state.LEASE_GENERATION,
      FENCE_TOKEN: state.FENCE_TOKEN,
      SOURCE_STATE_VERSION: state.STATE_VERSION,
      SOURCE_EVENT_SEQUENCE: state.LAST_EVENT_SEQUENCE,
      SOURCE_EVENT_SHA256: lastEvent.EVENT_SHA256,
      ACCEPTED_ARTIFACT_MANIFEST: accepted.acceptedArtifacts,
      EXECUTION_RECEIPT: accepted.receipt,
      COMMITTED_AT: committedAt,
      ACCEPTANCE_RECORD_SHA256: "0".repeat(64)
    };
    record.ACCEPTANCE_RECORD_SHA256 = acceptanceRecordHash(record);
    validateAcceptanceRecord(record);
    await atomicWriteAcceptance(journalPath, record);
    return { ok: true, replay: false, acceptance: clone(record) };
  } finally {
    await releaseLock(journalLock);
    await releaseLock(stateLock);
  }
}

export function validateDurableResultAcceptanceV1(record) {
  try {
    validateAcceptanceRecord(record);
    return { ok: true, errors: [] };
  } catch (error) {
    return { ok: false, errors: [error.message] };
  }
}
