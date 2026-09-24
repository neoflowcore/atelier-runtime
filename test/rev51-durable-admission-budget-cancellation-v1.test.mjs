import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  deriveAdmissionBudgetProjectionV1,
  initializeDurableAdmissionBudgetV1,
  readDurableAdmissionBudgetV1,
  requestExecutionCancellationV1,
  reserveAdmissionBudgetV1,
  settleAdmissionReservationV1,
  startReservedAdmissionV1,
  validateDurableAdmissionBudgetV1,
  validateReservationForExecutionV1
} from "../runtime/rev51/durable-admission-budget-cancellation-v1.mjs";

const T0 = Date.parse("2026-09-24T00:00:00.000Z");
const TASK = "1".repeat(64);
const INTENT = "2".repeat(64);
const PLAN = "3".repeat(64);

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "r51-p2g-"));
  const admissionPath = join(dir, "admission.json");
  const statePath = join(dir, "execution-state.json");
  const state = {
    EXECUTION_ID: "exec-1",
    ATTEMPT_ID: "attempt-1",
    LEASE_GENERATION: 1,
    FENCE_SEQUENCE: 1,
    FENCE_TOKEN: "fence-1",
    STATE_VERSION: 7,
    RECONCILIATION_REQUIRED: false
  };
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await initializeDurableAdmissionBudgetV1(admissionPath, {
    TASK_CONTRACT_SHA256: TASK,
    EXECUTION_INTENT_SHA256: INTENT,
    EXECUTION_PLAN_SHA256: PLAN,
    ECONOMY_BUDGET: { MAX_EXECUTIONS: 2, MAX_RETRIES: 1, MAX_REPAIRS: 1, MAX_PARALLELISM: 2 },
    BUDGET_INTENT: { MAX_RUNTIME_SECONDS: 300, MAX_COST_MICRO_USD: 1000 }
  }, T0);
  return { dir, admissionPath, statePath, state };
}

function reserveRequest(overrides = {}) {
  return {
    EXPECTED_ADMISSION_STATE_VERSION: 0,
    EXPECTED_EXECUTION_STATE_VERSION: 7,
    EXECUTION_ID: "exec-1",
    SUBMITTED_FENCE_TOKEN: "fence-1",
    IDEMPOTENCY_KEY: "reserve-1",
    RESERVATION_ID: "reservation-1",
    KIND: "EXECUTION",
    RUNTIME_SECONDS: 60,
    COST_MICRO_USD: 100,
    RUNTIME_NOW_MS: T0 + 1000,
    ...overrides
  };
}

function stateRequest(version, key, overrides = {}) {
  return {
    EXPECTED_ADMISSION_STATE_VERSION: version,
    EXPECTED_EXECUTION_STATE_VERSION: 7,
    EXECUTION_ID: "exec-1",
    SUBMITTED_FENCE_TOKEN: "fence-1",
    IDEMPOTENCY_KEY: key,
    RUNTIME_NOW_MS: T0 + 2000 + version,
    ...overrides
  };
}

test("initialize and reopen preserve durable budget state", async () => {
  const f = await fixture();
  try {
    const s = await readDurableAdmissionBudgetV1(f.admissionPath);
    assert.deepEqual(validateDurableAdmissionBudgetV1(s), { ok: true, errors: [] });
    assert.equal(s.ADMISSION_OPEN, true);
    assert.equal(s.CANCELLATION_STATUS, "NONE");
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("reservation binds current execution state and fence", async () => {
  const f = await fixture();
  try {
    const r = await reserveAdmissionBudgetV1(f.admissionPath, f.statePath, reserveRequest());
    assert.equal(r.store.RESERVATIONS["reservation-1"].FENCE_TOKEN, "fence-1");
    assert.equal(r.store.RESERVATIONS["reservation-1"].SOURCE_EXECUTION_STATE_VERSION, 7);
    assert.equal(r.store.TOTAL_EXECUTIONS_RESERVED, 1);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("stale fence is rejected", async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      reserveAdmissionBudgetV1(f.admissionPath, f.statePath, reserveRequest({ SUBMITTED_FENCE_TOKEN: "stale" })),
      /STALE_FENCE_REJECTED/
    );
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("execution state CAS mismatch is rejected", async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      reserveAdmissionBudgetV1(f.admissionPath, f.statePath, reserveRequest({ EXPECTED_EXECUTION_STATE_VERSION: 6 })),
      /EXECUTION_STATE_CAS_MISMATCH/
    );
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("same idempotency exact replay does not double spend budget", async () => {
  const f = await fixture();
  try {
    const a = await reserveAdmissionBudgetV1(f.admissionPath, f.statePath, reserveRequest());
    const b = await reserveAdmissionBudgetV1(f.admissionPath, f.statePath, reserveRequest({ RUNTIME_NOW_MS: T0 + 9000 }));
    assert.equal(a.replay, false);
    assert.equal(b.replay, true);
    assert.equal(b.store.TOTAL_EXECUTIONS_RESERVED, 1);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("same idempotency changed request is rejected", async () => {
  const f = await fixture();
  try {
    await reserveAdmissionBudgetV1(f.admissionPath, f.statePath, reserveRequest());
    await assert.rejects(
      reserveAdmissionBudgetV1(f.admissionPath, f.statePath, reserveRequest({ COST_MICRO_USD: 101, RUNTIME_NOW_MS: T0 + 9000 })),
      /ADMISSION_IDEMPOTENCY_KEY_CONFLICT/
    );
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("max execution count is fail closed", async () => {
  const f = await fixture();
  try {
    await reserveAdmissionBudgetV1(f.admissionPath, f.statePath, reserveRequest());
    await settleAdmissionReservationV1(f.admissionPath, f.statePath, stateRequest(1, "settle-1", { RESERVATION_ID: "reservation-1", TERMINAL_STATE: "SUCCEEDED" }));
    await reserveAdmissionBudgetV1(f.admissionPath, f.statePath, reserveRequest({ EXPECTED_ADMISSION_STATE_VERSION: 2, IDEMPOTENCY_KEY: "reserve-2", RESERVATION_ID: "reservation-2" }));
    await settleAdmissionReservationV1(f.admissionPath, f.statePath, stateRequest(3, "settle-2", { RESERVATION_ID: "reservation-2", TERMINAL_STATE: "SUCCEEDED" }));
    await assert.rejects(
      reserveAdmissionBudgetV1(f.admissionPath, f.statePath, reserveRequest({ EXPECTED_ADMISSION_STATE_VERSION: 4, IDEMPOTENCY_KEY: "reserve-3", RESERVATION_ID: "reservation-3" })),
      /MAX_EXECUTIONS_EXHAUSTED/
    );
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("max parallelism ceiling blocks oversubscription without interpreting A6", async () => {
  const f = await fixture();
  try {
    await reserveAdmissionBudgetV1(f.admissionPath, f.statePath, reserveRequest());
    await reserveAdmissionBudgetV1(f.admissionPath, f.statePath, reserveRequest({ EXPECTED_ADMISSION_STATE_VERSION: 1, IDEMPOTENCY_KEY: "reserve-2", RESERVATION_ID: "reservation-2" }));
    await assert.rejects(
      reserveAdmissionBudgetV1(f.admissionPath, f.statePath, reserveRequest({ EXPECTED_ADMISSION_STATE_VERSION: 2, IDEMPOTENCY_KEY: "reserve-retry", RESERVATION_ID: "reservation-3", KIND: "RETRY" })),
      /MAX_PARALLELISM_EXHAUSTED/
    );
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("runtime budget ceiling is enforced", async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      reserveAdmissionBudgetV1(f.admissionPath, f.statePath, reserveRequest({ RUNTIME_SECONDS: 301 })),
      /MAX_RUNTIME_SECONDS_EXHAUSTED/
    );
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("cost budget ceiling is enforced", async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      reserveAdmissionBudgetV1(f.admissionPath, f.statePath, reserveRequest({ COST_MICRO_USD: 1001 })),
      /MAX_COST_MICRO_USD_EXHAUSTED/
    );
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("reserved admission must exist before execution start", async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      startReservedAdmissionV1(f.admissionPath, f.statePath, stateRequest(0, "start-missing", { RESERVATION_ID: "missing" })),
      /RESERVATION_NOT_FOUND/
    );
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("cancellation closes new admission and start", async () => {
  const f = await fixture();
  try {
    await reserveAdmissionBudgetV1(f.admissionPath, f.statePath, reserveRequest());
    const c = await requestExecutionCancellationV1(f.admissionPath, f.statePath, stateRequest(1, "cancel-1", { REASON: "operator" }));
    assert.equal(c.store.ADMISSION_OPEN, false);
    assert.equal(c.store.CANCELLATION_STATUS, "REQUESTED");
    await assert.rejects(
      reserveAdmissionBudgetV1(f.admissionPath, f.statePath, reserveRequest({ EXPECTED_ADMISSION_STATE_VERSION: 2, IDEMPOTENCY_KEY: "reserve-2", RESERVATION_ID: "reservation-2" })),
      /ADMISSION_CLOSED_BY_CANCELLATION/
    );
    await assert.rejects(
      startReservedAdmissionV1(f.admissionPath, f.statePath, stateRequest(2, "start-1", { RESERVATION_ID: "reservation-1" })),
      /START_DENIED_BY_CANCELLATION/
    );
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("cancellation still allows terminal settlement and becomes cancelled", async () => {
  const f = await fixture();
  try {
    await reserveAdmissionBudgetV1(f.admissionPath, f.statePath, reserveRequest());
    await requestExecutionCancellationV1(f.admissionPath, f.statePath, stateRequest(1, "cancel-1"));
    const s = await settleAdmissionReservationV1(f.admissionPath, f.statePath, stateRequest(2, "settle-1", { RESERVATION_ID: "reservation-1", TERMINAL_STATE: "CANCELLED" }));
    assert.equal(s.store.CANCELLATION_STATUS, "CANCELLED");
    assert.equal(deriveAdmissionBudgetProjectionV1(s.store).ACTIVE_RESERVATION_COUNT, 0);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("cancellation without active reservations becomes immediately terminal", async () => {
  const f = await fixture();
  try {
    const c = await requestExecutionCancellationV1(f.admissionPath, f.statePath, stateRequest(0, "cancel-empty"));
    assert.equal(c.store.CANCELLATION_STATUS, "CANCELLED");
    assert.equal(c.store.CANCELLATION_FENCE_TOKEN, "fence-1");
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("restart preserves cancellation and budget spend", async () => {
  const f = await fixture();
  try {
    await reserveAdmissionBudgetV1(f.admissionPath, f.statePath, reserveRequest());
    await requestExecutionCancellationV1(f.admissionPath, f.statePath, stateRequest(1, "cancel-1"));
    const reopened = await readDurableAdmissionBudgetV1(f.admissionPath);
    assert.equal(reopened.CANCELLATION_STATUS, "REQUESTED");
    assert.equal(reopened.TOTAL_EXECUTIONS_RESERVED, 1);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("reservation execution validation denies stale fence", async () => {
  const f = await fixture();
  try {
    const r = await reserveAdmissionBudgetV1(f.admissionPath, f.statePath, reserveRequest());
    assert.deepEqual(validateReservationForExecutionV1(r.store, "reservation-1", "stale"), { ok: false, code: "RESERVATION_FENCE_MISMATCH" });
    assert.deepEqual(validateReservationForExecutionV1(r.store, "reservation-1", "fence-1"), { ok: true, code: "EXECUTION_ADMISSION_VALID" });
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("started reservation settles without budget refund", async () => {
  const f = await fixture();
  try {
    await reserveAdmissionBudgetV1(f.admissionPath, f.statePath, reserveRequest());
    await startReservedAdmissionV1(f.admissionPath, f.statePath, stateRequest(1, "start-1", { RESERVATION_ID: "reservation-1" }));
    const s = await settleAdmissionReservationV1(f.admissionPath, f.statePath, stateRequest(2, "settle-1", { RESERVATION_ID: "reservation-1", TERMINAL_STATE: "FAILED" }));
    assert.equal(s.store.TOTAL_EXECUTIONS_RESERVED, 1);
    assert.equal(s.store.TOTAL_RUNTIME_SECONDS_RESERVED, 60);
    assert.equal(s.store.TOTAL_COST_MICRO_USD_RESERVED, 100);
    assert.equal(deriveAdmissionBudgetProjectionV1(s.store).ACTIVE_RESERVATION_COUNT, 0);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("tampered event hash is rejected after reopen", async () => {
  const f = await fixture();
  try {
    const raw = JSON.parse(await readFile(f.admissionPath, "utf8"));
    raw.EVENT_LEDGER[0].EVENT_SHA256 = "0".repeat(64);
    await writeFile(f.admissionPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
    await assert.rejects(readDurableAdmissionBudgetV1(f.admissionPath), /ADMISSION_EVENT_HASH_MISMATCH/);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});
