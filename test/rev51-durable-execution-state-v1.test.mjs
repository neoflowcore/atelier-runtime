import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  advanceExecutionFenceV1,
  initializeDurableExecutionStateV1,
  readDurableExecutionStateV1,
  recordProviderOperationOutcomeV1,
  transitionMaterializedStateV1,
  validateAuthoritativeFenceV1,
  validateDurableExecutionStateV1
} from "../runtime/rev51/durable-execution-state-v1.mjs";

const T0 = Date.parse("2026-09-21T00:00:00Z");

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "atelier-r51-p2a-"));
  const path = join(dir, "execution-state.json");
  await initializeDurableExecutionStateV1(path, {
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
  return { dir, path };
}

async function cleanup(dir) {
  await rm(dir, { recursive: true, force: true });
}

test("state survives reopen and event ledger remains valid", async () => {
  const { dir, path } = await fixture();
  try {
    const reopened = await readDurableExecutionStateV1(path);
    assert.equal(reopened.EXECUTION_ID, "exec-001");
    assert.equal(reopened.FENCE_TOKEN, "fence-001");
    assert.equal(reopened.STATE_VERSION, 0);
    assert.equal(reopened.LAST_EVENT_SEQUENCE, 1);
    assert.deepEqual(validateDurableExecutionStateV1(reopened), { ok: true, errors: [] });
  } finally {
    await cleanup(dir);
  }
});

test("CAS transition is durable and increments state/event versions", async () => {
  const { dir, path } = await fixture();
  try {
    const out = await transitionMaterializedStateV1(path, {
      EXPECTED_STATE_VERSION: 0,
      IDEMPOTENCY_KEY: "transition-1",
      SUBMITTED_FENCE_TOKEN: "fence-001",
      NEXT_MATERIALIZED_STATE: "RUNNING",
      RUNTIME_NOW_MS: T0 + 1000
    });
    assert.equal(out.replay, false);
    assert.equal(out.state.MATERIALIZED_STATE, "RUNNING");
    assert.equal(out.state.STATE_VERSION, 1);
    assert.equal(out.state.LAST_EVENT_SEQUENCE, 2);
    const reopened = await readDurableExecutionStateV1(path);
    assert.equal(reopened.MATERIALIZED_STATE, "RUNNING");
  } finally {
    await cleanup(dir);
  }
});

test("stale state version fails compare-and-swap", async () => {
  const { dir, path } = await fixture();
  try {
    await transitionMaterializedStateV1(path, {
      EXPECTED_STATE_VERSION: 0,
      IDEMPOTENCY_KEY: "transition-1",
      SUBMITTED_FENCE_TOKEN: "fence-001",
      NEXT_MATERIALIZED_STATE: "RUNNING",
      RUNTIME_NOW_MS: T0 + 1000
    });
    await assert.rejects(() => transitionMaterializedStateV1(path, {
      EXPECTED_STATE_VERSION: 0,
      IDEMPOTENCY_KEY: "transition-2",
      SUBMITTED_FENCE_TOKEN: "fence-001",
      NEXT_MATERIALIZED_STATE: "COLLECTING",
      RUNTIME_NOW_MS: T0 + 2000
    }), /STATE_CAS_MISMATCH/);
  } finally {
    await cleanup(dir);
  }
});

test("stale fence is rejected before authoritative mutation", async () => {
  const { dir, path } = await fixture();
  try {
    await assert.rejects(() => transitionMaterializedStateV1(path, {
      EXPECTED_STATE_VERSION: 0,
      IDEMPOTENCY_KEY: "stale-fence-transition",
      SUBMITTED_FENCE_TOKEN: "fence-stale",
      NEXT_MATERIALIZED_STATE: "RUNNING",
      RUNTIME_NOW_MS: T0 + 1000
    }), /STALE_FENCE_REJECTED/);
    const state = await readDurableExecutionStateV1(path);
    assert.equal(state.STATE_VERSION, 0);
    assert.equal(state.LAST_EVENT_SEQUENCE, 1);
  } finally {
    await cleanup(dir);
  }
});

test("identical idempotency replay does not append a second event", async () => {
  const { dir, path } = await fixture();
  try {
    const request = {
      EXPECTED_STATE_VERSION: 0,
      IDEMPOTENCY_KEY: "transition-1",
      SUBMITTED_FENCE_TOKEN: "fence-001",
      NEXT_MATERIALIZED_STATE: "RUNNING",
      RUNTIME_NOW_MS: T0 + 1000
    };
    const first = await transitionMaterializedStateV1(path, request);
    const second = await transitionMaterializedStateV1(path, request);
    assert.equal(first.replay, false);
    assert.equal(second.replay, true);
    assert.equal(second.state.STATE_VERSION, 1);
    assert.equal(second.state.LAST_EVENT_SEQUENCE, 2);
  } finally {
    await cleanup(dir);
  }
});

test("same idempotency key with different request is denied", async () => {
  const { dir, path } = await fixture();
  try {
    await transitionMaterializedStateV1(path, {
      EXPECTED_STATE_VERSION: 0,
      IDEMPOTENCY_KEY: "transition-1",
      SUBMITTED_FENCE_TOKEN: "fence-001",
      NEXT_MATERIALIZED_STATE: "RUNNING",
      RUNTIME_NOW_MS: T0 + 1000
    });
    await assert.rejects(() => transitionMaterializedStateV1(path, {
      EXPECTED_STATE_VERSION: 1,
      IDEMPOTENCY_KEY: "transition-1",
      SUBMITTED_FENCE_TOKEN: "fence-001",
      NEXT_MATERIALIZED_STATE: "COLLECTING",
      RUNTIME_NOW_MS: T0 + 2000
    }), /IDEMPOTENCY_KEY_CONFLICT/);
  } finally {
    await cleanup(dir);
  }
});

test("fence advancement is strictly monotonic and updates attempt/lease", async () => {
  const { dir, path } = await fixture();
  try {
    const out = await advanceExecutionFenceV1(path, {
      EXPECTED_STATE_VERSION: 0,
      IDEMPOTENCY_KEY: "advance-fence-1",
      SUBMITTED_FENCE_TOKEN: "fence-001",
      NEXT_FENCE_SEQUENCE: 2,
      NEXT_FENCE_TOKEN: "fence-002",
      NEXT_ATTEMPT_ID: "attempt-002",
      NEXT_LEASE_GENERATION: 2,
      RUNTIME_NOW_MS: T0 + 1000
    });
    assert.equal(out.state.FENCE_SEQUENCE, 2);
    assert.equal(out.state.FENCE_TOKEN, "fence-002");
    assert.equal(out.state.ATTEMPT_ID, "attempt-002");
    assert.equal(out.state.LEASE_GENERATION, 2);
    assert.deepEqual(validateAuthoritativeFenceV1(out.state, "fence-001"), { ok: false, code: "STALE_FENCE_REJECTED" });
    assert.deepEqual(validateAuthoritativeFenceV1(out.state, "fence-002"), { ok: true, code: "CURRENT_FENCE" });
  } finally {
    await cleanup(dir);
  }
});

test("fence sequence gaps and token reuse are denied", async () => {
  const { dir, path } = await fixture();
  try {
    await assert.rejects(() => advanceExecutionFenceV1(path, {
      EXPECTED_STATE_VERSION: 0,
      IDEMPOTENCY_KEY: "gap",
      SUBMITTED_FENCE_TOKEN: "fence-001",
      NEXT_FENCE_SEQUENCE: 3,
      NEXT_FENCE_TOKEN: "fence-003",
      RUNTIME_NOW_MS: T0 + 1000
    }), /FENCE_SEQUENCE_GAP/);
    await assert.rejects(() => advanceExecutionFenceV1(path, {
      EXPECTED_STATE_VERSION: 0,
      IDEMPOTENCY_KEY: "reuse",
      SUBMITTED_FENCE_TOKEN: "fence-001",
      NEXT_FENCE_SEQUENCE: 2,
      NEXT_FENCE_TOKEN: "fence-001",
      RUNTIME_NOW_MS: T0 + 1000
    }), /FENCE_TOKEN_REUSE_DENIED/);
  } finally {
    await cleanup(dir);
  }
});

test("OUTCOME_UNKNOWN persists reconciliation-only state and never enables blind retry", async () => {
  const { dir, path } = await fixture();
  try {
    const out = await recordProviderOperationOutcomeV1(path, {
      EXPECTED_STATE_VERSION: 0,
      IDEMPOTENCY_KEY: "provider-op-1-outcome",
      SUBMITTED_FENCE_TOKEN: "fence-001",
      PROVIDER_OPERATION_STATE: "OUTCOME_UNKNOWN",
      RUNTIME_NOW_MS: T0 + 1000
    });
    assert.equal(out.state.PROVIDER_OPERATION_STATE, "OUTCOME_UNKNOWN");
    assert.equal(out.state.RECONCILIATION_REQUIRED, true);
    assert.equal(out.state.BLIND_RETRY_ALLOWED, false);
    const reopened = await readDurableExecutionStateV1(path);
    assert.equal(reopened.RECONCILIATION_REQUIRED, true);
  } finally {
    await cleanup(dir);
  }
});

test("event ledger tampering is detected on reopen", async () => {
  const { dir, path } = await fixture();
  try {
    const store = JSON.parse(await readFile(path, "utf8"));
    store.EVENT_LEDGER[0].PAYLOAD.ATTEMPT_ID = "tampered";
    await writeFile(path, `${JSON.stringify(store, null, 2)}\n`, "utf8");
    await assert.rejects(() => readDurableExecutionStateV1(path), /EVENT_HASH_MISMATCH/);
  } finally {
    await cleanup(dir);
  }
});

test("runtime authoritative time is explicit and hidden wallclock is not accepted", async () => {
  const dir = await mkdtemp(join(tmpdir(), "atelier-r51-p2a-time-"));
  const path = join(dir, "execution-state.json");
  try {
    await assert.rejects(() => initializeDurableExecutionStateV1(path, {
      EXECUTION_ID: "exec-time",
      EXECUTION_EPOCH: 1,
      ATTEMPT_ID: "attempt-001",
      LEASE_GENERATION: 1,
      FENCE_SEQUENCE: 1,
      FENCE_TOKEN: "fence-001",
      DESIRED_STATE: "EXECUTE",
      MATERIALIZED_STATE: "ADMITTED"
    }), /RUNTIME_AUTHORITATIVE_TIME_REQUIRED/);
  } finally {
    await cleanup(dir);
  }
});
