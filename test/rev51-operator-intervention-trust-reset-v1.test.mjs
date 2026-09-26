import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  initializeDurableExecutionStateV1,
  readDurableExecutionStateV1
} from "../runtime/rev51/durable-execution-state-v1.mjs";
import {
  initializeOneShotExecutionSessionV1,
  readOneShotExecutionSessionV1,
  validateSessionAgainstDurableExecutionStateV1
} from "../runtime/rev51/one-shot-execution-session-v1.mjs";
import {
  createOperatorInterventionReceiptV1,
  evaluateAutomaticResultAcceptanceAfterInterventionV1,
  findLatestOperatorInterventionReceiptV1,
  recordOperatorInterventionV1,
  validateOperatorInterventionReceiptV1
} from "../runtime/rev51/operator-intervention-trust-reset-v1.mjs";

const T0 = Date.parse("2026-09-21T11:00:00Z");
const PLAN = "a".repeat(64);
const COMPUTE = "b".repeat(64);
const TRANSPORT = "c".repeat(64);
const ATTEST = "d".repeat(64);

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "atelier-r51-p2c-"));
  const executionPath = join(dir, "execution.json");
  const sessionPath = join(dir, "session.json");
  await initializeDurableExecutionStateV1(executionPath, {
    EXECUTION_ID: "exec-001",
    EXECUTION_EPOCH: 1,
    ATTEMPT_ID: "attempt-001",
    LEASE_GENERATION: 1,
    FENCE_SEQUENCE: 1,
    FENCE_TOKEN: "fence-001",
    DESIRED_STATE: "EXECUTE",
    MATERIALIZED_STATE: "RUNNING",
    PROVIDER_OPERATION_STATE: "PENDING"
  }, T0);
  await initializeOneShotExecutionSessionV1(sessionPath, {
    SESSION_ID: "session-001",
    EXECUTION_PLAN_HASH: PLAN,
    EXECUTION_EPOCH: 1,
    ATTEMPT_ID: "attempt-001",
    LEASE_GENERATION: 1,
    FENCE_TOKEN: "fence-001",
    COMPUTE_PROVIDER_BINDING: { BINDING_ID: "compute-001", BINDING_SHA256: COMPUTE },
    EXECUTION_TRANSPORT_BINDING: { BINDING_ID: "transport-001", BINDING_SHA256: TRANSPORT },
    WORKER_ID: "worker-001",
    WORKER_READY_ATTESTATION_HASH: ATTEST,
    APPROVAL_GRANT_ID: "approval-001",
    BUDGET_RESERVATION_ID: "budget-001"
  }, T0 + 1);
  return { dir, executionPath, sessionPath };
}

async function cleanup(dir) {
  await rm(dir, { recursive: true, force: true });
}

function baseInput(overrides = {}) {
  return {
    SESSION_ID: "session-001",
    EXECUTION_ID: "exec-001",
    INTERACTION_CLASS: "STATE_AFFECTING",
    INTERVENTION_TYPE: "PROCESS_CONTROL",
    REASON: "bounded recovery action",
    AFFECTED_SCOPE: ["worker-process"],
    AFFECTED_STATE: "EXECUTION_TRUST_STATE",
    STARTED_AT_MS: T0 + 100,
    ENDED_AT_MS: T0 + 200,
    RUNTIME_NOW_MS: T0 + 300,
    EXPECTED_STATE_VERSION: 0,
    IDEMPOTENCY_KEY: "intervention-001",
    SUBMITTED_FENCE_TOKEN: "fence-001",
    NEW_ATTEMPT_ID: "attempt-002",
    NEW_LEASE_GENERATION: 2,
    NEW_FENCE_SEQUENCE: 2,
    NEW_FENCE_TOKEN: "fence-002",
    ...overrides
  };
}

test("OBSERVE_ONLY preserves attestation trust and execution authority", async () => {
  const { dir, executionPath, sessionPath } = await fixture();
  try {
    const beforeSession = await readOneShotExecutionSessionV1(sessionPath);
    const out = await recordOperatorInterventionV1(executionPath, baseInput({
      INTERACTION_CLASS: "OBSERVE_ONLY",
      INTERVENTION_TYPE: "READ_LOGS",
      REASON: "inspect status only",
      AFFECTED_SCOPE: ["logs"],
      AFFECTED_STATE: "READ_ONLY_OBSERVATION",
      IDEMPOTENCY_KEY: "observe-001",
      NEW_ATTEMPT_ID: undefined,
      NEW_LEASE_GENERATION: undefined,
      NEW_FENCE_SEQUENCE: undefined,
      NEW_FENCE_TOKEN: undefined
    }));
    assert.equal(out.receipt.TRUST_RESET_REQUIRED, false);
    assert.equal(out.receipt.POST_INTERVENTION_ATTESTATION.STATE, "PRESERVED");
    assert.equal(out.state.ATTEMPT_ID, "attempt-001");
    assert.equal(out.state.LEASE_GENERATION, 1);
    assert.equal(out.state.FENCE_TOKEN, "fence-001");
    assert.deepEqual(validateSessionAgainstDurableExecutionStateV1(beforeSession, out.state), { ok: true, errors: [] });
  } finally { await cleanup(dir); }
});

test("STATE_AFFECTING invalidates trust, advances fence and requires new attempt", async () => {
  const { dir, executionPath } = await fixture();
  try {
    const out = await recordOperatorInterventionV1(executionPath, baseInput());
    assert.equal(out.receipt.TRUST_RESET_REQUIRED, true);
    assert.equal(out.receipt.POST_INTERVENTION_ATTESTATION.STATE, "INVALIDATED");
    assert.equal(out.receipt.AUTOMATIC_RESULT_ACCEPTANCE, "SUSPENDED");
    assert.equal(out.receipt.REATTESTATION_REQUIRED, "YES");
    assert.equal(out.receipt.NEW_ATTEMPT_REQUIRED, "YES");
    assert.equal(out.state.ATTEMPT_ID, "attempt-002");
    assert.equal(out.state.LEASE_GENERATION, 2);
    assert.equal(out.state.FENCE_SEQUENCE, 2);
    assert.equal(out.state.FENCE_TOKEN, "fence-002");
  } finally { await cleanup(dir); }
});

test("state-affecting trust reset makes the pre-intervention session authority stale", async () => {
  const { dir, executionPath, sessionPath } = await fixture();
  try {
    const oldSession = await readOneShotExecutionSessionV1(sessionPath);
    const out = await recordOperatorInterventionV1(executionPath, baseInput());
    const validation = validateSessionAgainstDurableExecutionStateV1(oldSession, out.state);
    assert.equal(validation.ok, false);
    assert.ok(validation.errors.includes("SESSION_ATTEMPT_ID_MISMATCH"));
    assert.ok(validation.errors.includes("SESSION_LEASE_GENERATION_MISMATCH"));
    assert.ok(validation.errors.includes("SESSION_FENCE_TOKEN_MISMATCH"));
  } finally { await cleanup(dir); }
});

test("PRIVILEGED_MUTATION uses the same trust-reset boundary", async () => {
  const { dir, executionPath } = await fixture();
  try {
    const out = await recordOperatorInterventionV1(executionPath, baseInput({
      INTERACTION_CLASS: "PRIVILEGED_MUTATION",
      INTERVENTION_TYPE: "PRIVILEGED_CONFIGURATION_CHANGE"
    }));
    assert.equal(out.receipt.AUTHORITY_EFFECT.FENCE_ADVANCE, "YES");
    assert.equal(out.receipt.TRUST_RESET_REQUIRED, true);
  } finally { await cleanup(dir); }
});

test("RECOVERY_MUTATION uses the same trust-reset boundary", async () => {
  const { dir, executionPath } = await fixture();
  try {
    const out = await recordOperatorInterventionV1(executionPath, baseInput({
      INTERACTION_CLASS: "RECOVERY_MUTATION",
      INTERVENTION_TYPE: "BREAK_GLASS_REPAIR"
    }));
    assert.equal(out.receipt.POST_INTERVENTION_ATTESTATION.REATTESTATION_REQUIRED, "YES");
  } finally { await cleanup(dir); }
});

test("ambiguous interaction class fails conservative to STATE_AFFECTING", async () => {
  const { dir, executionPath } = await fixture();
  try {
    const out = await recordOperatorInterventionV1(executionPath, baseInput({
      INTERACTION_CLASS: "AMBIGUOUS_INTERACTIVE_ACCESS"
    }));
    assert.equal(out.receipt.INTERACTION_CLASS, "STATE_AFFECTING");
    assert.equal(out.receipt.CLASSIFICATION_MODE, "CONSERVATIVE_STATE_AFFECTING");
    assert.equal(out.receipt.TRUST_RESET_REQUIRED, true);
  } finally { await cleanup(dir); }
});

test("OBSERVE_ONLY cannot smuggle a new attempt, lease or fence", async () => {
  const { dir, executionPath } = await fixture();
  try {
    await assert.rejects(() => recordOperatorInterventionV1(executionPath, baseInput({
      INTERACTION_CLASS: "OBSERVE_ONLY",
      INTERVENTION_TYPE: "READ_STATUS",
      AFFECTED_STATE: "READ_ONLY_OBSERVATION"
    })), /OBSERVE_ONLY_NEW_ATTEMPT_ID_DENIED/);
  } finally { await cleanup(dir); }
});

test("stale submitted fence is rejected before trust-reset mutation", async () => {
  const { dir, executionPath } = await fixture();
  try {
    await assert.rejects(() => recordOperatorInterventionV1(executionPath, baseInput({
      SUBMITTED_FENCE_TOKEN: "fence-stale"
    })), /STALE_FENCE_REJECTED/);
    const state = await readDurableExecutionStateV1(executionPath);
    assert.equal(state.STATE_VERSION, 0);
    assert.equal(state.FENCE_TOKEN, "fence-001");
  } finally { await cleanup(dir); }
});

test("trust-reset receipt is embedded in the durable hash-chained event ledger", async () => {
  const { dir, executionPath } = await fixture();
  try {
    const out = await recordOperatorInterventionV1(executionPath, baseInput());
    const latest = findLatestOperatorInterventionReceiptV1(out.state);
    assert.deepEqual(latest, out.receipt);
    assert.equal(out.state.EVENT_LEDGER.at(-1).EVENT_TYPE, "OPERATOR_INTERVENTION_TRUST_RESET");
    assert.equal(out.state.EVENT_LEDGER.at(-1).PAYLOAD.CURRENT_ATTESTATION_INVALIDATED, true);
  } finally { await cleanup(dir); }
});

test("identical operator intervention replay is idempotent", async () => {
  const { dir, executionPath } = await fixture();
  try {
    const input = baseInput();
    const first = await recordOperatorInterventionV1(executionPath, input);
    const second = await recordOperatorInterventionV1(executionPath, input);
    assert.equal(first.replay, false);
    assert.equal(second.replay, true);
    assert.deepEqual(second.receipt, first.receipt);
    assert.equal(second.state.STATE_VERSION, 1);
    assert.equal(second.state.LAST_EVENT_SEQUENCE, 2);
  } finally { await cleanup(dir); }
});

test("same idempotency key with changed intervention is denied", async () => {
  const { dir, executionPath } = await fixture();
  try {
    await recordOperatorInterventionV1(executionPath, baseInput());
    await assert.rejects(() => recordOperatorInterventionV1(executionPath, baseInput({
      REASON: "different reason"
    })), /OPERATOR_INTERVENTION_IDEMPOTENCY_CONFLICT/);
  } finally { await cleanup(dir); }
});

test("tampered intervention receipt hash is rejected", async () => {
  const { dir, executionPath } = await fixture();
  try {
    const state = await readDurableExecutionStateV1(executionPath);
    const receipt = createOperatorInterventionReceiptV1(state, baseInput());
    receipt.REASON = "tampered";
    const result = validateOperatorInterventionReceiptV1(receipt);
    assert.equal(result.ok, false);
    assert.ok(result.errors.includes("OPERATOR_INTERVENTION_RECEIPT_HASH_MISMATCH"));
  } finally { await cleanup(dir); }
});

test("automatic result acceptance gate is unchanged for OBSERVE_ONLY", async () => {
  const { dir, executionPath } = await fixture();
  try {
    const state = await readDurableExecutionStateV1(executionPath);
    const receipt = createOperatorInterventionReceiptV1(state, baseInput({
      INTERACTION_CLASS: "OBSERVE_ONLY",
      INTERVENTION_TYPE: "READ_RECEIPTS",
      AFFECTED_SCOPE: ["receipts"],
      AFFECTED_STATE: "READ_ONLY_OBSERVATION",
      NEW_ATTEMPT_ID: undefined,
      NEW_LEASE_GENERATION: undefined,
      NEW_FENCE_SEQUENCE: undefined,
      NEW_FENCE_TOKEN: undefined
    }));
    assert.deepEqual(evaluateAutomaticResultAcceptanceAfterInterventionV1(receipt), {
      ok: true,
      AUTOMATIC_RESULT_ACCEPTANCE: "UNCHANGED",
      REATTESTATION_REQUIRED: "NO",
      NEW_ATTEMPT_REQUIRED: "NO"
    });
  } finally { await cleanup(dir); }
});

test("automatic result acceptance is suspended after state-affecting intervention", async () => {
  const { dir, executionPath } = await fixture();
  try {
    const state = await readDurableExecutionStateV1(executionPath);
    const receipt = createOperatorInterventionReceiptV1(state, baseInput());
    assert.deepEqual(evaluateAutomaticResultAcceptanceAfterInterventionV1(receipt), {
      ok: true,
      AUTOMATIC_RESULT_ACCEPTANCE: "SUSPENDED",
      REATTESTATION_REQUIRED: "YES",
      NEW_ATTEMPT_REQUIRED: "YES"
    });
  } finally { await cleanup(dir); }
});

test("invalid intervention time range is rejected", async () => {
  const { dir, executionPath } = await fixture();
  try {
    await assert.rejects(() => recordOperatorInterventionV1(executionPath, baseInput({
      STARTED_AT_MS: T0 + 500,
      ENDED_AT_MS: T0 + 400
    })), /INTERVENTION_TIME_RANGE_INVALID/);
  } finally { await cleanup(dir); }
});

test("affected scope must be explicit and duplicate-free", async () => {
  const { dir, executionPath } = await fixture();
  try {
    await assert.rejects(() => recordOperatorInterventionV1(executionPath, baseInput({
      AFFECTED_SCOPE: ["worker-process", "worker-process"]
    })), /AFFECTED_SCOPE_DUPLICATE/);
  } finally { await cleanup(dir); }
});
