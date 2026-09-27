import {
  readDurableResultAcceptanceV1
} from "./durable-result-acceptance-v1.mjs";
import {
  readOneShotExecutionSessionV1,
  recordOneShotSessionProgressV1
} from "./one-shot-execution-session-v1.mjs";

export const DURABLE_RECEIPT_TERMINALIZATION_POLICY =
  "AUTHORITATIVE_P2F_ACCEPTANCE_TO_SESSION_RECEIPT_TERMINAL";

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

function assertAcceptanceSessionBinding(acceptance, session) {
  if (acceptance.EXECUTION_PLAN_HASH !== session.EXECUTION_PLAN_HASH) {
    throw new Error("RECEIPT_TERMINALIZATION_EXECUTION_PLAN_HASH_MISMATCH");
  }
  if (acceptance.EXECUTION_EPOCH !== session.EXECUTION_EPOCH) {
    throw new Error("RECEIPT_TERMINALIZATION_EXECUTION_EPOCH_MISMATCH");
  }
  if (acceptance.ATTEMPT_ID !== session.ATTEMPT_ID) {
    throw new Error("RECEIPT_TERMINALIZATION_ATTEMPT_ID_MISMATCH");
  }
  if (acceptance.LEASE_GENERATION !== session.LEASE_GENERATION) {
    throw new Error("RECEIPT_TERMINALIZATION_LEASE_GENERATION_MISMATCH");
  }
  if (acceptance.FENCE_TOKEN !== session.FENCE_TOKEN) {
    throw new Error("RECEIPT_TERMINALIZATION_FENCE_TOKEN_MISMATCH");
  }
  if (acceptance.EXECUTION_RECEIPT.ATTEMPT_ID !== session.ATTEMPT_ID) {
    throw new Error("RECEIPT_TERMINALIZATION_RECEIPT_ATTEMPT_ID_MISMATCH");
  }
  if (acceptance.EXECUTION_RECEIPT.FENCE_TOKEN !== session.FENCE_TOKEN) {
    throw new Error("RECEIPT_TERMINALIZATION_RECEIPT_FENCE_TOKEN_MISMATCH");
  }
}

export async function terminalizeAcceptedReceiptInSessionV1(
  acceptancePath,
  sessionPath,
  request
) {
  if (!isObject(request)) throw new Error("RECEIPT_TERMINALIZATION_REQUEST_REQUIRED");

  const idempotencyKey = requireString(
    request.IDEMPOTENCY_KEY,
    "IDEMPOTENCY_KEY_REQUIRED"
  );
  const expectedSessionStateVersion = requireNonNegativeInteger(
    request.EXPECTED_SESSION_STATE_VERSION,
    "EXPECTED_SESSION_STATE_VERSION_INVALID"
  );
  const submittedFenceToken = requireString(
    request.SUBMITTED_FENCE_TOKEN,
    "SUBMITTED_FENCE_TOKEN_REQUIRED"
  );
  const expectedAcceptanceRecordSha256 = requireSha256(
    request.EXPECTED_ACCEPTANCE_RECORD_SHA256,
    "EXPECTED_ACCEPTANCE_RECORD_SHA256_INVALID"
  );
  const expectedExecutionReceiptSha256 = requireSha256(
    request.EXPECTED_EXECUTION_RECEIPT_SHA256,
    "EXPECTED_EXECUTION_RECEIPT_SHA256_INVALID"
  );

  const acceptance = await readDurableResultAcceptanceV1(acceptancePath);
  const session = await readOneShotExecutionSessionV1(sessionPath);

  if (acceptance.ACCEPTANCE_RECORD_SHA256 !== expectedAcceptanceRecordSha256) {
    throw new Error("RECEIPT_TERMINALIZATION_ACCEPTANCE_RECORD_HASH_MISMATCH");
  }
  if (acceptance.EXECUTION_RECEIPT.OBJECT_SHA256 !== expectedExecutionReceiptSha256) {
    throw new Error("RECEIPT_TERMINALIZATION_EXECUTION_RECEIPT_HASH_MISMATCH");
  }

  assertAcceptanceSessionBinding(acceptance, session);

  const prior = session.IDEMPOTENCY_INDEX[idempotencyKey];
  if (session.RECEIPT_TERMINAL === true && !prior) {
    throw new Error("SESSION_RECEIPT_ALREADY_TERMINAL");
  }

  const result = await recordOneShotSessionProgressV1(sessionPath, {
    EXPECTED_STATE_VERSION: expectedSessionStateVersion,
    IDEMPOTENCY_KEY: idempotencyKey,
    SUBMITTED_FENCE_TOKEN: submittedFenceToken,
    RUNTIME_NOW_MS: request.RUNTIME_NOW_MS,
    RECEIPT_TERMINAL: true,
    EVENT_TYPE: "AUTHORITATIVE_RECEIPT_TERMINALIZED",
    EVENT_PAYLOAD: {
      POLICY: DURABLE_RECEIPT_TERMINALIZATION_POLICY,
      ACCEPTANCE_RECORD_SHA256: acceptance.ACCEPTANCE_RECORD_SHA256,
      EXECUTION_RECEIPT_SHA256: acceptance.EXECUTION_RECEIPT.OBJECT_SHA256,
      EXECUTION_ID: acceptance.EXECUTION_ID,
      WORKER_JOB_HASH: acceptance.WORKER_JOB_HASH
    }
  });

  return {
    ok: true,
    replay: result.replay,
    session: result.session,
    acceptance: {
      ACCEPTANCE_RECORD_SHA256: acceptance.ACCEPTANCE_RECORD_SHA256,
      EXECUTION_RECEIPT_SHA256: acceptance.EXECUTION_RECEIPT.OBJECT_SHA256,
      EXECUTION_ID: acceptance.EXECUTION_ID,
      ATTEMPT_ID: acceptance.ATTEMPT_ID,
      FENCE_TOKEN: acceptance.FENCE_TOKEN
    }
  };
}
