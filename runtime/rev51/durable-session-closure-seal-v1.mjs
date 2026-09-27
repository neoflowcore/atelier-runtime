import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import {
  isSessionCompleteV1,
  readOneShotExecutionSessionV1
} from "./one-shot-execution-session-v1.mjs";

export const DURABLE_SESSION_CLOSURE_SEAL_SCHEMA_ID = "DURABLE_SESSION_CLOSURE_SEAL_V1";
export const DURABLE_SESSION_CLOSURE_SEAL_SCHEMA_VERSION = "1";
export const DURABLE_SESSION_CLOSURE_SEAL_POLICY = "OBSERVE_COMPLETE_SESSION_AND_SEAL";

const SHA256_RE = /^[0-9a-f]{64}$/;
const EXACT_KEYS = Object.freeze([
  "SEAL_SCHEMA_ID",
  "SEAL_SCHEMA_VERSION",
  "SEAL_POLICY",
  "SESSION_ID",
  "EXECUTION_PLAN_HASH",
  "EXECUTION_EPOCH",
  "ATTEMPT_ID",
  "LEASE_GENERATION",
  "FENCE_TOKEN",
  "SESSION_STATE_VERSION",
  "SESSION_EVENT_SEQUENCE",
  "SESSION_EVENT_SHA256",
  "SESSION_SNAPSHOT_SHA256",
  "TERMINAL_FLAGS",
  "BILLING_STATUS",
  "SEALED_AT",
  "IDEMPOTENCY_KEY",
  "REQUEST_SHA256",
  "CLOSURE_SEAL_SHA256"
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
function canonicalize(value) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("SESSION_CLOSURE_SEAL_NON_SAFE_INTEGER");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  }
  throw new Error("SESSION_CLOSURE_SEAL_UNSUPPORTED_CANONICAL_TYPE");
}
function hashObject(value) {
  return createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
}
function exactKeys(value, expected) {
  if (!isObject(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}
function requestFingerprint(request) {
  const copy = clone(request);
  delete copy.RUNTIME_NOW_MS;
  return hashObject(copy);
}
function sealHash(seal) {
  const copy = clone(seal);
  delete copy.CLOSURE_SEAL_SHA256;
  return hashObject(copy);
}
function sessionSnapshotHash(session) {
  return hashObject(session);
}
function validateTerminalFlags(flags) {
  if (!isObject(flags)) throw new Error("SESSION_CLOSURE_SEAL_TERMINAL_FLAGS_REQUIRED");
  const keys = [
    "EXECUTION_TERMINAL",
    "RECEIPT_TERMINAL",
    "EXECUTION_TRANSPORT_DEREGISTERED",
    "REQUIRED_RESOURCE_CLEANUP_TERMINAL"
  ];
  if (!exactKeys(flags, keys)) throw new Error("SESSION_CLOSURE_SEAL_TERMINAL_FLAGS_FIELDS_MISMATCH");
  for (const key of keys) {
    if (flags[key] !== true) throw new Error(`SESSION_CLOSURE_SEAL_TERMINAL_FLAG_NOT_TRUE:${key}`);
  }
}
function validateSeal(seal) {
  if (!exactKeys(seal, EXACT_KEYS)) throw new Error("SESSION_CLOSURE_SEAL_FIELDS_MISMATCH");
  if (seal.SEAL_SCHEMA_ID !== DURABLE_SESSION_CLOSURE_SEAL_SCHEMA_ID) throw new Error("SESSION_CLOSURE_SEAL_SCHEMA_ID_MISMATCH");
  if (seal.SEAL_SCHEMA_VERSION !== DURABLE_SESSION_CLOSURE_SEAL_SCHEMA_VERSION) throw new Error("SESSION_CLOSURE_SEAL_SCHEMA_VERSION_MISMATCH");
  if (seal.SEAL_POLICY !== DURABLE_SESSION_CLOSURE_SEAL_POLICY) throw new Error("SESSION_CLOSURE_SEAL_POLICY_MISMATCH");
  requireString(seal.SESSION_ID, "SESSION_CLOSURE_SEAL_SESSION_ID_REQUIRED");
  requireSha256(seal.EXECUTION_PLAN_HASH, "SESSION_CLOSURE_SEAL_EXECUTION_PLAN_HASH_INVALID");
  requirePositiveInteger(seal.EXECUTION_EPOCH, "SESSION_CLOSURE_SEAL_EXECUTION_EPOCH_INVALID");
  requireString(seal.ATTEMPT_ID, "SESSION_CLOSURE_SEAL_ATTEMPT_ID_REQUIRED");
  requirePositiveInteger(seal.LEASE_GENERATION, "SESSION_CLOSURE_SEAL_LEASE_GENERATION_INVALID");
  requireString(seal.FENCE_TOKEN, "SESSION_CLOSURE_SEAL_FENCE_TOKEN_REQUIRED");
  requireNonNegativeInteger(seal.SESSION_STATE_VERSION, "SESSION_CLOSURE_SEAL_SESSION_STATE_VERSION_INVALID");
  requirePositiveInteger(seal.SESSION_EVENT_SEQUENCE, "SESSION_CLOSURE_SEAL_SESSION_EVENT_SEQUENCE_INVALID");
  requireSha256(seal.SESSION_EVENT_SHA256, "SESSION_CLOSURE_SEAL_SESSION_EVENT_SHA256_INVALID");
  requireSha256(seal.SESSION_SNAPSHOT_SHA256, "SESSION_CLOSURE_SEAL_SESSION_SNAPSHOT_SHA256_INVALID");
  validateTerminalFlags(seal.TERMINAL_FLAGS);
  if (!["STOPPED", "NOT_APPLICABLE"].includes(seal.BILLING_STATUS)) throw new Error("SESSION_CLOSURE_SEAL_BILLING_STATUS_NOT_TERMINAL");
  if (typeof seal.SEALED_AT !== "string" || Number.isNaN(Date.parse(seal.SEALED_AT))) throw new Error("SESSION_CLOSURE_SEAL_SEALED_AT_INVALID");
  requireString(seal.IDEMPOTENCY_KEY, "SESSION_CLOSURE_SEAL_IDEMPOTENCY_KEY_REQUIRED");
  requireSha256(seal.REQUEST_SHA256, "SESSION_CLOSURE_SEAL_REQUEST_SHA256_INVALID");
  requireSha256(seal.CLOSURE_SEAL_SHA256, "SESSION_CLOSURE_SEAL_HASH_INVALID");
  if (sealHash(seal) !== seal.CLOSURE_SEAL_SHA256) throw new Error("SESSION_CLOSURE_SEAL_HASH_MISMATCH");
  return seal;
}
function assertCompleteSession(session, request) {
  if (session.SESSION_STATUS !== "COMPLETE" || !isSessionCompleteV1(session)) {
    throw new Error("SESSION_CLOSURE_SEAL_COMPLETE_SESSION_REQUIRED");
  }
  if (request.EXPECTED_SESSION_STATE_VERSION !== session.STATE_VERSION) {
    throw new Error("SESSION_CLOSURE_SEAL_SESSION_STATE_CAS_MISMATCH");
  }
  const event = session.EVENT_LEDGER.at(-1);
  if (request.EXPECTED_SESSION_EVENT_SHA256 !== event.EVENT_SHA256) {
    throw new Error("SESSION_CLOSURE_SEAL_SESSION_EVENT_HASH_MISMATCH");
  }
  return event;
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
  if (!lock) return;
  try { await lock.handle.close(); } finally { await unlink(lock.path).catch(() => {}); }
}
async function fsyncDirectory(path) {
  const handle = await open(path, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}
async function atomicWrite(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}`;
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
async function readSealIfPresent(path) {
  try {
    return validateSeal(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function readDurableSessionClosureSealV1(path) {
  return validateSeal(JSON.parse(await readFile(path, "utf8")));
}

export async function commitDurableSessionClosureSealV1(sessionPath, sealPath, request) {
  if (!isObject(request)) throw new Error("SESSION_CLOSURE_SEAL_REQUEST_REQUIRED");
  const idempotencyKey = requireString(request.IDEMPOTENCY_KEY, "IDEMPOTENCY_KEY_REQUIRED");
  requireNonNegativeInteger(request.EXPECTED_SESSION_STATE_VERSION, "EXPECTED_SESSION_STATE_VERSION_INVALID");
  requireSha256(request.EXPECTED_SESSION_EVENT_SHA256, "EXPECTED_SESSION_EVENT_SHA256_INVALID");
  const sealedAt = runtimeIso(request.RUNTIME_NOW_MS);
  const requestSha256 = requestFingerprint(request);

  let sessionLock = null;
  let sealLock = null;
  try {
    sessionLock = await acquireLock(`${sessionPath}.lock`, "SESSION_STATE_LOCKED_FOR_CLOSURE_SEAL");
    sealLock = await acquireLock(`${sealPath}.lock`, "SESSION_CLOSURE_SEAL_LOCKED");

    const session = await readOneShotExecutionSessionV1(sessionPath);
    const terminalEvent = assertCompleteSession(session, request);
    const existing = await readSealIfPresent(sealPath);
    if (existing) {
      if (existing.IDEMPOTENCY_KEY === idempotencyKey && existing.REQUEST_SHA256 === requestSha256) {
        if (existing.SESSION_SNAPSHOT_SHA256 !== sessionSnapshotHash(session)) {
          throw new Error("SESSION_CLOSURE_SEAL_REPLAY_SESSION_SNAPSHOT_MISMATCH");
        }
        return { ok: true, replay: true, seal: clone(existing) };
      }
      if (existing.IDEMPOTENCY_KEY === idempotencyKey) throw new Error("SESSION_CLOSURE_SEAL_IDEMPOTENCY_KEY_CONFLICT");
      throw new Error("SESSION_ALREADY_CLOSURE_SEALED");
    }

    const seal = {
      SEAL_SCHEMA_ID: DURABLE_SESSION_CLOSURE_SEAL_SCHEMA_ID,
      SEAL_SCHEMA_VERSION: DURABLE_SESSION_CLOSURE_SEAL_SCHEMA_VERSION,
      SEAL_POLICY: DURABLE_SESSION_CLOSURE_SEAL_POLICY,
      SESSION_ID: session.SESSION_ID,
      EXECUTION_PLAN_HASH: session.EXECUTION_PLAN_HASH,
      EXECUTION_EPOCH: session.EXECUTION_EPOCH,
      ATTEMPT_ID: session.ATTEMPT_ID,
      LEASE_GENERATION: session.LEASE_GENERATION,
      FENCE_TOKEN: session.FENCE_TOKEN,
      SESSION_STATE_VERSION: session.STATE_VERSION,
      SESSION_EVENT_SEQUENCE: session.LAST_EVENT_SEQUENCE,
      SESSION_EVENT_SHA256: terminalEvent.EVENT_SHA256,
      SESSION_SNAPSHOT_SHA256: sessionSnapshotHash(session),
      TERMINAL_FLAGS: {
        EXECUTION_TERMINAL: session.EXECUTION_TERMINAL,
        RECEIPT_TERMINAL: session.RECEIPT_TERMINAL,
        EXECUTION_TRANSPORT_DEREGISTERED: session.EXECUTION_TRANSPORT_DEREGISTERED,
        REQUIRED_RESOURCE_CLEANUP_TERMINAL: session.REQUIRED_RESOURCE_CLEANUP_TERMINAL
      },
      BILLING_STATUS: session.BILLING_STATUS,
      SEALED_AT: sealedAt,
      IDEMPOTENCY_KEY: idempotencyKey,
      REQUEST_SHA256: requestSha256,
      CLOSURE_SEAL_SHA256: "0".repeat(64)
    };
    seal.CLOSURE_SEAL_SHA256 = sealHash(seal);
    validateSeal(seal);
    await atomicWrite(sealPath, seal);
    return { ok: true, replay: false, seal: clone(seal) };
  } finally {
    await releaseLock(sealLock);
    await releaseLock(sessionLock);
  }
}

export function validateDurableSessionClosureSealV1(seal) {
  try {
    validateSeal(clone(seal));
    return { ok: true, errors: [] };
  } catch (error) {
    return { ok: false, errors: [error.message] };
  }
}
