import { createHash } from "node:crypto";
import { validateDurableResultAcceptanceV1 } from "./durable-result-acceptance-v1.mjs";
import {
  deriveOneShotSessionTerminalProjectionV1,
  validateProviderBootstrapSagaV1
} from "./provider-bootstrap-saga-v1.mjs";
import { validateDurableSessionClosureSealV1 } from "./durable-session-closure-seal-v1.mjs";
import { evaluateGcEligibilityV1 } from "./authoritative-gc-tombstone-v1.mjs";

export const AUTHORITATIVE_GC_INPUT_PROJECTION_POLICY =
  "P2F_ACCEPTANCE_P2E_COMPLETE_P2V_CLOSURE_TO_P2J_GC_INPUT";

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function canonicalize(value) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("GC_INPUT_PROJECTION_NON_SAFE_INTEGER");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  }
  throw new Error("GC_INPUT_PROJECTION_UNSUPPORTED_CANONICAL_TYPE");
}

function hashObject(value) {
  return createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
}

function assertValidAcceptance(acceptance) {
  const result = validateDurableResultAcceptanceV1(acceptance);
  if (!result.ok) throw new Error(`GC_INPUT_ACCEPTANCE_INVALID:${result.errors.join("|")}`);
  if (acceptance.ACCEPTANCE_STATE !== "ACCEPTED") throw new Error("GC_INPUT_AUTHORITATIVE_ACCEPTANCE_REQUIRED");
}

function assertValidSaga(saga) {
  const result = validateProviderBootstrapSagaV1(saga);
  if (!result.ok) throw new Error(`GC_INPUT_PROVIDER_SAGA_INVALID:${result.errors.join("|")}`);
  if (saga.SAGA_STATUS !== "COMPLETE") throw new Error("GC_INPUT_PROVIDER_SAGA_COMPLETE_REQUIRED");
}

function assertValidSeal(seal) {
  const result = validateDurableSessionClosureSealV1(seal);
  if (!result.ok) throw new Error(`GC_INPUT_CLOSURE_SEAL_INVALID:${result.errors.join("|")}`);
}

function assertCrossBindings(acceptance, saga, seal) {
  if (acceptance.EXECUTION_PLAN_HASH !== seal.EXECUTION_PLAN_HASH) throw new Error("GC_INPUT_ACCEPTANCE_SEAL_PLAN_HASH_MISMATCH");
  if (acceptance.EXECUTION_EPOCH !== seal.EXECUTION_EPOCH) throw new Error("GC_INPUT_ACCEPTANCE_SEAL_EXECUTION_EPOCH_MISMATCH");
  if (acceptance.ATTEMPT_ID !== seal.ATTEMPT_ID) throw new Error("GC_INPUT_ACCEPTANCE_SEAL_ATTEMPT_ID_MISMATCH");
  if (acceptance.LEASE_GENERATION !== seal.LEASE_GENERATION) throw new Error("GC_INPUT_ACCEPTANCE_SEAL_LEASE_GENERATION_MISMATCH");
  if (acceptance.FENCE_TOKEN !== seal.FENCE_TOKEN) throw new Error("GC_INPUT_ACCEPTANCE_SEAL_FENCE_TOKEN_MISMATCH");
  if (saga.EXECUTION_ID !== acceptance.EXECUTION_ID) throw new Error("GC_INPUT_SAGA_ACCEPTANCE_EXECUTION_ID_MISMATCH");
  if (saga.EXECUTION_PLAN_HASH !== acceptance.EXECUTION_PLAN_HASH) throw new Error("GC_INPUT_SAGA_ACCEPTANCE_PLAN_HASH_MISMATCH");

  const projection = deriveOneShotSessionTerminalProjectionV1(saga);
  if (projection.EXECUTION_TRANSPORT_DEREGISTERED !== seal.TERMINAL_FLAGS.EXECUTION_TRANSPORT_DEREGISTERED) {
    throw new Error("GC_INPUT_TRANSPORT_DEREGISTRATION_MISMATCH");
  }
  if (projection.REQUIRED_RESOURCE_CLEANUP_TERMINAL !== seal.TERMINAL_FLAGS.REQUIRED_RESOURCE_CLEANUP_TERMINAL) {
    throw new Error("GC_INPUT_RESOURCE_CLEANUP_MISMATCH");
  }
  if (projection.BILLING_STATUS !== seal.BILLING_STATUS) {
    throw new Error("GC_INPUT_BILLING_STATUS_MISMATCH");
  }
  if (projection.PROVIDER_SAGA_COMPLETE !== true) throw new Error("GC_INPUT_PROVIDER_SAGA_COMPLETE_REQUIRED");
  return projection;
}

export function buildAuthoritativeGcInputV1(acceptance, saga, seal, artifactId) {
  assertValidAcceptance(acceptance);
  assertValidSaga(saga);
  assertValidSeal(seal);
  const projection = assertCrossBindings(acceptance, saga, seal);

  if (typeof artifactId !== "string" || artifactId.length === 0) throw new Error("GC_INPUT_ARTIFACT_ID_REQUIRED");
  const artifact = acceptance.ACCEPTED_ARTIFACT_MANIFEST.find((item) => item.ARTIFACT_ID === artifactId);
  if (!artifact) throw new Error("GC_INPUT_ACCEPTED_ARTIFACT_NOT_FOUND");

  const input = {
    AUTHORITATIVE_ACCEPTANCE: true,
    PROVIDER_SAGA_COMPLETE: true,
    EXECUTION_TRANSPORT_DEREGISTERED: projection.EXECUTION_TRANSPORT_DEREGISTERED,
    REQUIRED_RESOURCE_CLEANUP_TERMINAL: projection.REQUIRED_RESOURCE_CLEANUP_TERMINAL,
    BILLING_STATUS: projection.BILLING_STATUS,
    ACCEPTANCE_JOURNAL_SHA256: acceptance.ACCEPTANCE_RECORD_SHA256,
    EXECUTION_RECEIPT_SHA256: acceptance.EXECUTION_RECEIPT.OBJECT_SHA256,
    ARTIFACT_MANIFEST_SHA256: hashObject(acceptance.ACCEPTED_ARTIFACT_MANIFEST),
    CONTENT_SHA256: artifact.CONTENT_SHA256
  };

  const eligibility = evaluateGcEligibilityV1(input);
  if (!eligibility.ok) throw new Error(`GC_INPUT_NOT_ELIGIBLE:${eligibility.code}`);

  return Object.freeze({
    POLICY: AUTHORITATIVE_GC_INPUT_PROJECTION_POLICY,
    ARTIFACT_ID: artifact.ARTIFACT_ID,
    EXECUTION_ID: acceptance.EXECUTION_ID,
    EXECUTION_PLAN_HASH: acceptance.EXECUTION_PLAN_HASH,
    SESSION_ID: seal.SESSION_ID,
    GC_INPUT: Object.freeze(input)
  });
}
