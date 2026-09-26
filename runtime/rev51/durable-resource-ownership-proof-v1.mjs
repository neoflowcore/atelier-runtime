import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { A5_POLICY } from "./pilote-capability-resource-security-consumer-v1.mjs";
import { readDurableExecutionStateV1, validateAuthoritativeFenceV1 } from "./durable-execution-state-v1.mjs";

export const RESOURCE_OWNERSHIP_SCHEMA_ID = "DURABLE_RESOURCE_OWNERSHIP_PROOF_V1";
export const RESOURCE_OWNERSHIP_SCHEMA_VERSION = "1";
export const RESOURCE_OWNERSHIP_EVENT_SCHEMA_VERSION = "1";

export const RESOURCE_OWNERSHIP_STATUSES = Object.freeze([
  "AVAILABLE",
  "IN_USE",
  "RECONCILIATION_REQUIRED",
  "CONSUMED",
  "FAILED"
]);

const SHA256_RE = /^[0-9a-f]{64}$/;
const EXACT_STORE_KEYS = Object.freeze([
  "STORE_SCHEMA_ID",
  "STORE_SCHEMA_VERSION",
  "EVENT_SCHEMA_VERSION",
  "PROOF_ID",
  "EXECUTION_ID",
  "EXECUTION_EPOCH",
  "ATTEMPT_ID",
  "LEASE_GENERATION",
  "FENCE_TOKEN",
  "WORKER_JOB_SHA256",
  "RESOURCE_FINGERPRINT_SHA256",
  "CREATION_RECEIPT_SHA256",
  "OWNERSHIP_ASSERTION_SHA256",
  "PROOF_STATUS",
  "ACTIVE_OPERATION",
  "FAILURE",
  "STATE_VERSION",
  "LAST_EVENT_SEQUENCE",
  "CREATED_AT",
  "UPDATED_AT",
  "IDEMPOTENCY_INDEX",
  "EVENT_LEDGER"
]);

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function exactKeys(value, keys) {
  if (!isObject(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function requireString(value, code) {
  if (typeof value !== "string" || value.length === 0) throw new Error(code);
  return value;
}

function requireSha256(value, code) {
  if (!SHA256_RE.test(value ?? "")) throw new Error(code);
  return value;
}

function requireNonNegativeInteger(value, code) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(code);
  return value;
}

function requirePositiveInteger(value, code) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(code);
  return value;
}

function runtimeIso(runtimeNowMs) {
  if (!Number.isSafeInteger(runtimeNowMs)) throw new Error("RUNTIME_AUTHORITATIVE_TIME_REQUIRED");
  return new Date(runtimeNowMs).toISOString();
}

function canonicalize(value) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("RESOURCE_OWNERSHIP_NON_SAFE_INTEGER");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  }
  throw new Error("RESOURCE_OWNERSHIP_UNSUPPORTED_CANONICAL_TYPE");
}

function hashObject(value) {
  return createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
}

function buildEvent(previousHash, sequence, eventType, idempotencyKey, stateVersion, timestamp, payload) {
  const body = {
    EVENT_SCHEMA_VERSION: RESOURCE_OWNERSHIP_EVENT_SCHEMA_VERSION,
    EVENT_SEQUENCE: sequence,
    EVENT_TYPE: eventType,
    IDEMPOTENCY_KEY: idempotencyKey,
    STATE_VERSION: stateVersion,
    TIMESTAMP: timestamp,
    PAYLOAD: clone(payload),
    PREVIOUS_EVENT_SHA256: previousHash
  };
  return { ...body, EVENT_SHA256: hashObject(body) };
}

function validateEventLedger(events) {
  if (!Array.isArray(events) || events.length === 0) throw new Error("RESOURCE_OWNERSHIP_EVENT_LEDGER_REQUIRED");
  let previousHash = "0".repeat(64);
  let sequence = 1;
  for (const event of events) {
    if (!isObject(event)) throw new Error("RESOURCE_OWNERSHIP_EVENT_INVALID");
    if (event.EVENT_SCHEMA_VERSION !== RESOURCE_OWNERSHIP_EVENT_SCHEMA_VERSION) throw new Error("RESOURCE_OWNERSHIP_EVENT_SCHEMA_VERSION_MISMATCH");
    if (event.EVENT_SEQUENCE !== sequence) throw new Error("RESOURCE_OWNERSHIP_EVENT_SEQUENCE_GAP");
    if (event.PREVIOUS_EVENT_SHA256 !== previousHash) throw new Error("RESOURCE_OWNERSHIP_EVENT_PREVIOUS_HASH_MISMATCH");
    const { EVENT_SHA256, ...body } = event;
    if (!SHA256_RE.test(EVENT_SHA256 ?? "") || hashObject(body) !== EVENT_SHA256) throw new Error("RESOURCE_OWNERSHIP_EVENT_HASH_MISMATCH");
    previousHash = EVENT_SHA256;
    sequence += 1;
  }
}

function validateStore(store) {
  if (!exactKeys(store, EXACT_STORE_KEYS)) throw new Error("RESOURCE_OWNERSHIP_STORE_FIELDS_MISMATCH");
  if (store.STORE_SCHEMA_ID !== RESOURCE_OWNERSHIP_SCHEMA_ID) throw new Error("RESOURCE_OWNERSHIP_SCHEMA_ID_MISMATCH");
  if (store.STORE_SCHEMA_VERSION !== RESOURCE_OWNERSHIP_SCHEMA_VERSION) throw new Error("RESOURCE_OWNERSHIP_SCHEMA_VERSION_MISMATCH");
  if (store.EVENT_SCHEMA_VERSION !== RESOURCE_OWNERSHIP_EVENT_SCHEMA_VERSION) throw new Error("RESOURCE_OWNERSHIP_EVENT_SCHEMA_VERSION_MISMATCH");
  requireString(store.PROOF_ID, "RESOURCE_OWNERSHIP_PROOF_ID_REQUIRED");
  requireString(store.EXECUTION_ID, "EXECUTION_ID_REQUIRED");
  requirePositiveInteger(store.EXECUTION_EPOCH, "EXECUTION_EPOCH_INVALID");
  requireString(store.ATTEMPT_ID, "ATTEMPT_ID_REQUIRED");
  requirePositiveInteger(store.LEASE_GENERATION, "LEASE_GENERATION_INVALID");
  requireString(store.FENCE_TOKEN, "FENCE_TOKEN_REQUIRED");
  requireSha256(store.WORKER_JOB_SHA256, "WORKER_JOB_SHA256_INVALID");
  requireSha256(store.RESOURCE_FINGERPRINT_SHA256, "RESOURCE_FINGERPRINT_SHA256_INVALID");
  requireSha256(store.CREATION_RECEIPT_SHA256, "CREATION_RECEIPT_SHA256_INVALID");
  requireSha256(store.OWNERSHIP_ASSERTION_SHA256, "OWNERSHIP_ASSERTION_SHA256_INVALID");
  if (!RESOURCE_OWNERSHIP_STATUSES.includes(store.PROOF_STATUS)) throw new Error("RESOURCE_OWNERSHIP_STATUS_INVALID");
  requireNonNegativeInteger(store.STATE_VERSION, "RESOURCE_OWNERSHIP_STATE_VERSION_INVALID");
  requirePositiveInteger(store.LAST_EVENT_SEQUENCE, "RESOURCE_OWNERSHIP_EVENT_SEQUENCE_INVALID");
  if (!isObject(store.IDEMPOTENCY_INDEX)) throw new Error("RESOURCE_OWNERSHIP_IDEMPOTENCY_INDEX_REQUIRED");
  if (typeof store.CREATED_AT !== "string" || Number.isNaN(Date.parse(store.CREATED_AT))) throw new Error("RESOURCE_OWNERSHIP_CREATED_AT_INVALID");
  if (typeof store.UPDATED_AT !== "string" || Number.isNaN(Date.parse(store.UPDATED_AT))) throw new Error("RESOURCE_OWNERSHIP_UPDATED_AT_INVALID");
  validateEventLedger(store.EVENT_LEDGER);
  if (store.EVENT_LEDGER.length !== store.LAST_EVENT_SEQUENCE) throw new Error("RESOURCE_OWNERSHIP_LAST_EVENT_SEQUENCE_MISMATCH");

  if (store.PROOF_STATUS === "AVAILABLE" && store.ACTIVE_OPERATION !== null) throw new Error("AVAILABLE_PROOF_ACTIVE_OPERATION_DENIED");
  if (store.PROOF_STATUS === "IN_USE") {
    if (!isObject(store.ACTIVE_OPERATION) || store.ACTIVE_OPERATION.RESULT !== "IN_PROGRESS") throw new Error("IN_USE_OPERATION_INVALID");
  }
  if (store.PROOF_STATUS === "RECONCILIATION_REQUIRED") {
    if (!isObject(store.ACTIVE_OPERATION) || store.ACTIVE_OPERATION.RESULT !== "OUTCOME_UNKNOWN") throw new Error("RECONCILIATION_OPERATION_INVALID");
  }
  if (store.PROOF_STATUS === "CONSUMED" && store.ACTIVE_OPERATION !== null) throw new Error("CONSUMED_PROOF_ACTIVE_OPERATION_DENIED");
  if (store.PROOF_STATUS === "FAILED" && !store.FAILURE) throw new Error("FAILED_PROOF_FAILURE_REQUIRED");
  return store;
}

async function fsyncDirectory(path) {
  const handle = await open(path, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}

async function atomicWriteJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}`;
  const handle = await open(temp, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temp, path);
  await fsyncDirectory(dirname(path));
}

async function acquireLockPath(lockPath, code) {
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
  try { await lock.handle.close(); } finally { await unlink(lock.lockPath).catch(() => {}); }
}

function requestFingerprint(request) {
  const copy = clone(request);
  delete copy.RUNTIME_NOW_MS;
  delete copy.EVENT_TYPE;
  delete copy.EVENT_PAYLOAD;
  return hashObject(copy);
}

function assertA5Policy() {
  if (A5_POLICY.RESOURCE_OWNERSHIP_PROOF_POLICY !== "DURABLE_PROOF_REQUIRED_BEFORE_DESTRUCTIVE_ACTION") {
    throw new Error("A5_RESOURCE_OWNERSHIP_POLICY_MISMATCH");
  }
}

function assertExecutionBinding(executionState, store, submittedFenceToken) {
  if (executionState.EXECUTION_ID !== store.EXECUTION_ID) throw new Error("RESOURCE_OWNERSHIP_EXECUTION_ID_MISMATCH");
  if (executionState.EXECUTION_EPOCH !== store.EXECUTION_EPOCH) throw new Error("RESOURCE_OWNERSHIP_EXECUTION_EPOCH_STALE");
  if (executionState.ATTEMPT_ID !== store.ATTEMPT_ID) throw new Error("RESOURCE_OWNERSHIP_ATTEMPT_STALE");
  if (executionState.LEASE_GENERATION !== store.LEASE_GENERATION) throw new Error("RESOURCE_OWNERSHIP_LEASE_STALE");
  if (executionState.FENCE_TOKEN !== store.FENCE_TOKEN) throw new Error("RESOURCE_OWNERSHIP_FENCE_STALE");
  const fence = validateAuthoritativeFenceV1(executionState, submittedFenceToken);
  if (!fence.ok) throw new Error(fence.code);
}

function assertSameOperation(store, request) {
  if (!isObject(store.ACTIVE_OPERATION)) throw new Error("RESOURCE_OWNERSHIP_ACTIVE_OPERATION_REQUIRED");
  if (store.ACTIVE_OPERATION.OPERATION_ID !== request.OPERATION_ID
      || store.ACTIVE_OPERATION.IDEMPOTENCY_KEY !== request.OPERATION_IDEMPOTENCY_KEY) {
    throw new Error("RESOURCE_OWNERSHIP_SECOND_MUTATION_DENIED");
  }
}

async function applyProofCas(path, request, mutate) {
  if (!isObject(request)) throw new Error("RESOURCE_OWNERSHIP_CAS_REQUEST_REQUIRED");
  const idempotencyKey = requireString(request.IDEMPOTENCY_KEY, "IDEMPOTENCY_KEY_REQUIRED");
  const timestamp = runtimeIso(request.RUNTIME_NOW_MS);
  const fingerprint = requestFingerprint(request);
  const lock = await acquireLockPath(`${path}.lock`, "RESOURCE_OWNERSHIP_STATE_LOCKED");
  try {
    const current = await readDurableResourceOwnershipProofV1(path);
    const prior = current.IDEMPOTENCY_INDEX[idempotencyKey];
    if (prior) {
      if (prior.REQUEST_SHA256 !== fingerprint) throw new Error("RESOURCE_OWNERSHIP_IDEMPOTENCY_KEY_CONFLICT");
      return { ok: true, replay: true, proof: clone(current) };
    }
    if (request.EXPECTED_STATE_VERSION !== current.STATE_VERSION) throw new Error("RESOURCE_OWNERSHIP_STATE_CAS_MISMATCH");
    const next = clone(current);
    mutate(next, current);
    next.STATE_VERSION = current.STATE_VERSION + 1;
    next.UPDATED_AT = timestamp;
    const sequence = current.LAST_EVENT_SEQUENCE + 1;
    const event = buildEvent(
      current.EVENT_LEDGER.at(-1).EVENT_SHA256,
      sequence,
      requireString(request.EVENT_TYPE, "RESOURCE_OWNERSHIP_EVENT_TYPE_REQUIRED"),
      idempotencyKey,
      next.STATE_VERSION,
      timestamp,
      request.EVENT_PAYLOAD ?? {}
    );
    next.EVENT_LEDGER.push(event);
    next.LAST_EVENT_SEQUENCE = sequence;
    next.IDEMPOTENCY_INDEX[idempotencyKey] = {
      REQUEST_SHA256: fingerprint,
      EVENT_SEQUENCE: sequence,
      STATE_VERSION: next.STATE_VERSION
    };
    validateStore(next);
    await atomicWriteJson(path, next);
    return { ok: true, replay: false, proof: clone(next) };
  } finally {
    await releaseLock(lock);
  }
}

export async function readDurableResourceOwnershipProofV1(path) {
  return validateStore(JSON.parse(await readFile(path, "utf8")));
}

export async function initializeDurableResourceOwnershipProofV1(path, executionStatePath, initial, runtimeNowMs) {
  assertA5Policy();
  if (!isObject(initial)) throw new Error("RESOURCE_OWNERSHIP_INITIAL_STATE_REQUIRED");
  const executionLock = await acquireLockPath(`${executionStatePath}.lock`, "EXECUTION_STATE_LOCKED_FOR_RESOURCE_OWNERSHIP");
  try {
    const executionState = await readDurableExecutionStateV1(executionStatePath);
    if (executionState.EXECUTION_ID !== initial.EXECUTION_ID) throw new Error("RESOURCE_OWNERSHIP_EXECUTION_ID_MISMATCH");
    const timestamp = runtimeIso(runtimeNowMs);
    const proofId = requireString(initial.PROOF_ID, "RESOURCE_OWNERSHIP_PROOF_ID_REQUIRED");
    const proof = {
      STORE_SCHEMA_ID: RESOURCE_OWNERSHIP_SCHEMA_ID,
      STORE_SCHEMA_VERSION: RESOURCE_OWNERSHIP_SCHEMA_VERSION,
      EVENT_SCHEMA_VERSION: RESOURCE_OWNERSHIP_EVENT_SCHEMA_VERSION,
      PROOF_ID: proofId,
      EXECUTION_ID: executionState.EXECUTION_ID,
      EXECUTION_EPOCH: executionState.EXECUTION_EPOCH,
      ATTEMPT_ID: executionState.ATTEMPT_ID,
      LEASE_GENERATION: executionState.LEASE_GENERATION,
      FENCE_TOKEN: executionState.FENCE_TOKEN,
      WORKER_JOB_SHA256: requireSha256(initial.WORKER_JOB_SHA256, "WORKER_JOB_SHA256_INVALID"),
      RESOURCE_FINGERPRINT_SHA256: requireSha256(initial.RESOURCE_FINGERPRINT_SHA256, "RESOURCE_FINGERPRINT_SHA256_INVALID"),
      CREATION_RECEIPT_SHA256: requireSha256(initial.CREATION_RECEIPT_SHA256, "CREATION_RECEIPT_SHA256_INVALID"),
      OWNERSHIP_ASSERTION_SHA256: requireSha256(initial.OWNERSHIP_ASSERTION_SHA256, "OWNERSHIP_ASSERTION_SHA256_INVALID"),
      PROOF_STATUS: "AVAILABLE",
      ACTIVE_OPERATION: null,
      FAILURE: null,
      STATE_VERSION: 0,
      LAST_EVENT_SEQUENCE: 1,
      CREATED_AT: timestamp,
      UPDATED_AT: timestamp,
      IDEMPOTENCY_INDEX: {},
      EVENT_LEDGER: []
    };
    proof.EVENT_LEDGER.push(buildEvent(
      "0".repeat(64),
      1,
      "RESOURCE_OWNERSHIP_PROOF_REGISTERED",
      `init:${proofId}`,
      0,
      timestamp,
      {
        EXECUTION_ID: proof.EXECUTION_ID,
        EXECUTION_EPOCH: proof.EXECUTION_EPOCH,
        ATTEMPT_ID: proof.ATTEMPT_ID,
        LEASE_GENERATION: proof.LEASE_GENERATION,
        FENCE_TOKEN: proof.FENCE_TOKEN,
        WORKER_JOB_SHA256: proof.WORKER_JOB_SHA256,
        RESOURCE_FINGERPRINT_SHA256: proof.RESOURCE_FINGERPRINT_SHA256,
        CREATION_RECEIPT_SHA256: proof.CREATION_RECEIPT_SHA256,
        OWNERSHIP_ASSERTION_SHA256: proof.OWNERSHIP_ASSERTION_SHA256
      }
    ));
    validateStore(proof);
    const proofLock = await acquireLockPath(`${path}.lock`, "RESOURCE_OWNERSHIP_STATE_LOCKED");
    try {
      try {
        await readFile(path, "utf8");
        throw new Error("RESOURCE_OWNERSHIP_PROOF_ALREADY_EXISTS");
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      await atomicWriteJson(path, proof);
    } finally {
      await releaseLock(proofLock);
    }
    return clone(proof);
  } finally {
    await releaseLock(executionLock);
  }
}

export async function beginDestructiveResourceActionV1(path, executionStatePath, request) {
  assertA5Policy();
  if (!isObject(request)) throw new Error("DESTRUCTIVE_RESOURCE_ACTION_REQUEST_REQUIRED");
  const executionLock = await acquireLockPath(`${executionStatePath}.lock`, "EXECUTION_STATE_LOCKED_FOR_RESOURCE_OWNERSHIP");
  try {
    const executionState = await readDurableExecutionStateV1(executionStatePath);
    const current = await readDurableResourceOwnershipProofV1(path);
    assertExecutionBinding(executionState, current, requireString(request.SUBMITTED_FENCE_TOKEN, "SUBMITTED_FENCE_TOKEN_REQUIRED"));
    return applyProofCas(path, {
      ...request,
      EVENT_TYPE: "DESTRUCTIVE_RESOURCE_ACTION_CLAIMED",
      EVENT_PAYLOAD: {
        OPERATION_ID: request.OPERATION_ID,
        OPERATION_IDEMPOTENCY_KEY: request.OPERATION_IDEMPOTENCY_KEY,
        RESOURCE_FINGERPRINT_SHA256: current.RESOURCE_FINGERPRINT_SHA256,
        FENCE_TOKEN: current.FENCE_TOKEN
      }
    }, (next, proof) => {
      if (proof.PROOF_STATUS === "RECONCILIATION_REQUIRED") throw new Error("RESOURCE_OWNERSHIP_RECONCILIATION_REQUIRED");
      if (proof.PROOF_STATUS !== "AVAILABLE") throw new Error("RESOURCE_OWNERSHIP_PROOF_NOT_AVAILABLE");
      next.PROOF_STATUS = "IN_USE";
      next.ACTIVE_OPERATION = {
        OPERATION_ID: requireString(request.OPERATION_ID, "OPERATION_ID_REQUIRED"),
        IDEMPOTENCY_KEY: requireString(request.OPERATION_IDEMPOTENCY_KEY, "OPERATION_IDEMPOTENCY_REQUIRED"),
        RESULT: "IN_PROGRESS",
        CLAIMED_FENCE_TOKEN: proof.FENCE_TOKEN,
        STARTED_AT: runtimeIso(request.RUNTIME_NOW_MS)
      };
    });
  } finally {
    await releaseLock(executionLock);
  }
}

export async function recordDestructiveResourceActionResultV1(path, request) {
  return applyProofCas(path, {
    ...request,
    EVENT_TYPE: request?.RESULT === "OUTCOME_UNKNOWN"
      ? "DESTRUCTIVE_RESOURCE_ACTION_OUTCOME_UNKNOWN"
      : "DESTRUCTIVE_RESOURCE_ACTION_RESULT",
    EVENT_PAYLOAD: {
      OPERATION_ID: request?.OPERATION_ID,
      OPERATION_IDEMPOTENCY_KEY: request?.OPERATION_IDEMPOTENCY_KEY,
      RESULT: request?.RESULT,
      EVIDENCE_SHA256: request?.EVIDENCE_SHA256
    }
  }, (next, current) => {
    if (current.PROOF_STATUS === "RECONCILIATION_REQUIRED") throw new Error("RESOURCE_OWNERSHIP_RECONCILIATION_REQUIRED");
    if (current.PROOF_STATUS !== "IN_USE") throw new Error("RESOURCE_OWNERSHIP_OPERATION_NOT_IN_USE");
    assertSameOperation(current, request);
    if (request.EVIDENCE_SHA256 !== undefined) requireSha256(request.EVIDENCE_SHA256, "DESTRUCTIVE_ACTION_EVIDENCE_SHA256_INVALID");
    if (request.RESULT === "PASS") {
      next.PROOF_STATUS = "CONSUMED";
      next.ACTIVE_OPERATION = null;
      return;
    }
    if (request.RESULT === "OUTCOME_UNKNOWN") {
      next.PROOF_STATUS = "RECONCILIATION_REQUIRED";
      next.ACTIVE_OPERATION.RESULT = "OUTCOME_UNKNOWN";
      return;
    }
    if (request.RESULT === "FAIL" || request.RESULT === "BLOCKED") {
      next.PROOF_STATUS = "FAILED";
      next.ACTIVE_OPERATION.RESULT = request.RESULT;
      next.FAILURE = { RESULT: request.RESULT, REASON: request.REASON ?? request.RESULT };
      return;
    }
    throw new Error("DESTRUCTIVE_ACTION_RESULT_INVALID");
  });
}

export async function reconcileDestructiveResourceActionV1(path, request) {
  return applyProofCas(path, {
    ...request,
    EVENT_TYPE: "DESTRUCTIVE_RESOURCE_ACTION_RECONCILED",
    EVENT_PAYLOAD: {
      OPERATION_ID: request?.OPERATION_ID,
      OPERATION_IDEMPOTENCY_KEY: request?.OPERATION_IDEMPOTENCY_KEY,
      RECONCILED_RESULT: request?.RECONCILED_RESULT,
      EVIDENCE_SHA256: request?.EVIDENCE_SHA256
    }
  }, (next, current) => {
    if (current.PROOF_STATUS !== "RECONCILIATION_REQUIRED") throw new Error("RESOURCE_OWNERSHIP_OUTCOME_UNKNOWN_NOT_ACTIVE");
    assertSameOperation(current, request);
    if (request.EVIDENCE_SHA256 !== undefined) requireSha256(request.EVIDENCE_SHA256, "DESTRUCTIVE_ACTION_EVIDENCE_SHA256_INVALID");
    if (request.RECONCILED_RESULT === "PASS") {
      next.PROOF_STATUS = "CONSUMED";
      next.ACTIVE_OPERATION = null;
      return;
    }
    if (request.RECONCILED_RESULT === "OUTCOME_UNKNOWN") {
      next.PROOF_STATUS = "RECONCILIATION_REQUIRED";
      next.ACTIVE_OPERATION.RESULT = "OUTCOME_UNKNOWN";
      return;
    }
    if (request.RECONCILED_RESULT === "FAIL" || request.RECONCILED_RESULT === "BLOCKED") {
      next.PROOF_STATUS = "FAILED";
      next.ACTIVE_OPERATION.RESULT = request.RECONCILED_RESULT;
      next.FAILURE = { RESULT: request.RECONCILED_RESULT, REASON: request.REASON ?? request.RECONCILED_RESULT };
      return;
    }
    throw new Error("DESTRUCTIVE_ACTION_RECONCILED_RESULT_INVALID");
  });
}

export function validateDurableResourceOwnershipProofV1(store) {
  try {
    validateStore(store);
    return { ok: true, errors: [] };
  } catch (error) {
    return { ok: false, errors: [error.message] };
  }
}
