import {
  readDurableReservationSettlementV1
} from "./durable-reservation-settlement-v1.mjs";
import {
  readOneShotExecutionSessionV1,
  recordOneShotSessionProgressV1
} from "./one-shot-execution-session-v1.mjs";

export const DURABLE_BILLING_TERMINALIZATION_POLICY =
  "P2H_SETTLEMENT_TO_SESSION_BILLING_STOPPED";

const SHA256_RE = /^[0-9a-f]{64}$/;

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

function requireNonNegativeInteger(value, code) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(code);
  return value;
}

function canonicalize(value) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("BILLING_TERMINALIZATION_NON_SAFE_INTEGER");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return "[" + value.map(canonicalize).join(",") + "]";
  if (isObject(value)) {
    return "{" + Object.keys(value).sort().map((key) =>
      JSON.stringify(key) + ":" + canonicalize(value[key])
    ).join(",") + "}";
  }
  throw new Error("BILLING_TERMINALIZATION_UNSUPPORTED_CANONICAL_TYPE");
}

function findAuthoritativeSettlementEvent(store, reservationId) {
  const matches = store.EVENT_LEDGER.filter((event) =>
    event.EVENT_TYPE === "RESERVATION_USAGE_SETTLED" &&
    event.PAYLOAD?.RESERVATION_ID === reservationId
  );
  if (matches.length !== 1) {
    throw new Error("BILLING_TERMINALIZATION_SETTLEMENT_EVENT_CARDINALITY_INVALID");
  }
  return matches[0];
}

function assertSettlementSessionBinding(store, session, request) {
  if (store.EXECUTION_PLAN_SHA256 !== session.EXECUTION_PLAN_HASH) {
    throw new Error("BILLING_TERMINALIZATION_EXECUTION_PLAN_HASH_MISMATCH");
  }
  if (store.STATE_VERSION !== request.EXPECTED_SETTLEMENT_STATE_VERSION) {
    throw new Error("BILLING_TERMINALIZATION_SETTLEMENT_STATE_CAS_MISMATCH");
  }

  const reservationId = session.BUDGET_RESERVATION_ID;
  const settlement = store.SETTLEMENTS?.[reservationId];
  if (!isObject(settlement)) {
    throw new Error("BILLING_TERMINALIZATION_SETTLEMENT_REQUIRED");
  }
  if (settlement.RESERVATION_ID !== reservationId) {
    throw new Error("BILLING_TERMINALIZATION_RESERVATION_ID_MISMATCH");
  }
  if (settlement.FENCE_TOKEN !== session.FENCE_TOKEN) {
    throw new Error("BILLING_TERMINALIZATION_FENCE_TOKEN_MISMATCH");
  }

  const event = findAuthoritativeSettlementEvent(store, reservationId);
  if (event.EVENT_SHA256 !== request.EXPECTED_SETTLEMENT_EVENT_SHA256) {
    throw new Error("BILLING_TERMINALIZATION_SETTLEMENT_EVENT_HASH_MISMATCH");
  }
  if (canonicalize(event.PAYLOAD) !== canonicalize(settlement)) {
    throw new Error("BILLING_TERMINALIZATION_SETTLEMENT_EVENT_PAYLOAD_MISMATCH");
  }

  return { settlement, event };
}

export async function terminalizeSettledBillingInSessionV1(
  settlementPath,
  sessionPath,
  request
) {
  if (!isObject(request)) throw new Error("BILLING_TERMINALIZATION_REQUEST_REQUIRED");

  const idempotencyKey = requireString(
    request.IDEMPOTENCY_KEY,
    "IDEMPOTENCY_KEY_REQUIRED"
  );
  const expectedSessionStateVersion = requireNonNegativeInteger(
    request.EXPECTED_SESSION_STATE_VERSION,
    "EXPECTED_SESSION_STATE_VERSION_INVALID"
  );
  requireNonNegativeInteger(
    request.EXPECTED_SETTLEMENT_STATE_VERSION,
    "EXPECTED_SETTLEMENT_STATE_VERSION_INVALID"
  );
  requireSha256(
    request.EXPECTED_SETTLEMENT_EVENT_SHA256,
    "EXPECTED_SETTLEMENT_EVENT_SHA256_INVALID"
  );
  const submittedFenceToken = requireString(
    request.SUBMITTED_FENCE_TOKEN,
    "SUBMITTED_FENCE_TOKEN_REQUIRED"
  );

  const settlementStore = await readDurableReservationSettlementV1(settlementPath);
  const session = await readOneShotExecutionSessionV1(sessionPath);
  const prior = session.IDEMPOTENCY_INDEX[idempotencyKey];

  if (session.BILLING_STATUS !== "ACTIVE" && !prior) {
    throw new Error("SESSION_BILLING_ALREADY_TERMINAL");
  }

  const authoritative = assertSettlementSessionBinding(
    settlementStore,
    session,
    request
  );

  const result = await recordOneShotSessionProgressV1(sessionPath, {
    EXPECTED_STATE_VERSION: expectedSessionStateVersion,
    IDEMPOTENCY_KEY: idempotencyKey,
    SUBMITTED_FENCE_TOKEN: submittedFenceToken,
    RUNTIME_NOW_MS: request.RUNTIME_NOW_MS,
    BILLING_STATUS: "STOPPED",
    EVENT_TYPE: "AUTHORITATIVE_BILLING_TERMINALIZED",
    EVENT_PAYLOAD: {
      POLICY: DURABLE_BILLING_TERMINALIZATION_POLICY,
      RESERVATION_ID: authoritative.settlement.RESERVATION_ID,
      SETTLEMENT_EVENT_SHA256: authoritative.event.EVENT_SHA256,
      SETTLEMENT_STATE_VERSION: settlementStore.STATE_VERSION,
      TERMINAL_STATE: authoritative.settlement.TERMINAL_STATE,
      ACTUAL_RUNTIME_SECONDS: authoritative.settlement.ACTUAL_RUNTIME_SECONDS,
      ACTUAL_COST_MICRO_USD: authoritative.settlement.ACTUAL_COST_MICRO_USD,
      RELEASED_RUNTIME_SECONDS: authoritative.settlement.RELEASED_RUNTIME_SECONDS,
      RELEASED_COST_MICRO_USD: authoritative.settlement.RELEASED_COST_MICRO_USD
    }
  });

  return {
    ok: true,
    replay: result.replay,
    session: result.session,
    settlement: {
      RESERVATION_ID: authoritative.settlement.RESERVATION_ID,
      SETTLEMENT_EVENT_SHA256: authoritative.event.EVENT_SHA256,
      SETTLEMENT_STATE_VERSION: settlementStore.STATE_VERSION
    }
  };
}
