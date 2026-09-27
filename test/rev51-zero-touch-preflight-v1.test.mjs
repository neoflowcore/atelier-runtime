import test from "node:test";
import assert from "node:assert/strict";
import {
  operatorInteractionEffect,
  validateDurableSessionConnectivity,
  validateExecutionAxes,
  validateExecutionPreflight,
  validateWorkerReadyAttestation,
  validateZeroTouchNormalPath
} from "../runtime/rev51/zero-touch-preflight-v1.mjs";

const H = "a".repeat(64);
const NOW = Date.parse("2026-09-19T03:00:00Z");

function readyAttestation(overrides = {}) {
  return {
    ATTESTATION_ID: "att-1",
    WORKER_ID: "worker-1",
    EXECUTION_PLAN_HASH: H,
    ATTESTATION_STATE: "READY",
    ISSUED_AT: "2026-09-19T02:59:00Z",
    EXPIRES_AT: "2026-09-19T03:05:00Z",
    ...overrides
  };
}

function preflight(overrides = {}) {
  return {
    EXECUTION_PLAN_HASH: H,
    READY_ATTESTATION_VALID: true,
    SOURCE_IDENTITY_EXACT: true,
    EXECUTION_PLAN_VALID: true,
    APPROVAL_VALID: true,
    BUDGET_RESERVATION_VALID: true,
    VERIFIER_POLICY_EXACT: true,
    EXECUTION_TRANSPORT_READY: true,
    WORKER_READY_ATTESTATION: readyAttestation(),
    GATE_TRIGGERED: false,
    ...overrides
  };
}

test("compute, transport and verifier axes remain independent", () => {
  assert.deepEqual(validateExecutionAxes({
    COMPUTE_PROVIDER: "DIGITALOCEAN",
    EXECUTION_TRANSPORT: "GITHUB_SELF_HOSTED_JIT",
    VERIFIER_POLICY: "RUNTIME_PLUS_PROJECT_CI"
  }), { ok: true, errors: [] });
});

test("GitHub self-hosted JIT cannot be used as compute provider", () => {
  const result = validateExecutionAxes({
    COMPUTE_PROVIDER: "GITHUB_SELF_HOSTED_JIT",
    EXECUTION_TRANSPORT: "GITHUB_SELF_HOSTED_JIT",
    VERIFIER_POLICY: "PROJECT_CI_REQUIRED"
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("UNSUPPORTED_COMPUTE_PROVIDER"));
});

test("normal path is zero-touch after approval", () => {
  assert.deepEqual(validateZeroTouchNormalPath({
    NORMAL_PATH_POLICY: "ZERO_TOUCH_AFTER_APPROVAL",
    OPERATOR_ACTIONS_AFTER_APPROVAL: 0,
    MANUAL_SSH_COUNT: 0,
    MANUAL_TERMUX_COMMAND_COUNT: 0,
    MANUAL_SECRET_COPY_COUNT: 0,
    MANUAL_RUNNER_REGISTRATION_COUNT: 0,
    WORKER_GITHUB_DEVICE_LOGIN_COUNT: 0,
    MANUAL_RERUN_COUNT: 0
  }), { ok: true, errors: [] });
});

test("manual runner registration is not a normal-path success", () => {
  const result = validateZeroTouchNormalPath({
    NORMAL_PATH_POLICY: "ZERO_TOUCH_AFTER_APPROVAL",
    OPERATOR_ACTIONS_AFTER_APPROVAL: 1,
    MANUAL_SSH_COUNT: 0,
    MANUAL_TERMUX_COMMAND_COUNT: 0,
    MANUAL_SECRET_COPY_COUNT: 0,
    MANUAL_RUNNER_REGISTRATION_COUNT: 1,
    WORKER_GITHUB_DEVICE_LOGIN_COUNT: 0,
    MANUAL_RERUN_COUNT: 0
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("MANUAL_RUNNER_REGISTRATION_COUNT_NONZERO"));
});

test("ready attestation TTL is enforced by Runtime time", () => {
  assert.equal(validateWorkerReadyAttestation(readyAttestation(), NOW).ok, true);
  assert.ok(validateWorkerReadyAttestation(readyAttestation({ EXPIRES_AT: "2026-09-19T02:59:59Z" }), NOW).errors.includes("READY_ATTESTATION_EXPIRED"));
});

test("capacity-first preflight requires all gates", () => {
  assert.equal(validateExecutionPreflight(preflight(), NOW).ok, true);
  const fail = validateExecutionPreflight(preflight({ EXECUTION_TRANSPORT_READY: false }), NOW);
  assert.ok(fail.errors.includes("PREFLIGHT_FAIL:EXECUTION_TRANSPORT_READY"));
});

test("ready attestation is bound to exact execution plan", () => {
  const fail = validateExecutionPreflight(preflight({
    WORKER_READY_ATTESTATION: readyAttestation({ EXECUTION_PLAN_HASH: "b".repeat(64) })
  }), NOW);
  assert.ok(fail.errors.includes("READY_ATTESTATION_PLAN_HASH_MISMATCH"));
});

test("gate cannot be triggered when preflight fails", () => {
  const fail = validateExecutionPreflight(preflight({ APPROVAL_VALID: false, GATE_TRIGGERED: true }), NOW);
  assert.ok(fail.errors.includes("GATE_TRIGGERED_WITH_FAILED_PREFLIGHT"));
});

test("observe-only operator action preserves attestation and fence", () => {
  const effect = operatorInteractionEffect("OBSERVE_ONLY");
  assert.equal(effect.ATTESTATION_INVALIDATION, "NO");
  assert.equal(effect.FENCE_ADVANCE, "NO");
  assert.equal(effect.NEW_ATTEMPT_REQUIRED, "NO");
});

test("state-affecting intervention invalidates trust and requires new attempt", () => {
  for (const interactionClass of ["STATE_AFFECTING", "PRIVILEGED_MUTATION", "RECOVERY_MUTATION"]) {
    const effect = operatorInteractionEffect(interactionClass);
    assert.equal(effect.ATTESTATION_INVALIDATION, "YES");
    assert.equal(effect.FENCE_ADVANCE, "YES");
    assert.equal(effect.AUTOMATIC_RESULT_ACCEPTANCE, "SUSPENDED");
    assert.equal(effect.REATTESTATION_REQUIRED, "YES");
    assert.equal(effect.NEW_ATTEMPT_REQUIRED, "YES");
  }
});

test("operator connectivity never owns durable session lifetime", () => {
  assert.deepEqual(validateDurableSessionConnectivity({
    CHAT_DISCONNECTED: "NO_EFFECT",
    ANDROID_OFFLINE: "NO_EFFECT",
    SSH_DISCONNECTED: "NO_EFFECT"
  }), { ok: true, errors: [] });
});
