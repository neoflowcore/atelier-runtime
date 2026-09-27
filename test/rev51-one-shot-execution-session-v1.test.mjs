import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  initializeDurableExecutionStateV1,
  readDurableExecutionStateV1
} from "../runtime/rev51/durable-execution-state-v1.mjs";
import {
  initializeOneShotExecutionSessionV1,
  isSessionCompleteV1,
  readOneShotExecutionSessionV1,
  recordOneShotSessionProgressV1,
  recordSessionClientDisconnectV1,
  validateOneShotExecutionSessionV1,
  validateSessionAgainstDurableExecutionStateV1
} from "../runtime/rev51/one-shot-execution-session-v1.mjs";

const T0 = Date.parse("2026-09-21T10:00:00Z");
const H = "a".repeat(64);
const B1 = "b".repeat(64);
const B2 = "c".repeat(64);
const ATT = "d".repeat(64);

function sessionInput(overrides = {}) {
  return {
    SESSION_ID: "session-001",
    EXECUTION_PLAN_HASH: H,
    EXECUTION_EPOCH: 1,
    ATTEMPT_ID: "attempt-001",
    LEASE_GENERATION: 1,
    FENCE_TOKEN: "fence-001",
    COMPUTE_PROVIDER_BINDING: { BINDING_ID: "compute-binding-1", BINDING_SHA256: B1 },
    EXECUTION_TRANSPORT_BINDING: { BINDING_ID: "transport-binding-1", BINDING_SHA256: B2 },
    WORKER_ID: "worker-001",
    WORKER_READY_ATTESTATION_HASH: ATT,
    APPROVAL_GRANT_ID: "approval-001",
    BUDGET_RESERVATION_ID: "budget-001",
    ...overrides
  };
}

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "atelier-r51-p2b-"));
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
    MATERIALIZED_STATE: "ADMITTED",
    PROVIDER_OPERATION_STATE: "PENDING"
  }, T0);
  await initializeOneShotExecutionSessionV1(sessionPath, sessionInput(), T0 + 1);
  return { dir, executionPath, sessionPath };
}

async function cleanup(dir) {
  await rm(dir, { recursive: true, force: true });
}

async function progress(path, version, key, values = {}) {
  return recordOneShotSessionProgressV1(path, {
    EXPECTED_STATE_VERSION: version,
    IDEMPOTENCY_KEY: key,
    SUBMITTED_FENCE_TOKEN: "fence-001",
    RUNTIME_NOW_MS: T0 + 1000 + version,
    ...values
  });
}

test("session initializes with exact operational bindings and ACTIVE state", async () => {
  const { dir, sessionPath } = await fixture();
  try {
    const session = await readOneShotExecutionSessionV1(sessionPath);
    assert.equal(session.SESSION_STATUS, "ACTIVE");
    assert.equal(session.EXECUTION_PLAN_HASH, H);
    assert.equal(session.WORKER_READY_ATTESTATION_HASH, ATT);
    assert.equal(session.LAST_EVENT_SEQUENCE, 1);
    assert.equal(isSessionCompleteV1(session), false);
  } finally { await cleanup(dir); }
});

test("session exact attempt/lease/fence binding matches durable execution state", async () => {
  const { dir, executionPath, sessionPath } = await fixture();
  try {
    const session = await readOneShotExecutionSessionV1(sessionPath);
    const execution = await readDurableExecutionStateV1(executionPath);
    assert.deepEqual(validateSessionAgainstDurableExecutionStateV1(session, execution), { ok: true, errors: [] });
  } finally { await cleanup(dir); }
});

test("stale session fence binding is rejected against durable execution state", async () => {
  const { dir, executionPath, sessionPath } = await fixture();
  try {
    const session = await readOneShotExecutionSessionV1(sessionPath);
    const execution = await readDurableExecutionStateV1(executionPath);
    session.FENCE_TOKEN = "stale-fence";
    const result = validateSessionAgainstDurableExecutionStateV1(session, execution);
    assert.equal(result.ok, false);
    assert.ok(result.errors.includes("SESSION_FENCE_TOKEN_MISMATCH"));
  } finally { await cleanup(dir); }
});

test("session survives reopen from durable bytes", async () => {
  const { dir, sessionPath } = await fixture();
  try {
    const a = await readOneShotExecutionSessionV1(sessionPath);
    const b = await readOneShotExecutionSessionV1(sessionPath);
    assert.deepEqual(a, b);
  } finally { await cleanup(dir); }
});

test("chat/ssh/client disconnect records evidence but never owns session lifetime", async () => {
  const { dir, sessionPath } = await fixture();
  try {
    let state = await readOneShotExecutionSessionV1(sessionPath);
    for (const [i, channel] of ["CHAT", "SSH", "ANDROID", "CLIENT"].entries()) {
      const out = await recordSessionClientDisconnectV1(sessionPath, {
        EXPECTED_STATE_VERSION: state.STATE_VERSION,
        IDEMPOTENCY_KEY: `disconnect-${channel}`,
        SUBMITTED_FENCE_TOKEN: "fence-001",
        RUNTIME_NOW_MS: T0 + 100 + i,
        CHANNEL: channel
      });
      state = out.session;
      assert.equal(state.SESSION_STATUS, "ACTIVE");
      assert.equal(state.FENCE_TOKEN, "fence-001");
      assert.equal(state.ATTEMPT_ID, "attempt-001");
    }
    assert.equal(state.CLIENT_DISCONNECT_EVENTS, 4);
  } finally { await cleanup(dir); }
});

test("job execution terminal alone never completes the durable session", async () => {
  const { dir, sessionPath } = await fixture();
  try {
    const out = await progress(sessionPath, 0, "execution-terminal", { EXECUTION_TERMINAL: true });
    assert.equal(out.session.SESSION_STATUS, "FINALIZING");
    assert.equal(isSessionCompleteV1(out.session), false);
  } finally { await cleanup(dir); }
});

test("session requires receipt, transport deregistration, resource cleanup and billing stop", async () => {
  const { dir, sessionPath } = await fixture();
  try {
    const out = await progress(sessionPath, 0, "almost-complete", {
      EXECUTION_TERMINAL: true,
      RECEIPT_TERMINAL: true,
      EXECUTION_TRANSPORT_DEREGISTERED: true,
      REQUIRED_RESOURCE_CLEANUP_TERMINAL: true
    });
    assert.equal(out.session.SESSION_STATUS, "FINALIZING");
    assert.equal(out.session.BILLING_STATUS, "ACTIVE");
    assert.equal(isSessionCompleteV1(out.session), false);
  } finally { await cleanup(dir); }
});

test("session becomes COMPLETE only after every terminal condition and billing STOPPED", async () => {
  const { dir, sessionPath } = await fixture();
  try {
    const out = await progress(sessionPath, 0, "complete", {
      EXECUTION_TERMINAL: true,
      RECEIPT_TERMINAL: true,
      EXECUTION_TRANSPORT_DEREGISTERED: true,
      REQUIRED_RESOURCE_CLEANUP_TERMINAL: true,
      BILLING_STATUS: "STOPPED"
    });
    assert.equal(out.session.SESSION_STATUS, "COMPLETE");
    assert.equal(isSessionCompleteV1(out.session), true);
  } finally { await cleanup(dir); }
});

test("NOT_APPLICABLE billing is a valid terminal billing state", async () => {
  const { dir, sessionPath } = await fixture();
  try {
    const out = await progress(sessionPath, 0, "complete-na", {
      EXECUTION_TERMINAL: true,
      RECEIPT_TERMINAL: true,
      EXECUTION_TRANSPORT_DEREGISTERED: true,
      REQUIRED_RESOURCE_CLEANUP_TERMINAL: true,
      BILLING_STATUS: "NOT_APPLICABLE"
    });
    assert.equal(out.session.SESSION_STATUS, "COMPLETE");
  } finally { await cleanup(dir); }
});

test("terminal closure flags never regress from true to false", async () => {
  const { dir, sessionPath } = await fixture();
  try {
    await progress(sessionPath, 0, "execution-terminal", { EXECUTION_TERMINAL: true });
    await assert.rejects(() => progress(sessionPath, 1, "execution-unterminal", { EXECUTION_TERMINAL: false }), /SESSION_TERMINAL_FLAG_REGRESSION/);
  } finally { await cleanup(dir); }
});

test("billing cannot reopen after STOPPED", async () => {
  const { dir, sessionPath } = await fixture();
  try {
    await progress(sessionPath, 0, "billing-stop", { BILLING_STATUS: "STOPPED" });
    await assert.rejects(() => progress(sessionPath, 1, "billing-reopen", { BILLING_STATUS: "ACTIVE" }), /BILLING_STATUS_REGRESSION_DENIED/);
  } finally { await cleanup(dir); }
});

test("identical session CAS replay is idempotent and appends no duplicate event", async () => {
  const { dir, sessionPath } = await fixture();
  try {
    const request = {
      EXPECTED_STATE_VERSION: 0,
      IDEMPOTENCY_KEY: "receipt-terminal",
      SUBMITTED_FENCE_TOKEN: "fence-001",
      RUNTIME_NOW_MS: T0 + 1000,
      RECEIPT_TERMINAL: true
    };
    const first = await recordOneShotSessionProgressV1(sessionPath, request);
    const second = await recordOneShotSessionProgressV1(sessionPath, request);
    assert.equal(first.replay, false);
    assert.equal(second.replay, true);
    assert.equal(second.session.STATE_VERSION, 1);
    assert.equal(second.session.LAST_EVENT_SEQUENCE, 2);
  } finally { await cleanup(dir); }
});

test("same idempotency key with different request is denied", async () => {
  const { dir, sessionPath } = await fixture();
  try {
    await progress(sessionPath, 0, "same-key", { RECEIPT_TERMINAL: true });
    await assert.rejects(() => recordOneShotSessionProgressV1(sessionPath, {
      EXPECTED_STATE_VERSION: 1,
      IDEMPOTENCY_KEY: "same-key",
      SUBMITTED_FENCE_TOKEN: "fence-001",
      RUNTIME_NOW_MS: T0 + 2000,
      EXECUTION_TRANSPORT_DEREGISTERED: true
    }), /SESSION_IDEMPOTENCY_KEY_CONFLICT/);
  } finally { await cleanup(dir); }
});

test("completed session rejects new non-replay mutation", async () => {
  const { dir, sessionPath } = await fixture();
  try {
    await progress(sessionPath, 0, "complete", {
      EXECUTION_TERMINAL: true,
      RECEIPT_TERMINAL: true,
      EXECUTION_TRANSPORT_DEREGISTERED: true,
      REQUIRED_RESOURCE_CLEANUP_TERMINAL: true,
      BILLING_STATUS: "STOPPED"
    });
    await assert.rejects(() => recordSessionClientDisconnectV1(sessionPath, {
      EXPECTED_STATE_VERSION: 1,
      IDEMPOTENCY_KEY: "after-complete",
      SUBMITTED_FENCE_TOKEN: "fence-001",
      RUNTIME_NOW_MS: T0 + 3000,
      CHANNEL: "CHAT"
    }), /SESSION_ALREADY_COMPLETE/);
  } finally { await cleanup(dir); }
});

test("session event ledger tampering is detected on reopen", async () => {
  const { dir, sessionPath } = await fixture();
  try {
    const raw = JSON.parse(await readFile(sessionPath, "utf8"));
    raw.EVENT_LEDGER[0].PAYLOAD.ATTEMPT_ID = "tampered";
    await writeFile(sessionPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
    await assert.rejects(() => readOneShotExecutionSessionV1(sessionPath), /SESSION_EVENT_HASH_MISMATCH/);
  } finally { await cleanup(dir); }
});

test("runtime authoritative time is mandatory", async () => {
  const dir = await mkdtemp(join(tmpdir(), "atelier-r51-p2b-time-"));
  const sessionPath = join(dir, "session.json");
  try {
    await assert.rejects(() => initializeOneShotExecutionSessionV1(sessionPath, sessionInput()), /RUNTIME_AUTHORITATIVE_TIME_REQUIRED/);
  } finally { await cleanup(dir); }
});
