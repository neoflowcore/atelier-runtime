import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { validateDurableExecutionStateV1 } from "./durable-execution-state-v1.mjs";

export const ADMISSION_STORE_SCHEMA_ID = "DURABLE_ADMISSION_BUDGET_CANCELLATION_V1";
export const ADMISSION_STORE_SCHEMA_VERSION = "1";
export const ADMISSION_EVENT_SCHEMA_VERSION = "1";
export const RESERVATION_KINDS = Object.freeze(["EXECUTION", "RETRY", "REPAIR"]);
export const RESERVATION_STATES = Object.freeze(["RESERVED", "STARTED", "SUCCEEDED", "FAILED", "CANCELLED"]);
export const CANCELLATION_STATES = Object.freeze(["NONE", "REQUESTED", "CANCELLED"]);

const SHA256_RE = /^[0-9a-f]{64}$/;
const TERMINAL_RESERVATION_STATES = new Set(["SUCCEEDED", "FAILED", "CANCELLED"]);

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

function requireNonNegativeInt(value, code) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(code);
  return value;
}

function requirePositiveInt(value, code) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(code);
  return value;
}

function canonicalize(value) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("ADMISSION_NON_SAFE_INTEGER");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  }
  throw new Error("ADMISSION_UNSUPPORTED_CANONICAL_TYPE");
}

function hashObject(value) {
  return createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
}

function runtimeIso(runtimeNowMs) {
  if (!Number.isSafeInteger(runtimeNowMs)) throw new Error("RUNTIME_AUTHORITATIVE_TIME_REQUIRED");
  return new Date(runtimeNowMs).toISOString();
}

function validateEconomyBudget(value) {
  if (!isObject(value)) throw new Error("ECONOMY_BUDGET_REQUIRED");
  const keys = ["MAX_EXECUTIONS", "MAX_RETRIES", "MAX_REPAIRS", "MAX_PARALLELISM"];
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(keys.sort())) throw new Error("ECONOMY_BUDGET_FIELDS_MISMATCH");
  requireNonNegativeInt(value.MAX_EXECUTIONS, "MAX_EXECUTIONS_INVALID");
  requireNonNegativeInt(value.MAX_RETRIES, "MAX_RETRIES_INVALID");
  requireNonNegativeInt(value.MAX_REPAIRS, "MAX_REPAIRS_INVALID");
  requirePositiveInt(value.MAX_PARALLELISM, "MAX_PARALLELISM_INVALID");
  return value;
}

function validateBudgetIntent(value) {
  if (!isObject(value)) throw new Error("BUDGET_INTENT_REQUIRED");
  const keys = ["MAX_RUNTIME_SECONDS", "MAX_COST_MICRO_USD"];
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(keys.sort())) throw new Error("BUDGET_INTENT_FIELDS_MISMATCH");
  for (const key of keys) {
    if (value[key] !== null) requireNonNegativeInt(value[key], `${key}_INVALID`);
  }
  return value;
}

function validateExecutionState(state) {
  if (!isObject(state)) throw new Error("EXECUTION_STATE_REQUIRED");
  const authoritative = validateDurableExecutionStateV1(state);
  if (!authoritative?.ok) throw new Error(`EXECUTION_STATE_VALIDATION_FAILED:${(authoritative?.errors ?? ["UNKNOWN"]).join("|")}`);
  requireString(state.EXECUTION_ID, "EXECUTION_ID_REQUIRED");
  requireString(state.ATTEMPT_ID, "ATTEMPT_ID_REQUIRED");
  requirePositiveInt(state.LEASE_GENERATION, "LEASE_GENERATION_INVALID");
  requirePositiveInt(state.FENCE_SEQUENCE, "FENCE_SEQUENCE_INVALID");
  requireString(state.FENCE_TOKEN, "FENCE_TOKEN_REQUIRED");
  requireNonNegativeInt(state.STATE_VERSION, "STATE_VERSION_INVALID");
  if (state.RECONCILIATION_REQUIRED === true) throw new Error("EXECUTION_RECONCILIATION_REQUIRED");
  return state;
}

function buildEvent(previousHash, sequence, eventType, idempotencyKey, stateVersion, timestamp, payload) {
  const body = {
    EVENT_SCHEMA_VERSION: ADMISSION_EVENT_SCHEMA_VERSION,
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
  if (!Array.isArray(events) || events.length === 0) throw new Error("ADMISSION_EVENT_LEDGER_REQUIRED");
  let previous = "0".repeat(64);
  let sequence = 1;
  for (const event of events) {
    if (!isObject(event)) throw new Error("ADMISSION_EVENT_INVALID");
    if (event.EVENT_SCHEMA_VERSION !== ADMISSION_EVENT_SCHEMA_VERSION) throw new Error("ADMISSION_EVENT_SCHEMA_VERSION_MISMATCH");
    if (event.EVENT_SEQUENCE !== sequence) throw new Error("ADMISSION_EVENT_SEQUENCE_GAP");
    if (event.PREVIOUS_EVENT_SHA256 !== previous) throw new Error("ADMISSION_EVENT_PREVIOUS_HASH_MISMATCH");
    const { EVENT_SHA256, ...body } = event;
    if (!SHA256_RE.test(EVENT_SHA256 ?? "") || hashObject(body) !== EVENT_SHA256) throw new Error("ADMISSION_EVENT_HASH_MISMATCH");
    previous = EVENT_SHA256;
    sequence += 1;
  }
}

function activeReservationCount(store) {
  return Object.values(store.RESERVATIONS).filter((reservation) => !TERMINAL_RESERVATION_STATES.has(reservation.STATE)).length;
}

function validateStore(store) {
  if (!isObject(store)) throw new Error("ADMISSION_STORE_NOT_OBJECT");
  if (store.STORE_SCHEMA_ID !== ADMISSION_STORE_SCHEMA_ID) throw new Error("ADMISSION_STORE_SCHEMA_ID_MISMATCH");
  if (store.STORE_SCHEMA_VERSION !== ADMISSION_STORE_SCHEMA_VERSION) throw new Error("ADMISSION_STORE_SCHEMA_VERSION_MISMATCH");
  requireSha256(store.TASK_CONTRACT_SHA256, "TASK_CONTRACT_SHA256_INVALID");
  requireSha256(store.EXECUTION_INTENT_SHA256, "EXECUTION_INTENT_SHA256_INVALID");
  requireSha256(store.EXECUTION_PLAN_SHA256, "EXECUTION_PLAN_SHA256_INVALID");
  validateEconomyBudget(store.ECONOMY_BUDGET);
  validateBudgetIntent(store.BUDGET_INTENT);
  if (!CANCELLATION_STATES.includes(store.CANCELLATION_STATUS)) throw new Error("CANCELLATION_STATUS_INVALID");
  if (typeof store.ADMISSION_OPEN !== "boolean") throw new Error("ADMISSION_OPEN_INVALID");
  if (store.CANCELLATION_STATUS === "NONE" && store.ADMISSION_OPEN !== true) throw new Error("ADMISSION_OPEN_STATUS_MISMATCH");
  if (store.CANCELLATION_STATUS !== "NONE" && store.ADMISSION_OPEN !== false) throw new Error("CANCELLED_ADMISSION_MUST_BE_CLOSED");
  if (store.CANCELLATION_STATUS === "NONE" && store.CANCELLATION_FENCE_TOKEN !== null) throw new Error("CANCELLATION_FENCE_UNEXPECTED");
  if (store.CANCELLATION_STATUS !== "NONE") requireString(store.CANCELLATION_FENCE_TOKEN, "CANCELLATION_FENCE_TOKEN_REQUIRED");
  requireNonNegativeInt(store.STATE_VERSION, "ADMISSION_STATE_VERSION_INVALID");
  requireNonNegativeInt(store.LAST_EVENT_SEQUENCE, "ADMISSION_EVENT_SEQUENCE_INVALID");
  requireNonNegativeInt(store.TOTAL_EXECUTIONS_RESERVED, "TOTAL_EXECUTIONS_RESERVED_INVALID");
  requireNonNegativeInt(store.TOTAL_RETRIES_RESERVED, "TOTAL_RETRIES_RESERVED_INVALID");
  requireNonNegativeInt(store.TOTAL_REPAIRS_RESERVED, "TOTAL_REPAIRS_RESERVED_INVALID");
  requireNonNegativeInt(store.TOTAL_RUNTIME_SECONDS_RESERVED, "TOTAL_RUNTIME_SECONDS_RESERVED_INVALID");
  requireNonNegativeInt(store.TOTAL_COST_MICRO_USD_RESERVED, "TOTAL_COST_MICRO_USD_RESERVED_INVALID");
  if (!isObject(store.RESERVATIONS)) throw new Error("RESERVATIONS_REQUIRED");
  if (!isObject(store.IDEMPOTENCY_INDEX)) throw new Error("IDEMPOTENCY_INDEX_REQUIRED");
  for (const [id, reservation] of Object.entries(store.RESERVATIONS)) {
    if (!isObject(reservation) || reservation.RESERVATION_ID !== id) throw new Error("RESERVATION_ID_BINDING_MISMATCH");
    if (!RESERVATION_KINDS.includes(reservation.KIND)) throw new Error("RESERVATION_KIND_INVALID");
    if (!RESERVATION_STATES.includes(reservation.STATE)) throw new Error("RESERVATION_STATE_INVALID");
    requireNonNegativeInt(reservation.RUNTIME_SECONDS, "RESERVATION_RUNTIME_SECONDS_INVALID");
    requireNonNegativeInt(reservation.COST_MICRO_USD, "RESERVATION_COST_MICRO_USD_INVALID");
    requireString(reservation.FENCE_TOKEN, "RESERVATION_FENCE_TOKEN_REQUIRED");
    requireNonNegativeInt(reservation.SOURCE_EXECUTION_STATE_VERSION, "RESERVATION_SOURCE_STATE_VERSION_INVALID");
  }
  if (activeReservationCount(store) > store.ECONOMY_BUDGET.MAX_PARALLELISM) throw new Error("MAX_PARALLELISM_OVERSUBSCRIBED");
  if (store.CANCELLATION_STATUS === "CANCELLED" && activeReservationCount(store) !== 0) throw new Error("CANCELLED_WITH_ACTIVE_RESERVATIONS");
  validateEventLedger(store.EVENT_LEDGER);
  if (store.EVENT_LEDGER.length !== store.LAST_EVENT_SEQUENCE) throw new Error("ADMISSION_LAST_EVENT_SEQUENCE_MISMATCH");
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

async function acquireLock(path, code) {
  try {
    const handle = await open(path, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify({ pid: process.pid })}\n`, "utf8");
    await handle.sync();
    return { path, handle };
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error(code);
    throw error;
  }
}

async function releaseLock(lock) {
  try { await lock.handle.close(); } finally { await unlink(lock.path).catch(() => {}); }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function requestFingerprint(request) {
  const copy = clone(request);
  delete copy.RUNTIME_NOW_MS;
  return hashObject(copy);
}

function assertCurrentExecutionBinding(state, request) {
  if (request.EXPECTED_EXECUTION_STATE_VERSION !== state.STATE_VERSION) throw new Error("EXECUTION_STATE_CAS_MISMATCH");
  if (request.SUBMITTED_FENCE_TOKEN !== state.FENCE_TOKEN) throw new Error("STALE_FENCE_REJECTED");
  if (request.EXECUTION_ID !== state.EXECUTION_ID) throw new Error("EXECUTION_ID_BINDING_MISMATCH");
}

async function applyAdmissionCas(admissionPath, executionStatePath, request, mutate) {
  if (!isObject(request)) throw new Error("ADMISSION_REQUEST_REQUIRED");
  const idempotencyKey = requireString(request.IDEMPOTENCY_KEY, "IDEMPOTENCY_KEY_REQUIRED");
  const timestamp = runtimeIso(request.RUNTIME_NOW_MS);
  const fingerprint = requestFingerprint(request);
  const stateLock = await acquireLock(`${executionStatePath}.lock`, "EXECUTION_STATE_LOCKED");
  let admissionLock;
  try {
    admissionLock = await acquireLock(`${admissionPath}.lock`, "ADMISSION_STORE_LOCKED");
    const executionState = validateExecutionState(await readJson(executionStatePath));
    const current = validateStore(await readJson(admissionPath));
    const prior = current.IDEMPOTENCY_INDEX[idempotencyKey];
    if (prior) {
      if (prior.REQUEST_SHA256 !== fingerprint) throw new Error("ADMISSION_IDEMPOTENCY_KEY_CONFLICT");
      return { ok: true, replay: true, store: clone(current) };
    }
    if (request.EXPECTED_ADMISSION_STATE_VERSION !== current.STATE_VERSION) throw new Error("ADMISSION_STATE_CAS_MISMATCH");
    assertCurrentExecutionBinding(executionState, request);
    const next = clone(current);
    mutate(next, current, executionState);
    next.STATE_VERSION = current.STATE_VERSION + 1;
    next.UPDATED_AT = timestamp;
    const sequence = current.LAST_EVENT_SEQUENCE + 1;
    const event = buildEvent(
      current.EVENT_LEDGER.at(-1).EVENT_SHA256,
      sequence,
      requireString(request.EVENT_TYPE, "ADMISSION_EVENT_TYPE_REQUIRED"),
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
    await atomicWriteJson(admissionPath, next);
    return { ok: true, replay: false, store: clone(next) };
  } finally {
    if (admissionLock) await releaseLock(admissionLock);
    await releaseLock(stateLock);
  }
}

export async function readDurableAdmissionBudgetV1(path) {
  return validateStore(await readJson(path));
}

export async function initializeDurableAdmissionBudgetV1(path, initial, runtimeNowMs) {
  if (!isObject(initial)) throw new Error("ADMISSION_INITIAL_STATE_REQUIRED");
  const timestamp = runtimeIso(runtimeNowMs);
  const store = {
    STORE_SCHEMA_ID: ADMISSION_STORE_SCHEMA_ID,
    STORE_SCHEMA_VERSION: ADMISSION_STORE_SCHEMA_VERSION,
    TASK_CONTRACT_SHA256: requireSha256(initial.TASK_CONTRACT_SHA256, "TASK_CONTRACT_SHA256_INVALID"),
    EXECUTION_INTENT_SHA256: requireSha256(initial.EXECUTION_INTENT_SHA256, "EXECUTION_INTENT_SHA256_INVALID"),
    EXECUTION_PLAN_SHA256: requireSha256(initial.EXECUTION_PLAN_SHA256, "EXECUTION_PLAN_SHA256_INVALID"),
    ECONOMY_BUDGET: clone(validateEconomyBudget(initial.ECONOMY_BUDGET)),
    BUDGET_INTENT: clone(validateBudgetIntent(initial.BUDGET_INTENT)),
    ADMISSION_OPEN: true,
    CANCELLATION_STATUS: "NONE",
    CANCELLATION_FENCE_TOKEN: null,
    TOTAL_EXECUTIONS_RESERVED: 0,
    TOTAL_RETRIES_RESERVED: 0,
    TOTAL_REPAIRS_RESERVED: 0,
    TOTAL_RUNTIME_SECONDS_RESERVED: 0,
    TOTAL_COST_MICRO_USD_RESERVED: 0,
    RESERVATIONS: {},
    STATE_VERSION: 0,
    LAST_EVENT_SEQUENCE: 1,
    CREATED_AT: timestamp,
    UPDATED_AT: timestamp,
    IDEMPOTENCY_INDEX: {},
    EVENT_LEDGER: []
  };
  store.EVENT_LEDGER.push(buildEvent(
    "0".repeat(64), 1, "ADMISSION_BUDGET_INITIALIZED", `init:${store.EXECUTION_PLAN_SHA256}`,
    0, timestamp, { EXECUTION_PLAN_SHA256: store.EXECUTION_PLAN_SHA256 }
  ));
  validateStore(store);
  const lock = await acquireLock(`${path}.lock`, "ADMISSION_STORE_LOCKED");
  try {
    try {
      await readFile(path, "utf8");
      throw new Error("ADMISSION_STORE_ALREADY_EXISTS");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await atomicWriteJson(path, store);
  } finally {
    await releaseLock(lock);
  }
  return clone(store);
}

function nextCounterField(kind) {
  if (kind === "EXECUTION") return ["TOTAL_EXECUTIONS_RESERVED", "MAX_EXECUTIONS"];
  if (kind === "RETRY") return ["TOTAL_RETRIES_RESERVED", "MAX_RETRIES"];
  if (kind === "REPAIR") return ["TOTAL_REPAIRS_RESERVED", "MAX_REPAIRS"];
  throw new Error("RESERVATION_KIND_INVALID");
}

export async function reserveAdmissionBudgetV1(admissionPath, executionStatePath, request) {
  const reservationId = requireString(request?.RESERVATION_ID, "RESERVATION_ID_REQUIRED");
  const kind = requireString(request?.KIND, "RESERVATION_KIND_REQUIRED");
  if (!RESERVATION_KINDS.includes(kind)) throw new Error("RESERVATION_KIND_INVALID");
  const runtimeSeconds = requireNonNegativeInt(request?.RUNTIME_SECONDS, "RESERVATION_RUNTIME_SECONDS_INVALID");
  const costMicroUsd = requireNonNegativeInt(request?.COST_MICRO_USD, "RESERVATION_COST_MICRO_USD_INVALID");
  return applyAdmissionCas(admissionPath, executionStatePath, {
    ...request,
    EVENT_TYPE: "ADMISSION_BUDGET_RESERVED",
    EVENT_PAYLOAD: { RESERVATION_ID: reservationId, KIND: kind, RUNTIME_SECONDS: runtimeSeconds, COST_MICRO_USD: costMicroUsd }
  }, (next, current, executionState) => {
    if (!current.ADMISSION_OPEN || current.CANCELLATION_STATUS !== "NONE") throw new Error("ADMISSION_CLOSED_BY_CANCELLATION");
    if (current.RESERVATIONS[reservationId]) throw new Error("RESERVATION_ID_REUSE_DENIED");
    if (activeReservationCount(current) >= current.ECONOMY_BUDGET.MAX_PARALLELISM) throw new Error("MAX_PARALLELISM_EXHAUSTED");
    const [counterField, limitField] = nextCounterField(kind);
    if (current[counterField] >= current.ECONOMY_BUDGET[limitField]) throw new Error(`${limitField}_EXHAUSTED`);
    if (current.BUDGET_INTENT.MAX_RUNTIME_SECONDS !== null && current.TOTAL_RUNTIME_SECONDS_RESERVED + runtimeSeconds > current.BUDGET_INTENT.MAX_RUNTIME_SECONDS) {
      throw new Error("MAX_RUNTIME_SECONDS_EXHAUSTED");
    }
    if (current.BUDGET_INTENT.MAX_COST_MICRO_USD !== null && current.TOTAL_COST_MICRO_USD_RESERVED + costMicroUsd > current.BUDGET_INTENT.MAX_COST_MICRO_USD) {
      throw new Error("MAX_COST_MICRO_USD_EXHAUSTED");
    }
    next[counterField] += 1;
    next.TOTAL_RUNTIME_SECONDS_RESERVED += runtimeSeconds;
    next.TOTAL_COST_MICRO_USD_RESERVED += costMicroUsd;
    next.RESERVATIONS[reservationId] = {
      RESERVATION_ID: reservationId,
      KIND: kind,
      STATE: "RESERVED",
      RUNTIME_SECONDS: runtimeSeconds,
      COST_MICRO_USD: costMicroUsd,
      FENCE_TOKEN: executionState.FENCE_TOKEN,
      SOURCE_EXECUTION_STATE_VERSION: executionState.STATE_VERSION,
      ATTEMPT_ID: executionState.ATTEMPT_ID,
      LEASE_GENERATION: executionState.LEASE_GENERATION,
      CREATED_AT: runtimeIso(request.RUNTIME_NOW_MS),
      STARTED_AT: null,
      SETTLED_AT: null
    };
  });
}

export async function startReservedAdmissionV1(admissionPath, executionStatePath, request) {
  const reservationId = requireString(request?.RESERVATION_ID, "RESERVATION_ID_REQUIRED");
  return applyAdmissionCas(admissionPath, executionStatePath, {
    ...request,
    EVENT_TYPE: "ADMISSION_RESERVATION_STARTED",
    EVENT_PAYLOAD: { RESERVATION_ID: reservationId }
  }, (next, current) => {
    if (!current.ADMISSION_OPEN || current.CANCELLATION_STATUS !== "NONE") throw new Error("START_DENIED_BY_CANCELLATION");
    const reservation = current.RESERVATIONS[reservationId];
    if (!reservation) throw new Error("RESERVATION_NOT_FOUND");
    if (reservation.STATE !== "RESERVED") throw new Error("RESERVATION_NOT_STARTABLE");
    next.RESERVATIONS[reservationId].STATE = "STARTED";
    next.RESERVATIONS[reservationId].STARTED_AT = runtimeIso(request.RUNTIME_NOW_MS);
  });
}

export async function settleAdmissionReservationV1(admissionPath, executionStatePath, request) {
  const reservationId = requireString(request?.RESERVATION_ID, "RESERVATION_ID_REQUIRED");
  const terminalState = requireString(request?.TERMINAL_STATE, "TERMINAL_STATE_REQUIRED");
  if (!TERMINAL_RESERVATION_STATES.has(terminalState)) throw new Error("TERMINAL_STATE_INVALID");
  return applyAdmissionCas(admissionPath, executionStatePath, {
    ...request,
    EVENT_TYPE: "ADMISSION_RESERVATION_SETTLED",
    EVENT_PAYLOAD: { RESERVATION_ID: reservationId, TERMINAL_STATE: terminalState }
  }, (next, current) => {
    const reservation = current.RESERVATIONS[reservationId];
    if (!reservation) throw new Error("RESERVATION_NOT_FOUND");
    if (TERMINAL_RESERVATION_STATES.has(reservation.STATE)) throw new Error("RESERVATION_ALREADY_TERMINAL");
    next.RESERVATIONS[reservationId].STATE = terminalState;
    next.RESERVATIONS[reservationId].SETTLED_AT = runtimeIso(request.RUNTIME_NOW_MS);
    if (current.CANCELLATION_STATUS === "REQUESTED" && activeReservationCount(next) === 0) {
      next.CANCELLATION_STATUS = "CANCELLED";
    }
  });
}

export async function requestExecutionCancellationV1(admissionPath, executionStatePath, request) {
  return applyAdmissionCas(admissionPath, executionStatePath, {
    ...request,
    EVENT_TYPE: "EXECUTION_CANCELLATION_REQUESTED",
    EVENT_PAYLOAD: { REASON: request?.REASON ?? "REQUESTED" }
  }, (next, current, executionState) => {
    if (current.CANCELLATION_STATUS !== "NONE") throw new Error("CANCELLATION_ALREADY_REQUESTED");
    next.ADMISSION_OPEN = false;
    next.CANCELLATION_FENCE_TOKEN = executionState.FENCE_TOKEN;
    next.CANCELLATION_STATUS = activeReservationCount(current) === 0 ? "CANCELLED" : "REQUESTED";
  });
}

export function validateReservationForExecutionV1(store, reservationId, submittedFenceToken) {
  try { validateStore(clone(store)); } catch (error) { return { ok: false, code: error.message }; }
  if (store.CANCELLATION_STATUS !== "NONE" || !store.ADMISSION_OPEN) return { ok: false, code: "EXECUTION_ADMISSION_CANCELLED" };
  const reservation = store.RESERVATIONS[reservationId];
  if (!reservation) return { ok: false, code: "RESERVATION_NOT_FOUND" };
  if (!new Set(["RESERVED", "STARTED"]).has(reservation.STATE)) return { ok: false, code: "RESERVATION_NOT_ACTIVE" };
  if (reservation.FENCE_TOKEN !== submittedFenceToken) return { ok: false, code: "RESERVATION_FENCE_MISMATCH" };
  return { ok: true, code: "EXECUTION_ADMISSION_VALID" };
}

export function deriveAdmissionBudgetProjectionV1(store) {
  const value = validateStore(clone(store));
  return Object.freeze({
    ADMISSION_OPEN: value.ADMISSION_OPEN,
    CANCELLATION_STATUS: value.CANCELLATION_STATUS,
    ACTIVE_RESERVATION_COUNT: activeReservationCount(value),
    TOTAL_EXECUTIONS_RESERVED: value.TOTAL_EXECUTIONS_RESERVED,
    TOTAL_RETRIES_RESERVED: value.TOTAL_RETRIES_RESERVED,
    TOTAL_REPAIRS_RESERVED: value.TOTAL_REPAIRS_RESERVED,
    TOTAL_RUNTIME_SECONDS_RESERVED: value.TOTAL_RUNTIME_SECONDS_RESERVED,
    TOTAL_COST_MICRO_USD_RESERVED: value.TOTAL_COST_MICRO_USD_RESERVED
  });
}

export function validateDurableAdmissionBudgetV1(store) {
  try {
    validateStore(clone(store));
    return { ok: true, errors: [] };
  } catch (error) {
    return { ok: false, errors: [error.message] };
  }
}
