import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";

export const PROVIDER_BOOTSTRAP_SAGA_SCHEMA_ID = "DURABLE_PROVIDER_BOOTSTRAP_SAGA_V1";
export const PROVIDER_BOOTSTRAP_SAGA_SCHEMA_VERSION = "1";
export const PROVIDER_BOOTSTRAP_EVENT_SCHEMA_VERSION = "1";

export const PROVIDER_BOOTSTRAP_PHASES = Object.freeze([
  "PROVISION",
  "BOOTSTRAP",
  "ATTEST",
  "REGISTER_TRANSPORT",
  "BIND_JOB",
  "EXECUTE",
  "COLLECT",
  "DEREGISTER",
  "CLEANUP",
  "BILLING_STOP"
]);

export const PROVIDER_BOOTSTRAP_STATUSES = Object.freeze([
  "RUNNING",
  "RECONCILIATION_REQUIRED",
  "FAILED",
  "COMPLETE"
]);

const PROVIDERS = new Set(["LOCAL", "VMWARE", "DIGITALOCEAN"]);
const TRANSPORTS = new Set(["DIRECT_WORKER", "GITHUB_SELF_HOSTED_JIT"]);
const BILLING_STATUSES = new Set(["ACTIVE", "STOPPED", "NOT_APPLICABLE"]);
const SHA256_RE = /^[0-9a-f]{64}$/;
const EVIDENCE_REQUIRED_PHASES = new Set(["BOOTSTRAP", "ATTEST", "REGISTER_TRANSPORT", "BIND_JOB"]);

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
    if (!Number.isSafeInteger(value)) throw new Error("PROVIDER_SAGA_NON_SAFE_INTEGER");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  }
  throw new Error("PROVIDER_SAGA_UNSUPPORTED_CANONICAL_TYPE");
}

function hashObject(value) {
  return createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
}

function buildEvent(previousHash, sequence, eventType, idempotencyKey, stateVersion, timestamp, payload) {
  const body = {
    EVENT_SCHEMA_VERSION: PROVIDER_BOOTSTRAP_EVENT_SCHEMA_VERSION,
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
  if (!Array.isArray(events) || events.length === 0) throw new Error("PROVIDER_SAGA_EVENT_LEDGER_REQUIRED");
  let previousHash = "0".repeat(64);
  let sequence = 1;
  for (const event of events) {
    if (!isObject(event)) throw new Error("PROVIDER_SAGA_EVENT_INVALID");
    if (event.EVENT_SCHEMA_VERSION !== PROVIDER_BOOTSTRAP_EVENT_SCHEMA_VERSION) throw new Error("PROVIDER_SAGA_EVENT_SCHEMA_VERSION_MISMATCH");
    if (event.EVENT_SEQUENCE !== sequence) throw new Error("PROVIDER_SAGA_EVENT_SEQUENCE_GAP");
    if (event.PREVIOUS_EVENT_SHA256 !== previousHash) throw new Error("PROVIDER_SAGA_EVENT_PREVIOUS_HASH_MISMATCH");
    const { EVENT_SHA256, ...body } = event;
    if (!SHA256_RE.test(EVENT_SHA256 ?? "") || hashObject(body) !== EVENT_SHA256) throw new Error("PROVIDER_SAGA_EVENT_HASH_MISMATCH");
    previousHash = EVENT_SHA256;
    sequence += 1;
  }
}

function expectedCurrentPhase(completedPhases) {
  return PROVIDER_BOOTSTRAP_PHASES[completedPhases.length] ?? null;
}

function validateSaga(saga) {
  if (!isObject(saga)) throw new Error("PROVIDER_SAGA_NOT_OBJECT");
  if (saga.SAGA_SCHEMA_ID !== PROVIDER_BOOTSTRAP_SAGA_SCHEMA_ID) throw new Error("PROVIDER_SAGA_SCHEMA_ID_MISMATCH");
  if (saga.SAGA_SCHEMA_VERSION !== PROVIDER_BOOTSTRAP_SAGA_SCHEMA_VERSION) throw new Error("PROVIDER_SAGA_SCHEMA_VERSION_MISMATCH");
  if (saga.EVENT_SCHEMA_VERSION !== PROVIDER_BOOTSTRAP_EVENT_SCHEMA_VERSION) throw new Error("PROVIDER_SAGA_EVENT_SCHEMA_VERSION_MISMATCH");
  requireString(saga.SAGA_ID, "PROVIDER_SAGA_ID_REQUIRED");
  requireString(saga.EXECUTION_ID, "EXECUTION_ID_REQUIRED");
  requireSha256(saga.EXECUTION_PLAN_HASH, "EXECUTION_PLAN_HASH_INVALID");
  requireSha256(saga.BOOTSTRAP_SPEC_SHA256, "BOOTSTRAP_SPEC_SHA256_INVALID");
  requireString(saga.APPROVAL_GRANT_ID, "APPROVAL_GRANT_ID_REQUIRED");
  requireString(saga.BUDGET_RESERVATION_ID, "BUDGET_RESERVATION_ID_REQUIRED");
  if (!PROVIDERS.has(saga.COMPUTE_PROVIDER)) throw new Error("COMPUTE_PROVIDER_INVALID");
  if (!TRANSPORTS.has(saga.EXECUTION_TRANSPORT)) throw new Error("EXECUTION_TRANSPORT_INVALID");
  if (!PROVIDER_BOOTSTRAP_STATUSES.includes(saga.SAGA_STATUS)) throw new Error("PROVIDER_SAGA_STATUS_INVALID");
  if (!Array.isArray(saga.COMPLETED_PHASES)) throw new Error("COMPLETED_PHASES_REQUIRED");
  const expected = PROVIDER_BOOTSTRAP_PHASES.slice(0, saga.COMPLETED_PHASES.length);
  if (JSON.stringify(saga.COMPLETED_PHASES) !== JSON.stringify(expected)) throw new Error("COMPLETED_PHASES_NOT_STRICT_PREFIX");
  if (saga.CURRENT_PHASE !== expectedCurrentPhase(saga.COMPLETED_PHASES)) throw new Error("CURRENT_PHASE_DERIVATION_MISMATCH");
  if (!BILLING_STATUSES.has(saga.BILLING_STATUS)) throw new Error("BILLING_STATUS_INVALID");
  if (typeof saga.EXECUTION_TRANSPORT_DEREGISTERED !== "boolean") throw new Error("TRANSPORT_DEREGISTERED_INVALID");
  if (typeof saga.REQUIRED_RESOURCE_CLEANUP_TERMINAL !== "boolean") throw new Error("RESOURCE_CLEANUP_TERMINAL_INVALID");
  requireNonNegativeInteger(saga.STATE_VERSION, "PROVIDER_SAGA_STATE_VERSION_INVALID");
  requireNonNegativeInteger(saga.LAST_EVENT_SEQUENCE, "PROVIDER_SAGA_EVENT_SEQUENCE_INVALID");
  if (!isObject(saga.IDEMPOTENCY_INDEX)) throw new Error("PROVIDER_SAGA_IDEMPOTENCY_INDEX_REQUIRED");
  if (typeof saga.CREATED_AT !== "string" || Number.isNaN(Date.parse(saga.CREATED_AT))) throw new Error("PROVIDER_SAGA_CREATED_AT_INVALID");
  if (typeof saga.UPDATED_AT !== "string" || Number.isNaN(Date.parse(saga.UPDATED_AT))) throw new Error("PROVIDER_SAGA_UPDATED_AT_INVALID");
  validateEventLedger(saga.EVENT_LEDGER);
  if (saga.EVENT_LEDGER.length !== saga.LAST_EVENT_SEQUENCE) throw new Error("PROVIDER_SAGA_LAST_EVENT_SEQUENCE_MISMATCH");

  if (saga.SAGA_STATUS === "RUNNING" && saga.ACTIVE_OPERATION !== null) {
    if (!isObject(saga.ACTIVE_OPERATION) || saga.ACTIVE_OPERATION.RESULT !== "IN_PROGRESS") throw new Error("RUNNING_SAGA_ACTIVE_OPERATION_INVALID");
  }
  if (saga.SAGA_STATUS === "RECONCILIATION_REQUIRED") {
    if (!isObject(saga.ACTIVE_OPERATION)) throw new Error("OUTCOME_UNKNOWN_ACTIVE_OPERATION_REQUIRED");
    if (saga.ACTIVE_OPERATION.RESULT !== "OUTCOME_UNKNOWN") throw new Error("OUTCOME_UNKNOWN_OPERATION_RESULT_REQUIRED");
  }
  if (saga.SAGA_STATUS === "COMPLETE") {
    if (saga.CURRENT_PHASE !== null || saga.COMPLETED_PHASES.length !== PROVIDER_BOOTSTRAP_PHASES.length) throw new Error("COMPLETE_PHASE_SET_INVALID");
    if (saga.EXECUTION_TRANSPORT_DEREGISTERED !== true) throw new Error("COMPLETE_TRANSPORT_NOT_DEREGISTERED");
    if (saga.REQUIRED_RESOURCE_CLEANUP_TERMINAL !== true) throw new Error("COMPLETE_RESOURCE_CLEANUP_NOT_TERMINAL");
    if (!["STOPPED", "NOT_APPLICABLE"].includes(saga.BILLING_STATUS)) throw new Error("COMPLETE_BILLING_NOT_TERMINAL");
  }
  if (saga.SAGA_STATUS === "FAILED" && !saga.FAILURE) throw new Error("FAILED_SAGA_FAILURE_REQUIRED");
  return saga;
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
    if (error?.code === "EEXIST") throw new Error("PROVIDER_SAGA_STATE_LOCKED");
    throw error;
  }
}

async function releaseLock(lock) {
  try { await lock.handle.close(); } finally { await unlink(lock.lockPath).catch(() => {}); }
}

function requestFingerprint(request) {
  const copy = clone(request);
  delete copy.RUNTIME_NOW_MS;
  return hashObject(copy);
}

async function applySagaCas(path, request, mutate) {
  if (!isObject(request)) throw new Error("PROVIDER_SAGA_CAS_REQUEST_REQUIRED");
  const idempotencyKey = requireString(request.IDEMPOTENCY_KEY, "IDEMPOTENCY_KEY_REQUIRED");
  const timestamp = runtimeIso(request.RUNTIME_NOW_MS);
  const fingerprint = requestFingerprint(request);
  const lock = await acquireLock(path);
  try {
    const current = await readProviderBootstrapSagaV1(path);
    const prior = current.IDEMPOTENCY_INDEX[idempotencyKey];
    if (prior) {
      if (prior.REQUEST_SHA256 !== fingerprint) throw new Error("PROVIDER_SAGA_IDEMPOTENCY_KEY_CONFLICT");
      return { ok: true, replay: true, saga: clone(current) };
    }
    if (request.EXPECTED_STATE_VERSION !== current.STATE_VERSION) throw new Error("PROVIDER_SAGA_STATE_CAS_MISMATCH");
    const next = clone(current);
    mutate(next, current);
    next.STATE_VERSION = current.STATE_VERSION + 1;
    next.UPDATED_AT = timestamp;
    const sequence = current.LAST_EVENT_SEQUENCE + 1;
    const event = buildEvent(
      current.EVENT_LEDGER.at(-1).EVENT_SHA256,
      sequence,
      requireString(request.EVENT_TYPE, "PROVIDER_SAGA_EVENT_TYPE_REQUIRED"),
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
    validateSaga(next);
    await atomicWriteJson(path, next);
    return { ok: true, replay: false, saga: clone(next) };
  } finally {
    await releaseLock(lock);
  }
}

export async function readProviderBootstrapSagaV1(path) {
  return validateSaga(JSON.parse(await readFile(path, "utf8")));
}

export async function initializeProviderBootstrapSagaV1(path, initial, runtimeNowMs) {
  if (!isObject(initial)) throw new Error("PROVIDER_SAGA_INITIAL_STATE_REQUIRED");
  const timestamp = runtimeIso(runtimeNowMs);
  const sagaId = requireString(initial.SAGA_ID, "PROVIDER_SAGA_ID_REQUIRED");
  const saga = {
    SAGA_SCHEMA_ID: PROVIDER_BOOTSTRAP_SAGA_SCHEMA_ID,
    SAGA_SCHEMA_VERSION: PROVIDER_BOOTSTRAP_SAGA_SCHEMA_VERSION,
    EVENT_SCHEMA_VERSION: PROVIDER_BOOTSTRAP_EVENT_SCHEMA_VERSION,
    SAGA_ID: sagaId,
    EXECUTION_ID: requireString(initial.EXECUTION_ID, "EXECUTION_ID_REQUIRED"),
    EXECUTION_PLAN_HASH: requireSha256(initial.EXECUTION_PLAN_HASH, "EXECUTION_PLAN_HASH_INVALID"),
    BOOTSTRAP_SPEC_SHA256: requireSha256(initial.BOOTSTRAP_SPEC_SHA256, "BOOTSTRAP_SPEC_SHA256_INVALID"),
    COMPUTE_PROVIDER: initial.COMPUTE_PROVIDER,
    EXECUTION_TRANSPORT: initial.EXECUTION_TRANSPORT,
    APPROVAL_GRANT_ID: requireString(initial.APPROVAL_GRANT_ID, "APPROVAL_GRANT_ID_REQUIRED"),
    BUDGET_RESERVATION_ID: requireString(initial.BUDGET_RESERVATION_ID, "BUDGET_RESERVATION_ID_REQUIRED"),
    ZERO_TOUCH_REQUIRED: true,
    SAGA_STATUS: "RUNNING",
    CURRENT_PHASE: "PROVISION",
    COMPLETED_PHASES: [],
    ACTIVE_OPERATION: null,
    LAST_PROVIDER_OBSERVATION: null,
    PHASE_EVIDENCE: {},
    EXECUTION_TRANSPORT_DEREGISTERED: false,
    REQUIRED_RESOURCE_CLEANUP_TERMINAL: false,
    BILLING_STATUS: initial.BILLING_STATUS ?? (initial.COMPUTE_PROVIDER === "LOCAL" ? "NOT_APPLICABLE" : "ACTIVE"),
    FAILURE: null,
    STATE_VERSION: 0,
    LAST_EVENT_SEQUENCE: 1,
    CREATED_AT: timestamp,
    UPDATED_AT: timestamp,
    IDEMPOTENCY_INDEX: {},
    EVENT_LEDGER: []
  };
  if (!PROVIDERS.has(saga.COMPUTE_PROVIDER)) throw new Error("COMPUTE_PROVIDER_INVALID");
  if (!TRANSPORTS.has(saga.EXECUTION_TRANSPORT)) throw new Error("EXECUTION_TRANSPORT_INVALID");
  if (!BILLING_STATUSES.has(saga.BILLING_STATUS)) throw new Error("BILLING_STATUS_INVALID");
  saga.EVENT_LEDGER.push(buildEvent(
    "0".repeat(64),
    1,
    "PROVIDER_BOOTSTRAP_SAGA_INITIALIZED",
    `init:${sagaId}`,
    0,
    timestamp,
    {
      EXECUTION_PLAN_HASH: saga.EXECUTION_PLAN_HASH,
      BOOTSTRAP_SPEC_SHA256: saga.BOOTSTRAP_SPEC_SHA256,
      COMPUTE_PROVIDER: saga.COMPUTE_PROVIDER,
      EXECUTION_TRANSPORT: saga.EXECUTION_TRANSPORT
    }
  ));
  validateSaga(saga);
  const lock = await acquireLock(path);
  try {
    try {
      await readFile(path, "utf8");
      throw new Error("PROVIDER_BOOTSTRAP_SAGA_ALREADY_EXISTS");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await atomicWriteJson(path, saga);
  } finally {
    await releaseLock(lock);
  }
  return clone(saga);
}

export async function beginProviderBootstrapPhaseV1(path, request) {
  return applySagaCas(path, {
    ...request,
    EVENT_TYPE: "PROVIDER_SAGA_PHASE_STARTED",
    EVENT_PAYLOAD: {
      PHASE: request?.PHASE,
      OPERATION_ID: request?.OPERATION_ID,
      OPERATION_IDEMPOTENCY_KEY: request?.OPERATION_IDEMPOTENCY_KEY
    }
  }, (next, current) => {
    if (current.SAGA_STATUS === "RECONCILIATION_REQUIRED") throw new Error("OUTCOME_UNKNOWN_RECONCILIATION_REQUIRED");
    if (current.SAGA_STATUS === "FAILED") throw new Error("PROVIDER_SAGA_FAILED");
    if (current.SAGA_STATUS === "COMPLETE") throw new Error("PROVIDER_SAGA_COMPLETE");
    if (current.ACTIVE_OPERATION !== null) throw new Error("PROVIDER_SAGA_ACTIVE_OPERATION_EXISTS");
    if (request.PHASE !== current.CURRENT_PHASE) throw new Error("PROVIDER_SAGA_PHASE_ORDER_VIOLATION");
    next.ACTIVE_OPERATION = {
      PHASE: current.CURRENT_PHASE,
      OPERATION_ID: requireString(request.OPERATION_ID, "OPERATION_ID_REQUIRED"),
      IDEMPOTENCY_KEY: requireString(request.OPERATION_IDEMPOTENCY_KEY, "OPERATION_IDEMPOTENCY_REQUIRED"),
      RESULT: "IN_PROGRESS",
      STARTED_AT: runtimeIso(request.RUNTIME_NOW_MS)
    };
  });
}

function assertSameOperation(current, request) {
  if (!isObject(current.ACTIVE_OPERATION)) throw new Error("PROVIDER_SAGA_ACTIVE_OPERATION_REQUIRED");
  if (current.ACTIVE_OPERATION.OPERATION_ID !== request.OPERATION_ID || current.ACTIVE_OPERATION.IDEMPOTENCY_KEY !== request.OPERATION_IDEMPOTENCY_KEY) {
    throw new Error("SECOND_MUTATION_DENIED");
  }
}

function applySuccessfulPhase(next, current, request) {
  const phase = current.CURRENT_PHASE;
  if (EVIDENCE_REQUIRED_PHASES.has(phase)) {
    requireSha256(request.EVIDENCE_SHA256, `PHASE_EVIDENCE_REQUIRED:${phase}`);
    next.PHASE_EVIDENCE[phase] = request.EVIDENCE_SHA256;
  } else if (request.EVIDENCE_SHA256 !== undefined) {
    next.PHASE_EVIDENCE[phase] = requireSha256(request.EVIDENCE_SHA256, `PHASE_EVIDENCE_INVALID:${phase}`);
  }
  next.COMPLETED_PHASES.push(phase);
  if (phase === "DEREGISTER") next.EXECUTION_TRANSPORT_DEREGISTERED = true;
  if (phase === "CLEANUP") next.REQUIRED_RESOURCE_CLEANUP_TERMINAL = true;
  if (phase === "BILLING_STOP") {
    const billingStatus = request.BILLING_STATUS ?? (current.COMPUTE_PROVIDER === "LOCAL" ? "NOT_APPLICABLE" : "STOPPED");
    if (!["STOPPED", "NOT_APPLICABLE"].includes(billingStatus)) throw new Error("BILLING_STOP_TERMINAL_STATUS_REQUIRED");
    next.BILLING_STATUS = billingStatus;
  }
  next.CURRENT_PHASE = expectedCurrentPhase(next.COMPLETED_PHASES);
  next.ACTIVE_OPERATION = null;
  next.SAGA_STATUS = next.CURRENT_PHASE === null ? "COMPLETE" : "RUNNING";
}

export async function recordProviderBootstrapPhaseResultV1(path, request) {
  return applySagaCas(path, {
    ...request,
    EVENT_TYPE: request?.RESULT === "OUTCOME_UNKNOWN" ? "PROVIDER_SAGA_PHASE_OUTCOME_UNKNOWN" : "PROVIDER_SAGA_PHASE_RESULT",
    EVENT_PAYLOAD: {
      PHASE: request?.PHASE,
      OPERATION_ID: request?.OPERATION_ID,
      OPERATION_IDEMPOTENCY_KEY: request?.OPERATION_IDEMPOTENCY_KEY,
      RESULT: request?.RESULT,
      EVIDENCE_SHA256: request?.EVIDENCE_SHA256,
      BILLING_STATUS: request?.BILLING_STATUS
    }
  }, (next, current) => {
    if (current.SAGA_STATUS === "RECONCILIATION_REQUIRED") throw new Error("OUTCOME_UNKNOWN_RECONCILIATION_REQUIRED");
    assertSameOperation(current, request);
    if (request.PHASE !== current.CURRENT_PHASE || request.PHASE !== current.ACTIVE_OPERATION.PHASE) throw new Error("PROVIDER_SAGA_PHASE_RESULT_MISMATCH");
    if (request.RESULT === "PASS") {
      applySuccessfulPhase(next, current, request);
      return;
    }
    if (request.RESULT === "OUTCOME_UNKNOWN") {
      next.ACTIVE_OPERATION.RESULT = "OUTCOME_UNKNOWN";
      next.SAGA_STATUS = "RECONCILIATION_REQUIRED";
      return;
    }
    if (request.RESULT === "FAIL" || request.RESULT === "BLOCKED") {
      next.ACTIVE_OPERATION.RESULT = request.RESULT;
      next.FAILURE = {
        PHASE: current.CURRENT_PHASE,
        RESULT: request.RESULT,
        REASON: request.REASON ?? request.RESULT
      };
      next.SAGA_STATUS = "FAILED";
      return;
    }
    throw new Error("PROVIDER_SAGA_RESULT_INVALID");
  });
}

export async function reconcileProviderBootstrapOutcomeV1(path, request) {
  return applySagaCas(path, {
    ...request,
    EVENT_TYPE: "PROVIDER_SAGA_OUTCOME_RECONCILED",
    EVENT_PAYLOAD: {
      PHASE: request?.PHASE,
      OPERATION_ID: request?.OPERATION_ID,
      OPERATION_IDEMPOTENCY_KEY: request?.OPERATION_IDEMPOTENCY_KEY,
      RECONCILED_RESULT: request?.RECONCILED_RESULT,
      EVIDENCE_SHA256: request?.EVIDENCE_SHA256,
      BILLING_STATUS: request?.BILLING_STATUS
    }
  }, (next, current) => {
    if (current.SAGA_STATUS !== "RECONCILIATION_REQUIRED") throw new Error("OUTCOME_UNKNOWN_NOT_ACTIVE");
    assertSameOperation(current, request);
    if (request.PHASE !== current.CURRENT_PHASE || request.PHASE !== current.ACTIVE_OPERATION.PHASE) throw new Error("PROVIDER_SAGA_PHASE_RECONCILE_MISMATCH");
    if (request.RECONCILED_RESULT === "PASS") {
      applySuccessfulPhase(next, current, { ...request, RESULT: "PASS" });
      return;
    }
    if (request.RECONCILED_RESULT === "FAIL" || request.RECONCILED_RESULT === "BLOCKED") {
      next.ACTIVE_OPERATION.RESULT = request.RECONCILED_RESULT;
      next.FAILURE = {
        PHASE: current.CURRENT_PHASE,
        RESULT: request.RECONCILED_RESULT,
        REASON: request.REASON ?? request.RECONCILED_RESULT
      };
      next.SAGA_STATUS = "FAILED";
      return;
    }
    if (request.RECONCILED_RESULT === "OUTCOME_UNKNOWN") {
      next.ACTIVE_OPERATION.RESULT = "OUTCOME_UNKNOWN";
      next.SAGA_STATUS = "RECONCILIATION_REQUIRED";
      return;
    }
    throw new Error("RECONCILED_RESULT_INVALID");
  });
}

export async function recordProviderObservedStateV1(path, request) {
  return applySagaCas(path, {
    ...request,
    EVENT_TYPE: "PROVIDER_OBSERVED_STATE_RECORDED",
    EVENT_PAYLOAD: { OBSERVATION: request?.OBSERVATION }
  }, (next, current) => {
    if (!isObject(request.OBSERVATION)) throw new Error("PROVIDER_OBSERVATION_REQUIRED");
    next.LAST_PROVIDER_OBSERVATION = {
      ...clone(request.OBSERVATION),
      OBSERVED_AT: runtimeIso(request.RUNTIME_NOW_MS)
    };
    next.CURRENT_PHASE = current.CURRENT_PHASE;
    next.COMPLETED_PHASES = clone(current.COMPLETED_PHASES);
    next.SAGA_STATUS = current.SAGA_STATUS;
    next.ACTIVE_OPERATION = clone(current.ACTIVE_OPERATION);
  });
}

export function deriveOneShotSessionTerminalProjectionV1(saga) {
  const validated = validateSaga(clone(saga));
  return Object.freeze({
    EXECUTION_TRANSPORT_DEREGISTERED: validated.EXECUTION_TRANSPORT_DEREGISTERED,
    REQUIRED_RESOURCE_CLEANUP_TERMINAL: validated.REQUIRED_RESOURCE_CLEANUP_TERMINAL,
    BILLING_STATUS: validated.BILLING_STATUS,
    PROVIDER_SAGA_COMPLETE: validated.SAGA_STATUS === "COMPLETE"
  });
}

export function validateProviderBootstrapSagaV1(saga) {
  try {
    validateSaga(saga);
    return { ok: true, errors: [] };
  } catch (error) {
    return { ok: false, errors: [error.message] };
  }
}
