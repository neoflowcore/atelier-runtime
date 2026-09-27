import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { readDurableExecutionStateV1, validateAuthoritativeFenceV1 } from "./durable-execution-state-v1.mjs";
import { readDurableWorkerJobLaunchV1 } from "./durable-worker-job-launch-v1.mjs";

export const EXECUTION_TRANSPORT_STORE_SCHEMA_ID = "DURABLE_EXECUTION_TRANSPORT_V1";
export const EXECUTION_TRANSPORT_STORE_SCHEMA_VERSION = "1";
export const EXECUTION_TRANSPORT_EVENT_SCHEMA_VERSION = "1";
export const EXECUTION_TRANSPORTS = Object.freeze(["DIRECT_WORKER", "GITHUB_SELF_HOSTED_JIT"]);
export const EXECUTION_TRANSPORT_STATES = Object.freeze(["PREPARING", "READY", "ACTIVE", "CLOSED", "FAILED", "OUTCOME_UNKNOWN"]);
export const EXECUTION_TRANSPORT_CONFORMANCE_RESULTS = Object.freeze(["PENDING", "PASS", "FAIL", "BLOCKED"]);

const SHA256_RE = /^[0-9a-f]{64}$/;
const STORE_KEYS = Object.freeze([
  "STORE_SCHEMA_ID",
  "STORE_SCHEMA_VERSION",
  "EVENT_SCHEMA_VERSION",
  "EXECUTION_TRANSPORT",
  "TRANSPORT_STATE",
  "CONFORMANCE_RESULT",
  "WORKER_ID",
  "EXECUTION_ID",
  "ATTEMPT_ID",
  "FENCE_TOKEN",
  "WORKER_JOB_SHA256",
  "CONFORMANCE_EVIDENCE_SHA256",
  "ACTIVE_OPERATION",
  "FAILURE",
  "CLOSED_AT",
  "STATE_VERSION",
  "LAST_EVENT_SEQUENCE",
  "CREATED_AT",
  "UPDATED_AT",
  "IDEMPOTENCY_INDEX",
  "EVENT_LEDGER"
]);
const INITIAL_KEYS = Object.freeze(["EXECUTION_TRANSPORT", "WORKER_ID"]);
const FORBIDDEN_RUNTIME_MATERIAL_KEYS = new Set([
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
function requireSha(value, code) {
  if (!SHA256_RE.test(value ?? "")) throw new Error(code);
  return value;
}
function requireInt(value, code) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(code);
  return value;
}
function exactKeys(value, expected) {
  if (!isObject(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}
function runtimeIso(runtimeNowMs) {
  return new Date(requireInt(runtimeNowMs, "RUNTIME_AUTHORITATIVE_TIME_REQUIRED")).toISOString();
}
function canonicalize(value) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("TRANSPORT_NON_SAFE_INTEGER");
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  }
  throw new Error("TRANSPORT_CANONICAL_TYPE_INVALID");
}
function hashObject(value) {
  return createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
}
function scanForbiddenMaterial(value, path = "$") {
  const errors = [];
  if (Array.isArray(value)) value.forEach((item, index) => errors.push(...scanForbiddenMaterial(item, `${path}[${index}]`)));
  else if (isObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_RUNTIME_MATERIAL_KEYS.has(key)) errors.push(`FORBIDDEN_TRANSPORT_MATERIAL:${path}.${key}`);
      errors.push(...scanForbiddenMaterial(child, `${path}.${key}`));
    }
  }
  return errors;
}
function event(previousHash, sequence, type, idempotencyKey, stateVersion, timestamp, payload) {
  const body = {
    EVENT_SCHEMA_VERSION: EXECUTION_TRANSPORT_EVENT_SCHEMA_VERSION,
    EVENT_SEQUENCE: sequence,
    EVENT_TYPE: type,
    IDEMPOTENCY_KEY: idempotencyKey,
    STATE_VERSION: stateVersion,
    TIMESTAMP: timestamp,
    PAYLOAD: clone(payload),
    PREVIOUS_EVENT_SHA256: previousHash
  };
  return { ...body, EVENT_SHA256: hashObject(body) };
}
function validateEventLedger(events) {
  if (!Array.isArray(events) || events.length === 0) throw new Error("TRANSPORT_EVENT_LEDGER_REQUIRED");
  let previousHash = "0".repeat(64);
  let sequence = 1;
  for (const entry of events) {
    if (!isObject(entry)) throw new Error("TRANSPORT_EVENT_INVALID");
    if (entry.EVENT_SEQUENCE !== sequence) throw new Error("TRANSPORT_EVENT_SEQUENCE_GAP");
    if (entry.PREVIOUS_EVENT_SHA256 !== previousHash) throw new Error("TRANSPORT_EVENT_PREVIOUS_HASH_MISMATCH");
    const { EVENT_SHA256, ...body } = entry;
    if (!SHA256_RE.test(EVENT_SHA256 ?? "") || hashObject(body) !== EVENT_SHA256) throw new Error("TRANSPORT_EVENT_HASH_MISMATCH");
    previousHash = EVENT_SHA256;
    sequence += 1;
  }
}
function validateActiveOperation(operation) {
  if (operation === null) return;
  if (!isObject(operation) || !exactKeys(operation, ["OPERATION_ID", "IDEMPOTENCY_KEY", "RESULT", "STARTED_AT"])) {
    throw new Error("TRANSPORT_ACTIVE_OPERATION_INVALID");
  }
  requireString(operation.OPERATION_ID, "TRANSPORT_OPERATION_ID_REQUIRED");
  requireString(operation.IDEMPOTENCY_KEY, "TRANSPORT_OPERATION_IDEMPOTENCY_REQUIRED");
  if (!new Set(["IN_PROGRESS", "OUTCOME_UNKNOWN"]).has(operation.RESULT)) throw new Error("TRANSPORT_OPERATION_RESULT_INVALID");
  if (typeof operation.STARTED_AT !== "string" || Number.isNaN(Date.parse(operation.STARTED_AT))) throw new Error("TRANSPORT_OPERATION_STARTED_AT_INVALID");
}
function validateStore(store) {
  if (!exactKeys(store, STORE_KEYS)) throw new Error("TRANSPORT_STORE_FIELDS_MISMATCH");
  if (store.STORE_SCHEMA_ID !== EXECUTION_TRANSPORT_STORE_SCHEMA_ID) throw new Error("TRANSPORT_STORE_SCHEMA_ID_MISMATCH");
  if (store.STORE_SCHEMA_VERSION !== EXECUTION_TRANSPORT_STORE_SCHEMA_VERSION) throw new Error("TRANSPORT_STORE_SCHEMA_VERSION_MISMATCH");
  if (store.EVENT_SCHEMA_VERSION !== EXECUTION_TRANSPORT_EVENT_SCHEMA_VERSION) throw new Error("TRANSPORT_EVENT_SCHEMA_VERSION_MISMATCH");
  if (!EXECUTION_TRANSPORTS.includes(store.EXECUTION_TRANSPORT)) throw new Error("EXECUTION_TRANSPORT_INVALID");
  if (!EXECUTION_TRANSPORT_STATES.includes(store.TRANSPORT_STATE)) throw new Error("TRANSPORT_STATE_INVALID");
  if (!EXECUTION_TRANSPORT_CONFORMANCE_RESULTS.includes(store.CONFORMANCE_RESULT)) throw new Error("TRANSPORT_CONFORMANCE_RESULT_INVALID");
  requireString(store.WORKER_ID, "TRANSPORT_WORKER_ID_REQUIRED");
  requireString(store.EXECUTION_ID, "TRANSPORT_EXECUTION_ID_REQUIRED");
  requireString(store.ATTEMPT_ID, "TRANSPORT_ATTEMPT_ID_REQUIRED");
  requireString(store.FENCE_TOKEN, "TRANSPORT_FENCE_TOKEN_REQUIRED");
  requireSha(store.WORKER_JOB_SHA256, "TRANSPORT_WORKER_JOB_SHA256_INVALID");
  if (store.CONFORMANCE_EVIDENCE_SHA256 !== null) requireSha(store.CONFORMANCE_EVIDENCE_SHA256, "TRANSPORT_CONFORMANCE_EVIDENCE_INVALID");
  validateActiveOperation(store.ACTIVE_OPERATION);
  if (store.FAILURE !== null && !isObject(store.FAILURE)) throw new Error("TRANSPORT_FAILURE_INVALID");
  if (store.CLOSED_AT !== null && (typeof store.CLOSED_AT !== "string" || Number.isNaN(Date.parse(store.CLOSED_AT)))) throw new Error("TRANSPORT_CLOSED_AT_INVALID");
  requireInt(store.STATE_VERSION, "TRANSPORT_STATE_VERSION_INVALID");
  requireInt(store.LAST_EVENT_SEQUENCE, "TRANSPORT_LAST_EVENT_SEQUENCE_INVALID");
  if (!isObject(store.IDEMPOTENCY_INDEX)) throw new Error("TRANSPORT_IDEMPOTENCY_INDEX_REQUIRED");
  validateEventLedger(store.EVENT_LEDGER);
  if (store.EVENT_LEDGER.length !== store.LAST_EVENT_SEQUENCE) throw new Error("TRANSPORT_EVENT_SEQUENCE_MISMATCH");
  if (store.TRANSPORT_STATE === "PREPARING" && store.CONFORMANCE_RESULT !== "PENDING") throw new Error("TRANSPORT_PREPARING_CONFORMANCE_MISMATCH");
  if (["READY", "ACTIVE", "CLOSED", "OUTCOME_UNKNOWN"].includes(store.TRANSPORT_STATE) && store.CONFORMANCE_RESULT !== "PASS") throw new Error("TRANSPORT_PASS_CONFORMANCE_REQUIRED");
  if (store.TRANSPORT_STATE === "FAILED" && !["FAIL", "BLOCKED", "PASS"].includes(store.CONFORMANCE_RESULT)) throw new Error("TRANSPORT_FAILED_CONFORMANCE_INVALID");
  if (store.TRANSPORT_STATE === "OUTCOME_UNKNOWN" && store.ACTIVE_OPERATION?.RESULT !== "OUTCOME_UNKNOWN") throw new Error("TRANSPORT_OUTCOME_UNKNOWN_OPERATION_REQUIRED");
  if (store.TRANSPORT_STATE === "CLOSED" && store.CLOSED_AT === null) throw new Error("TRANSPORT_CLOSED_AT_REQUIRED");
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
async function acquireLock(lockPath, code) {
  try {
    const handle = await open(lockPath, "wx", 0o600);
    await handle.writeFile(`${process.pid}\n`, "utf8");
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
  return hashObject(copy);
}
function assertCurrentBinding(executionState, launchState, transportState, submittedFenceToken) {
  const fence = validateAuthoritativeFenceV1(executionState, submittedFenceToken);
  if (!fence.ok) throw new Error(fence.code);
  if (executionState.EXECUTION_ID !== transportState.EXECUTION_ID) throw new Error("TRANSPORT_EXECUTION_BINDING_MISMATCH");
  if (executionState.ATTEMPT_ID !== transportState.ATTEMPT_ID) throw new Error("TRANSPORT_ATTEMPT_BINDING_MISMATCH");
  if (executionState.FENCE_TOKEN !== transportState.FENCE_TOKEN) throw new Error("TRANSPORT_FENCE_BINDING_MISMATCH");
  if (launchState.EXECUTION_ID !== transportState.EXECUTION_ID || launchState.ATTEMPT_ID !== transportState.ATTEMPT_ID || launchState.FENCE_TOKEN !== transportState.FENCE_TOKEN) {
    throw new Error("TRANSPORT_LAUNCH_LINEAGE_MISMATCH");
  }
  if (launchState.WORKER_JOB_SHA256 !== transportState.WORKER_JOB_SHA256) throw new Error("TRANSPORT_WORKER_JOB_BINDING_MISMATCH");
}
function assertSameOperation(store, request) {
  const operation = store.ACTIVE_OPERATION;
  if (!operation) throw new Error("TRANSPORT_ACTIVE_OPERATION_REQUIRED");
  if (operation.OPERATION_ID !== request.OPERATION_ID || operation.IDEMPOTENCY_KEY !== request.OPERATION_IDEMPOTENCY_KEY) {
    throw new Error("SECOND_MUTATION_DENIED");
  }
}

export async function readDurableExecutionTransportV1(path) {
  return validateStore(JSON.parse(await readFile(path, "utf8")));
}

export async function initializeDurableExecutionTransportV1(path, executionStatePath, workerLaunchPath, initial, runtimeNowMs) {
  if (!exactKeys(initial, INITIAL_KEYS)) throw new Error("TRANSPORT_INITIAL_FIELDS_MISMATCH");
  const forbidden = scanForbiddenMaterial(initial);
  if (forbidden.length) throw new Error(forbidden[0]);
  if (!EXECUTION_TRANSPORTS.includes(initial.EXECUTION_TRANSPORT)) throw new Error("EXECUTION_TRANSPORT_INVALID");
  const workerId = requireString(initial.WORKER_ID, "TRANSPORT_WORKER_ID_REQUIRED");
  const timestamp = runtimeIso(runtimeNowMs);
  const executionLock = await acquireLock(`${executionStatePath}.lock`, "EXECUTION_STATE_LOCKED_FOR_TRANSPORT");
  try {
    const launchLock = await acquireLock(`${workerLaunchPath}.lock`, "WORKER_JOB_LAUNCH_LOCKED_FOR_TRANSPORT");
    try {
      const executionState = await readDurableExecutionStateV1(executionStatePath);
      const launchState = await readDurableWorkerJobLaunchV1(workerLaunchPath);
      if (launchState.LAUNCH_STATUS !== "AVAILABLE") throw new Error("WORKER_JOB_LAUNCH_NOT_AVAILABLE_FOR_TRANSPORT_REGISTRATION");
      if (executionState.EXECUTION_ID !== launchState.EXECUTION_ID || executionState.ATTEMPT_ID !== launchState.ATTEMPT_ID || executionState.FENCE_TOKEN !== launchState.FENCE_TOKEN) {
        throw new Error("TRANSPORT_INITIAL_LINEAGE_MISMATCH");
      }
      const store = {
        STORE_SCHEMA_ID: EXECUTION_TRANSPORT_STORE_SCHEMA_ID,
        STORE_SCHEMA_VERSION: EXECUTION_TRANSPORT_STORE_SCHEMA_VERSION,
        EVENT_SCHEMA_VERSION: EXECUTION_TRANSPORT_EVENT_SCHEMA_VERSION,
        EXECUTION_TRANSPORT: initial.EXECUTION_TRANSPORT,
        TRANSPORT_STATE: "PREPARING",
        CONFORMANCE_RESULT: "PENDING",
        WORKER_ID: workerId,
        EXECUTION_ID: executionState.EXECUTION_ID,
        ATTEMPT_ID: executionState.ATTEMPT_ID,
        FENCE_TOKEN: executionState.FENCE_TOKEN,
        WORKER_JOB_SHA256: launchState.WORKER_JOB_SHA256,
        CONFORMANCE_EVIDENCE_SHA256: null,
        ACTIVE_OPERATION: null,
        FAILURE: null,
        CLOSED_AT: null,
        STATE_VERSION: 0,
        LAST_EVENT_SEQUENCE: 1,
        CREATED_AT: timestamp,
        UPDATED_AT: timestamp,
        IDEMPOTENCY_INDEX: {},
        EVENT_LEDGER: []
      };
      store.EVENT_LEDGER.push(event(
        "0".repeat(64),
        1,
        "EXECUTION_TRANSPORT_REGISTERED",
        `init:${store.EXECUTION_ID}:${store.WORKER_JOB_SHA256}`,
        0,
        timestamp,
        { EXECUTION_TRANSPORT: store.EXECUTION_TRANSPORT, WORKER_ID: store.WORKER_ID, WORKER_JOB_SHA256: store.WORKER_JOB_SHA256 }
      ));
      validateStore(store);
      const transportLock = await acquireLock(`${path}.lock`, "TRANSPORT_STORE_LOCKED");
      try {
        try {
          await readFile(path, "utf8");
          throw new Error("TRANSPORT_STORE_ALREADY_EXISTS");
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
        await atomicWriteJson(path, store);
      } finally {
        await releaseLock(transportLock);
      }
      return clone(store);
    } finally {
      await releaseLock(launchLock);
    }
  } finally {
    await releaseLock(executionLock);
  }
}

async function applyCas(path, request, mutate) {
  if (!isObject(request)) throw new Error("TRANSPORT_CAS_REQUEST_REQUIRED");
  const forbidden = scanForbiddenMaterial(request);
  if (forbidden.length) throw new Error(forbidden[0]);
  const idempotencyKey = requireString(request.IDEMPOTENCY_KEY, "IDEMPOTENCY_KEY_REQUIRED");
  const timestamp = runtimeIso(request.RUNTIME_NOW_MS);
  const fingerprint = requestFingerprint(request);
  const lock = await acquireLock(`${path}.lock`, "TRANSPORT_STORE_LOCKED");
  try {
    const current = await readDurableExecutionTransportV1(path);
    const prior = current.IDEMPOTENCY_INDEX[idempotencyKey];
    if (prior) {
      if (prior.REQUEST_SHA256 !== fingerprint) throw new Error("IDEMPOTENCY_KEY_CONFLICT");
      return { ok: true, replay: true, state: clone(current) };
    }
    if (request.EXPECTED_STATE_VERSION !== current.STATE_VERSION) throw new Error("TRANSPORT_STATE_CAS_MISMATCH");
    const next = clone(current);
    mutate(next, current);
    next.STATE_VERSION = current.STATE_VERSION + 1;
    next.UPDATED_AT = timestamp;
    const sequence = current.LAST_EVENT_SEQUENCE + 1;
    next.EVENT_LEDGER.push(event(
      current.EVENT_LEDGER.at(-1).EVENT_SHA256,
      sequence,
      requireString(request.EVENT_TYPE, "TRANSPORT_EVENT_TYPE_REQUIRED"),
      idempotencyKey,
      next.STATE_VERSION,
      timestamp,
      request.EVENT_PAYLOAD ?? {}
    ));
    next.LAST_EVENT_SEQUENCE = sequence;
    next.IDEMPOTENCY_INDEX[idempotencyKey] = { REQUEST_SHA256: fingerprint, EVENT_SEQUENCE: sequence, STATE_VERSION: next.STATE_VERSION };
    validateStore(next);
    await atomicWriteJson(path, next);
    return { ok: true, replay: false, state: clone(next) };
  } finally {
    await releaseLock(lock);
  }
}

export async function recordExecutionTransportConformanceV1(path, request) {
  const result = request?.CONFORMANCE_RESULT;
  if (!["PASS", "FAIL", "BLOCKED"].includes(result)) throw new Error("TRANSPORT_CONFORMANCE_RESULT_INVALID");
  const evidenceSha = requireSha(request?.CONFORMANCE_EVIDENCE_SHA256, "TRANSPORT_CONFORMANCE_EVIDENCE_INVALID");
  return applyCas(path, {
    ...request,
    EVENT_TYPE: "EXECUTION_TRANSPORT_CONFORMANCE_RECORDED",
    EVENT_PAYLOAD: { CONFORMANCE_RESULT: result, CONFORMANCE_EVIDENCE_SHA256: evidenceSha }
  }, (next, current) => {
    if (current.TRANSPORT_STATE !== "PREPARING" || current.CONFORMANCE_RESULT !== "PENDING") throw new Error("TRANSPORT_CONFORMANCE_ALREADY_FINALIZED");
    next.CONFORMANCE_RESULT = result;
    next.CONFORMANCE_EVIDENCE_SHA256 = evidenceSha;
    if (result === "PASS") {
      next.TRANSPORT_STATE = "READY";
      return;
    }
    next.TRANSPORT_STATE = "FAILED";
    next.FAILURE = { RESULT: result, REASON: request.REASON ?? result };
  });
}

export async function beginExecutionTransportActivationV1(path, executionStatePath, workerLaunchPath, request) {
  const executionLock = await acquireLock(`${executionStatePath}.lock`, "EXECUTION_STATE_LOCKED_FOR_TRANSPORT");
  try {
    const launchLock = await acquireLock(`${workerLaunchPath}.lock`, "WORKER_JOB_LAUNCH_LOCKED_FOR_TRANSPORT");
    try {
      const executionState = await readDurableExecutionStateV1(executionStatePath);
      const launchState = await readDurableWorkerJobLaunchV1(workerLaunchPath);
      const current = await readDurableExecutionTransportV1(path);
      assertCurrentBinding(executionState, launchState, current, requireString(request.SUBMITTED_FENCE_TOKEN, "SUBMITTED_FENCE_TOKEN_REQUIRED"));
      if (launchState.LAUNCH_STATUS !== "CLAIMED") throw new Error("WORKER_JOB_LAUNCH_MUST_BE_CLAIMED_BEFORE_TRANSPORT_ACTIVATION");
      return applyCas(path, {
        ...request,
        EVENT_TYPE: "EXECUTION_TRANSPORT_ACTIVATION_CLAIMED",
        EVENT_PAYLOAD: { OPERATION_ID: request.OPERATION_ID, OPERATION_IDEMPOTENCY_KEY: request.OPERATION_IDEMPOTENCY_KEY, WORKER_ID: current.WORKER_ID }
      }, (next, store) => {
        if (store.TRANSPORT_STATE === "OUTCOME_UNKNOWN") throw new Error("TRANSPORT_RECONCILIATION_REQUIRED");
        if (store.TRANSPORT_STATE !== "READY") throw new Error("TRANSPORT_NOT_READY");
        if (store.CONFORMANCE_RESULT !== "PASS") throw new Error("TRANSPORT_CONFORMANCE_PASS_REQUIRED");
        if (store.ACTIVE_OPERATION !== null) throw new Error("TRANSPORT_ACTIVATION_ALREADY_CLAIMED");
        next.ACTIVE_OPERATION = {
          OPERATION_ID: requireString(request.OPERATION_ID, "TRANSPORT_OPERATION_ID_REQUIRED"),
          IDEMPOTENCY_KEY: requireString(request.OPERATION_IDEMPOTENCY_KEY, "TRANSPORT_OPERATION_IDEMPOTENCY_REQUIRED"),
          RESULT: "IN_PROGRESS",
          STARTED_AT: runtimeIso(request.RUNTIME_NOW_MS)
        };
      });
    } finally {
      await releaseLock(launchLock);
    }
  } finally {
    await releaseLock(executionLock);
  }
}

export async function recordExecutionTransportActivationResultV1(path, request) {
  return applyCas(path, {
    ...request,
    EVENT_TYPE: request?.RESULT === "OUTCOME_UNKNOWN" ? "EXECUTION_TRANSPORT_ACTIVATION_OUTCOME_UNKNOWN" : "EXECUTION_TRANSPORT_ACTIVATION_RESULT",
    EVENT_PAYLOAD: { OPERATION_ID: request?.OPERATION_ID, OPERATION_IDEMPOTENCY_KEY: request?.OPERATION_IDEMPOTENCY_KEY, RESULT: request?.RESULT, EVIDENCE_SHA256: request?.EVIDENCE_SHA256 }
  }, (next, current) => {
    if (current.TRANSPORT_STATE === "OUTCOME_UNKNOWN") throw new Error("TRANSPORT_RECONCILIATION_REQUIRED");
    if (current.TRANSPORT_STATE !== "READY" || current.ACTIVE_OPERATION === null) throw new Error("TRANSPORT_ACTIVATION_NOT_CLAIMED");
    assertSameOperation(current, request);
    if (request.EVIDENCE_SHA256 !== undefined) requireSha(request.EVIDENCE_SHA256, "TRANSPORT_ACTIVATION_EVIDENCE_INVALID");
    if (request.RESULT === "PASS") {
      next.TRANSPORT_STATE = "ACTIVE";
      next.ACTIVE_OPERATION = null;
      return;
    }
    if (request.RESULT === "OUTCOME_UNKNOWN") {
      next.TRANSPORT_STATE = "OUTCOME_UNKNOWN";
      next.ACTIVE_OPERATION.RESULT = "OUTCOME_UNKNOWN";
      return;
    }
    if (request.RESULT === "FAIL" || request.RESULT === "BLOCKED") {
      next.TRANSPORT_STATE = "FAILED";
      next.ACTIVE_OPERATION = null;
      next.FAILURE = { RESULT: request.RESULT, REASON: request.REASON ?? request.RESULT };
      return;
    }
    throw new Error("TRANSPORT_ACTIVATION_RESULT_INVALID");
  });
}

export async function reconcileExecutionTransportActivationV1(path, request) {
  return applyCas(path, {
    ...request,
    EVENT_TYPE: "EXECUTION_TRANSPORT_ACTIVATION_RECONCILED",
    EVENT_PAYLOAD: { OPERATION_ID: request?.OPERATION_ID, OPERATION_IDEMPOTENCY_KEY: request?.OPERATION_IDEMPOTENCY_KEY, RECONCILED_RESULT: request?.RECONCILED_RESULT, EVIDENCE_SHA256: request?.EVIDENCE_SHA256 }
  }, (next, current) => {
    if (current.TRANSPORT_STATE !== "OUTCOME_UNKNOWN") throw new Error("TRANSPORT_OUTCOME_UNKNOWN_NOT_ACTIVE");
    assertSameOperation(current, request);
    if (request.EVIDENCE_SHA256 !== undefined) requireSha(request.EVIDENCE_SHA256, "TRANSPORT_ACTIVATION_EVIDENCE_INVALID");
    if (request.RECONCILED_RESULT === "PASS") {
      next.TRANSPORT_STATE = "ACTIVE";
      next.ACTIVE_OPERATION = null;
      return;
    }
    if (request.RECONCILED_RESULT === "OUTCOME_UNKNOWN") {
      next.TRANSPORT_STATE = "OUTCOME_UNKNOWN";
      return;
    }
    if (request.RECONCILED_RESULT === "FAIL" || request.RECONCILED_RESULT === "BLOCKED") {
      next.TRANSPORT_STATE = "FAILED";
      next.ACTIVE_OPERATION = null;
      next.FAILURE = { RESULT: request.RECONCILED_RESULT, REASON: request.REASON ?? request.RECONCILED_RESULT };
      return;
    }
    throw new Error("TRANSPORT_RECONCILED_RESULT_INVALID");
  });
}

export async function closeExecutionTransportV1(path, request) {
  const evidenceSha = requireSha(request?.DEREGISTRATION_EVIDENCE_SHA256, "TRANSPORT_DEREGISTRATION_EVIDENCE_INVALID");
  return applyCas(path, {
    ...request,
    EVENT_TYPE: "EXECUTION_TRANSPORT_CLOSED",
    EVENT_PAYLOAD: { DEREGISTRATION_EVIDENCE_SHA256: evidenceSha }
  }, (next, current) => {
    if (!["ACTIVE", "FAILED"].includes(current.TRANSPORT_STATE)) throw new Error("TRANSPORT_NOT_CLOSABLE");
    if (current.ACTIVE_OPERATION !== null) throw new Error("TRANSPORT_ACTIVE_OPERATION_NOT_TERMINAL");
    next.TRANSPORT_STATE = "CLOSED";
    next.CLOSED_AT = runtimeIso(request.RUNTIME_NOW_MS);
  });
}

export function validateExecutionTransportDispatchGateV1(store, request) {
  try {
    validateStore(store);
    if (store.TRANSPORT_STATE !== "ACTIVE") throw new Error("TRANSPORT_NOT_ACTIVE");
    if (store.CONFORMANCE_RESULT !== "PASS") throw new Error("TRANSPORT_CONFORMANCE_PASS_REQUIRED");
    if (request.EXECUTION_ID !== store.EXECUTION_ID) throw new Error("TRANSPORT_EXECUTION_BINDING_MISMATCH");
    if (request.ATTEMPT_ID !== store.ATTEMPT_ID) throw new Error("TRANSPORT_ATTEMPT_BINDING_MISMATCH");
    if (request.FENCE_TOKEN !== store.FENCE_TOKEN) throw new Error("STALE_FENCE_REJECTED");
    if (request.WORKER_ID !== store.WORKER_ID) throw new Error("TRANSPORT_WORKER_BINDING_MISMATCH");
    if (request.WORKER_JOB_SHA256 !== store.WORKER_JOB_SHA256) throw new Error("TRANSPORT_WORKER_JOB_BINDING_MISMATCH");
    return { ok: true, code: "EXECUTION_TRANSPORT_ACTIVE" };
  } catch (error) {
    return { ok: false, code: error.message };
  }
}

export function validateDurableExecutionTransportV1(store) {
  try {
    validateStore(store);
    return { ok: true, errors: [] };
  } catch (error) {
    return { ok: false, errors: [error.message] };
  }
}
