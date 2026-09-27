import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { validateDurableExecutionStateV1 } from "./durable-execution-state-v1.mjs";

export const ONE_SHOT_EXECUTION_SESSION_SCHEMA_ID = "ONE_SHOT_EXECUTION_SESSION_V1";
export const ONE_SHOT_EXECUTION_SESSION_SCHEMA_VERSION = "1";
export const EXECUTION_SESSION_EVENT_SCHEMA_VERSION = "1";

export const SESSION_STATUSES = Object.freeze(["ACTIVE", "FINALIZING", "COMPLETE"]);
export const BILLING_STATUSES = Object.freeze(["ACTIVE", "STOPPED", "NOT_APPLICABLE"]);
export const CLIENT_DISCONNECT_CHANNELS = Object.freeze(["CHAT", "SSH", "ANDROID", "CLIENT"]);

const SHA256_RE = /^[0-9a-f]{64}$/;
const TERMINAL_FLAGS = Object.freeze([
  "EXECUTION_TERMINAL",
  "RECEIPT_TERMINAL",
  "EXECUTION_TRANSPORT_DEREGISTERED",
  "REQUIRED_RESOURCE_CLEANUP_TERMINAL"
]);

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
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

function canonicalize(value) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("SESSION_NON_SAFE_INTEGER");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  }
  throw new Error("SESSION_UNSUPPORTED_CANONICAL_TYPE");
}

function hashObject(value) {
  return createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function validateBinding(binding, prefix) {
  if (!isObject(binding)) throw new Error(`${prefix}_BINDING_REQUIRED`);
  requireString(binding.BINDING_ID, `${prefix}_BINDING_ID_REQUIRED`);
  requireSha256(binding.BINDING_SHA256, `${prefix}_BINDING_SHA256_INVALID`);
  return binding;
}

function buildEvent(previousHash, sequence, eventType, idempotencyKey, stateVersion, timestamp, payload) {
  const body = {
    EVENT_SCHEMA_VERSION: EXECUTION_SESSION_EVENT_SCHEMA_VERSION,
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
  if (!Array.isArray(events) || events.length === 0) throw new Error("SESSION_EVENT_LEDGER_REQUIRED");
  let previousHash = "0".repeat(64);
  let sequence = 1;
  for (const event of events) {
    if (!isObject(event)) throw new Error("SESSION_EVENT_INVALID");
    if (event.EVENT_SCHEMA_VERSION !== EXECUTION_SESSION_EVENT_SCHEMA_VERSION) throw new Error("SESSION_EVENT_SCHEMA_VERSION_MISMATCH");
    if (event.EVENT_SEQUENCE !== sequence) throw new Error("SESSION_EVENT_SEQUENCE_GAP");
    if (event.PREVIOUS_EVENT_SHA256 !== previousHash) throw new Error("SESSION_EVENT_PREVIOUS_HASH_MISMATCH");
    const { EVENT_SHA256, ...body } = event;
    if (!SHA256_RE.test(EVENT_SHA256 ?? "") || hashObject(body) !== EVENT_SHA256) throw new Error("SESSION_EVENT_HASH_MISMATCH");
    previousHash = EVENT_SHA256;
    sequence += 1;
  }
}

export function isSessionCompleteV1(session) {
  return TERMINAL_FLAGS.every((field) => session?.[field] === true)
    && ["STOPPED", "NOT_APPLICABLE"].includes(session?.BILLING_STATUS);
}

function deriveSessionStatus(session) {
  if (isSessionCompleteV1(session)) return "COMPLETE";
  if (session.EXECUTION_TERMINAL === true) return "FINALIZING";
  return "ACTIVE";
}

function validateSession(session) {
  if (!isObject(session)) throw new Error("SESSION_NOT_OBJECT");
  if (session.SESSION_SCHEMA_ID !== ONE_SHOT_EXECUTION_SESSION_SCHEMA_ID) throw new Error("SESSION_SCHEMA_ID_MISMATCH");
  if (session.SESSION_SCHEMA_VERSION !== ONE_SHOT_EXECUTION_SESSION_SCHEMA_VERSION) throw new Error("SESSION_SCHEMA_VERSION_MISMATCH");
  if (session.EVENT_SCHEMA_VERSION !== EXECUTION_SESSION_EVENT_SCHEMA_VERSION) throw new Error("SESSION_EVENT_SCHEMA_VERSION_MISMATCH");
  requireString(session.SESSION_ID, "SESSION_ID_REQUIRED");
  requireSha256(session.EXECUTION_PLAN_HASH, "EXECUTION_PLAN_HASH_INVALID");
  requirePositiveInteger(session.EXECUTION_EPOCH, "EXECUTION_EPOCH_INVALID");
  requireString(session.ATTEMPT_ID, "ATTEMPT_ID_REQUIRED");
  requirePositiveInteger(session.LEASE_GENERATION, "LEASE_GENERATION_INVALID");
  requireString(session.FENCE_TOKEN, "FENCE_TOKEN_REQUIRED");
  validateBinding(session.COMPUTE_PROVIDER_BINDING, "COMPUTE_PROVIDER");
  validateBinding(session.EXECUTION_TRANSPORT_BINDING, "EXECUTION_TRANSPORT");
  requireString(session.WORKER_ID, "WORKER_ID_REQUIRED");
  requireSha256(session.WORKER_READY_ATTESTATION_HASH, "WORKER_READY_ATTESTATION_HASH_INVALID");
  requireString(session.APPROVAL_GRANT_ID, "APPROVAL_GRANT_ID_REQUIRED");
  requireString(session.BUDGET_RESERVATION_ID, "BUDGET_RESERVATION_ID_REQUIRED");
  requireNonNegativeInteger(session.STATE_VERSION, "SESSION_STATE_VERSION_INVALID");
  requirePositiveInteger(session.LAST_EVENT_SEQUENCE, "SESSION_LAST_EVENT_SEQUENCE_INVALID");
  requireNonNegativeInteger(session.CLIENT_DISCONNECT_EVENTS, "CLIENT_DISCONNECT_EVENTS_INVALID");
  if (!SESSION_STATUSES.includes(session.SESSION_STATUS)) throw new Error("SESSION_STATUS_INVALID");
  if (!BILLING_STATUSES.includes(session.BILLING_STATUS)) throw new Error("BILLING_STATUS_INVALID");
  for (const field of TERMINAL_FLAGS) {
    if (typeof session[field] !== "boolean") throw new Error(`${field}_INVALID`);
  }
  if (session.SESSION_STATUS !== deriveSessionStatus(session)) throw new Error("SESSION_STATUS_DERIVATION_MISMATCH");
  if (!isObject(session.IDEMPOTENCY_INDEX)) throw new Error("SESSION_IDEMPOTENCY_INDEX_REQUIRED");
  if (typeof session.STARTED_AT !== "string" || Number.isNaN(Date.parse(session.STARTED_AT))) throw new Error("SESSION_STARTED_AT_INVALID");
  if (typeof session.UPDATED_AT !== "string" || Number.isNaN(Date.parse(session.UPDATED_AT))) throw new Error("SESSION_UPDATED_AT_INVALID");
  validateEventLedger(session.EVENT_LEDGER);
  if (session.EVENT_LEDGER.length !== session.LAST_EVENT_SEQUENCE) throw new Error("SESSION_LAST_EVENT_SEQUENCE_MISMATCH");
  return session;
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
    if (error?.code === "EEXIST") throw new Error("SESSION_STATE_LOCKED");
    throw error;
  }
}

async function releaseLock(lock) {
  try { await lock.handle.close(); } finally { await unlink(lock.lockPath).catch(() => {}); }
}

export async function readOneShotExecutionSessionV1(path) {
  return validateSession(JSON.parse(await readFile(path, "utf8")));
}

export async function initializeOneShotExecutionSessionV1(path, initial, runtimeNowMs) {
  if (!isObject(initial)) throw new Error("SESSION_INITIAL_STATE_REQUIRED");
  const timestamp = runtimeIso(runtimeNowMs);
  const sessionId = requireString(initial.SESSION_ID, "SESSION_ID_REQUIRED");
  const session = {
    SESSION_SCHEMA_ID: ONE_SHOT_EXECUTION_SESSION_SCHEMA_ID,
    SESSION_SCHEMA_VERSION: ONE_SHOT_EXECUTION_SESSION_SCHEMA_VERSION,
    EVENT_SCHEMA_VERSION: EXECUTION_SESSION_EVENT_SCHEMA_VERSION,
    SESSION_ID: sessionId,
    EXECUTION_PLAN_HASH: requireSha256(initial.EXECUTION_PLAN_HASH, "EXECUTION_PLAN_HASH_INVALID"),
    EXECUTION_EPOCH: requirePositiveInteger(initial.EXECUTION_EPOCH, "EXECUTION_EPOCH_INVALID"),
    ATTEMPT_ID: requireString(initial.ATTEMPT_ID, "ATTEMPT_ID_REQUIRED"),
    LEASE_GENERATION: requirePositiveInteger(initial.LEASE_GENERATION, "LEASE_GENERATION_INVALID"),
    FENCE_TOKEN: requireString(initial.FENCE_TOKEN, "FENCE_TOKEN_REQUIRED"),
    COMPUTE_PROVIDER_BINDING: clone(validateBinding(initial.COMPUTE_PROVIDER_BINDING, "COMPUTE_PROVIDER")),
    EXECUTION_TRANSPORT_BINDING: clone(validateBinding(initial.EXECUTION_TRANSPORT_BINDING, "EXECUTION_TRANSPORT")),
    WORKER_ID: requireString(initial.WORKER_ID, "WORKER_ID_REQUIRED"),
    WORKER_READY_ATTESTATION_HASH: requireSha256(initial.WORKER_READY_ATTESTATION_HASH, "WORKER_READY_ATTESTATION_HASH_INVALID"),
    APPROVAL_GRANT_ID: requireString(initial.APPROVAL_GRANT_ID, "APPROVAL_GRANT_ID_REQUIRED"),
    BUDGET_RESERVATION_ID: requireString(initial.BUDGET_RESERVATION_ID, "BUDGET_RESERVATION_ID_REQUIRED"),
    STARTED_AT: timestamp,
    UPDATED_AT: timestamp,
    SESSION_STATUS: "ACTIVE",
    STATE_VERSION: 0,
    LAST_EVENT_SEQUENCE: 1,
    EXECUTION_TERMINAL: false,
    RECEIPT_TERMINAL: false,
    EXECUTION_TRANSPORT_DEREGISTERED: false,
    REQUIRED_RESOURCE_CLEANUP_TERMINAL: false,
    BILLING_STATUS: initial.BILLING_STATUS ?? "ACTIVE",
    CLIENT_DISCONNECT_EVENTS: 0,
    IDEMPOTENCY_INDEX: {},
    EVENT_LEDGER: []
  };
  if (!BILLING_STATUSES.includes(session.BILLING_STATUS)) throw new Error("BILLING_STATUS_INVALID");
  session.EVENT_LEDGER.push(buildEvent(
    "0".repeat(64),
    1,
    "ONE_SHOT_SESSION_INITIALIZED",
    `init:${sessionId}`,
    0,
    timestamp,
    {
      EXECUTION_PLAN_HASH: session.EXECUTION_PLAN_HASH,
      EXECUTION_EPOCH: session.EXECUTION_EPOCH,
      ATTEMPT_ID: session.ATTEMPT_ID,
      LEASE_GENERATION: session.LEASE_GENERATION,
      FENCE_TOKEN: session.FENCE_TOKEN
    }
  ));
  validateSession(session);

  const lock = await acquireLock(path);
  try {
    try {
      await readFile(path, "utf8");
      throw new Error("ONE_SHOT_SESSION_ALREADY_EXISTS");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await atomicWriteJson(path, session);
  } finally {
    await releaseLock(lock);
  }
  return clone(session);
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

function requestFingerprint(request) {
  const value = { ...request };
  delete value.RUNTIME_NOW_MS;
  return hashObject(stripUndefined(value));
}

async function applySessionCas(path, request, mutate) {
  if (!isObject(request)) throw new Error("SESSION_CAS_REQUEST_REQUIRED");
  const idempotencyKey = requireString(request.IDEMPOTENCY_KEY, "IDEMPOTENCY_KEY_REQUIRED");
  const timestamp = runtimeIso(request.RUNTIME_NOW_MS);
  const fingerprint = requestFingerprint(request);
  const lock = await acquireLock(path);
  try {
    const current = await readOneShotExecutionSessionV1(path);
    const prior = current.IDEMPOTENCY_INDEX[idempotencyKey];
    if (prior) {
      if (prior.REQUEST_SHA256 !== fingerprint) throw new Error("SESSION_IDEMPOTENCY_KEY_CONFLICT");
      return { ok: true, replay: true, session: clone(current) };
    }
    if (current.SESSION_STATUS === "COMPLETE") throw new Error("SESSION_ALREADY_COMPLETE");
    if (request.EXPECTED_STATE_VERSION !== current.STATE_VERSION) throw new Error("SESSION_STATE_CAS_MISMATCH");
    if (request.SUBMITTED_FENCE_TOKEN !== current.FENCE_TOKEN) throw new Error("SESSION_STALE_FENCE_REJECTED");

    const next = clone(current);
    mutate(next, current);
    next.SESSION_STATUS = deriveSessionStatus(next);
    next.STATE_VERSION = current.STATE_VERSION + 1;
    next.UPDATED_AT = timestamp;
    const sequence = current.LAST_EVENT_SEQUENCE + 1;
    const event = buildEvent(
      current.EVENT_LEDGER.at(-1).EVENT_SHA256,
      sequence,
      requireString(request.EVENT_TYPE, "SESSION_EVENT_TYPE_REQUIRED"),
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
    validateSession(next);
    await atomicWriteJson(path, next);
    return { ok: true, replay: false, session: clone(next) };
  } finally {
    await releaseLock(lock);
  }
}

function assertMonotonicTerminalFlag(current, next, field) {
  if (current[field] === true && next[field] === false) throw new Error(`SESSION_TERMINAL_FLAG_REGRESSION:${field}`);
}

function assertBillingTransition(currentStatus, nextStatus) {
  if (!BILLING_STATUSES.includes(nextStatus)) throw new Error("BILLING_STATUS_INVALID");
  if (currentStatus === nextStatus) return;
  if (currentStatus !== "ACTIVE") throw new Error("BILLING_STATUS_REGRESSION_DENIED");
  if (!["STOPPED", "NOT_APPLICABLE"].includes(nextStatus)) throw new Error("BILLING_STATUS_TRANSITION_INVALID");
}

export async function recordOneShotSessionProgressV1(path, request) {
  return applySessionCas(path, {
    ...request,
    EVENT_TYPE: request?.EVENT_TYPE ?? "SESSION_LIFECYCLE_PROGRESS",
    EVENT_PAYLOAD: {
      EXECUTION_TERMINAL: request?.EXECUTION_TERMINAL,
      RECEIPT_TERMINAL: request?.RECEIPT_TERMINAL,
      EXECUTION_TRANSPORT_DEREGISTERED: request?.EXECUTION_TRANSPORT_DEREGISTERED,
      REQUIRED_RESOURCE_CLEANUP_TERMINAL: request?.REQUIRED_RESOURCE_CLEANUP_TERMINAL,
      BILLING_STATUS: request?.BILLING_STATUS,
      ...(request?.EVENT_PAYLOAD ?? {})
    }
  }, (next, current) => {
    for (const field of TERMINAL_FLAGS) {
      if (request[field] !== undefined) {
        if (typeof request[field] !== "boolean") throw new Error(`${field}_INVALID`);
        next[field] = request[field];
        assertMonotonicTerminalFlag(current, next, field);
      }
    }
    if (request.BILLING_STATUS !== undefined) {
      assertBillingTransition(current.BILLING_STATUS, request.BILLING_STATUS);
      next.BILLING_STATUS = request.BILLING_STATUS;
    }
  });
}

export async function recordSessionClientDisconnectV1(path, request) {
  if (!CLIENT_DISCONNECT_CHANNELS.includes(request?.CHANNEL)) throw new Error("CLIENT_DISCONNECT_CHANNEL_INVALID");
  return applySessionCas(path, {
    ...request,
    EVENT_TYPE: "CLIENT_DISCONNECTED_NO_SESSION_EFFECT",
    EVENT_PAYLOAD: {
      CHANNEL: request.CHANNEL,
      SESSION_LIFETIME_EFFECT: "NO_EFFECT"
    }
  }, (next) => {
    next.CLIENT_DISCONNECT_EVENTS += 1;
  });
}

export function validateSessionAgainstDurableExecutionStateV1(session, durableState) {
  const sessionResult = validateOneShotExecutionSessionV1(session);
  if (!sessionResult.ok) return sessionResult;
  const executionResult = validateDurableExecutionStateV1(durableState);
  if (!executionResult.ok) return { ok: false, errors: executionResult.errors.map((v) => `DURABLE_EXECUTION_STATE:${v}`) };
  const errors = [];
  if (session.EXECUTION_EPOCH !== durableState.EXECUTION_EPOCH) errors.push("SESSION_EXECUTION_EPOCH_MISMATCH");
  if (session.ATTEMPT_ID !== durableState.ATTEMPT_ID) errors.push("SESSION_ATTEMPT_ID_MISMATCH");
  if (session.LEASE_GENERATION !== durableState.LEASE_GENERATION) errors.push("SESSION_LEASE_GENERATION_MISMATCH");
  if (session.FENCE_TOKEN !== durableState.FENCE_TOKEN) errors.push("SESSION_FENCE_TOKEN_MISMATCH");
  return { ok: errors.length === 0, errors };
}

export function validateOneShotExecutionSessionV1(session) {
  try {
    validateSession(session);
    return { ok: true, errors: [] };
  } catch (error) {
    return { ok: false, errors: [error.message] };
  }
}
