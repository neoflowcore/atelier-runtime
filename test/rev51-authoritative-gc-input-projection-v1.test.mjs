import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { computeRev51ObjectHash } from "../runtime/rev51/contract-core.mjs";
import { initializeDurableExecutionStateV1 } from "../runtime/rev51/durable-execution-state-v1.mjs";
import { commitDurableResultAcceptanceV1 } from "../runtime/rev51/durable-result-acceptance-v1.mjs";
import {
  PROVIDER_BOOTSTRAP_PHASES,
  beginProviderBootstrapPhaseV1,
  initializeProviderBootstrapSagaV1,
  recordProviderBootstrapPhaseResultV1
} from "../runtime/rev51/provider-bootstrap-saga-v1.mjs";
import {
  initializeOneShotExecutionSessionV1,
  recordOneShotSessionProgressV1
} from "../runtime/rev51/one-shot-execution-session-v1.mjs";
import { commitDurableSessionClosureSealV1 } from "../runtime/rev51/durable-session-closure-seal-v1.mjs";
import {
  commitGcTombstoneV1,
  initializeAuthoritativeGcTombstoneV1
} from "../runtime/rev51/authoritative-gc-tombstone-v1.mjs";
import { buildAuthoritativeGcInputV1 } from "../runtime/rev51/authoritative-gc-input-projection-v1.mjs";

const T0 = Date.parse("2026-09-25T01:00:00.000Z");
const EVIDENCE = "e".repeat(64);
let tick = 0;
function now() { tick += 1000; return T0 + tick; }

function plan(seed = "1") {
  const value = {
    SCHEMA_ID: "RUNTIME_EXECUTION_PLAN_V1",
    SCHEMA_VERSION: "1",
    CANONICALIZATION_ID: "ATELIER_REV51_JCS_V1",
    UPSTREAM_OBJECT_SHA256: seed.repeat(64),
    OBJECT_SHA256: "0".repeat(64),
    EXECUTION_TRANSPORT: "DIRECT_WORKER"
  };
  value.OBJECT_SHA256 = computeRev51ObjectHash(value);
  return value;
}
function workerJob(p, executionId = "exec-001") {
  const value = {
    SCHEMA_ID: "WORKER_JOB_V1",
    SCHEMA_VERSION: "1",
    CANONICALIZATION_ID: "ATELIER_REV51_JCS_V1",
    UPSTREAM_OBJECT_SHA256: p.OBJECT_SHA256,
    OBJECT_SHA256: "0".repeat(64),
    EXECUTION_PLAN_HASH: p.OBJECT_SHA256,
    EXECUTION_ID: executionId,
    ATTEMPT_ID: "attempt-003",
    FENCE_TOKEN: "fence-007"
  };
  value.OBJECT_SHA256 = computeRev51ObjectHash(value);
  return value;
}
function artifact(id, sha, executionId = "exec-001") {
  return {
    ARTIFACT_ID: id,
    CONTENT_SHA256: sha,
    SIZE_BYTES: 10,
    MEDIA_TYPE: "application/octet-stream",
    STORAGE_CLASS: "RUNTIME_LOCAL",
    SECURITY_DOMAIN: "DEFAULT",
    ORIGIN_EXECUTION_ID: executionId,
    CREATED_AT: "2026-09-25T01:00:00Z",
    RETENTION_CLASS: "UNTIL_FINAL_ACCEPTANCE",
    LOCATIONS: [`runtime://${id}`],
    ARTIFACT_STATE: "QUARANTINED"
  };
}
async function createAcceptance(dir, p, executionId = "exec-001") {
  const statePath = join(dir, `state-${executionId}.json`);
  const acceptancePath = join(dir, `acceptance-${executionId}.json`);
  const w = workerJob(p, executionId);
  const artifacts = [artifact("artifact-a", "a".repeat(64), executionId),artifact("artifact-b", "b".repeat(64), executionId)];
  await initializeDurableExecutionStateV1(statePath, {
    EXECUTION_ID: executionId,EXECUTION_EPOCH: 2,ATTEMPT_ID: "attempt-003",LEASE_GENERATION: 4,FENCE_SEQUENCE: 7,FENCE_TOKEN: "fence-007",
    DESIRED_STATE: "RUNNING",MATERIALIZED_STATE: "RESULT_QUARANTINED",PROVIDER_OPERATION_STATE: "SUCCEEDED"
  }, now());
  const result = await commitDurableResultAcceptanceV1(statePath, acceptancePath, {
    IDEMPOTENCY_KEY: `accept-${executionId}`,EXPECTED_STATE_VERSION: 0,EXPECTED_EXECUTION_EPOCH: 2,EXPECTED_LEASE_GENERATION: 4,SUBMITTED_FENCE_TOKEN: "fence-007",
    RUNTIME_NOW_MS: now(),PLAN: p,WORKER_JOB: w,QUARANTINED_ARTIFACTS: artifacts,
    VERIFICATION: {
      VERIFICATION_RESULT: "PASS",EXECUTION_ID: executionId,ATTEMPT_ID: "attempt-003",FENCE_TOKEN: "fence-007",WORKER_JOB_HASH: w.OBJECT_SHA256,
      EXECUTION_PLAN_HASH: p.OBJECT_SHA256,CONTENT_VERIFIED: true,FENCE_VERIFIED: true,WORKER_JOB_VERIFIED: true,EXECUTION_PLAN_VERIFIED: true,SECURITY_OUTPUT_CONTRACT_VERIFIED: true,
      ARTIFACT_CONTENT_BINDINGS: artifacts.map((a) => ({ ARTIFACT_ID: a.ARTIFACT_ID,CONTENT_SHA256: a.CONTENT_SHA256 }))
    }
  });
  return result.acceptance;
}
async function createCompleteSaga(dir, p, { executionId = "exec-001", provider = "DIGITALOCEAN" } = {}) {
  const path = join(dir, `saga-${executionId}-${provider}.json`);
  await initializeProviderBootstrapSagaV1(path, {
    SAGA_ID: `saga-${executionId}-${provider}`,EXECUTION_ID: executionId,EXECUTION_PLAN_HASH: p.OBJECT_SHA256,BOOTSTRAP_SPEC_SHA256: "c".repeat(64),
    COMPUTE_PROVIDER: provider,EXECUTION_TRANSPORT: "DIRECT_WORKER",APPROVAL_GRANT_ID: "approval-001",BUDGET_RESERVATION_ID: "budget-001"
  }, now());
  let stateVersion = 0;
  for (const phase of PROVIDER_BOOTSTRAP_PHASES) {
    const op = `op-${phase}`;
    const begun = await beginProviderBootstrapPhaseV1(path, {
      EXPECTED_STATE_VERSION: stateVersion,IDEMPOTENCY_KEY: `begin-${phase}`,RUNTIME_NOW_MS: now(),PHASE: phase,OPERATION_ID: op,OPERATION_IDEMPOTENCY_KEY: `remote-${phase}`
    });
    stateVersion = begun.saga.STATE_VERSION;
    const completed = await recordProviderBootstrapPhaseResultV1(path, {
      EXPECTED_STATE_VERSION: stateVersion,IDEMPOTENCY_KEY: `pass-${phase}`,RUNTIME_NOW_MS: now(),PHASE: phase,OPERATION_ID: op,OPERATION_IDEMPOTENCY_KEY: `remote-${phase}`,RESULT: "PASS",
      ...(new Set(["BOOTSTRAP", "ATTEST", "REGISTER_TRANSPORT", "BIND_JOB"]).has(phase) ? { EVIDENCE_SHA256: EVIDENCE } : {}),
      ...(phase === "BILLING_STOP" ? { BILLING_STATUS: provider === "LOCAL" ? "NOT_APPLICABLE" : "STOPPED" } : {})
    });
    stateVersion = completed.saga.STATE_VERSION;
    if (phase === "BILLING_STOP") return completed.saga;
  }
}
async function createClosureSeal(dir, p, billingStatus = "STOPPED") {
  const sessionPath = join(dir, `session-${billingStatus}-${p.OBJECT_SHA256.slice(0, 8)}.json`);
  const sealPath = join(dir, `seal-${billingStatus}-${p.OBJECT_SHA256.slice(0, 8)}.json`);
  await initializeOneShotExecutionSessionV1(sessionPath, {
    SESSION_ID: `session-${billingStatus}`,EXECUTION_PLAN_HASH: p.OBJECT_SHA256,EXECUTION_EPOCH: 2,ATTEMPT_ID: "attempt-003",LEASE_GENERATION: 4,FENCE_TOKEN: "fence-007",
    COMPUTE_PROVIDER_BINDING: { BINDING_ID: "compute-1", BINDING_SHA256: "d".repeat(64) },
    EXECUTION_TRANSPORT_BINDING: { BINDING_ID: "transport-1", BINDING_SHA256: "f".repeat(64) },
    WORKER_ID: "worker-001",WORKER_READY_ATTESTATION_HASH: "9".repeat(64),APPROVAL_GRANT_ID: "approval-001",BUDGET_RESERVATION_ID: "budget-001"
  }, now());
  const completed = await recordOneShotSessionProgressV1(sessionPath, {
    EXPECTED_STATE_VERSION: 0,IDEMPOTENCY_KEY: "complete-session",SUBMITTED_FENCE_TOKEN: "fence-007",RUNTIME_NOW_MS: now(),EXECUTION_TERMINAL: true,RECEIPT_TERMINAL: true,
    EXECUTION_TRANSPORT_DEREGISTERED: true,REQUIRED_RESOURCE_CLEANUP_TERMINAL: true,BILLING_STATUS: billingStatus
  });
  const sealed = await commitDurableSessionClosureSealV1(sessionPath, sealPath, {
    EXPECTED_SESSION_STATE_VERSION: completed.session.STATE_VERSION,EXPECTED_SESSION_EVENT_SHA256: completed.session.EVENT_LEDGER.at(-1).EVENT_SHA256,
    IDEMPOTENCY_KEY: "seal-session",RUNTIME_NOW_MS: now()
  });
  return sealed.seal;
}
async function fixture({ provider = "DIGITALOCEAN" } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "r51-p2w-")); const p = plan(); const acceptance = await createAcceptance(dir, p);
  const saga = await createCompleteSaga(dir, p, { provider }); const billing = provider === "LOCAL" ? "NOT_APPLICABLE" : "STOPPED";
  const seal = await createClosureSeal(dir, p, billing); return { dir, p, acceptance, saga, seal };
}
async function cleanup(f) { await rm(f.dir, { recursive: true, force: true }); }

test("P2F + P2E COMPLETE + P2V project an eligible P2J GC input", async () => {
  const f = await fixture(); try {
    const projected = buildAuthoritativeGcInputV1(f.acceptance, f.saga, f.seal, "artifact-a");
    assert.equal(projected.ARTIFACT_ID, "artifact-a"); assert.equal(projected.GC_INPUT.AUTHORITATIVE_ACCEPTANCE, true); assert.equal(projected.GC_INPUT.PROVIDER_SAGA_COMPLETE, true);
    assert.equal(projected.GC_INPUT.EXECUTION_TRANSPORT_DEREGISTERED, true); assert.equal(projected.GC_INPUT.REQUIRED_RESOURCE_CLEANUP_TERMINAL, true);
    assert.equal(projected.GC_INPUT.BILLING_STATUS, "STOPPED"); assert.equal(projected.GC_INPUT.CONTENT_SHA256, "a".repeat(64));
  } finally { await cleanup(f); }
});
test("projected input commits through existing P2J tombstone contract", async () => {
  const f = await fixture(); try {
    const projected = buildAuthoritativeGcInputV1(f.acceptance, f.saga, f.seal, "artifact-b"); const gcPath = join(f.dir, "gc.json");
    await initializeAuthoritativeGcTombstoneV1(gcPath, { EXECUTION_PLAN_SHA256: f.p.OBJECT_SHA256 }, now());
    const result = await commitGcTombstoneV1(gcPath, projected.GC_INPUT, { ARTIFACT_ID: projected.ARTIFACT_ID,IDEMPOTENCY_KEY: "gc-artifact-b",EXPECTED_STATE_VERSION: 0,RUNTIME_NOW_MS: now() });
    assert.equal(result.replay, false); assert.equal(result.tombstone.ARTIFACT_ID, "artifact-b"); assert.equal(result.tombstone.CONTENT_SHA256, "b".repeat(64));
  } finally { await cleanup(f); }
});
test("unknown artifact is denied", async () => {
  const f = await fixture(); try { assert.throws(() => buildAuthoritativeGcInputV1(f.acceptance, f.saga, f.seal, "missing"),/ACCEPTED_ARTIFACT_NOT_FOUND/); }
  finally { await cleanup(f); }
});
test("valid but different provider execution identity is denied", async () => {
  const f = await fixture(); try {
    const otherSaga = await createCompleteSaga(f.dir, f.p, { executionId: "exec-other" });
    assert.throws(() => buildAuthoritativeGcInputV1(f.acceptance, otherSaga, f.seal, "artifact-a"),/SAGA_ACCEPTANCE_EXECUTION_ID_MISMATCH/);
  } finally { await cleanup(f); }
});
test("valid closure seal from another plan is denied", async () => {
  const f = await fixture(); try {
    const otherPlan = plan("2"); const otherSeal = await createClosureSeal(f.dir, otherPlan, "STOPPED");
    assert.throws(() => buildAuthoritativeGcInputV1(f.acceptance, f.saga, otherSeal, "artifact-a"),/ACCEPTANCE_SEAL_PLAN_HASH_MISMATCH/);
  } finally { await cleanup(f); }
});
test("LOCAL provider preserves NOT_APPLICABLE billing through GC input", async () => {
  const f = await fixture({ provider: "LOCAL" }); try {
    const projected = buildAuthoritativeGcInputV1(f.acceptance, f.saga, f.seal, "artifact-a"); assert.equal(projected.GC_INPUT.BILLING_STATUS, "NOT_APPLICABLE");
  } finally { await cleanup(f); }
});
