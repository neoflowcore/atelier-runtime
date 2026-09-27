import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  A5T_AUTHORITATIVE_BINDING,
  A5T_EXECUTION_STATES,
  A5T_NON_TERMINAL_STATES,
  A5T_TERMINAL_STATES,
  bindA5TExecutionTerminalToSessionV1,
  buildRuntimeExecutionTerminalEvidenceV1,
  deriveA5TExecutionTerminalProjectionV1,
  validateA5TSourceStatusV1,
  validateRuntimeExecutionTerminalEvidenceV1
} from "../runtime/rev51/pilote-execution-terminal-semantic-consumer-v1.mjs";
import {
  initializeDurableExecutionStateV1,
  readDurableExecutionStateV1
} from "../runtime/rev51/durable-execution-state-v1.mjs";
import {
  initializeOneShotExecutionSessionV1,
  readOneShotExecutionSessionV1
} from "../runtime/rev51/one-shot-execution-session-v1.mjs";

const T0 = Date.parse("2026-09-25T03:00:00.000Z");
const PLAN = "a".repeat(64);
let tick = 0;
function now() { tick += 1000; return T0 + tick; }

function status(sessionId, executionState, overrides = {}) {
  return {
    SESSION_ID: sessionId,
    EXECUTION_STATE: executionState,
    RESOURCE_STATE: "CLEANED",
    BILLING_STATE: "STOPPED",
    PROVIDER_OPERATION_STATE: executionState === "OUTCOME_UNKNOWN" ? "OUTCOME_UNKNOWN" : "SUCCEEDED",
    CHAT_DISCONNECTED: "NO_EFFECT",
    ANDROID_OFFLINE: "NO_EFFECT",
    SSH_DISCONNECTED: "NO_EFFECT",
    ...overrides
  };
}

async function fixture(executionState = "SUCCEEDED") {
  const dir = await mkdtemp(join(tmpdir(), "r51-a5t-runtime-"));
  const statePath = join(dir, "state.json");
  const sessionPath = join(dir, "session.json");
  const executionId = "exec-001";
  const sessionId = "session-001";
  await initializeDurableExecutionStateV1(statePath, {
    EXECUTION_ID: executionId,
    EXECUTION_EPOCH: 2,
    ATTEMPT_ID: "attempt-003",
    LEASE_GENERATION: 4,
    FENCE_SEQUENCE: 7,
    FENCE_TOKEN: "fence-007",
    DESIRED_STATE: "RUNNING",
    MATERIALIZED_STATE: "RUNTIME_EVIDENCE_SOURCE",
    PROVIDER_OPERATION_STATE: executionState === "OUTCOME_UNKNOWN" ? "OUTCOME_UNKNOWN" : "SUCCEEDED"
  }, now());
  await initializeOneShotExecutionSessionV1(sessionPath, {
    SESSION_ID: sessionId,
    EXECUTION_PLAN_HASH: PLAN,
    EXECUTION_EPOCH: 2,
    ATTEMPT_ID: "attempt-003",
    LEASE_GENERATION: 4,
    FENCE_TOKEN: "fence-007",
    COMPUTE_PROVIDER_BINDING: { BINDING_ID: "compute-1", BINDING_SHA256: "b".repeat(64) },
    EXECUTION_TRANSPORT_BINDING: { BINDING_ID: "transport-1", BINDING_SHA256: "c".repeat(64) },
    WORKER_ID: "worker-001",
    WORKER_READY_ATTESTATION_HASH: "d".repeat(64),
    APPROVAL_GRANT_ID: "approval-001",
    BUDGET_RESERVATION_ID: "budget-001",
    BILLING_STATUS: "STOPPED"
  }, now());
  const state = await readDurableExecutionStateV1(statePath);
  const evidence = buildRuntimeExecutionTerminalEvidenceV1({
    SESSION_ID: sessionId,
    EXECUTION_ID: executionId,
    EXECUTION_EPOCH: state.EXECUTION_EPOCH,
    ATTEMPT_ID: state.ATTEMPT_ID,
    LEASE_GENERATION: state.LEASE_GENERATION,
    FENCE_TOKEN: state.FENCE_TOKEN,
    SOURCE_STATE_VERSION: state.STATE_VERSION,
    SOURCE_EVENT_SHA256: state.EVENT_LEDGER.at(-1).EVENT_SHA256,
    OPERATION_ID: `operation-${executionState}`,
    OPERATION_IDEMPOTENCY_KEY: `operation-idem-${executionState}`,
    EXECUTION_SESSION_STATUS: status(sessionId, executionState)
  });
  return { dir, statePath, sessionPath, evidence };
}

async function cleanup(f) { await rm(f.dir, { recursive: true, force: true }); }
function request(overrides = {}) {
  return {
    EXPECTED_SESSION_STATE_VERSION: 0,
    IDEMPOTENCY_KEY: "a5t-bind-001",
    SUBMITTED_FENCE_TOKEN: "fence-007",
    RUNTIME_NOW_MS: now(),
    ...overrides
  };
}

test("A5T authoritative identities are exact", () => {
  assert.equal(A5T_AUTHORITATIVE_BINDING.HEAD, "e74a428d1c987aaec396a8a144869747b42360e9");
  assert.equal(A5T_AUTHORITATIVE_BINDING.TREE, "1a403580a090edc8747c156ae67cd9031fbcf439");
  assert.equal(A5T_AUTHORITATIVE_BINDING.SCHEMA_SHA256, "a02d12215955e8b3fcfc663a6123002303d3ed80fe395d9aed97e0212cec6336");
  assert.equal(A5T_AUTHORITATIVE_BINDING.TEST_VECTOR_SET_SHA256, "73d0840feff0977e7ebd6c1e91e66055fe4f3bdf6c8c59e569fdae24ef9e6fc1");
  assert.equal(A5T_AUTHORITATIVE_BINDING.EXPECTED_RESULT_SET_SHA256, "62c85eeaac53bfc69adefdf9d54b0c6c76e03dabb51470876a35206aec669095");
  assert.equal(A5T_AUTHORITATIVE_BINDING.AUTHORITATIVE_MANIFEST_SHA256, "4e8a77efd1171d82dcc20e1b1908e5cafefd3284477f9f8a7af375354956b3a8");
  assert.equal(A5T_AUTHORITATIVE_BINDING.SOURCE_STATUS_SCHEMA_SHA256, "fd612bf9556b20b9434d6218ec437d9ec61dfe447f1d9eb534fbb4e7a2a3b5f2");
  assert.equal(A5T_AUTHORITATIVE_BINDING.SOURCE_STATUS_SCHEMA_GIT_BLOB, "d0e0c62d1b387d39eb911e493eeb459e283e626a");
});

test("source status enum is exact A5T source contract", () => {
  assert.deepEqual(A5T_EXECUTION_STATES, ["REQUESTED","READY","RUNNING","SUCCEEDED","FAILED","CANCELED","EXPIRED","OUTCOME_UNKNOWN"]);
  assert.deepEqual(A5T_TERMINAL_STATES, ["SUCCEEDED","FAILED","CANCELED","EXPIRED"]);
  assert.deepEqual(A5T_NON_TERMINAL_STATES, ["REQUESTED","READY","RUNNING","OUTCOME_UNKNOWN"]);
  for (const executionState of A5T_EXECUTION_STATES) {
    assert.deepEqual(validateA5TSourceStatusV1(status("session-1", executionState)), { ok: true, errors: [] });
  }
});

test("A5T projection reproduces terminal partition and acceptance non-implication", () => {
  for (const executionState of A5T_EXECUTION_STATES) {
    const projection = deriveA5TExecutionTerminalProjectionV1(executionState);
    assert.equal(projection.EXECUTION_TERMINAL, A5T_TERMINAL_STATES.includes(executionState));
    assert.equal(projection.RECONCILIATION_REQUIRED, executionState === "OUTCOME_UNKNOWN");
    assert.equal(projection.ACCEPTANCE_IMPLIED, false);
    assert.equal(projection.RUNTIME_EVIDENCE_REQUIRED, true);
  }
});

for (const executionState of ["SUCCEEDED", "FAILED", "CANCELED", "EXPIRED"]) {
  test(`${executionState} authoritative Runtime evidence sets only EXECUTION_TERMINAL`, async () => {
    const f = await fixture(executionState);
    try {
      const result = await bindA5TExecutionTerminalToSessionV1(f.statePath, f.sessionPath, f.evidence, request());
      assert.equal(result.replay, false);
      assert.equal(result.session.EXECUTION_TERMINAL, true);
      assert.equal(result.session.RECEIPT_TERMINAL, false);
      assert.equal(result.session.EXECUTION_TRANSPORT_DEREGISTERED, false);
      assert.equal(result.session.REQUIRED_RESOURCE_CLEANUP_TERMINAL, false);
      assert.equal(result.session.BILLING_STATUS, "STOPPED");
      assert.equal(result.session.SESSION_STATUS, "FINALIZING");
      assert.deepEqual(result.binding, {
        SOURCE_STATUS_SCHEMA_BINDING: "PASS",
        TERMINAL_STATE_PARTITION_BINDING: "PASS",
        OUTCOME_UNKNOWN_NON_TERMINAL_BINDING: "PASS",
        EXECUTION_TERMINAL_RUNTIME_EVIDENCE_BINDING: "PASS",
        ACCEPTANCE_NON_IMPLICATION_BINDING: "PASS"
      });
    } finally { await cleanup(f); }
  });
}

test("OUTCOME_UNKNOWN remains non-terminal and requires reconciliation", async () => {
  const f = await fixture("OUTCOME_UNKNOWN");
  try {
    await assert.rejects(
      bindA5TExecutionTerminalToSessionV1(f.statePath, f.sessionPath, f.evidence, request()),
      /A5T_OUTCOME_UNKNOWN_RECONCILIATION_REQUIRED/
    );
    const session = await readOneShotExecutionSessionV1(f.sessionPath);
    assert.equal(session.EXECUTION_TERMINAL, false);
  } finally { await cleanup(f); }
});

test("RUNNING remains non-terminal without session mutation", async () => {
  const f = await fixture("RUNNING");
  try {
    await assert.rejects(
      bindA5TExecutionTerminalToSessionV1(f.statePath, f.sessionPath, f.evidence, request()),
      /A5T_EXECUTION_STATE_NOT_TERMINAL/
    );
    const session = await readOneShotExecutionSessionV1(f.sessionPath);
    assert.equal(session.EXECUTION_TERMINAL, false);
  } finally { await cleanup(f); }
});

test("runtime evidence hash and source schema binding fail closed", async () => {
  const f = await fixture("SUCCEEDED");
  try {
    const tampered = structuredClone(f.evidence);
    tampered.EXECUTION_SESSION_STATUS.EXECUTION_STATE = "FAILED";
    assert.equal(validateRuntimeExecutionTerminalEvidenceV1(tampered).ok, false);
    const drifted = structuredClone(f.evidence);
    drifted.STATUS_SCHEMA_REF.SHA256 = "0".repeat(64);
    drifted.EVIDENCE_SHA256 = "0".repeat(64);
    const result = validateRuntimeExecutionTerminalEvidenceV1(drifted);
    assert.equal(result.ok, false);
    assert.ok(result.errors.includes("SOURCE_STATUS_SCHEMA_REF_MISMATCH"));
  } finally { await cleanup(f); }
});

test("current Runtime lineage and fence bindings are exact", async () => {
  const f = await fixture("SUCCEEDED");
  try {
    for (const [field, value, pattern] of [
      ["EXECUTION_EPOCH", 99, /EXECUTION_EPOCH_MISMATCH/],
      ["ATTEMPT_ID", "attempt-other", /ATTEMPT_ID_MISMATCH/],
      ["LEASE_GENERATION", 99, /LEASE_GENERATION_MISMATCH/],
      ["FENCE_TOKEN", "fence-old", /FENCE_TOKEN_MISMATCH/],
      ["SOURCE_STATE_VERSION", 99, /STATE_VERSION_MISMATCH/],
      ["SOURCE_EVENT_SHA256", "9".repeat(64), /EVENT_HASH_MISMATCH/]
    ]) {
      const bad = structuredClone(f.evidence);
      bad[field] = value;
      bad.EVIDENCE_SHA256 = buildRuntimeExecutionTerminalEvidenceV1({
        SESSION_ID: bad.SESSION_ID,
        EXECUTION_ID: bad.EXECUTION_ID,
        EXECUTION_EPOCH: bad.EXECUTION_EPOCH,
        ATTEMPT_ID: bad.ATTEMPT_ID,
        LEASE_GENERATION: bad.LEASE_GENERATION,
        FENCE_TOKEN: bad.FENCE_TOKEN,
        SOURCE_STATE_VERSION: bad.SOURCE_STATE_VERSION,
        SOURCE_EVENT_SHA256: bad.SOURCE_EVENT_SHA256,
        OPERATION_ID: bad.OPERATION_ID,
        OPERATION_IDEMPOTENCY_KEY: bad.OPERATION_IDEMPOTENCY_KEY,
        EXECUTION_SESSION_STATUS: bad.EXECUTION_SESSION_STATUS
      }).EVIDENCE_SHA256;
      await assert.rejects(bindA5TExecutionTerminalToSessionV1(f.statePath, f.sessionPath, bad, request()), pattern);
    }
  } finally { await cleanup(f); }
});

test("same terminal binding replays exactly and second key is denied", async () => {
  const f = await fixture("SUCCEEDED");
  try {
    const req = request();
    await bindA5TExecutionTerminalToSessionV1(f.statePath, f.sessionPath, f.evidence, req);
    const replay = await bindA5TExecutionTerminalToSessionV1(f.statePath, f.sessionPath, f.evidence, { ...req, RUNTIME_NOW_MS: now() });
    assert.equal(replay.replay, true);
    await assert.rejects(
      bindA5TExecutionTerminalToSessionV1(f.statePath, f.sessionPath, f.evidence, request({ EXPECTED_SESSION_STATE_VERSION: 1, IDEMPOTENCY_KEY: "a5t-bind-002" })),
      /SESSION_EXECUTION_TERMINAL_ALREADY_SET/
    );
  } finally { await cleanup(f); }
});
