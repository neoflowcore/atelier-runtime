import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  PROVIDER_BOOTSTRAP_PHASES,
  beginProviderBootstrapPhaseV1,
  deriveOneShotSessionTerminalProjectionV1,
  initializeProviderBootstrapSagaV1,
  readProviderBootstrapSagaV1,
  reconcileProviderBootstrapOutcomeV1,
  recordProviderBootstrapPhaseResultV1,
  recordProviderObservedStateV1,
  validateProviderBootstrapSagaV1
} from "../runtime/rev51/provider-bootstrap-saga-v1.mjs";

const PLAN = "a".repeat(64);
const BOOT = "b".repeat(64);
const EVIDENCE = "c".repeat(64);
const T0 = Date.parse("2026-09-23T00:00:00.000Z");
let tick = 0;

async function fixture(provider = "DIGITALOCEAN") {
  const dir = await mkdtemp(join(tmpdir(), "r51-p2e-"));
  const path = join(dir, "saga.json");
  await initializeProviderBootstrapSagaV1(path, {
    SAGA_ID: "saga-1",
    EXECUTION_ID: "exec-1",
    EXECUTION_PLAN_HASH: PLAN,
    BOOTSTRAP_SPEC_SHA256: BOOT,
    COMPUTE_PROVIDER: provider,
    EXECUTION_TRANSPORT: "DIRECT_WORKER",
    APPROVAL_GRANT_ID: "approval-1",
    BUDGET_RESERVATION_ID: "budget-1"
  }, T0);
  return { dir, path };
}

function now() { tick += 1000; return T0 + tick; }

async function begin(path, phase, stateVersion, op = `op-${phase}`) {
  return beginProviderBootstrapPhaseV1(path, {
    EXPECTED_STATE_VERSION: stateVersion,
    IDEMPOTENCY_KEY: `begin-${phase}-${stateVersion}`,
    RUNTIME_NOW_MS: now(),
    PHASE: phase,
    OPERATION_ID: op,
    OPERATION_IDEMPOTENCY_KEY: `idem-${op}`
  });
}

async function pass(path, phase, stateVersion, op = `op-${phase}`, extra = {}) {
  return recordProviderBootstrapPhaseResultV1(path, {
    EXPECTED_STATE_VERSION: stateVersion,
    IDEMPOTENCY_KEY: `pass-${phase}-${stateVersion}`,
    RUNTIME_NOW_MS: now(),
    PHASE: phase,
    OPERATION_ID: op,
    OPERATION_IDEMPOTENCY_KEY: `idem-${op}`,
    RESULT: "PASS",
    ...(new Set(["BOOTSTRAP","ATTEST","REGISTER_TRANSPORT","BIND_JOB"]).has(phase) ? { EVIDENCE_SHA256: EVIDENCE } : {}),
    ...extra
  });
}

async function completeThrough(path, targetPhase) {
  let state = await readProviderBootstrapSagaV1(path);
  for (const phase of PROVIDER_BOOTSTRAP_PHASES) {
    const b = await begin(path, phase, state.STATE_VERSION);
    state = b.saga;
    const p = await pass(path, phase, state.STATE_VERSION, `op-${phase}`, phase === "BILLING_STOP" ? { BILLING_STATUS: state.COMPUTE_PROVIDER === "LOCAL" ? "NOT_APPLICABLE" : "STOPPED" } : {});
    state = p.saga;
    if (phase === targetPhase) return state;
  }
  return state;
}

test("initializes strict provider/bootstrap saga at PROVISION", async () => {
  const f = await fixture();
  try {
    const s = await readProviderBootstrapSagaV1(f.path);
    assert.equal(s.CURRENT_PHASE, "PROVISION");
    assert.equal(s.SAGA_STATUS, "RUNNING");
    assert.deepEqual(s.COMPLETED_PHASES, []);
    assert.equal(s.ZERO_TOUCH_REQUIRED, true);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("restart/reopen preserves durable saga state", async () => {
  const f = await fixture();
  try {
    const b = await begin(f.path, "PROVISION", 0);
    const p = await pass(f.path, "PROVISION", b.saga.STATE_VERSION);
    const reopened = await readProviderBootstrapSagaV1(f.path);
    assert.equal(reopened.CURRENT_PHASE, "BOOTSTRAP");
    assert.deepEqual(reopened.COMPLETED_PHASES, ["PROVISION"]);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("phase order is strict", async () => {
  const f = await fixture();
  try {
    await assert.rejects(begin(f.path, "BOOTSTRAP", 0), /PROVIDER_SAGA_PHASE_ORDER_VIOLATION/);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("bootstrap/attest/transport/job phases require evidence hash", async () => {
  const f = await fixture();
  try {
    let s = (await begin(f.path, "PROVISION", 0)).saga;
    s = (await pass(f.path, "PROVISION", s.STATE_VERSION)).saga;
    s = (await begin(f.path, "BOOTSTRAP", s.STATE_VERSION)).saga;
    await assert.rejects(recordProviderBootstrapPhaseResultV1(f.path, {
      EXPECTED_STATE_VERSION: s.STATE_VERSION,
      IDEMPOTENCY_KEY: "bootstrap-no-evidence",
      RUNTIME_NOW_MS: now(),
      PHASE: "BOOTSTRAP",
      OPERATION_ID: "op-BOOTSTRAP",
      OPERATION_IDEMPOTENCY_KEY: "idem-op-BOOTSTRAP",
      RESULT: "PASS"
    }), /PHASE_EVIDENCE_REQUIRED:BOOTSTRAP/);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("OUTCOME_UNKNOWN blocks blind retry and phase advance", async () => {
  const f = await fixture();
  try {
    let s = (await begin(f.path, "PROVISION", 0)).saga;
    s = (await recordProviderBootstrapPhaseResultV1(f.path, {
      EXPECTED_STATE_VERSION: s.STATE_VERSION,
      IDEMPOTENCY_KEY: "unknown-provision",
      RUNTIME_NOW_MS: now(),
      PHASE: "PROVISION",
      OPERATION_ID: "op-PROVISION",
      OPERATION_IDEMPOTENCY_KEY: "idem-op-PROVISION",
      RESULT: "OUTCOME_UNKNOWN"
    })).saga;
    assert.equal(s.SAGA_STATUS, "RECONCILIATION_REQUIRED");
    await assert.rejects(begin(f.path, "PROVISION", s.STATE_VERSION, "op-PROVISION-2"), /OUTCOME_UNKNOWN_RECONCILIATION_REQUIRED/);
    await assert.rejects(begin(f.path, "BOOTSTRAP", s.STATE_VERSION), /OUTCOME_UNKNOWN_RECONCILIATION_REQUIRED/);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("OUTCOME_UNKNOWN reconciliation only accepts same operation identity", async () => {
  const f = await fixture();
  try {
    let s = (await begin(f.path, "PROVISION", 0)).saga;
    s = (await recordProviderBootstrapPhaseResultV1(f.path, {
      EXPECTED_STATE_VERSION: s.STATE_VERSION,
      IDEMPOTENCY_KEY: "unknown-provision",
      RUNTIME_NOW_MS: now(),
      PHASE: "PROVISION",
      OPERATION_ID: "op-PROVISION",
      OPERATION_IDEMPOTENCY_KEY: "idem-op-PROVISION",
      RESULT: "OUTCOME_UNKNOWN"
    })).saga;
    await assert.rejects(reconcileProviderBootstrapOutcomeV1(f.path, {
      EXPECTED_STATE_VERSION: s.STATE_VERSION,
      IDEMPOTENCY_KEY: "reconcile-wrong",
      RUNTIME_NOW_MS: now(),
      PHASE: "PROVISION",
      OPERATION_ID: "different-op",
      OPERATION_IDEMPOTENCY_KEY: "different-idem",
      RECONCILED_RESULT: "PASS"
    }), /SECOND_MUTATION_DENIED/);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("same operation reconciliation PASS advances exactly one phase", async () => {
  const f = await fixture();
  try {
    let s = (await begin(f.path, "PROVISION", 0)).saga;
    s = (await recordProviderBootstrapPhaseResultV1(f.path, {
      EXPECTED_STATE_VERSION: s.STATE_VERSION,
      IDEMPOTENCY_KEY: "unknown-provision",
      RUNTIME_NOW_MS: now(),
      PHASE: "PROVISION",
      OPERATION_ID: "op-PROVISION",
      OPERATION_IDEMPOTENCY_KEY: "idem-op-PROVISION",
      RESULT: "OUTCOME_UNKNOWN"
    })).saga;
    s = (await reconcileProviderBootstrapOutcomeV1(f.path, {
      EXPECTED_STATE_VERSION: s.STATE_VERSION,
      IDEMPOTENCY_KEY: "reconcile-provision",
      RUNTIME_NOW_MS: now(),
      PHASE: "PROVISION",
      OPERATION_ID: "op-PROVISION",
      OPERATION_IDEMPOTENCY_KEY: "idem-op-PROVISION",
      RECONCILED_RESULT: "PASS"
    })).saga;
    assert.equal(s.SAGA_STATUS, "RUNNING");
    assert.equal(s.CURRENT_PHASE, "BOOTSTRAP");
    assert.deepEqual(s.COMPLETED_PHASES, ["PROVISION"]);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("provider observed state never overrides desired saga phase", async () => {
  const f = await fixture();
  try {
    const r = await recordProviderObservedStateV1(f.path, {
      EXPECTED_STATE_VERSION: 0,
      IDEMPOTENCY_KEY: "observe-later-state",
      RUNTIME_NOW_MS: now(),
      OBSERVATION: { PROVIDER_STATE: "RESOURCE_ACTIVE", CLAIMED_PHASE: "EXECUTE" }
    });
    assert.equal(r.saga.CURRENT_PHASE, "PROVISION");
    assert.deepEqual(r.saga.COMPLETED_PHASES, []);
    assert.equal(r.saga.LAST_PROVIDER_OBSERVATION.CLAIMED_PHASE, "EXECUTE");
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("CAS rejects stale state version", async () => {
  const f = await fixture();
  try {
    await begin(f.path, "PROVISION", 0);
    await assert.rejects(recordProviderObservedStateV1(f.path, {
      EXPECTED_STATE_VERSION: 0,
      IDEMPOTENCY_KEY: "stale-observation",
      RUNTIME_NOW_MS: now(),
      OBSERVATION: { PROVIDER_STATE: "UNKNOWN" }
    }), /PROVIDER_SAGA_STATE_CAS_MISMATCH/);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("idempotent request replay does not add a second event", async () => {
  const f = await fixture();
  try {
    const request = {
      EXPECTED_STATE_VERSION: 0,
      IDEMPOTENCY_KEY: "observe-1",
      RUNTIME_NOW_MS: now(),
      OBSERVATION: { PROVIDER_STATE: "PENDING" }
    };
    const first = await recordProviderObservedStateV1(f.path, request);
    const second = await recordProviderObservedStateV1(f.path, { ...request, RUNTIME_NOW_MS: request.RUNTIME_NOW_MS + 5000 });
    assert.equal(first.saga.STATE_VERSION, 1);
    assert.equal(second.replay, true);
    assert.equal(second.saga.STATE_VERSION, 1);
    assert.equal(second.saga.EVENT_LEDGER.length, 2);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("changed request under same idempotency key is rejected", async () => {
  const f = await fixture();
  try {
    await recordProviderObservedStateV1(f.path, {
      EXPECTED_STATE_VERSION: 0,
      IDEMPOTENCY_KEY: "observe-1",
      RUNTIME_NOW_MS: now(),
      OBSERVATION: { PROVIDER_STATE: "PENDING" }
    });
    await assert.rejects(recordProviderObservedStateV1(f.path, {
      EXPECTED_STATE_VERSION: 1,
      IDEMPOTENCY_KEY: "observe-1",
      RUNTIME_NOW_MS: now(),
      OBSERVATION: { PROVIDER_STATE: "ACTIVE" }
    }), /PROVIDER_SAGA_IDEMPOTENCY_KEY_CONFLICT/);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("DEREGISTER and CLEANUP project terminal session flags", async () => {
  const f = await fixture();
  try {
    const s = await completeThrough(f.path, "CLEANUP");
    const projection = deriveOneShotSessionTerminalProjectionV1(s);
    assert.equal(projection.EXECUTION_TRANSPORT_DEREGISTERED, true);
    assert.equal(projection.REQUIRED_RESOURCE_CLEANUP_TERMINAL, true);
    assert.equal(projection.PROVIDER_SAGA_COMPLETE, false);
    assert.equal(projection.BILLING_STATUS, "ACTIVE");
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("provider saga completes only after BILLING_STOP", async () => {
  const f = await fixture();
  try {
    const s = await completeThrough(f.path, "BILLING_STOP");
    assert.equal(s.SAGA_STATUS, "COMPLETE");
    assert.equal(s.CURRENT_PHASE, null);
    assert.deepEqual(s.COMPLETED_PHASES, PROVIDER_BOOTSTRAP_PHASES);
    const projection = deriveOneShotSessionTerminalProjectionV1(s);
    assert.deepEqual(projection, {
      EXECUTION_TRANSPORT_DEREGISTERED: true,
      REQUIRED_RESOURCE_CLEANUP_TERMINAL: true,
      BILLING_STATUS: "STOPPED",
      PROVIDER_SAGA_COMPLETE: true
    });
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("LOCAL provider completes with billing NOT_APPLICABLE", async () => {
  const f = await fixture("LOCAL");
  try {
    const s = await completeThrough(f.path, "BILLING_STOP");
    assert.equal(s.SAGA_STATUS, "COMPLETE");
    assert.equal(s.BILLING_STATUS, "NOT_APPLICABLE");
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("tampered durable event hash is rejected after reopen", async () => {
  const f = await fixture();
  try {
    const raw = JSON.parse(await readFile(f.path, "utf8"));
    raw.EVENT_LEDGER[0].EVENT_SHA256 = "0".repeat(64);
    await writeFile(f.path, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
    await assert.rejects(readProviderBootstrapSagaV1(f.path), /PROVIDER_SAGA_EVENT_HASH_MISMATCH/);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("validation rejects malformed completed phase prefix", async () => {
  const f = await fixture();
  try {
    const s = await readProviderBootstrapSagaV1(f.path);
    s.COMPLETED_PHASES = ["BOOTSTRAP"];
    s.CURRENT_PHASE = "ATTEST";
    assert.deepEqual(validateProviderBootstrapSagaV1(s), { ok: false, errors: ["COMPLETED_PHASES_NOT_STRICT_PREFIX"] });
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});
