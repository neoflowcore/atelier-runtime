import { createHash } from "node:crypto";
import {
  readDurableExecutionStateV1,
  validateAuthoritativeFenceV1
} from "./durable-execution-state-v1.mjs";
import {
  readOneShotExecutionSessionV1,
  recordOneShotSessionProgressV1,
  validateSessionAgainstDurableExecutionStateV1
} from "./one-shot-execution-session-v1.mjs";

export const A5T_AUTHORITATIVE_BINDING = Object.freeze({
  REPOSITORY: "neoflowcore/atelier-runtime",
  BRANCH: "pilote-r51-a5t-execution-terminal-semantic-binding",
  HEAD: "e74a428d1c987aaec396a8a144869747b42360e9",
  TREE: "1a403580a090edc8747c156ae67cd9031fbcf439",
  MODULE_SHA256: "e0f14ed0e1f25bf86f38cf6b95e89aed657f68233a2def401f57572ad0dc3a5b",
  SCHEMA_SHA256: "a02d12215955e8b3fcfc663a6123002303d3ed80fe395d9aed97e0212cec6336",
  CANONICALIZATION_ID: "ATELIER_EXECUTION_CANONICAL_JSON_V1",
  TEST_VECTOR_SET_SHA256: "73d0840feff0977e7ebd6c1e91e66055fe4f3bdf6c8c59e569fdae24ef9e6fc1",
  EXPECTED_RESULT_SET_SHA256: "62c85eeaac53bfc69adefdf9d54b0c6c76e03dabb51470876a35206aec669095",
  AUTHORITATIVE_MANIFEST_SHA256: "4e8a77efd1171d82dcc20e1b1908e5cafefd3284477f9f8a7af375354956b3a8",
  SOURCE_STATUS_SCHEMA_PATH: "schemas/rev51/execution-session-status-v1.schema.json",
  SOURCE_STATUS_SCHEMA_SHA256: "fd612bf9556b20b9434d6218ec437d9ec61dfe447f1d9eb534fbb4e7a2a3b5f2",
  SOURCE_STATUS_SCHEMA_GIT_BLOB: "d0e0c62d1b387d39eb911e493eeb459e283e626a",
  CONTRACT_SET_ID: "ATELIER_REV51_CONTRACT_SET_V1",
  CONTRACT_SET_VERSION: "1.0.0",
  CONTRACT_SET_SHA256: "a8b220c92a47306061e9aca1c65077d357b00bda12e9daad4f37215256083f4a",
  A5T_BINDING_SHA256: "0c26ecc91d6a8f9ebba390f9168ec9e7681f6915a87070a15d74df06f22bdaca"
});

export const A5T_EXECUTION_STATES = Object.freeze([
  "REQUESTED", "READY", "RUNNING", "SUCCEEDED",
  "FAILED", "CANCELED", "EXPIRED", "OUTCOME_UNKNOWN"
]);
export const A5T_TERMINAL_STATES = Object.freeze(["SUCCEEDED", "FAILED", "CANCELED", "EXPIRED"]);
export const A5T_NON_TERMINAL_STATES = Object.freeze(["REQUESTED", "READY", "RUNNING", "OUTCOME_UNKNOWN"]);

const RESOURCE_STATES = new Set(["NOT_ALLOCATED", "ALLOCATED", "CLEANUP_PENDING", "CLEANED", "CLEANUP_FAILED", "UNKNOWN"]);
const BILLING_STATES = new Set(["NOT_APPLICABLE", "ACTIVE", "STOP_REQUESTED", "STOPPED", "UNKNOWN"]);
const PROVIDER_OPERATION_STATES = new Set(["PENDING", "SUCCEEDED", "FAILED", "OUTCOME_UNKNOWN"]);
const SHA256_RE = /^[0-9a-f]{64}$/;
const STATUS_KEYS = Object.freeze([
  "SESSION_ID", "EXECUTION_STATE", "RESOURCE_STATE", "BILLING_STATE",
  "PROVIDER_OPERATION_STATE", "CHAT_DISCONNECTED", "ANDROID_OFFLINE", "SSH_DISCONNECTED"
]);
const EVIDENCE_KEYS = Object.freeze([
  "EVIDENCE_TYPE", "EVIDENCE_VERSION", "STATUS_SCHEMA_REF", "SESSION_ID", "EXECUTION_ID",
  "EXECUTION_EPOCH", "ATTEMPT_ID", "LEASE_GENERATION", "FENCE_TOKEN", "SOURCE_STATE_VERSION",
  "SOURCE_EVENT_SHA256", "OPERATION_ID", "OPERATION_IDEMPOTENCY_KEY", "EXECUTION_SESSION_STATUS",
  "RECONCILIATION_REQUIRED", "ACCEPTANCE_IMPLIED", "EVIDENCE_SHA256"
]);

function isObject(value) { return !!value && typeof value === "object" && !Array.isArray(value); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function exactKeys(value, expected) {
  if (!isObject(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}
function requireString(value, code) { if (typeof value !== "string" || !value) throw new Error(code); return value; }
function requireSha256(value, code) { if (!SHA256_RE.test(value ?? "")) throw new Error(code); return value; }
function requirePositiveInteger(value, code) { if (!Number.isSafeInteger(value) || value <= 0) throw new Error(code); return value; }
function requireNonNegativeInteger(value, code) { if (!Number.isSafeInteger(value) || value < 0) throw new Error(code); return value; }
function canonicalize(value) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("A5T_RUNTIME_NON_SAFE_INTEGER");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  throw new Error("A5T_RUNTIME_UNSUPPORTED_CANONICAL_TYPE");
}
function hashObject(value) { return createHash("sha256").update(canonicalize(value), "utf8").digest("hex"); }
function evidenceHash(evidence) { const copy = clone(evidence); delete copy.EVIDENCE_SHA256; return hashObject(copy); }

export function validateA5TSourceStatusV1(status) {
  const errors = [];
  if (!exactKeys(status, STATUS_KEYS)) errors.push("SOURCE_STATUS_FIELDS_MISMATCH");
  if (typeof status?.SESSION_ID !== "string" || !status.SESSION_ID) errors.push("SOURCE_STATUS_SESSION_ID_INVALID");
  if (!A5T_EXECUTION_STATES.includes(status?.EXECUTION_STATE)) errors.push("SOURCE_STATUS_EXECUTION_STATE_INVALID");
  if (!RESOURCE_STATES.has(status?.RESOURCE_STATE)) errors.push("SOURCE_STATUS_RESOURCE_STATE_INVALID");
  if (!BILLING_STATES.has(status?.BILLING_STATE)) errors.push("SOURCE_STATUS_BILLING_STATE_INVALID");
  if (!PROVIDER_OPERATION_STATES.has(status?.PROVIDER_OPERATION_STATE)) errors.push("SOURCE_STATUS_PROVIDER_OPERATION_STATE_INVALID");
  for (const key of ["CHAT_DISCONNECTED", "ANDROID_OFFLINE", "SSH_DISCONNECTED"]) {
    if (status?.[key] !== "NO_EFFECT") errors.push(`SOURCE_STATUS_${key}_MISMATCH`);
  }
  return { ok: errors.length === 0, errors };
}

export function deriveA5TExecutionTerminalProjectionV1(executionState) {
  if (!A5T_EXECUTION_STATES.includes(executionState)) throw new Error("A5T_EXECUTION_STATE_UNSUPPORTED");
  return Object.freeze({
    EXECUTION_STATE: executionState,
    EXECUTION_TERMINAL: A5T_TERMINAL_STATES.includes(executionState),
    RECONCILIATION_REQUIRED: executionState === "OUTCOME_UNKNOWN",
    ACCEPTANCE_IMPLIED: false,
    RUNTIME_EVIDENCE_REQUIRED: true
  });
}

export function validateRuntimeExecutionTerminalEvidenceV1(evidence) {
  const errors = [];
  if (!exactKeys(evidence, EVIDENCE_KEYS)) errors.push("RUNTIME_EXECUTION_TERMINAL_EVIDENCE_FIELDS_MISMATCH");
  if (evidence?.EVIDENCE_TYPE !== "RUNTIME_EXECUTION_STATUS_EVIDENCE_V1") errors.push("RUNTIME_EXECUTION_TERMINAL_EVIDENCE_TYPE_MISMATCH");
  if (evidence?.EVIDENCE_VERSION !== "1") errors.push("RUNTIME_EXECUTION_TERMINAL_EVIDENCE_VERSION_MISMATCH");
  const ref = evidence?.STATUS_SCHEMA_REF;
  if (!isObject(ref)
      || ref.PATH !== A5T_AUTHORITATIVE_BINDING.SOURCE_STATUS_SCHEMA_PATH
      || ref.SHA256 !== A5T_AUTHORITATIVE_BINDING.SOURCE_STATUS_SCHEMA_SHA256
      || ref.GIT_BLOB !== A5T_AUTHORITATIVE_BINDING.SOURCE_STATUS_SCHEMA_GIT_BLOB) {
    errors.push("SOURCE_STATUS_SCHEMA_REF_MISMATCH");
  }
  if (typeof evidence?.SESSION_ID !== "string" || !evidence.SESSION_ID) errors.push("RUNTIME_EVIDENCE_SESSION_ID_INVALID");
  if (typeof evidence?.EXECUTION_ID !== "string" || !evidence.EXECUTION_ID) errors.push("RUNTIME_EVIDENCE_EXECUTION_ID_INVALID");
  if (!Number.isSafeInteger(evidence?.EXECUTION_EPOCH) || evidence.EXECUTION_EPOCH <= 0) errors.push("RUNTIME_EVIDENCE_EXECUTION_EPOCH_INVALID");
  if (typeof evidence?.ATTEMPT_ID !== "string" || !evidence.ATTEMPT_ID) errors.push("RUNTIME_EVIDENCE_ATTEMPT_ID_INVALID");
  if (!Number.isSafeInteger(evidence?.LEASE_GENERATION) || evidence.LEASE_GENERATION <= 0) errors.push("RUNTIME_EVIDENCE_LEASE_GENERATION_INVALID");
  if (typeof evidence?.FENCE_TOKEN !== "string" || !evidence.FENCE_TOKEN) errors.push("RUNTIME_EVIDENCE_FENCE_TOKEN_INVALID");
  if (!Number.isSafeInteger(evidence?.SOURCE_STATE_VERSION) || evidence.SOURCE_STATE_VERSION < 0) errors.push("RUNTIME_EVIDENCE_SOURCE_STATE_VERSION_INVALID");
  if (!SHA256_RE.test(evidence?.SOURCE_EVENT_SHA256 ?? "")) errors.push("RUNTIME_EVIDENCE_SOURCE_EVENT_SHA256_INVALID");
  if (typeof evidence?.OPERATION_ID !== "string" || !evidence.OPERATION_ID) errors.push("RUNTIME_EVIDENCE_OPERATION_ID_INVALID");
  if (typeof evidence?.OPERATION_IDEMPOTENCY_KEY !== "string" || !evidence.OPERATION_IDEMPOTENCY_KEY) errors.push("RUNTIME_EVIDENCE_OPERATION_IDEMPOTENCY_KEY_INVALID");
  const status = validateA5TSourceStatusV1(evidence?.EXECUTION_SESSION_STATUS);
  if (!status.ok) errors.push(...status.errors);
  if (evidence?.EXECUTION_SESSION_STATUS?.SESSION_ID !== evidence?.SESSION_ID) errors.push("RUNTIME_EVIDENCE_STATUS_SESSION_ID_MISMATCH");
  const expectedProjection = A5T_EXECUTION_STATES.includes(evidence?.EXECUTION_SESSION_STATUS?.EXECUTION_STATE)
    ? deriveA5TExecutionTerminalProjectionV1(evidence.EXECUTION_SESSION_STATUS.EXECUTION_STATE)
    : null;
  if (expectedProjection && evidence.RECONCILIATION_REQUIRED !== expectedProjection.RECONCILIATION_REQUIRED) errors.push("RUNTIME_EVIDENCE_RECONCILIATION_REQUIRED_MISMATCH");
  if (evidence?.ACCEPTANCE_IMPLIED !== false) errors.push("RUNTIME_EVIDENCE_ACCEPTANCE_IMPLICATION_DENIED");
  if (!SHA256_RE.test(evidence?.EVIDENCE_SHA256 ?? "")) errors.push("RUNTIME_EVIDENCE_SHA256_INVALID");
  else {
    try { if (evidenceHash(evidence) !== evidence.EVIDENCE_SHA256) errors.push("RUNTIME_EVIDENCE_SHA256_MISMATCH"); }
    catch (error) { errors.push(`RUNTIME_EVIDENCE_CANONICALIZATION_REJECTED:${error.message}`); }
  }
  return { ok: errors.length === 0, errors };
}

export function buildRuntimeExecutionTerminalEvidenceV1(input) {
  if (!isObject(input)) throw new Error("RUNTIME_EXECUTION_TERMINAL_EVIDENCE_INPUT_REQUIRED");
  const statusResult = validateA5TSourceStatusV1(input.EXECUTION_SESSION_STATUS);
  if (!statusResult.ok) throw new Error(`SOURCE_STATUS_INVALID:${statusResult.errors.join("|")}`);
  const projection = deriveA5TExecutionTerminalProjectionV1(input.EXECUTION_SESSION_STATUS.EXECUTION_STATE);
  const evidence = {
    EVIDENCE_TYPE: "RUNTIME_EXECUTION_STATUS_EVIDENCE_V1",
    EVIDENCE_VERSION: "1",
    STATUS_SCHEMA_REF: {
      PATH: A5T_AUTHORITATIVE_BINDING.SOURCE_STATUS_SCHEMA_PATH,
      SHA256: A5T_AUTHORITATIVE_BINDING.SOURCE_STATUS_SCHEMA_SHA256,
      GIT_BLOB: A5T_AUTHORITATIVE_BINDING.SOURCE_STATUS_SCHEMA_GIT_BLOB
    },
    SESSION_ID: requireString(input.SESSION_ID, "RUNTIME_EVIDENCE_SESSION_ID_REQUIRED"),
    EXECUTION_ID: requireString(input.EXECUTION_ID, "RUNTIME_EVIDENCE_EXECUTION_ID_REQUIRED"),
    EXECUTION_EPOCH: requirePositiveInteger(input.EXECUTION_EPOCH, "RUNTIME_EVIDENCE_EXECUTION_EPOCH_REQUIRED"),
    ATTEMPT_ID: requireString(input.ATTEMPT_ID, "RUNTIME_EVIDENCE_ATTEMPT_ID_REQUIRED"),
    LEASE_GENERATION: requirePositiveInteger(input.LEASE_GENERATION, "RUNTIME_EVIDENCE_LEASE_GENERATION_REQUIRED"),
    FENCE_TOKEN: requireString(input.FENCE_TOKEN, "RUNTIME_EVIDENCE_FENCE_TOKEN_REQUIRED"),
    SOURCE_STATE_VERSION: requireNonNegativeInteger(input.SOURCE_STATE_VERSION, "RUNTIME_EVIDENCE_SOURCE_STATE_VERSION_REQUIRED"),
    SOURCE_EVENT_SHA256: requireSha256(input.SOURCE_EVENT_SHA256, "RUNTIME_EVIDENCE_SOURCE_EVENT_SHA256_REQUIRED"),
    OPERATION_ID: requireString(input.OPERATION_ID, "RUNTIME_EVIDENCE_OPERATION_ID_REQUIRED"),
    OPERATION_IDEMPOTENCY_KEY: requireString(input.OPERATION_IDEMPOTENCY_KEY, "RUNTIME_EVIDENCE_OPERATION_IDEMPOTENCY_KEY_REQUIRED"),
    EXECUTION_SESSION_STATUS: clone(input.EXECUTION_SESSION_STATUS),
    RECONCILIATION_REQUIRED: projection.RECONCILIATION_REQUIRED,
    ACCEPTANCE_IMPLIED: false,
    EVIDENCE_SHA256: "0".repeat(64)
  };
  evidence.EVIDENCE_SHA256 = evidenceHash(evidence);
  const result = validateRuntimeExecutionTerminalEvidenceV1(evidence);
  if (!result.ok) throw new Error(`BUILT_RUNTIME_EVIDENCE_INVALID:${result.errors.join("|")}`);
  return evidence;
}

export async function bindA5TExecutionTerminalToSessionV1(statePath, sessionPath, evidence, request) {
  if (!isObject(request)) throw new Error("A5T_RUNTIME_BIND_REQUEST_REQUIRED");
  const evidenceResult = validateRuntimeExecutionTerminalEvidenceV1(evidence);
  if (!evidenceResult.ok) throw new Error(`A5T_RUNTIME_EVIDENCE_REJECTED:${evidenceResult.errors.join("|")}`);

  const state = await readDurableExecutionStateV1(statePath);
  const session = await readOneShotExecutionSessionV1(sessionPath);
  const sessionBinding = validateSessionAgainstDurableExecutionStateV1(session, state);
  if (!sessionBinding.ok) throw new Error(`A5T_SESSION_STATE_BINDING_REJECTED:${sessionBinding.errors.join("|")}`);

  if (evidence.SESSION_ID !== session.SESSION_ID) throw new Error("A5T_RUNTIME_EVIDENCE_SESSION_ID_MISMATCH");
  if (evidence.EXECUTION_ID !== state.EXECUTION_ID) throw new Error("A5T_RUNTIME_EVIDENCE_EXECUTION_ID_MISMATCH");
  if (evidence.EXECUTION_EPOCH !== state.EXECUTION_EPOCH) throw new Error("A5T_RUNTIME_EVIDENCE_EXECUTION_EPOCH_MISMATCH");
  if (evidence.ATTEMPT_ID !== state.ATTEMPT_ID) throw new Error("A5T_RUNTIME_EVIDENCE_ATTEMPT_ID_MISMATCH");
  if (evidence.LEASE_GENERATION !== state.LEASE_GENERATION) throw new Error("A5T_RUNTIME_EVIDENCE_LEASE_GENERATION_MISMATCH");
  if (evidence.FENCE_TOKEN !== state.FENCE_TOKEN) throw new Error("A5T_RUNTIME_EVIDENCE_FENCE_TOKEN_MISMATCH");
  if (evidence.SOURCE_STATE_VERSION !== state.STATE_VERSION) throw new Error("A5T_RUNTIME_EVIDENCE_STATE_VERSION_MISMATCH");
  if (evidence.SOURCE_EVENT_SHA256 !== state.EVENT_LEDGER.at(-1).EVENT_SHA256) throw new Error("A5T_RUNTIME_EVIDENCE_EVENT_HASH_MISMATCH");
  const fence = validateAuthoritativeFenceV1(state, evidence.FENCE_TOKEN);
  if (!fence.ok) throw new Error("A5T_RUNTIME_EVIDENCE_STALE_FENCE_REJECTED");

  const projection = deriveA5TExecutionTerminalProjectionV1(evidence.EXECUTION_SESSION_STATUS.EXECUTION_STATE);
  if (projection.ACCEPTANCE_IMPLIED !== false) throw new Error("A5T_ACCEPTANCE_NON_IMPLICATION_REQUIRED");
  if (projection.EXECUTION_TERMINAL !== true) {
    if (projection.RECONCILIATION_REQUIRED) throw new Error("A5T_OUTCOME_UNKNOWN_RECONCILIATION_REQUIRED");
    throw new Error("A5T_EXECUTION_STATE_NOT_TERMINAL");
  }

  const idempotencyKey = requireString(request.IDEMPOTENCY_KEY, "IDEMPOTENCY_KEY_REQUIRED");
  const prior = session.IDEMPOTENCY_INDEX[idempotencyKey];
  if (session.EXECUTION_TERMINAL === true && !prior) throw new Error("SESSION_EXECUTION_TERMINAL_ALREADY_SET");

  const result = await recordOneShotSessionProgressV1(sessionPath, {
    EXPECTED_STATE_VERSION: requireNonNegativeInteger(request.EXPECTED_SESSION_STATE_VERSION, "EXPECTED_SESSION_STATE_VERSION_INVALID"),
    IDEMPOTENCY_KEY: idempotencyKey,
    SUBMITTED_FENCE_TOKEN: requireString(request.SUBMITTED_FENCE_TOKEN, "SUBMITTED_FENCE_TOKEN_REQUIRED"),
    RUNTIME_NOW_MS: request.RUNTIME_NOW_MS,
    EXECUTION_TERMINAL: true,
    EVENT_TYPE: "A5T_AUTHORITATIVE_EXECUTION_TERMINAL_BOUND",
    EVENT_PAYLOAD: {
      PILOTE_A5T_HEAD: A5T_AUTHORITATIVE_BINDING.HEAD,
      PILOTE_A5T_TREE: A5T_AUTHORITATIVE_BINDING.TREE,
      A5T_BINDING_SHA256: A5T_AUTHORITATIVE_BINDING.A5T_BINDING_SHA256,
      SOURCE_STATUS_SCHEMA_SHA256: A5T_AUTHORITATIVE_BINDING.SOURCE_STATUS_SCHEMA_SHA256,
      EXECUTION_STATE: projection.EXECUTION_STATE,
      RUNTIME_EVIDENCE_SHA256: evidence.EVIDENCE_SHA256,
      RUNTIME_OPERATION_ID: evidence.OPERATION_ID,
      RUNTIME_OPERATION_IDEMPOTENCY_KEY: evidence.OPERATION_IDEMPOTENCY_KEY,
      ACCEPTANCE_IMPLIED: false
    }
  });

  return {
    ok: true,
    replay: result.replay,
    session: result.session,
    binding: Object.freeze({
      SOURCE_STATUS_SCHEMA_BINDING: "PASS",
      TERMINAL_STATE_PARTITION_BINDING: "PASS",
      OUTCOME_UNKNOWN_NON_TERMINAL_BINDING: "PASS",
      EXECUTION_TERMINAL_RUNTIME_EVIDENCE_BINDING: "PASS",
      ACCEPTANCE_NON_IMPLICATION_BINDING: "PASS"
    })
  };
}
