import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  initializeDurableReservationSettlementV1,
  settleReservationUsageV1
} from "../runtime/rev51/durable-reservation-settlement-v1.mjs";
import {
  initializeOneShotExecutionSessionV1,
  readOneShotExecutionSessionV1,
  recordSessionClientDisconnectV1
} from "../runtime/rev51/one-shot-execution-session-v1.mjs";
import {
  terminalizeSettledBillingInSessionV1
} from "../runtime/rev51/durable-billing-terminalization-v1.mjs";

const T0 = Date.parse("2026-09-24T16:00:00.000Z");
const PLAN = "a".repeat(64);

function admission(state = "SUCCEEDED", fence = "fence-007") {
  return {
    RESERVATIONS: {
      "budget-001": {
        RESERVATION_ID: "budget-001",
        STATE: state,
        RUNTIME_SECONDS: 100,
        COST_MICRO_USD: 500,
        FENCE_TOKEN: fence
      }
    }
  };
}

async function fixture({ planHash = PLAN, settlementFence = "fence-007" } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "r51-p2u-"));
  const settlementPath = join(dir, "settlement.json");
  const sessionPath = join(dir, "session.json");

  await initializeDurableReservationSettlementV1(
    settlementPath,
    { EXECUTION_PLAN_SHA256: planHash },
    T0
  );

  const settled = await settleReservationUsageV1(
    settlementPath,
    admission("SUCCEEDED", settlementFence),
    {
      RESERVATION_ID: "budget-001",
      ACTUAL_RUNTIME_SECONDS: 70,
      ACTUAL_COST_MICRO_USD: 350,
      EXPECTED_STATE_VERSION: 0,
      IDEMPOTENCY_KEY: "settle-001",
      RUNTIME_NOW_MS: T0 + 1
    }
  );

  await initializeOneShotExecutionSessionV1(sessionPath, {
    SESSION_ID: "session-001",
    EXECUTION_PLAN_HASH: PLAN,
    EXECUTION_EPOCH: 2,
    ATTEMPT_ID: "attempt-003",
    LEASE_GENERATION: 4,
    FENCE_TOKEN: "fence-007",
    COMPUTE_PROVIDER_BINDING: {
      BINDING_ID: "compute-binding-1",
      BINDING_SHA256: "c".repeat(64)
    },
    EXECUTION_TRANSPORT_BINDING: {
      BINDING_ID: "transport-binding-1",
      BINDING_SHA256: "d".repeat(64)
    },
    WORKER_ID: "worker-001",
    WORKER_READY_ATTESTATION_HASH: "e".repeat(64),
    APPROVAL_GRANT_ID: "approval-001",
    BUDGET_RESERVATION_ID: "budget-001"
  }, T0 + 2);

  const settlementEvent = settled.state.EVENT_LEDGER.at(-1);
  return {
    dir,
    settlementPath,
    sessionPath,
    settlement: settled.state,
    settlementEvent
  };
}

function request(f, overrides = {}) {
  return {
    EXPECTED_SESSION_STATE_VERSION: 0,
    EXPECTED_SETTLEMENT_STATE_VERSION: f.settlement.STATE_VERSION,
    EXPECTED_SETTLEMENT_EVENT_SHA256: f.settlementEvent.EVENT_SHA256,
    IDEMPOTENCY_KEY: "billing-terminal-001",
    SUBMITTED_FENCE_TOKEN: "fence-007",
    RUNTIME_NOW_MS: T0 + 10,
    ...overrides
  };
}

async function cleanup(f) {
  await rm(f.dir, { recursive: true, force: true });
}

test("P2H settlement terminalizes only billing status", async () => {
  const f = await fixture();
  try {
    const result = await terminalizeSettledBillingInSessionV1(
      f.settlementPath,
      f.sessionPath,
      request(f)
    );
    assert.equal(result.replay, false);
    assert.equal(result.session.BILLING_STATUS, "STOPPED");
    assert.equal(result.session.EXECUTION_TERMINAL, false);
    assert.equal(result.session.RECEIPT_TERMINAL, false);
    assert.equal(result.session.EXECUTION_TRANSPORT_DEREGISTERED, false);
    assert.equal(result.session.REQUIRED_RESOURCE_CLEANUP_TERMINAL, false);
    assert.equal(result.session.SESSION_STATUS, "ACTIVE");
  } finally { await cleanup(f); }
});

test("same billing terminalization request replays exactly", async () => {
  const f = await fixture();
  try {
    const req = request(f);
    await terminalizeSettledBillingInSessionV1(f.settlementPath, f.sessionPath, req);
    const replay = await terminalizeSettledBillingInSessionV1(
      f.settlementPath,
      f.sessionPath,
      req
    );
    assert.equal(replay.replay, true);
    assert.equal(replay.session.BILLING_STATUS, "STOPPED");
  } finally { await cleanup(f); }
});

test("second terminalization key after billing stop is denied", async () => {
  const f = await fixture();
  try {
    await terminalizeSettledBillingInSessionV1(
      f.settlementPath,
      f.sessionPath,
      request(f)
    );
    await assert.rejects(
      terminalizeSettledBillingInSessionV1(
        f.settlementPath,
        f.sessionPath,
        request(f, {
          IDEMPOTENCY_KEY: "billing-terminal-002",
          EXPECTED_SESSION_STATE_VERSION: 1,
          RUNTIME_NOW_MS: T0 + 11
        })
      ),
      /SESSION_BILLING_ALREADY_TERMINAL/
    );
  } finally { await cleanup(f); }
});

test("execution-plan and fence lineage mismatch are denied", async () => {
  const planMismatch = await fixture({ planHash: "9".repeat(64) });
  try {
    await assert.rejects(
      terminalizeSettledBillingInSessionV1(
        planMismatch.settlementPath,
        planMismatch.sessionPath,
        request(planMismatch)
      ),
      /EXECUTION_PLAN_HASH_MISMATCH/
    );
  } finally { await cleanup(planMismatch); }

  const fenceMismatch = await fixture({ settlementFence: "fence-old" });
  try {
    await assert.rejects(
      terminalizeSettledBillingInSessionV1(
        fenceMismatch.settlementPath,
        fenceMismatch.sessionPath,
        request(fenceMismatch)
      ),
      /FENCE_TOKEN_MISMATCH/
    );
  } finally { await cleanup(fenceMismatch); }
});

test("settlement state CAS and event hash are exact bindings", async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      terminalizeSettledBillingInSessionV1(
        f.settlementPath,
        f.sessionPath,
        request(f, { EXPECTED_SETTLEMENT_STATE_VERSION: 0 })
      ),
      /SETTLEMENT_STATE_CAS_MISMATCH/
    );
    await assert.rejects(
      terminalizeSettledBillingInSessionV1(
        f.settlementPath,
        f.sessionPath,
        request(f, { EXPECTED_SETTLEMENT_EVENT_SHA256: "8".repeat(64) })
      ),
      /SETTLEMENT_EVENT_HASH_MISMATCH/
    );
  } finally { await cleanup(f); }
});

test("stale session CAS is denied without billing mutation", async () => {
  const f = await fixture();
  try {
    await recordSessionClientDisconnectV1(f.sessionPath, {
      EXPECTED_STATE_VERSION: 0,
      IDEMPOTENCY_KEY: "disconnect-1",
      SUBMITTED_FENCE_TOKEN: "fence-007",
      RUNTIME_NOW_MS: T0 + 5,
      CHANNEL: "CHAT"
    });
    await assert.rejects(
      terminalizeSettledBillingInSessionV1(
        f.settlementPath,
        f.sessionPath,
        request(f)
      ),
      /SESSION_STATE_CAS_MISMATCH/
    );
    const session = await readOneShotExecutionSessionV1(f.sessionPath);
    assert.equal(session.BILLING_STATUS, "ACTIVE");
  } finally { await cleanup(f); }
});

test("tampered settlement record cannot bypass event binding", async () => {
  const f = await fixture();
  try {
    const raw = JSON.parse(await readFile(f.settlementPath, "utf8"));
    raw.SETTLEMENTS["budget-001"].ACTUAL_COST_MICRO_USD = 1;
    await writeFile(f.settlementPath, JSON.stringify(raw));
    await assert.rejects(
      terminalizeSettledBillingInSessionV1(
        f.settlementPath,
        f.sessionPath,
        request(f)
      ),
      /SETTLEMENT_EVENT_PAYLOAD_MISMATCH/
    );
  } finally { await cleanup(f); }
});
