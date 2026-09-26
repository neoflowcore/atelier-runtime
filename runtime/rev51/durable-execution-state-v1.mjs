import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";

export const DURABLE_EXECUTION_STATE_SCHEMA_ID = "DURABLE_EXECUTION_STATE_V1";
export const DURABLE_EXECUTION_STATE_SCHEMA_VERSION = "1";
export const EXECUTION_EVENT_SCHEMA_VERSION = "1";
export const EXECUTION_EVENT_HASH_ALGORITHM = "SHA256";

export const PROVIDER_OPERATION_STATES = Object.freeze([
  "PENDING",
  "SUCCEEDED",
  "FAILED",
  "OUTCOME_UNKNOWN"
]);

const SHA256_RE = /^[0-9a-f]{64}$/;

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function requireString(value, code) {
  if (typeof value !== "string" || value.length === 0) throw new Error(code);
  return value;
}

function requireSafeNonNegativeInteger(value, code) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(code);
  return value;
}

function requireSafePositiveInteger(value, code) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(code);
  return value;
}

function isoFromRuntimeTime(runtimeNowMs) {
  if (!Number.isSafeInteger(runtimeNowMs)) throw new Error("RUNTIME_AUTHORITATIVE_TIME_REQUIRED");
  return new Date(runtimeNowMs).toISOString();
}

function canonicalize(value) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("DURABLE_STATE_NON_SAFE_INTEGER");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  }
  throw new Error("DURABLE_STATE_UNSUPPORTED_CANONICAL_TYPE");
}

function hashObject(value) {
  return createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildEvent(previousHash, sequence, eventType, idempotencyKey, stateVersion, timestamp, payload) {
  const body = {
    EVENT_SCHEMA_VERSION: EXECUTION_EVENT_SCHEMA_VERSION,
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

function validateEventChain(events) {
  if (!Array.isArray(events) || events.length === 0) throw new Error("EVENT_LEDGER_REQUIRED");
  let previousHash = "0".repeat(64);
  let expectedSequence = 1;
  for (const event of events) {
    if (!isObject(event)) throw new Error("EVENT_LEDGER_ENTRY_INVALID");
    if (event.EVENT_SCHEMA_VERSION !== EXECUTION_EVENT_SCHEMA_VERSION) throw new Error("EVENT_SCHEMA_VERSION_MISMATCH");
    if (event.EVENT_SEQUENCE !== expectedSequence) throw new Error("EVENT_SEQUENCE_GAP");
    if (event.PREVIOUS_EVENT_SHA256 !== previousHash) throw new Error("EVENT_PREVIOUS_HASH_MISMATCH");
    const { EVENT_SHA256, ...body } = event;
    if (!SHA256_RE.test(EVENT_SHA256 ?? "") || hashObject(body) !== EVENT_SHA256) throw new Error("EVENT_HASH_MISMATCH");
    previousHash = EVENT_SHA256;
    expectedSequence += 1;
  }
}

function validateStore(store) {
  if (!isObject(store)) throw new Error("DURABLE_STORE_NOT_OBJECT");
  if (store.STORE_SCHEMA_ID !== DURABLE_EXECUTION_STATE_SCHEMA_ID) throw new Error("DURABLE_STORE_SCHEMA_ID_MISMATCH");
  if (store.STATE_SCHEMA_VERSION !== DURABLE_EXECUTION_STATE_SCHEMA_VERSION) throw new Error("STATE_SCHEMA_VERSION_MISMATCH");
  if (store.EVENT_SCHEMA_VERSION !== EXECUTION_EVENT_SCHEMA_VERSION) throw new Error("EVENT_SCHEMA_VERSION_MISMATCH");
  requireString(store.EXECUTION_ID, "EXECUTION_ID_REQUIRED");
  requireSafePositiveInteger(store.EXECUTION_EPOCH, "EXECUTION_EPOCH_INVALID");
  requireString(store.ATTEMPT_ID, "ATTEMPT_ID_REQUIRED");
  requireSafePositiveInteger(store.LEASE_GENERATION, "LEASE_GENERATION_INVALID");
  requireSafePositiveInteger(store.FENCE_SEQUENCE, "FENCE_SEQUENCE_INVALID");
  requireString(store.FENCE_TOKEN, "FENCE_TOKEN_REQUIRED");
  requireSafeNonNegativeInteger(store.STATE_VERSION, "STATE_VERSION_INVALID");
  requireSafePositiveInteger(store.LAST_EVENT_SEQUENCE, "LAST_EVENT_SEQUENCE_INVALID");
  requireString(store.DESIRED_STATE, "DESIRED_STATE_REQUIRED");
  requireString(store.MATERIALIZED_STATE, "MATERIALIZED_STATE_REQUIRED");
  if (!PROVIDER_OPERATION_STATES.includes(store.PROVIDER_OPERATION_STATE)) throw new Error("PROVIDER_OPERATION_STATE_INVALID");
  if (!isObject(store.IDEMPOTENCY_INDEX)) throw new Error("IDEMPOTENCY_INDEX_REQUIRED");
  if (!Array.isArray(store.USED_FENCE_TOKENS) || !store.USED_FENCE_TOKENS.includes(store.FENCE_TOKEN)) throw new Error("USED_FENCE_TOKENS_INVALID");
  if (new Set(store.USED_FENCE_TOKENS).size !== store.USED_FENCE_TOKENS.length) throw new Error("FENCE_TOKEN_REUSED");
  validateEventChain(store.EVENT_LEDGER);
  if (store.EVENT_LEDGER.length !== store.LAST_EVENT_SEQUENCE) throw new Error("LAST_EVENT_SEQUENCE_MISMATCH");
  if (store.EVENT_LEDGER.at(-1).EVENT_SEQUENCE !== store.LAST_EVENT_SEQUENCE) throw new Error("LAST_EVENT_SEQUENCE_INVALID");
  return store;
}

async function fsyncDirectory(path) {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
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

async function acquireLock(path) {
  const lockPath = `${path}.lock`;
  try {
    const handle = await open(lockPath, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify({ pid: process.pid })}\n`, "utf8");
    await handle.sync();
    return { lockPath, handle };
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error("DURABLE_STATE_LOCKED");
    throw error;
  }
}

async function releaseLock(lock) {
  try {
    await lock.handle.close();
  } finally {
    await unlink(lock.lockPath).catch(() => {});
  }
}

export async function readDurableExecutionStateV1(path) {
  const raw = await readFile(path, "utf8");
  return validateStore(JSON.parse(raw));
}

export async function initializeDurableExecutionStateV1(path, initial, runtimeNowMs) {
  if (!isObject(initial)) throw new Error("INITIAL_STATE_REQUIRED");
  const timestamp = isoFromRuntimeTime(runtimeNowMs);
  const executionId = requireString(initial.EXECUTION_ID, "EXECUTION_ID_REQUIRED");
  const fenceToken = requireString(initial.FENCE_TOKEN, "FENCE_TOKEN_REQUIRED");
  const store = {
    STORE_SCHEMA_ID: DURABLE_EXECUTION_STATE_SCHEMA_ID,
    STATE_SCHEMA_VERSION: DURABLE_EXECUTION_STATE_SCHEMA_VERSION,
    EVENT_SCHEMA_VERSION: EXECUTION_EVENT_SCHEMA_VERSION,
    EXECUTION_ID: executionId,
    EXECUTION_EPOCH: requireSafePositiveInteger(initial.EXECUTION_EPOCH, "EXECUTION_EPOCH_INVALID"),
    ATTEMPT_ID: requireString(initial.ATTEMPT_ID, "ATTEMPT_ID_REQUIRED"),
    LEASE_GENERATION: requireSafePositiveInteger(initial.LEASE_GENERATION, "LEASE_GENERATION_INVALID"),
    FENCE_SEQUENCE: requireSafePositiveInteger(initial.FENCE_SEQUENCE, "FENCE_SEQUENCE_INVALID"),
    FENCE_TOKEN: fenceToken,
    DESIRED_STATE: requireString(initial.DESIRED_STATE, "DESIRED_STATE_REQUIRED"),
    MATERIALIZED_STATE: requireString(initial.MATERIALIZED_STATE, "MATERIALIZED_STATE_REQUIRED"),
    PROVIDER_OPERATION_STATE: initial.PROVIDER_OPERATION_STATE ?? "PENDING",
    RECONCILIATION_REQUIRED: false,
    BLIND_RETRY_ALLOWED: false,
    STATE_VERSION: 0,
    LAST_EVENT_SEQUENCE: 1,
    CREATED_AT: timestamp,
    UPDATED_AT: timestamp,
    USED_FENCE_TOKENS: [fenceToken],
    IDEMPOTENCY_INDEX: {},
    EVENT_LEDGER: []
  };
  if (!PROVIDER_OPERATION_STATES.includes(store.PROVIDER_OPERATION_STATE)) throw new Error("PROVIDER_OPERATION_STATE_INVALID");
  store.EVENT_LEDGER.push(buildEvent(
    "0".repeat(64),
    1,
    "EXECUTION_STATE_INITIALIZED",
    `init:${executionId}`,
    0,
    timestamp,
    {
      EXECUTION_EPOCH: store.EXECUTION_EPOCH,
      ATTEMPT_ID: store.ATTEMPT_ID,
      LEASE_GENERATION: store.LEASE_GENERATION,
      FENCE_SEQUENCE: store.FENCE_SEQUENCE,
      FENCE_TOKEN: store.FENCE_TOKEN
    }
  ));
  validateStore(store);

  const lock = await acquireLock(path);
  try {
    try {
      await readFile(path, "utf8");
      throw new Error("DURABLE_STATE_ALREADY_EXISTS");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await atomicWriteJson(path, store);
  } finally {
    await releaseLock(lock);
  }
  return clone(store);
}

function requestFingerprint(request) {
  const payload = { ...request };
  delete payload.RUNTIME_NOW_MS;
  return hashObject(payload);
}

async function applyCas(path, request, mutate) {
  if (!isObject(request)) throw new Error("CAS_REQUEST_REQUIRED");
  const idempotencyKey = requireString(request.IDEMPOTENCY_KEY, "IDEMPOTENCY_KEY_REQUIRED");
  const timestamp = isoFromRuntimeTime(request.RUNTIME_NOW_MS);
  const fingerprint = requestFingerprint(request);
  const lock = await acquireLock(path);
  try {
    const current = await readDurableExecutionStateV1(path);
    const prior = current.IDEMPOTENCY_INDEX[idempotencyKey];
    if (prior) {
      if (prior.REQUEST_SHA256 !== fingerprint) throw new Error("IDEMPOTENCY_KEY_CONFLICT");
      return { ok: true, replay: true, state: clone(current) };
    }
    if (request.EXPECTED_STATE_VERSION !== current.STATE_VERSION) throw new Error("STATE_CAS_MISMATCH");
    if (request.SUBMITTED_FENCE_TOKEN !== current.FENCE_TOKEN) throw new Error("STALE_FENCE_REJECTED");

    const next = clone(current);
    mutate(next, current);
    next.STATE_VERSION = current.STATE_VERSION + 1;
    next.UPDATED_AT = timestamp;
    const eventSequence = current.LAST_EVENT_SEQUENCE + 1;
    const event = buildEvent(
      current.EVENT_LEDGER.at(-1).EVENT_SHA256,
      eventSequence,
      requireString(request.EVENT_TYPE, "EVENT_TYPE_REQUIRED"),
      idempotencyKey,
      next.STATE_VERSION,
      timestamp,
      request.EVENT_PAYLOAD ?? {}
    );
    next.EVENT_LEDGER.push(event);
    next.LAST_EVENT_SEQUENCE = eventSequence;
    next.IDEMPOTENCY_INDEX[idempotencyKey] = {
      REQUEST_SHA256: fingerprint,
      EVENT_SEQUENCE: eventSequence,
      STATE_VERSION: next.STATE_VERSION
    };
    validateStore(next);
    await atomicWriteJson(path, next);
    return { ok: true, replay: false, state: clone(next) };
  } finally {
    await releaseLock(lock);
  }
}

export async function transitionMaterializedStateV1(path, request) {
  const nextState = requireString(request?.NEXT_MATERIALIZED_STATE, "NEXT_MATERIALIZED_STATE_REQUIRED");
  return applyCas(path, {
    ...request,
    EVENT_TYPE: request.EVENT_TYPE ?? "MATERIALIZED_STATE_TRANSITION",
    EVENT_PAYLOAD: {
      NEXT_MATERIALIZED_STATE: nextState,
      ...(request.EVENT_PAYLOAD ?? {})
    }
  }, (next) => {
    next.MATERIALIZED_STATE = nextState;
  });
}

export async function recordProviderOperationOutcomeV1(path, request) {
  if (!PROVIDER_OPERATION_STATES.includes(request?.PROVIDER_OPERATION_STATE)) throw new Error("PROVIDER_OPERATION_STATE_INVALID");
  return applyCas(path, {
    ...request,
    EVENT_TYPE: request.EVENT_TYPE ?? "PROVIDER_OPERATION_OUTCOME",
    EVENT_PAYLOAD: {
      PROVIDER_OPERATION_STATE: request.PROVIDER_OPERATION_STATE,
      ...(request.EVENT_PAYLOAD ?? {})
    }
  }, (next) => {
    next.PROVIDER_OPERATION_STATE = request.PROVIDER_OPERATION_STATE;
    next.RECONCILIATION_REQUIRED = request.PROVIDER_OPERATION_STATE === "OUTCOME_UNKNOWN";
    next.BLIND_RETRY_ALLOWED = false;
  });
}

export async function advanceExecutionFenceV1(path, request) {
  const nextFenceToken = requireString(request?.NEXT_FENCE_TOKEN, "NEXT_FENCE_TOKEN_REQUIRED");
  const nextFenceSequence = requireSafePositiveInteger(request?.NEXT_FENCE_SEQUENCE, "NEXT_FENCE_SEQUENCE_INVALID");
  const nextAttemptId = request?.NEXT_ATTEMPT_ID === undefined ? null : requireString(request.NEXT_ATTEMPT_ID, "NEXT_ATTEMPT_ID_INVALID");
  const nextLeaseGeneration = request?.NEXT_LEASE_GENERATION === undefined ? null : requireSafePositiveInteger(request.NEXT_LEASE_GENERATION, "NEXT_LEASE_GENERATION_INVALID");
  return applyCas(path, {
    ...request,
    EVENT_TYPE: request.EVENT_TYPE ?? "FENCE_ADVANCED",
    EVENT_PAYLOAD: {
      NEXT_FENCE_SEQUENCE: nextFenceSequence,
      NEXT_FENCE_TOKEN: nextFenceToken,
      NEXT_ATTEMPT_ID: nextAttemptId,
      NEXT_LEASE_GENERATION: nextLeaseGeneration,
      ...(request.EVENT_PAYLOAD ?? {})
    }
  }, (next, current) => {
    if (nextFenceSequence <= current.FENCE_SEQUENCE) throw new Error("FENCE_SEQUENCE_NOT_MONOTONIC");
    if (nextFenceSequence !== current.FENCE_SEQUENCE + 1) throw new Error("FENCE_SEQUENCE_GAP");
    if (current.USED_FENCE_TOKENS.includes(nextFenceToken)) throw new Error("FENCE_TOKEN_REUSE_DENIED");
    next.FENCE_SEQUENCE = nextFenceSequence;
    next.FENCE_TOKEN = nextFenceToken;
    next.USED_FENCE_TOKENS.push(nextFenceToken);
    if (nextAttemptId !== null) next.ATTEMPT_ID = nextAttemptId;
    if (nextLeaseGeneration !== null) {
      if (nextLeaseGeneration <= current.LEASE_GENERATION) throw new Error("LEASE_GENERATION_NOT_MONOTONIC");
      next.LEASE_GENERATION = nextLeaseGeneration;
    }
  });
}

export function validateAuthoritativeFenceV1(store, submittedFenceToken) {
  validateStore(store);
  return submittedFenceToken === store.FENCE_TOKEN
    ? { ok: true, code: "CURRENT_FENCE" }
    : { ok: false, code: "STALE_FENCE_REJECTED" };
}

export function validateDurableExecutionStateV1(store) {
  try {
    validateStore(store);
    return { ok: true, errors: [] };
  } catch (error) {
    return { ok: false, errors: [error.message] };
  }
}
