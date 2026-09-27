import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  PROVIDER_BOOTSTRAP_PHASES,
  beginProviderBootstrapPhaseV1,
  initializeProviderBootstrapSagaV1,
  recordProviderBootstrapPhaseResultV1
} from "../runtime/rev51/provider-bootstrap-saga-v1.mjs";
import {
  initializeOneShotExecutionSessionV1,
  readOneShotExecutionSessionV1,
  recordSessionClientDisconnectV1
} from "../runtime/rev51/one-shot-execution-session-v1.mjs";
import { bindProviderTerminalProjectionToSessionV1 } from "../runtime/rev51/durable-provider-terminal-session-binding-v1.mjs";

const T0 = Date.parse("2026-09-25T02:00:00.000Z");
const PLAN = "a".repeat(64);
const EVIDENCE = "e".repeat(64);
let tick = 0;
function now() { tick += 1000; return T0 + tick; }

async function createSaga(dir, { planHash = PLAN, executionId = "exec-001", approval = "approval-001", budget = "budget-001", provider = "DIGITALOCEAN", complete = true } = {}) {
  const path = join(dir, `saga-${executionId}-${provider}-${planHash.slice(0,8)}.json`);
  await initializeProviderBootstrapSagaV1(path, {
    SAGA_ID: `saga-${executionId}-${provider}`,
    EXECUTION_ID: executionId,
    EXECUTION_PLAN_HASH: planHash,
    BOOTSTRAP_SPEC_SHA256: "b".repeat(64),
    COMPUTE_PROVIDER: provider,
    EXECUTION_TRANSPORT: "DIRECT_WORKER",
    APPROVAL_GRANT_ID: approval,
    BUDGET_RESERVATION_ID: budget
  }, now());
  if (!complete) return { path, saga: null };
  let stateVersion = 0;
  let saga;
  for (const phase of PROVIDER_BOOTSTRAP_PHASES) {
    const op = `op-${phase}`;
    const begun = await beginProviderBootstrapPhaseV1(path, {
      EXPECTED_STATE_VERSION: stateVersion,
      IDEMPOTENCY_KEY: `begin-${phase}`,
      RUNTIME_NOW_MS: now(),
      PHASE: phase,
      OPERATION_ID: op,
      OPERATION_IDEMPOTENCY_KEY: `remote-${phase}`
    });
    stateVersion = begun.saga.STATE_VERSION;
    const done = await recordProviderBootstrapPhaseResultV1(path, {
      EXPECTED_STATE_VERSION: stateVersion,
      IDEMPOTENCY_KEY: `pass-${phase}`,
      RUNTIME_NOW_MS: now(),
      PHASE: phase,
      OPERATION_ID: op,
      OPERATION_IDEMPOTENCY_KEY: `remote-${phase}`,
      RESULT: "PASS",
      ...(new Set(["BOOTSTRAP","ATTEST","REGISTER_TRANSPORT","BIND_JOB"]).has(phase) ? { EVIDENCE_SHA256: EVIDENCE } : {}),
      ...(phase === "BILLING_STOP" ? { BILLING_STATUS: provider === "LOCAL" ? "NOT_APPLICABLE" : "STOPPED" } : {})
    });
    saga = done.saga;
    stateVersion = saga.STATE_VERSION;
  }
  return { path, saga };
}

async function createSession(dir, { planHash = PLAN, approval = "approval-001", budget = "budget-001", billing = "STOPPED" } = {}) {
  const path = join(dir, `session-${planHash.slice(0,8)}-${approval}-${budget}-${billing}.json`);
  const session = await initializeOneShotExecutionSessionV1(path, {
    SESSION_ID: `session-${planHash.slice(0,8)}-${approval}-${budget}-${billing}`,
    EXECUTION_PLAN_HASH: planHash,
    EXECUTION_EPOCH: 2,
    ATTEMPT_ID: "attempt-003",
    LEASE_GENERATION: 4,
    FENCE_TOKEN: "fence-007",
    COMPUTE_PROVIDER_BINDING: { BINDING_ID: "compute-1", BINDING_SHA256: "c".repeat(64) },
    EXECUTION_TRANSPORT_BINDING: { BINDING_ID: "transport-1", BINDING_SHA256: "d".repeat(64) },
    WORKER_ID: "worker-001",
    WORKER_READY_ATTESTATION_HASH: "f".repeat(64),
    APPROVAL_GRANT_ID: approval,
    BUDGET_RESERVATION_ID: budget,
    BILLING_STATUS: billing
  }, now());
  return { path, session };
}

async function fixture(options = {}) {
  const dir = await mkdtemp(join(tmpdir(), "r51-p2x-"));
  const saga = await createSaga(dir, options.saga ?? {});
  const session = await createSession(dir, options.session ?? {});
  return { dir, sagaPath: saga.path, saga: saga.saga, sessionPath: session.path, session: session.session };
}
function request(f, overrides = {}) {
  return {
    EXPECTED_SAGA_STATE_VERSION: f.saga.STATE_VERSION,
    EXPECTED_SAGA_EVENT_SHA256: f.saga.EVENT_LEDGER.at(-1).EVENT_SHA256,
    EXPECTED_SESSION_STATE_VERSION: f.session.STATE_VERSION,
    IDEMPOTENCY_KEY: "provider-terminal-001",
    SUBMITTED_FENCE_TOKEN: "fence-007",
    RUNTIME_NOW_MS: now(),
    ...overrides
  };
}
async function cleanup(f) { await rm(f.dir, { recursive: true, force: true }); }

test("P2E COMPLETE binds only transport deregistration and cleanup terminal flags", async () => {
  const f = await fixture();
  try {
    const r = await bindProviderTerminalProjectionToSessionV1(f.sagaPath, f.sessionPath, request(f));
    assert.equal(r.replay, false);
    assert.equal(r.session.EXECUTION_TRANSPORT_DEREGISTERED, true);
    assert.equal(r.session.REQUIRED_RESOURCE_CLEANUP_TERMINAL, true);
    assert.equal(r.session.EXECUTION_TERMINAL, false);
    assert.equal(r.session.RECEIPT_TERMINAL, false);
    assert.equal(r.session.BILLING_STATUS, "STOPPED");
    assert.equal(r.session.SESSION_STATUS, "ACTIVE");
  } finally { await cleanup(f); }
});

test("same provider terminal binding request replays exactly", async () => {
  const f = await fixture();
  try {
    const req = request(f);
    await bindProviderTerminalProjectionToSessionV1(f.sagaPath, f.sessionPath, req);
    const replay = await bindProviderTerminalProjectionToSessionV1(f.sagaPath, f.sessionPath, { ...req, RUNTIME_NOW_MS: now() });
    assert.equal(replay.replay, true);
  } finally { await cleanup(f); }
});

test("different key after provider terminal flags are set is denied", async () => {
  const f = await fixture();
  try {
    await bindProviderTerminalProjectionToSessionV1(f.sagaPath, f.sessionPath, request(f));
    await assert.rejects(
      bindProviderTerminalProjectionToSessionV1(f.sagaPath, f.sessionPath, request(f, {
        IDEMPOTENCY_KEY: "provider-terminal-002",
        EXPECTED_SESSION_STATE_VERSION: 1
      })),
      /SESSION_PROVIDER_TERMINAL_FLAGS_ALREADY_SET/
    );
  } finally { await cleanup(f); }
});

test("plan, approval and budget bindings are exact", async () => {
  const f = await fixture();
  try {
    const otherPlan = await createSession(f.dir, { planHash: "9".repeat(64) });
    await assert.rejects(bindProviderTerminalProjectionToSessionV1(f.sagaPath, otherPlan.path, {
      ...request(f), EXPECTED_SESSION_STATE_VERSION: 0
    }), /PLAN_HASH_MISMATCH/);
    const otherApproval = await createSession(f.dir, { approval: "approval-other" });
    await assert.rejects(bindProviderTerminalProjectionToSessionV1(f.sagaPath, otherApproval.path, {
      ...request(f), EXPECTED_SESSION_STATE_VERSION: 0
    }), /APPROVAL_GRANT_MISMATCH/);
    const otherBudget = await createSession(f.dir, { budget: "budget-other" });
    await assert.rejects(bindProviderTerminalProjectionToSessionV1(f.sagaPath, otherBudget.path, {
      ...request(f), EXPECTED_SESSION_STATE_VERSION: 0
    }), /BUDGET_RESERVATION_MISMATCH/);
  } finally { await cleanup(f); }
});

test("saga state version, event hash and billing status are exact", async () => {
  const f = await fixture();
  try {
    await assert.rejects(bindProviderTerminalProjectionToSessionV1(f.sagaPath, f.sessionPath, request(f, { EXPECTED_SAGA_STATE_VERSION: 0 })), /SAGA_STATE_CAS_MISMATCH/);
    await assert.rejects(bindProviderTerminalProjectionToSessionV1(f.sagaPath, f.sessionPath, request(f, { EXPECTED_SAGA_EVENT_SHA256: "8".repeat(64) })), /SAGA_EVENT_HASH_MISMATCH/);
    const activeBilling = await createSession(f.dir, { billing: "ACTIVE" });
    await assert.rejects(bindProviderTerminalProjectionToSessionV1(f.sagaPath, activeBilling.path, {
      ...request(f), EXPECTED_SESSION_STATE_VERSION: 0
    }), /BILLING_STATUS_MISMATCH/);
  } finally { await cleanup(f); }
});

test("non-complete provider saga is denied", async () => {
  const f = await fixture();
  try {
    const partial = await createSaga(f.dir, { executionId: "exec-partial", complete: false });
    await assert.rejects(bindProviderTerminalProjectionToSessionV1(partial.path, f.sessionPath, {
      EXPECTED_SAGA_STATE_VERSION: 0,
      EXPECTED_SAGA_EVENT_SHA256: "0".repeat(64),
      EXPECTED_SESSION_STATE_VERSION: 0,
      IDEMPOTENCY_KEY: "partial",
      SUBMITTED_FENCE_TOKEN: "fence-007",
      RUNTIME_NOW_MS: now()
    }), /SAGA_COMPLETE_REQUIRED|SAGA_EVENT_HASH_MISMATCH/);
  } finally { await cleanup(f); }
});

test("stale session CAS is denied without setting provider terminal flags", async () => {
  const f = await fixture();
  try {
    await recordSessionClientDisconnectV1(f.sessionPath, {
      EXPECTED_STATE_VERSION: 0,
      IDEMPOTENCY_KEY: "disconnect-1",
      SUBMITTED_FENCE_TOKEN: "fence-007",
      RUNTIME_NOW_MS: now(),
      CHANNEL: "CHAT"
    });
    await assert.rejects(bindProviderTerminalProjectionToSessionV1(f.sagaPath, f.sessionPath, request(f)), /SESSION_STATE_CAS_MISMATCH/);
    const session = await readOneShotExecutionSessionV1(f.sessionPath);
    assert.equal(session.EXECUTION_TRANSPORT_DEREGISTERED, false);
    assert.equal(session.REQUIRED_RESOURCE_CLEANUP_TERMINAL, false);
  } finally { await cleanup(f); }
});
