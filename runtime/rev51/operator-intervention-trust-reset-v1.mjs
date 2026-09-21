import { createHash } from "node:crypto";
import {
  advanceExecutionFenceV1,
  readDurableExecutionStateV1,
  transitionMaterializedStateV1
} from "./durable-execution-state-v1.mjs";
import {
  OPERATOR_INTERACTION_CLASSES,
  operatorInteractionEffect
} from "./zero-touch-preflight-v1.mjs";

export const OPERATOR_INTERVENTION_RECEIPT_SCHEMA_ID = "OPERATOR_INTERVENTION_RECEIPT_V1";
export const OPERATOR_INTERVENTION_RECEIPT_SCHEMA_VERSION = "1";

const STATE_AFFECTING_CLASSES = Object.freeze([
  "STATE_AFFECTING",
  "PRIVILEGED_MUTATION",
  "RECOVERY_MUTATION"
]);

const SHA256_RE = /^[0-9a-f]{64}$/;

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function requireString(value, code) {
  if (typeof value !== "string" || value.length === 0) throw new Error(code);
  return value;
}

function requirePositiveInteger(value, code) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(code);
  return value;
}

function requireRuntimeMs(value, code) {
  if (!Number.isSafeInteger(value)) throw new Error(code);
  return value;
}

function runtimeIso(value, code) {
  return new Date(requireRuntimeMs(value, code)).toISOString();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function canonicalize(value) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("OPERATOR_RECEIPT_NON_SAFE_INTEGER");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  }
  throw new Error("OPERATOR_RECEIPT_UNSUPPORTED_CANONICAL_TYPE");
}

function hashObject(value) {
  return createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
}

function requireAffectedScope(value) {
  if (!Array.isArray(value) || value.length === 0) throw new Error("AFFECTED_SCOPE_REQUIRED");
  const scope = value.map((item) => requireString(item, "AFFECTED_SCOPE_ENTRY_INVALID"));
  if (new Set(scope).size !== scope.length) throw new Error("AFFECTED_SCOPE_DUPLICATE");
  return scope;
}

function classifyInteraction(inputClass) {
  if (OPERATOR_INTERACTION_CLASSES.includes(inputClass)) {
    return { interactionClass: inputClass, classificationMode: "EXPLICIT" };
  }
  return {
    interactionClass: "STATE_AFFECTING",
    classificationMode: "CONSERVATIVE_STATE_AFFECTING"
  };
}

function trustEffect(interactionClass) {
  const effect = operatorInteractionEffect(interactionClass);
  if (!effect.ok) throw new Error("OPERATOR_INTERACTION_EFFECT_UNAVAILABLE");
  return effect;
}

function validateAuthority(value, codePrefix) {
  if (!isObject(value)) throw new Error(`${codePrefix}_REQUIRED`);
  requireString(value.ATTEMPT_ID, `${codePrefix}_ATTEMPT_ID_REQUIRED`);
  requirePositiveInteger(value.LEASE_GENERATION, `${codePrefix}_LEASE_GENERATION_INVALID`);
  requirePositiveInteger(value.FENCE_SEQUENCE, `${codePrefix}_FENCE_SEQUENCE_INVALID`);
  requireString(value.FENCE_TOKEN, `${codePrefix}_FENCE_TOKEN_REQUIRED`);
  return value;
}

function buildReceiptBody(current, input) {
  const { interactionClass, classificationMode } = classifyInteraction(input.INTERACTION_CLASS);
  const effect = trustEffect(interactionClass);
  const startedMs = requireRuntimeMs(input.STARTED_AT_MS, "INTERVENTION_STARTED_AT_REQUIRED");
  const endedMs = requireRuntimeMs(input.ENDED_AT_MS, "INTERVENTION_ENDED_AT_REQUIRED");
  if (endedMs < startedMs) throw new Error("INTERVENTION_TIME_RANGE_INVALID");
  const runtimeNowMs = requireRuntimeMs(input.RUNTIME_NOW_MS, "RUNTIME_AUTHORITATIVE_TIME_REQUIRED");
  if (runtimeNowMs < endedMs) throw new Error("INTERVENTION_END_AFTER_RUNTIME_NOW");

  const preAuthority = {
    ATTEMPT_ID: current.ATTEMPT_ID,
    LEASE_GENERATION: current.LEASE_GENERATION,
    FENCE_SEQUENCE: current.FENCE_SEQUENCE,
    FENCE_TOKEN: current.FENCE_TOKEN
  };

  const stateAffecting = STATE_AFFECTING_CLASSES.includes(interactionClass);
  let postAuthority = clone(preAuthority);
  let postAttestation;

  if (stateAffecting) {
    postAuthority = {
      ATTEMPT_ID: requireString(input.NEW_ATTEMPT_ID, "NEW_ATTEMPT_ID_REQUIRED"),
      LEASE_GENERATION: requirePositiveInteger(input.NEW_LEASE_GENERATION, "NEW_LEASE_GENERATION_INVALID"),
      FENCE_SEQUENCE: requirePositiveInteger(input.NEW_FENCE_SEQUENCE, "NEW_FENCE_SEQUENCE_INVALID"),
      FENCE_TOKEN: requireString(input.NEW_FENCE_TOKEN, "NEW_FENCE_TOKEN_REQUIRED")
    };
    postAttestation = {
      STATE: "INVALIDATED",
      REATTESTATION_REQUIRED: "YES"
    };
  } else {
    for (const field of ["NEW_ATTEMPT_ID", "NEW_LEASE_GENERATION", "NEW_FENCE_SEQUENCE", "NEW_FENCE_TOKEN"]) {
      if (input[field] !== undefined && input[field] !== null) throw new Error(`OBSERVE_ONLY_${field}_DENIED`);
    }
    postAttestation = {
      STATE: "PRESERVED",
      REATTESTATION_REQUIRED: "NO"
    };
  }

  return {
    RECEIPT_SCHEMA_ID: OPERATOR_INTERVENTION_RECEIPT_SCHEMA_ID,
    RECEIPT_SCHEMA_VERSION: OPERATOR_INTERVENTION_RECEIPT_SCHEMA_VERSION,
    SESSION_ID: requireString(input.SESSION_ID, "SESSION_ID_REQUIRED"),
    EXECUTION_ID: requireString(input.EXECUTION_ID, "EXECUTION_ID_REQUIRED"),
    INTERACTION_CLASS: interactionClass,
    CLASSIFICATION_MODE: classificationMode,
    REQUESTED_INTERACTION_CLASS: input.INTERACTION_CLASS ?? null,
    INTERVENTION_TYPE: requireString(input.INTERVENTION_TYPE, "INTERVENTION_TYPE_REQUIRED"),
    REASON: requireString(input.REASON, "INTERVENTION_REASON_REQUIRED"),
    AFFECTED_SCOPE: requireAffectedScope(input.AFFECTED_SCOPE),
    AFFECTED_STATE: requireString(input.AFFECTED_STATE, "AFFECTED_STATE_REQUIRED"),
    AUTHORITY_EFFECT: effect,
    STARTED_AT: runtimeIso(startedMs, "INTERVENTION_STARTED_AT_REQUIRED"),
    ENDED_AT: runtimeIso(endedMs, "INTERVENTION_ENDED_AT_REQUIRED"),
    POST_INTERVENTION_ATTESTATION: postAttestation,
    PRE_INTERVENTION_AUTHORITY: preAuthority,
    POST_INTERVENTION_AUTHORITY: postAuthority,
    NEW_ATTEMPT_ID: stateAffecting ? postAuthority.ATTEMPT_ID : null,
    NEW_LEASE_GENERATION: stateAffecting ? postAuthority.LEASE_GENERATION : null,
    NEW_FENCE_TOKEN: stateAffecting ? postAuthority.FENCE_TOKEN : null,
    NEW_FENCE_SEQUENCE: stateAffecting ? postAuthority.FENCE_SEQUENCE : null,
    TRUST_RESET_REQUIRED: stateAffecting,
    AUTOMATIC_RESULT_ACCEPTANCE: effect.AUTOMATIC_RESULT_ACCEPTANCE,
    REATTESTATION_REQUIRED: effect.REATTESTATION_REQUIRED,
    NEW_ATTEMPT_REQUIRED: effect.NEW_ATTEMPT_REQUIRED
  };
}

export function createOperatorInterventionReceiptV1(current, input) {
  if (!isObject(current)) throw new Error("CURRENT_DURABLE_STATE_REQUIRED");
  if (!isObject(input)) throw new Error("OPERATOR_INTERVENTION_INPUT_REQUIRED");
  if (input.EXECUTION_ID !== current.EXECUTION_ID) throw new Error("EXECUTION_ID_MISMATCH");
  const body = buildReceiptBody(current, input);
  return { ...body, RECEIPT_SHA256: hashObject(body) };
}

export function validateOperatorInterventionReceiptV1(receipt) {
  try {
    if (!isObject(receipt)) throw new Error("OPERATOR_INTERVENTION_RECEIPT_NOT_OBJECT");
    if (receipt.RECEIPT_SCHEMA_ID !== OPERATOR_INTERVENTION_RECEIPT_SCHEMA_ID) throw new Error("OPERATOR_INTERVENTION_RECEIPT_SCHEMA_ID_MISMATCH");
    if (receipt.RECEIPT_SCHEMA_VERSION !== OPERATOR_INTERVENTION_RECEIPT_SCHEMA_VERSION) throw new Error("OPERATOR_INTERVENTION_RECEIPT_SCHEMA_VERSION_MISMATCH");
    requireString(receipt.SESSION_ID, "SESSION_ID_REQUIRED");
    requireString(receipt.EXECUTION_ID, "EXECUTION_ID_REQUIRED");
    if (!OPERATOR_INTERACTION_CLASSES.includes(receipt.INTERACTION_CLASS)) throw new Error("INTERACTION_CLASS_INVALID");
    if (!["EXPLICIT", "CONSERVATIVE_STATE_AFFECTING"].includes(receipt.CLASSIFICATION_MODE)) throw new Error("CLASSIFICATION_MODE_INVALID");
    requireString(receipt.INTERVENTION_TYPE, "INTERVENTION_TYPE_REQUIRED");
    requireString(receipt.REASON, "INTERVENTION_REASON_REQUIRED");
    requireAffectedScope(receipt.AFFECTED_SCOPE);
    requireString(receipt.AFFECTED_STATE, "AFFECTED_STATE_REQUIRED");
    validateAuthority(receipt.PRE_INTERVENTION_AUTHORITY, "PRE_INTERVENTION_AUTHORITY");
    validateAuthority(receipt.POST_INTERVENTION_AUTHORITY, "POST_INTERVENTION_AUTHORITY");
    if (!isObject(receipt.POST_INTERVENTION_ATTESTATION)) throw new Error("POST_INTERVENTION_ATTESTATION_REQUIRED");
    if (!isObject(receipt.AUTHORITY_EFFECT)) throw new Error("AUTHORITY_EFFECT_REQUIRED");
    const expectedEffect = trustEffect(receipt.INTERACTION_CLASS);
    if (canonicalize(receipt.AUTHORITY_EFFECT) !== canonicalize(expectedEffect)) throw new Error("AUTHORITY_EFFECT_MISMATCH");
    const started = Date.parse(receipt.STARTED_AT ?? "");
    const ended = Date.parse(receipt.ENDED_AT ?? "");
    if (!Number.isFinite(started) || !Number.isFinite(ended) || ended < started) throw new Error("INTERVENTION_TIME_RANGE_INVALID");

    const stateAffecting = STATE_AFFECTING_CLASSES.includes(receipt.INTERACTION_CLASS);
    if (stateAffecting) {
      if (receipt.TRUST_RESET_REQUIRED !== true) throw new Error("TRUST_RESET_REQUIRED_MISMATCH");
      if (receipt.POST_INTERVENTION_ATTESTATION.STATE !== "INVALIDATED") throw new Error("ATTESTATION_INVALIDATION_REQUIRED");
      if (receipt.AUTOMATIC_RESULT_ACCEPTANCE !== "SUSPENDED") throw new Error("AUTOMATIC_RESULT_ACCEPTANCE_MUST_BE_SUSPENDED");
      if (receipt.REATTESTATION_REQUIRED !== "YES" || receipt.NEW_ATTEMPT_REQUIRED !== "YES") throw new Error("REATTESTATION_NEW_ATTEMPT_REQUIRED");
      requireString(receipt.NEW_ATTEMPT_ID, "NEW_ATTEMPT_ID_REQUIRED");
      requirePositiveInteger(receipt.NEW_LEASE_GENERATION, "NEW_LEASE_GENERATION_INVALID");
      requireString(receipt.NEW_FENCE_TOKEN, "NEW_FENCE_TOKEN_REQUIRED");
      requirePositiveInteger(receipt.NEW_FENCE_SEQUENCE, "NEW_FENCE_SEQUENCE_INVALID");
    } else {
      if (receipt.TRUST_RESET_REQUIRED !== false) throw new Error("OBSERVE_ONLY_TRUST_RESET_DENIED");
      if (receipt.POST_INTERVENTION_ATTESTATION.STATE !== "PRESERVED") throw new Error("OBSERVE_ONLY_ATTESTATION_MUST_BE_PRESERVED");
      if (receipt.AUTOMATIC_RESULT_ACCEPTANCE !== "UNCHANGED") throw new Error("OBSERVE_ONLY_ACCEPTANCE_MUST_BE_UNCHANGED");
      if (receipt.NEW_ATTEMPT_ID !== null || receipt.NEW_LEASE_GENERATION !== null || receipt.NEW_FENCE_TOKEN !== null || receipt.NEW_FENCE_SEQUENCE !== null) {
        throw new Error("OBSERVE_ONLY_NEW_AUTHORITY_DENIED");
      }
      if (canonicalize(receipt.PRE_INTERVENTION_AUTHORITY) !== canonicalize(receipt.POST_INTERVENTION_AUTHORITY)) {
        throw new Error("OBSERVE_ONLY_AUTHORITY_CHANGED");
      }
    }

    const { RECEIPT_SHA256, ...body } = receipt;
    if (!SHA256_RE.test(RECEIPT_SHA256 ?? "") || hashObject(body) !== RECEIPT_SHA256) throw new Error("OPERATOR_INTERVENTION_RECEIPT_HASH_MISMATCH");
    return { ok: true, errors: [] };
  } catch (error) {
    return { ok: false, errors: [error.message] };
  }
}

function historicalReceiptForKey(state, idempotencyKey) {
  const prior = state.IDEMPOTENCY_INDEX?.[idempotencyKey];
  if (!prior) return null;
  const event = state.EVENT_LEDGER.find((item) => item.EVENT_SEQUENCE === prior.EVENT_SEQUENCE);
  return event?.PAYLOAD?.OPERATOR_INTERVENTION_RECEIPT ?? null;
}

function assertReplayMatchesInput(receipt, input) {
  const { interactionClass } = classifyInteraction(input.INTERACTION_CLASS);
  const pairs = [
    [receipt.SESSION_ID, input.SESSION_ID],
    [receipt.EXECUTION_ID, input.EXECUTION_ID],
    [receipt.INTERACTION_CLASS, interactionClass],
    [receipt.INTERVENTION_TYPE, input.INTERVENTION_TYPE],
    [receipt.REASON, input.REASON],
    [receipt.AFFECTED_STATE, input.AFFECTED_STATE],
    [receipt.STARTED_AT, runtimeIso(input.STARTED_AT_MS, "INTERVENTION_STARTED_AT_REQUIRED")],
    [receipt.ENDED_AT, runtimeIso(input.ENDED_AT_MS, "INTERVENTION_ENDED_AT_REQUIRED")]
  ];
  if (pairs.some(([a, b]) => a !== b)) throw new Error("OPERATOR_INTERVENTION_IDEMPOTENCY_CONFLICT");
  if (canonicalize(receipt.AFFECTED_SCOPE) !== canonicalize(requireAffectedScope(input.AFFECTED_SCOPE))) throw new Error("OPERATOR_INTERVENTION_IDEMPOTENCY_CONFLICT");
  if (STATE_AFFECTING_CLASSES.includes(interactionClass)) {
    if (receipt.NEW_ATTEMPT_ID !== input.NEW_ATTEMPT_ID
      || receipt.NEW_LEASE_GENERATION !== input.NEW_LEASE_GENERATION
      || receipt.NEW_FENCE_TOKEN !== input.NEW_FENCE_TOKEN
      || receipt.NEW_FENCE_SEQUENCE !== input.NEW_FENCE_SEQUENCE) {
      throw new Error("OPERATOR_INTERVENTION_IDEMPOTENCY_CONFLICT");
    }
  }
}

export async function recordOperatorInterventionV1(executionStatePath, input) {
  if (!isObject(input)) throw new Error("OPERATOR_INTERVENTION_INPUT_REQUIRED");
  const idempotencyKey = requireString(input.IDEMPOTENCY_KEY, "IDEMPOTENCY_KEY_REQUIRED");
  const current = await readDurableExecutionStateV1(executionStatePath);
  const historical = historicalReceiptForKey(current, idempotencyKey);
  if (historical) {
    const validation = validateOperatorInterventionReceiptV1(historical);
    if (!validation.ok) throw new Error(`HISTORICAL_OPERATOR_RECEIPT_INVALID:${validation.errors[0]}`);
    assertReplayMatchesInput(historical, input);
    return { ok: true, replay: true, receipt: clone(historical), state: clone(current) };
  }

  const receipt = createOperatorInterventionReceiptV1(current, input);
  const validation = validateOperatorInterventionReceiptV1(receipt);
  if (!validation.ok) throw new Error(validation.errors[0]);

  if (receipt.INTERACTION_CLASS === "OBSERVE_ONLY") {
    const out = await transitionMaterializedStateV1(executionStatePath, {
      EXPECTED_STATE_VERSION: input.EXPECTED_STATE_VERSION,
      IDEMPOTENCY_KEY: idempotencyKey,
      SUBMITTED_FENCE_TOKEN: input.SUBMITTED_FENCE_TOKEN,
      NEXT_MATERIALIZED_STATE: current.MATERIALIZED_STATE,
      RUNTIME_NOW_MS: input.RUNTIME_NOW_MS,
      EVENT_TYPE: "OPERATOR_OBSERVE_ONLY_RECORDED",
      EVENT_PAYLOAD: {
        OPERATOR_INTERVENTION_RECEIPT: receipt,
        TRUST_RESET_REQUIRED: false
      }
    });
    return { ok: true, replay: out.replay, receipt: clone(receipt), state: clone(out.state) };
  }

  const out = await advanceExecutionFenceV1(executionStatePath, {
    EXPECTED_STATE_VERSION: input.EXPECTED_STATE_VERSION,
    IDEMPOTENCY_KEY: idempotencyKey,
    SUBMITTED_FENCE_TOKEN: input.SUBMITTED_FENCE_TOKEN,
    NEXT_FENCE_SEQUENCE: receipt.NEW_FENCE_SEQUENCE,
    NEXT_FENCE_TOKEN: receipt.NEW_FENCE_TOKEN,
    NEXT_ATTEMPT_ID: receipt.NEW_ATTEMPT_ID,
    NEXT_LEASE_GENERATION: receipt.NEW_LEASE_GENERATION,
    RUNTIME_NOW_MS: input.RUNTIME_NOW_MS,
    EVENT_TYPE: "OPERATOR_INTERVENTION_TRUST_RESET",
    EVENT_PAYLOAD: {
      OPERATOR_INTERVENTION_RECEIPT: receipt,
      CURRENT_ATTESTATION_INVALIDATED: true,
      AUTOMATIC_RESULT_ACCEPTANCE_SUSPENDED: true,
      REATTESTATION_REQUIRED: true,
      NEW_ATTEMPT_REQUIRED: true
    }
  });
  return { ok: true, replay: out.replay, receipt: clone(receipt), state: clone(out.state) };
}

export function evaluateAutomaticResultAcceptanceAfterInterventionV1(receipt) {
  const validation = validateOperatorInterventionReceiptV1(receipt);
  if (!validation.ok) return { ok: false, errors: validation.errors };
  return receipt.TRUST_RESET_REQUIRED
    ? {
        ok: true,
        AUTOMATIC_RESULT_ACCEPTANCE: "SUSPENDED",
        REATTESTATION_REQUIRED: "YES",
        NEW_ATTEMPT_REQUIRED: "YES"
      }
    : {
        ok: true,
        AUTOMATIC_RESULT_ACCEPTANCE: "UNCHANGED",
        REATTESTATION_REQUIRED: "NO",
        NEW_ATTEMPT_REQUIRED: "NO"
      };
}

export function findLatestOperatorInterventionReceiptV1(state) {
  if (!isObject(state) || !Array.isArray(state.EVENT_LEDGER)) return null;
  for (let index = state.EVENT_LEDGER.length - 1; index >= 0; index -= 1) {
    const receipt = state.EVENT_LEDGER[index]?.PAYLOAD?.OPERATOR_INTERVENTION_RECEIPT;
    if (receipt) return clone(receipt);
  }
  return null;
}
