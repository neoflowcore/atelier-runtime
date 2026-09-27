import {
  deriveOneShotSessionTerminalProjectionV1,
  readProviderBootstrapSagaV1,
  validateProviderBootstrapSagaV1
} from "./provider-bootstrap-saga-v1.mjs";
import {
  readOneShotExecutionSessionV1,
  recordOneShotSessionProgressV1
} from "./one-shot-execution-session-v1.mjs";

export const DURABLE_PROVIDER_TERMINAL_SESSION_BINDING_POLICY =
  "P2E_COMPLETE_PROJECTION_TO_P2B_TRANSPORT_AND_CLEANUP_TERMINAL";

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

function assertSagaSessionBinding(saga, session, request) {
  const validated = validateProviderBootstrapSagaV1(saga);
  if (!validated.ok) throw new Error(`PROVIDER_TERMINAL_BINDING_SAGA_INVALID:${validated.errors.join("|")}`);
  if (saga.SAGA_STATUS !== "COMPLETE") throw new Error("PROVIDER_TERMINAL_BINDING_SAGA_COMPLETE_REQUIRED");
  if (request.EXPECTED_SAGA_STATE_VERSION !== saga.STATE_VERSION) throw new Error("PROVIDER_TERMINAL_BINDING_SAGA_STATE_CAS_MISMATCH");
  const lastEvent = saga.EVENT_LEDGER.at(-1);
  if (request.EXPECTED_SAGA_EVENT_SHA256 !== lastEvent.EVENT_SHA256) throw new Error("PROVIDER_TERMINAL_BINDING_SAGA_EVENT_HASH_MISMATCH");
  if (saga.EXECUTION_PLAN_HASH !== session.EXECUTION_PLAN_HASH) throw new Error("PROVIDER_TERMINAL_BINDING_PLAN_HASH_MISMATCH");
  if (saga.APPROVAL_GRANT_ID !== session.APPROVAL_GRANT_ID) throw new Error("PROVIDER_TERMINAL_BINDING_APPROVAL_GRANT_MISMATCH");
  if (saga.BUDGET_RESERVATION_ID !== session.BUDGET_RESERVATION_ID) throw new Error("PROVIDER_TERMINAL_BINDING_BUDGET_RESERVATION_MISMATCH");

  const projection = deriveOneShotSessionTerminalProjectionV1(saga);
  if (projection.PROVIDER_SAGA_COMPLETE !== true) throw new Error("PROVIDER_TERMINAL_BINDING_SAGA_COMPLETE_REQUIRED");
  if (projection.EXECUTION_TRANSPORT_DEREGISTERED !== true) throw new Error("PROVIDER_TERMINAL_BINDING_TRANSPORT_NOT_DEREGISTERED");
  if (projection.REQUIRED_RESOURCE_CLEANUP_TERMINAL !== true) throw new Error("PROVIDER_TERMINAL_BINDING_RESOURCE_CLEANUP_NOT_TERMINAL");
  if (session.BILLING_STATUS !== projection.BILLING_STATUS) throw new Error("PROVIDER_TERMINAL_BINDING_BILLING_STATUS_MISMATCH");
  return { projection, lastEvent };
}

export async function bindProviderTerminalProjectionToSessionV1(sagaPath, sessionPath, request) {
  if (!isObject(request)) throw new Error("PROVIDER_TERMINAL_BINDING_REQUEST_REQUIRED");
  const idempotencyKey = requireString(request.IDEMPOTENCY_KEY, "IDEMPOTENCY_KEY_REQUIRED");
  requireNonNegativeInteger(request.EXPECTED_SAGA_STATE_VERSION, "EXPECTED_SAGA_STATE_VERSION_INVALID");
  requireSha256(request.EXPECTED_SAGA_EVENT_SHA256, "EXPECTED_SAGA_EVENT_SHA256_INVALID");
  const expectedSessionStateVersion = requireNonNegativeInteger(
    request.EXPECTED_SESSION_STATE_VERSION,
    "EXPECTED_SESSION_STATE_VERSION_INVALID"
  );
  const submittedFenceToken = requireString(request.SUBMITTED_FENCE_TOKEN, "SUBMITTED_FENCE_TOKEN_REQUIRED");

  const saga = await readProviderBootstrapSagaV1(sagaPath);
  const session = await readOneShotExecutionSessionV1(sessionPath);
  const prior = session.IDEMPOTENCY_INDEX[idempotencyKey];
  if (
    session.EXECUTION_TRANSPORT_DEREGISTERED === true &&
    session.REQUIRED_RESOURCE_CLEANUP_TERMINAL === true &&
    !prior
  ) {
    throw new Error("SESSION_PROVIDER_TERMINAL_FLAGS_ALREADY_SET");
  }

  const authoritative = assertSagaSessionBinding(saga, session, request);
  const result = await recordOneShotSessionProgressV1(sessionPath, {
    EXPECTED_STATE_VERSION: expectedSessionStateVersion,
    IDEMPOTENCY_KEY: idempotencyKey,
    SUBMITTED_FENCE_TOKEN: submittedFenceToken,
    RUNTIME_NOW_MS: request.RUNTIME_NOW_MS,
    EXECUTION_TRANSPORT_DEREGISTERED: true,
    REQUIRED_RESOURCE_CLEANUP_TERMINAL: true,
    EVENT_TYPE: "AUTHORITATIVE_PROVIDER_TERMINAL_PROJECTION_BOUND",
    EVENT_PAYLOAD: {
      POLICY: DURABLE_PROVIDER_TERMINAL_SESSION_BINDING_POLICY,
      PROVIDER_SAGA_ID: saga.SAGA_ID,
      PROVIDER_SAGA_STATE_VERSION: saga.STATE_VERSION,
      PROVIDER_SAGA_EVENT_SHA256: authoritative.lastEvent.EVENT_SHA256,
      COMPUTE_PROVIDER: saga.COMPUTE_PROVIDER,
      EXECUTION_TRANSPORT: saga.EXECUTION_TRANSPORT
    }
  });

  return {
    ok: true,
    replay: result.replay,
    session: result.session,
    provider: {
      SAGA_ID: saga.SAGA_ID,
      STATE_VERSION: saga.STATE_VERSION,
      EVENT_SHA256: authoritative.lastEvent.EVENT_SHA256
    }
  };
}
