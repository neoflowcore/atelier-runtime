import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { A5_POLICY } from "./pilote-capability-resource-security-consumer-v1.mjs";
import { readDurableExecutionStateV1, validateAuthoritativeFenceV1 } from "./durable-execution-state-v1.mjs";
import { readDurableWorkerJobLaunchV1 } from "./durable-worker-job-launch-v1.mjs";

export const WORKER_ISOLATION_BOUNDARY_SCHEMA_ID = "DURABLE_WORKER_ISOLATION_BOUNDARY_V1";
export const WORKER_ISOLATION_BOUNDARY_SCHEMA_VERSION = "1";
export const WORKER_ISOLATION_EVENT_SCHEMA_VERSION = "1";
export const WORKER_ISOLATION_STATUSES = Object.freeze(["AVAILABLE", "CLAIMED", "INVALID"]);

const SHA256_RE = /^[0-9a-f]{64}$/;
const STORE_KEYS = Object.freeze([
  "STORE_SCHEMA_ID", "STORE_SCHEMA_VERSION", "EVENT_SCHEMA_VERSION",
  "EXECUTION_ID", "ATTEMPT_ID", "FENCE_TOKEN", "WORKER_ID", "WORKER_JOB_SHA256",
  "WORKER_READY_ATTESTATION_HASH", "ISOLATION_PROFILE_SHA256",
  "WORKER_PRIVILEGED", "HOST_MOUNT_GRANTED", "HOST_SECRET_INHERITED",
  "PERSISTENT_WORKER", "UNTRUSTED_CODE_ON_PERSISTENT_WORKER",
  "ISOLATION_STATUS", "ACTIVE_CLAIM", "INVALID_REASON",
  "STATE_VERSION", "LAST_EVENT_SEQUENCE", "CREATED_AT", "UPDATED_AT",
  "IDEMPOTENCY_INDEX", "EVENT_LEDGER"
]);
const INVALID_REASONS = new Set(["TRUST_RESET", "POLICY_DRIFT", "WORKER_REATTESTED", "WORKER_REPLACED"]);

function isObject(value) { return !!value && typeof value === "object" && !Array.isArray(value); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function reqStr(value, code) { if (typeof value !== "string" || value.length === 0) throw new Error(code); return value; }
function reqSha(value, code) { if (!SHA256_RE.test(value ?? "")) throw new Error(code); return value; }
function reqInt(value, code) { if (!Number.isSafeInteger(value) || value < 0) throw new Error(code); return value; }
function exactKeys(value, expected) {
  if (!isObject(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}
function iso(ms) { return new Date(reqInt(ms, "RUNTIME_AUTHORITATIVE_TIME_REQUIRED")).toISOString(); }
function canonicalize(value) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") { if (!Number.isSafeInteger(value)) throw new Error("ISOLATION_NON_SAFE_INTEGER"); return String(value); }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  throw new Error("ISOLATION_CANONICAL_TYPE_INVALID");
}
function hashObject(value) { return createHash("sha256").update(canonicalize(value), "utf8").digest("hex"); }
function buildEvent(previousHash, sequence, eventType, idempotencyKey, stateVersion, timestamp, payload) {
  const body = {
    EVENT_SCHEMA_VERSION: WORKER_ISOLATION_EVENT_SCHEMA_VERSION,
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
function validateEvents(events) {
  if (!Array.isArray(events) || events.length === 0) throw new Error("ISOLATION_EVENT_LEDGER_REQUIRED");
  let previous = "0".repeat(64);
  let sequence = 1;
  for (const event of events) {
    if (!isObject(event) || event.EVENT_SEQUENCE !== sequence || event.PREVIOUS_EVENT_SHA256 !== previous) throw new Error("ISOLATION_EVENT_CHAIN_INVALID");
    const { EVENT_SHA256, ...body } = event;
    if (!SHA256_RE.test(EVENT_SHA256 ?? "") || hashObject(body) !== EVENT_SHA256) throw new Error("ISOLATION_EVENT_HASH_MISMATCH");
    previous = EVENT_SHA256;
    sequence += 1;
  }
}
function assertA5IsolationPolicy() {
  if (A5_POLICY.PRIVILEGED_WORKER !== "DENY_DEFAULT") throw new Error("A5_PRIVILEGED_WORKER_POLICY_NOT_BOUND");
  if (A5_POLICY.HOST_MOUNT_POLICY !== "DENY_DEFAULT") throw new Error("A5_HOST_MOUNT_POLICY_NOT_BOUND");
  if (A5_POLICY.HOST_SECRET_INHERITANCE !== "DENY") throw new Error("A5_HOST_SECRET_POLICY_NOT_BOUND");
  if (A5_POLICY.UNTRUSTED_CODE_ON_PERSISTENT_WORKER !== "DENY") throw new Error("A5_PERSISTENT_WORKER_POLICY_NOT_BOUND");
}
function assertIsolationFacts(facts) {
  if (!isObject(facts)) throw new Error("ISOLATION_FACTS_REQUIRED");
  if (facts.WORKER_PRIVILEGED !== false) throw new Error("PRIVILEGED_WORKER_DENY_DEFAULT");
  if (facts.HOST_MOUNT_GRANTED !== false) throw new Error("HOST_MOUNT_DENY_DEFAULT");
  if (facts.HOST_SECRET_INHERITED !== false) throw new Error("HOST_SECRET_INHERITANCE_DENIED");
  if (typeof facts.PERSISTENT_WORKER !== "boolean") throw new Error("PERSISTENT_WORKER_FLAG_REQUIRED");
  if (facts.UNTRUSTED_CODE_ON_PERSISTENT_WORKER !== false) throw new Error("UNTRUSTED_CODE_ON_PERSISTENT_WORKER_DENIED");
}
function validateStore(store) {
  if (!exactKeys(store, STORE_KEYS)) throw new Error("ISOLATION_STORE_FIELDS_MISMATCH");
  if (store.STORE_SCHEMA_ID !== WORKER_ISOLATION_BOUNDARY_SCHEMA_ID || store.STORE_SCHEMA_VERSION !== WORKER_ISOLATION_BOUNDARY_SCHEMA_VERSION || store.EVENT_SCHEMA_VERSION !== WORKER_ISOLATION_EVENT_SCHEMA_VERSION) throw new Error("ISOLATION_SCHEMA_MISMATCH");
  reqStr(store.EXECUTION_ID, "EXECUTION_ID_REQUIRED");
  reqStr(store.ATTEMPT_ID, "ATTEMPT_ID_REQUIRED");
  reqStr(store.FENCE_TOKEN, "FENCE_TOKEN_REQUIRED");
  reqStr(store.WORKER_ID, "WORKER_ID_REQUIRED");
  reqSha(store.WORKER_JOB_SHA256, "WORKER_JOB_SHA256_INVALID");
  reqSha(store.WORKER_READY_ATTESTATION_HASH, "WORKER_READY_ATTESTATION_HASH_INVALID");
  reqSha(store.ISOLATION_PROFILE_SHA256, "ISOLATION_PROFILE_SHA256_INVALID");
  assertIsolationFacts(store);
  if (!WORKER_ISOLATION_STATUSES.includes(store.ISOLATION_STATUS)) throw new Error("ISOLATION_STATUS_INVALID");
  if (store.ISOLATION_STATUS === "CLAIMED" && !isObject(store.ACTIVE_CLAIM)) throw new Error("ISOLATION_ACTIVE_CLAIM_REQUIRED");
  if (store.ISOLATION_STATUS === "INVALID" && !INVALID_REASONS.has(store.INVALID_REASON)) throw new Error("ISOLATION_INVALID_REASON_REQUIRED");
  reqInt(store.STATE_VERSION, "ISOLATION_STATE_VERSION_INVALID");
  reqInt(store.LAST_EVENT_SEQUENCE, "ISOLATION_EVENT_SEQUENCE_INVALID");
  if (!isObject(store.IDEMPOTENCY_INDEX)) throw new Error("ISOLATION_IDEMPOTENCY_INDEX_REQUIRED");
  validateEvents(store.EVENT_LEDGER);
  if (store.EVENT_LEDGER.length !== store.LAST_EVENT_SEQUENCE) throw new Error("ISOLATION_EVENT_SEQUENCE_MISMATCH");
  return store;
}
async function fsyncDir(path) { const handle = await open(path, "r"); try { await handle.sync(); } finally { await handle.close(); } }
async function atomicWrite(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}`;
  const handle = await open(temp, "wx", 0o600);
  try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8"); await handle.sync(); } finally { await handle.close(); }
  await rename(temp, path); await fsyncDir(dirname(path));
}
async function acquireLock(lockPath, code) {
  try {
    const handle = await open(lockPath, "wx", 0o600);
    await handle.writeFile(`${process.pid}\n`, "utf8"); await handle.sync();
    return { lockPath, handle };
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error(code);
    throw error;
  }
}
async function releaseLock(lock) { try { await lock.handle.close(); } finally { await unlink(lock.lockPath).catch(() => {}); } }
function requestFingerprint(request) { const copy = clone(request); delete copy.RUNTIME_NOW_MS; return hashObject(copy); }
function assertExecutionBinding(execution, store, submittedFenceToken) {
  const fence = validateAuthoritativeFenceV1(execution, submittedFenceToken);
  if (!fence.ok) throw new Error(fence.code);
  if (execution.EXECUTION_ID !== store.EXECUTION_ID) throw new Error("ISOLATION_EXECUTION_BINDING_MISMATCH");
  if (execution.ATTEMPT_ID !== store.ATTEMPT_ID) throw new Error("ISOLATION_ATTEMPT_BINDING_MISMATCH");
  if (execution.FENCE_TOKEN !== store.FENCE_TOKEN) throw new Error("ISOLATION_FENCE_BINDING_MISMATCH");
}
function assertLaunchIdentity(launch, store) {
  if (launch.WORKER_JOB_SHA256 !== store.WORKER_JOB_SHA256) throw new Error("ISOLATION_WORKER_JOB_BINDING_MISMATCH");
  if (launch.EXECUTION_ID !== store.EXECUTION_ID || launch.ATTEMPT_ID !== store.ATTEMPT_ID || launch.FENCE_TOKEN !== store.FENCE_TOKEN) throw new Error("ISOLATION_LAUNCH_LINEAGE_MISMATCH");
}

export async function readDurableWorkerIsolationBoundaryV1(path) {
  return validateStore(JSON.parse(await readFile(path, "utf8")));
}

export async function initializeDurableWorkerIsolationBoundaryV1(path, executionStatePath, launchStatePath, initial, runtimeNowMs) {
  assertA5IsolationPolicy();
  assertIsolationFacts(initial);
  const executionLock = await acquireLock(`${executionStatePath}.lock`, "EXECUTION_STATE_LOCKED_FOR_WORKER_ISOLATION");
  try {
    const execution = await readDurableExecutionStateV1(executionStatePath);
    const launch = await readDurableWorkerJobLaunchV1(launchStatePath);
    const submittedFenceToken = reqStr(initial.FENCE_TOKEN, "FENCE_TOKEN_REQUIRED");
    const fence = validateAuthoritativeFenceV1(execution, submittedFenceToken);
    if (!fence.ok) throw new Error(fence.code);
    if (execution.EXECUTION_ID !== initial.EXECUTION_ID || execution.ATTEMPT_ID !== initial.ATTEMPT_ID) throw new Error("ISOLATION_INITIAL_LINEAGE_MISMATCH");
    if (launch.WORKER_JOB_SHA256 !== initial.WORKER_JOB_SHA256 || launch.EXECUTION_ID !== initial.EXECUTION_ID || launch.ATTEMPT_ID !== initial.ATTEMPT_ID || launch.FENCE_TOKEN !== submittedFenceToken) throw new Error("ISOLATION_INITIAL_LAUNCH_BINDING_MISMATCH");
    if (launch.LAUNCH_STATUS !== "AVAILABLE") throw new Error("ISOLATION_REQUIRES_AVAILABLE_LAUNCH");
    const timestamp = iso(runtimeNowMs);
    const store = {
      STORE_SCHEMA_ID: WORKER_ISOLATION_BOUNDARY_SCHEMA_ID,
      STORE_SCHEMA_VERSION: WORKER_ISOLATION_BOUNDARY_SCHEMA_VERSION,
      EVENT_SCHEMA_VERSION: WORKER_ISOLATION_EVENT_SCHEMA_VERSION,
      EXECUTION_ID: reqStr(initial.EXECUTION_ID, "EXECUTION_ID_REQUIRED"),
      ATTEMPT_ID: reqStr(initial.ATTEMPT_ID, "ATTEMPT_ID_REQUIRED"),
      FENCE_TOKEN: submittedFenceToken,
      WORKER_ID: reqStr(initial.WORKER_ID, "WORKER_ID_REQUIRED"),
      WORKER_JOB_SHA256: reqSha(initial.WORKER_JOB_SHA256, "WORKER_JOB_SHA256_INVALID"),
      WORKER_READY_ATTESTATION_HASH: reqSha(initial.WORKER_READY_ATTESTATION_HASH, "WORKER_READY_ATTESTATION_HASH_INVALID"),
      ISOLATION_PROFILE_SHA256: reqSha(initial.ISOLATION_PROFILE_SHA256, "ISOLATION_PROFILE_SHA256_INVALID"),
      WORKER_PRIVILEGED: false,
      HOST_MOUNT_GRANTED: false,
      HOST_SECRET_INHERITED: false,
      PERSISTENT_WORKER: initial.PERSISTENT_WORKER,
      UNTRUSTED_CODE_ON_PERSISTENT_WORKER: false,
      ISOLATION_STATUS: "AVAILABLE",
      ACTIVE_CLAIM: null,
      INVALID_REASON: null,
      STATE_VERSION: 0,
      LAST_EVENT_SEQUENCE: 1,
      CREATED_AT: timestamp,
      UPDATED_AT: timestamp,
      IDEMPOTENCY_INDEX: {},
      EVENT_LEDGER: []
    };
    store.EVENT_LEDGER.push(buildEvent(
      "0".repeat(64), 1, "WORKER_ISOLATION_BOUNDARY_INITIALIZED", `init:${store.WORKER_JOB_SHA256}`, 0, timestamp,
      { WORKER_ID: store.WORKER_ID, WORKER_JOB_SHA256: store.WORKER_JOB_SHA256, WORKER_READY_ATTESTATION_HASH: store.WORKER_READY_ATTESTATION_HASH, ISOLATION_PROFILE_SHA256: store.ISOLATION_PROFILE_SHA256 }
    ));
    validateStore(store);
    const stateLock = await acquireLock(`${path}.lock`, "WORKER_ISOLATION_STATE_LOCKED");
    try {
      try { await readFile(path, "utf8"); throw new Error("WORKER_ISOLATION_BOUNDARY_ALREADY_EXISTS"); } catch (error) { if (error?.code !== "ENOENT") throw error; }
      await atomicWrite(path, store);
    } finally { await releaseLock(stateLock); }
    return clone(store);
  } finally { await releaseLock(executionLock); }
}

async function applyCas(path, request, mutate) {
  if (!isObject(request)) throw new Error("ISOLATION_CAS_REQUEST_REQUIRED");
  const key = reqStr(request.IDEMPOTENCY_KEY, "IDEMPOTENCY_KEY_REQUIRED");
  const timestamp = iso(request.RUNTIME_NOW_MS);
  const fingerprint = requestFingerprint(request);
  const stateLock = await acquireLock(`${path}.lock`, "WORKER_ISOLATION_STATE_LOCKED");
  try {
    const current = await readDurableWorkerIsolationBoundaryV1(path);
    const prior = current.IDEMPOTENCY_INDEX[key];
    if (prior) {
      if (prior.REQUEST_SHA256 !== fingerprint) throw new Error("ISOLATION_IDEMPOTENCY_KEY_CONFLICT");
      return { ok: true, replay: true, state: clone(current) };
    }
    if (request.EXPECTED_STATE_VERSION !== current.STATE_VERSION) throw new Error("ISOLATION_STATE_CAS_MISMATCH");
    const next = clone(current);
    mutate(next, current);
    next.STATE_VERSION = current.STATE_VERSION + 1;
    next.UPDATED_AT = timestamp;
    const sequence = current.LAST_EVENT_SEQUENCE + 1;
    next.EVENT_LEDGER.push(buildEvent(current.EVENT_LEDGER.at(-1).EVENT_SHA256, sequence, request.EVENT_TYPE, key, next.STATE_VERSION, timestamp, request.EVENT_PAYLOAD ?? {}));
    next.LAST_EVENT_SEQUENCE = sequence;
    next.IDEMPOTENCY_INDEX[key] = { REQUEST_SHA256: fingerprint, EVENT_SEQUENCE: sequence, STATE_VERSION: next.STATE_VERSION };
    validateStore(next);
    await atomicWrite(path, next);
    return { ok: true, replay: false, state: clone(next) };
  } finally { await releaseLock(stateLock); }
}

export async function claimWorkerIsolationBoundaryV1(path, executionStatePath, launchStatePath, request) {
  const executionLock = await acquireLock(`${executionStatePath}.lock`, "EXECUTION_STATE_LOCKED_FOR_WORKER_ISOLATION");
  try {
    const execution = await readDurableExecutionStateV1(executionStatePath);
    const launch = await readDurableWorkerJobLaunchV1(launchStatePath);
    const current = await readDurableWorkerIsolationBoundaryV1(path);
    assertExecutionBinding(execution, current, reqStr(request.SUBMITTED_FENCE_TOKEN, "SUBMITTED_FENCE_TOKEN_REQUIRED"));
    assertLaunchIdentity(launch, current);
    if (request.WORKER_ID !== current.WORKER_ID) throw new Error("ISOLATION_WORKER_BINDING_MISMATCH");
    if (request.WORKER_READY_ATTESTATION_HASH !== current.WORKER_READY_ATTESTATION_HASH) throw new Error("ISOLATION_ATTESTATION_BINDING_MISMATCH");
    if (request.ISOLATION_PROFILE_SHA256 !== current.ISOLATION_PROFILE_SHA256) throw new Error("ISOLATION_PROFILE_BINDING_MISMATCH");
    if (current.ISOLATION_STATUS === "INVALID") throw new Error("WORKER_ISOLATION_BOUNDARY_NOT_AVAILABLE");
    const samePriorClaim = current.ISOLATION_STATUS === "CLAIMED"
      && current.ACTIVE_CLAIM?.OPERATION_ID === request.OPERATION_ID
      && current.ACTIVE_CLAIM?.IDEMPOTENCY_KEY === request.OPERATION_IDEMPOTENCY_KEY;
    if (!samePriorClaim && launch.LAUNCH_STATUS !== "AVAILABLE") throw new Error("ISOLATION_REQUIRES_AVAILABLE_LAUNCH");
    return applyCas(path, {
      ...request,
      EVENT_TYPE: "WORKER_ISOLATION_BOUNDARY_CLAIMED",
      EVENT_PAYLOAD: { OPERATION_ID: request.OPERATION_ID, OPERATION_IDEMPOTENCY_KEY: request.OPERATION_IDEMPOTENCY_KEY, WORKER_ID: request.WORKER_ID, WORKER_JOB_SHA256: current.WORKER_JOB_SHA256 }
    }, (next, store) => {
      if (store.ISOLATION_STATUS !== "AVAILABLE") throw new Error("WORKER_ISOLATION_BOUNDARY_NOT_AVAILABLE");
      next.ISOLATION_STATUS = "CLAIMED";
      next.ACTIVE_CLAIM = {
        OPERATION_ID: reqStr(request.OPERATION_ID, "OPERATION_ID_REQUIRED"),
        IDEMPOTENCY_KEY: reqStr(request.OPERATION_IDEMPOTENCY_KEY, "OPERATION_IDEMPOTENCY_KEY_REQUIRED"),
        CLAIMED_AT: iso(request.RUNTIME_NOW_MS)
      };
    });
  } finally { await releaseLock(executionLock); }
}

export async function invalidateWorkerIsolationBoundaryV1(path, request) {
  const reason = request?.REASON;
  if (!INVALID_REASONS.has(reason)) throw new Error("ISOLATION_INVALID_REASON_INVALID");
  return applyCas(path, {
    ...request,
    EVENT_TYPE: "WORKER_ISOLATION_BOUNDARY_INVALIDATED",
    EVENT_PAYLOAD: { REASON: reason }
  }, (next, current) => {
    if (!["AVAILABLE", "CLAIMED"].includes(current.ISOLATION_STATUS)) throw new Error("WORKER_ISOLATION_BOUNDARY_NOT_INVALIDATABLE");
    next.ISOLATION_STATUS = "INVALID";
    next.INVALID_REASON = reason;
    next.ACTIVE_CLAIM = null;
  });
}

export function validateWorkerIsolationBoundaryV1(store) {
  try { validateStore(store); return { ok: true, errors: [] }; }
  catch (error) { return { ok: false, errors: [error.message] }; }
}
