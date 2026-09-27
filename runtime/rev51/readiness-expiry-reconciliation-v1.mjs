import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";

export const READINESS_STATE_SCHEMA_ID = "DURABLE_WORKER_READINESS_V1";
export const READINESS_STATE_SCHEMA_VERSION = "1";
export const READINESS_EVENT_SCHEMA_VERSION = "1";
export const READINESS_STATUSES = Object.freeze(["READY", "EXPIRED"]);

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

function requireSafeNonNegativeInteger(value, code) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(code);
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
    if (!Number.isSafeInteger(value)) throw new Error("READINESS_NON_SAFE_INTEGER");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  }
  throw new Error("READINESS_UNSUPPORTED_CANONICAL_TYPE");
}

function hashObject(value) {
  return createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
}

export function computeWorkerReadyAttestationHashV1(attestation) {
  return hashObject(attestation);
}

export function validateWorkerReadyAttestationForReadinessV1(attestation, runtimeNowMs) {
  const errors = [];
  if (!isObject(attestation)) return { ok: false, errors: ["READY_ATTESTATION_NOT_OBJECT"] };
  if (attestation.ATTESTATION_STATE !== "READY") errors.push("READY_ATTESTATION_STATE_INVALID");
  if (typeof attestation.ATTESTATION_ID !== "string" || !attestation.ATTESTATION_ID) errors.push("ATTESTATION_ID_MISSING");
  if (typeof attestation.WORKER_ID !== "string" || !attestation.WORKER_ID) errors.push("WORKER_ID_MISSING");
  if (!SHA256_RE.test(attestation.EXECUTION_PLAN_HASH ?? "")) errors.push("EXECUTION_PLAN_HASH_INVALID");
  const issuedAtMs = Date.parse(attestation.ISSUED_AT ?? "");
  const expiresAtMs = Date.parse(attestation.EXPIRES_AT ?? "");
  if (!Number.isFinite(issuedAtMs)) errors.push("READY_ATTESTATION_ISSUED_AT_INVALID");
  if (!Number.isFinite(expiresAtMs)) errors.push("READY_ATTESTATION_EXPIRES_AT_INVALID");
  if (Number.isFinite(issuedAtMs) && Number.isFinite(expiresAtMs) && expiresAtMs <= issuedAtMs) {
    errors.push("READY_ATTESTATION_EXPIRY_ORDER_INVALID");
  }
  if (!Number.isSafeInteger(runtimeNowMs)) errors.push("RUNTIME_NOW_INVALID");
  if (Number.isFinite(expiresAtMs) && Number.isSafeInteger(runtimeNowMs) && expiresAtMs <= runtimeNowMs) {
    errors.push("READY_ATTESTATION_EXPIRED");
  }
  return { ok: errors.length === 0, errors };
}

function buildEvent(previousHash, sequence, eventType, idempotencyKey, stateVersion, timestamp, payload) {
  const body = {
    EVENT_SCHEMA_VERSION: READINESS_EVENT_SCHEMA_VERSION,
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
  if (!Array.isArray(events) || events.length === 0) throw new Error("READINESS_EVENT_LEDGER_REQUIRED");
  let previousHash = "0".repeat(64);
  let sequence = 1;
  for (const event of events) {
    if (!isObject(event)) throw new Error("READINESS_EVENT_INVALID");
    if (event.EVENT_SCHEMA_VERSION !== READINESS_EVENT_SCHEMA_VERSION) throw new Error("READINESS_EVENT_SCHEMA_VERSION_MISMATCH");
    if (event.EVENT_SEQUENCE !== sequence) throw new Error("READINESS_EVENT_SEQUENCE_GAP");
    if (event.PREVIOUS_EVENT_SHA256 !== previousHash) throw new Error("READINESS_EVENT_PREVIOUS_HASH_MISMATCH");
    const { EVENT_SHA256, ...body } = event;
    if (!SHA256_RE.test(EVENT_SHA256 ?? "") || hashObject(body) !== EVENT_SHA256) throw new Error("READINESS_EVENT_HASH_MISMATCH");
    previousHash = EVENT_SHA256;
    sequence += 1;
  }
}

function validateStore(store) {
  if (!isObject(store)) throw new Error("READINESS_STORE_NOT_OBJECT");
  if (store.STORE_SCHEMA_ID !== READINESS_STATE_SCHEMA_ID) throw new Error("READINESS_STORE_SCHEMA_ID_MISMATCH");
  if (store.STATE_SCHEMA_VERSION !== READINESS_STATE_SCHEMA_VERSION) throw new Error("READINESS_STATE_SCHEMA_VERSION_MISMATCH");
  if (store.EVENT_SCHEMA_VERSION !== READINESS_EVENT_SCHEMA_VERSION) throw new Error("READINESS_EVENT_SCHEMA_VERSION_MISMATCH");
  requireString(store.EXECUTION_ID, "EXECUTION_ID_REQUIRED");
  requireString(store.WORKER_ID, "WORKER_ID_REQUIRED");
  requireSha256(store.EXECUTION_PLAN_HASH, "EXECUTION_PLAN_HASH_INVALID");
  requireString(store.ATTESTATION_ID, "ATTESTATION_ID_REQUIRED");
  requireSha256(store.ATTESTATION_HASH, "ATTESTATION_HASH_INVALID");
  if (!READINESS_STATUSES.includes(store.READINESS_STATUS)) throw new Error("READINESS_STATUS_INVALID");
  if (typeof store.REATTESTATION_REQUIRED !== "boolean") throw new Error("REATTESTATION_REQUIRED_INVALID");
  if (typeof store.EXECUTION_GATE_OPEN !== "boolean") throw new Error("EXECUTION_GATE_OPEN_INVALID");
  if (store.READINESS_STATUS === "READY" && (store.REATTESTATION_REQUIRED || !store.EXECUTION_GATE_OPEN)) throw new Error("READY_STATUS_GATE_MISMATCH");
  if (store.READINESS_STATUS === "EXPIRED" && (!store.REATTESTATION_REQUIRED || store.EXECUTION_GATE_OPEN)) throw new Error("EXPIRED_STATUS_GATE_MISMATCH");
  if (typeof store.ISSUED_AT !== "string" || Number.isNaN(Date.parse(store.ISSUED_AT))) throw new Error("ISSUED_AT_INVALID");
  if (typeof store.EXPIRES_AT !== "string" || Number.isNaN(Date.parse(store.EXPIRES_AT))) throw new Error("EXPIRES_AT_INVALID");
  if (Date.parse(store.EXPIRES_AT) <= Date.parse(store.ISSUED_AT)) throw new Error("EXPIRY_ORDER_INVALID");
  requireSafeNonNegativeInteger(store.STATE_VERSION, "READINESS_STATE_VERSION_INVALID");
  requireSafeNonNegativeInteger(store.REPLACEMENT_COUNT, "READINESS_REPLACEMENT_COUNT_INVALID");
  if (!isObject(store.IDEMPOTENCY_INDEX)) throw new Error("READINESS_IDEMPOTENCY_INDEX_REQUIRED");
  validateEventLedger(store.EVENT_LEDGER);
  if (store.EVENT_LEDGER.length !== store.LAST_EVENT_SEQUENCE) throw new Error("READINESS_LAST_EVENT_SEQUENCE_MISMATCH");
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

async function acquireLock(path) {
  const lockPath = `${path}.lock`;
  try {
    const handle = await open(lockPath, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify({ pid: process.pid })}\n`, "utf8");
    await handle.sync();
    return { lockPath, handle };
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error("READINESS_STATE_LOCKED");
    throw error;
  }
}

async function releaseLock(lock) {
  try { await lock.handle.close(); } finally { await unlink(lock.lockPath).catch(() => {}); }
}

export async function readDurableWorkerReadinessV1(path) {
  return validateStore(JSON.parse(await readFile(path, "utf8")));
}

export async function initializeDurableWorkerReadinessV1(path, initial, runtimeNowMs) {
  if (!isObject(initial)) throw new Error("READINESS_INITIAL_STATE_REQUIRED");
  const attestation = clone(initial.WORKER_READY_ATTESTATION);
  const attestationResult = validateWorkerReadyAttestationForReadinessV1(attestation, runtimeNowMs);
  if (!attestationResult.ok) throw new Error(`READY_ATTESTATION_REJECTED:${attestationResult.errors.join("|")}`);
  const timestamp = runtimeIso(runtimeNowMs);
  const hash = computeWorkerReadyAttestationHashV1(attestation);
  const store = {
    STORE_SCHEMA_ID: READINESS_STATE_SCHEMA_ID,
    STATE_SCHEMA_VERSION: READINESS_STATE_SCHEMA_VERSION,
    EVENT_SCHEMA_VERSION: READINESS_EVENT_SCHEMA_VERSION,
    EXECUTION_ID: requireString(initial.EXECUTION_ID, "EXECUTION_ID_REQUIRED"),
    WORKER_ID: attestation.WORKER_ID,
    EXECUTION_PLAN_HASH: attestation.EXECUTION_PLAN_HASH,
    ATTESTATION_ID: attestation.ATTESTATION_ID,
    ATTESTATION_HASH: hash,
    ISSUED_AT: attestation.ISSUED_AT,
    EXPIRES_AT: attestation.EXPIRES_AT,
    READINESS_STATUS: "READY",
    REATTESTATION_REQUIRED: false,
    EXECUTION_GATE_OPEN: true,
    REPLACEMENT_COUNT: 0,
    STATE_VERSION: 0,
    LAST_EVENT_SEQUENCE: 1,
    CREATED_AT: timestamp,
    UPDATED_AT: timestamp,
    IDEMPOTENCY_INDEX: {},
    EVENT_LEDGER: []
  };
  store.EVENT_LEDGER.push(buildEvent(
    "0".repeat(64),
    1,
    "READY_ATTESTATION_REGISTERED",
    `init:${store.EXECUTION_ID}`,
    0,
    timestamp,
    { ATTESTATION_ID: store.ATTESTATION_ID, ATTESTATION_HASH: store.ATTESTATION_HASH, EXPIRES_AT: store.EXPIRES_AT }
  ));
  validateStore(store);
  const lock = await acquireLock(path);
  try {
    try {
      await readFile(path, "utf8");
      throw new Error("READINESS_STATE_ALREADY_EXISTS");
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
  const payload = clone(request);
  delete payload.RUNTIME_NOW_MS;
  return hashObject(payload);
}

async function applyCas(path, request, mutate) {
  if (!isObject(request)) throw new Error("READINESS_CAS_REQUEST_REQUIRED");
  const idempotencyKey = requireString(request.IDEMPOTENCY_KEY, "IDEMPOTENCY_KEY_REQUIRED");
  const timestamp = runtimeIso(request.RUNTIME_NOW_MS);
  const fingerprint = requestFingerprint(request);
  const lock = await acquireLock(path);
  try {
    const current = await readDurableWorkerReadinessV1(path);
    const prior = current.IDEMPOTENCY_INDEX[idempotencyKey];
    if (prior) {
      if (prior.REQUEST_SHA256 !== fingerprint) throw new Error("READINESS_IDEMPOTENCY_KEY_CONFLICT");
      return { ok: true, replay: true, state: clone(current) };
    }
    if (request.EXPECTED_STATE_VERSION !== current.STATE_VERSION) throw new Error("READINESS_STATE_CAS_MISMATCH");
    const next = clone(current);
    mutate(next, current);
    next.STATE_VERSION = current.STATE_VERSION + 1;
    next.UPDATED_AT = timestamp;
    const sequence = current.LAST_EVENT_SEQUENCE + 1;
    const event = buildEvent(
      current.EVENT_LEDGER.at(-1).EVENT_SHA256,
      sequence,
      requireString(request.EVENT_TYPE, "READINESS_EVENT_TYPE_REQUIRED"),
      idempotencyKey,
      next.STATE_VERSION,
      timestamp,
      request.EVENT_PAYLOAD ?? {}
    );
    next.EVENT_LEDGER.push(event);
    next.LAST_EVENT_SEQUENCE = sequence;
    next.IDEMPOTENCY_INDEX[idempotencyKey] = { REQUEST_SHA256: fingerprint, EVENT_SEQUENCE: sequence, STATE_VERSION: next.STATE_VERSION };
    validateStore(next);
    await atomicWriteJson(path, next);
    return { ok: true, replay: false, state: clone(next) };
  } finally {
    await releaseLock(lock);
  }
}

export async function reconcileWorkerReadinessExpiryV1(path, request) {
  const timestamp = runtimeIso(request?.RUNTIME_NOW_MS);
  const current = await readDurableWorkerReadinessV1(path);
  const expired = Date.parse(current.EXPIRES_AT) <= request.RUNTIME_NOW_MS;
  if (!expired) {
    return { ok: true, replay: false, changed: false, code: "READINESS_STILL_VALID", state: clone(current) };
  }
  if (current.READINESS_STATUS === "EXPIRED") {
    return { ok: true, replay: true, changed: false, code: "READINESS_ALREADY_EXPIRED", state: clone(current) };
  }
  return applyCas(path, {
    ...request,
    EVENT_TYPE: "READY_ATTESTATION_EXPIRED",
    EVENT_PAYLOAD: { ATTESTATION_ID: current.ATTESTATION_ID, ATTESTATION_HASH: current.ATTESTATION_HASH, EXPIRED_AT: timestamp }
  }, (next) => {
    next.READINESS_STATUS = "EXPIRED";
    next.REATTESTATION_REQUIRED = true;
    next.EXECUTION_GATE_OPEN = false;
  });
}

export async function replaceExpiredWorkerReadyAttestationV1(path, request) {
  const attestation = clone(request?.WORKER_READY_ATTESTATION);
  const check = validateWorkerReadyAttestationForReadinessV1(attestation, request?.RUNTIME_NOW_MS);
  if (!check.ok) throw new Error(`READY_ATTESTATION_REJECTED:${check.errors.join("|")}`);
  return applyCas(path, {
    ...request,
    EVENT_TYPE: "READY_ATTESTATION_REPLACED",
    EVENT_PAYLOAD: { ATTESTATION_ID: attestation.ATTESTATION_ID, ATTESTATION_HASH: computeWorkerReadyAttestationHashV1(attestation), EXPIRES_AT: attestation.EXPIRES_AT }
  }, (next, current) => {
    if (current.READINESS_STATUS !== "EXPIRED" || current.REATTESTATION_REQUIRED !== true) throw new Error("REATTESTATION_NOT_REQUIRED");
    if (attestation.WORKER_ID !== current.WORKER_ID) throw new Error("REATTESTATION_WORKER_ID_MISMATCH");
    if (attestation.EXECUTION_PLAN_HASH !== current.EXECUTION_PLAN_HASH) throw new Error("REATTESTATION_PLAN_HASH_MISMATCH");
    const nextHash = computeWorkerReadyAttestationHashV1(attestation);
    if (nextHash === current.ATTESTATION_HASH) throw new Error("REATTESTATION_MUST_REPLACE_ATTESTATION");
    next.ATTESTATION_ID = attestation.ATTESTATION_ID;
    next.ATTESTATION_HASH = nextHash;
    next.ISSUED_AT = attestation.ISSUED_AT;
    next.EXPIRES_AT = attestation.EXPIRES_AT;
    next.READINESS_STATUS = "READY";
    next.REATTESTATION_REQUIRED = false;
    next.EXECUTION_GATE_OPEN = true;
    next.REPLACEMENT_COUNT = current.REPLACEMENT_COUNT + 1;
  });
}

export function validateExecutionGateAgainstReadinessV1(readinessState, runtimeNowMs) {
  try { validateStore(readinessState); } catch (error) { return { ok: false, code: error.message }; }
  if (!Number.isSafeInteger(runtimeNowMs)) return { ok: false, code: "RUNTIME_AUTHORITATIVE_TIME_REQUIRED" };
  if (Date.parse(readinessState.EXPIRES_AT) <= runtimeNowMs) return { ok: false, code: "READY_ATTESTATION_EXPIRED" };
  if (readinessState.READINESS_STATUS !== "READY" || readinessState.REATTESTATION_REQUIRED || !readinessState.EXECUTION_GATE_OPEN) {
    return { ok: false, code: "READINESS_GATE_CLOSED" };
  }
  return { ok: true, code: "READINESS_GATE_OPEN" };
}

export function validateSessionReadinessBindingV1(session, readinessState, runtimeNowMs) {
  const gate = validateExecutionGateAgainstReadinessV1(readinessState, runtimeNowMs);
  if (!gate.ok) return gate;
  if (!isObject(session)) return { ok: false, code: "SESSION_NOT_OBJECT" };
  if (session.WORKER_ID !== readinessState.WORKER_ID) return { ok: false, code: "SESSION_WORKER_ID_MISMATCH" };
  if (session.EXECUTION_PLAN_HASH !== readinessState.EXECUTION_PLAN_HASH) return { ok: false, code: "SESSION_EXECUTION_PLAN_HASH_MISMATCH" };
  if (session.WORKER_READY_ATTESTATION_HASH !== readinessState.ATTESTATION_HASH) return { ok: false, code: "SESSION_ATTESTATION_HASH_MISMATCH" };
  return { ok: true, code: "SESSION_READINESS_BINDING_CURRENT" };
}

export function validateDurableWorkerReadinessV1(store) {
  try {
    validateStore(store);
    return { ok: true, errors: [] };
  } catch (error) {
    return { ok: false, errors: [error.message] };
  }
}
