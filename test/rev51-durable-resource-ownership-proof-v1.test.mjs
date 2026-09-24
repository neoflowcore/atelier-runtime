import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  beginDestructiveResourceActionV1,
  initializeDurableResourceOwnershipProofV1,
  readDurableResourceOwnershipProofV1,
  recordDestructiveResourceActionResultV1,
  reconcileDestructiveResourceActionV1,
  validateDurableResourceOwnershipProofV1
} from "../runtime/rev51/durable-resource-ownership-proof-v1.mjs";
import {
  advanceExecutionFenceV1,
  initializeDurableExecutionStateV1
} from "../runtime/rev51/durable-execution-state-v1.mjs";

const T0 = Date.parse("2026-09-24T00:00:00.000Z");
const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);
const SHA_D = "d".repeat(64);

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "r51-p2n-"));
  const executionPath = join(dir, "execution.json");
  const proofPath = join(dir, "ownership.json");
  const execution = await initializeDurableExecutionStateV1(executionPath, {
    EXECUTION_ID: "exec-1",
    EXECUTION_EPOCH: 1,
    ATTEMPT_ID: "attempt-1",
    LEASE_GENERATION: 1,
    FENCE_SEQUENCE: 1,
    FENCE_TOKEN: "fence-1",
    DESIRED_STATE: "RUNNING",
    MATERIALIZED_STATE: "READY",
    PROVIDER_OPERATION_STATE: "PENDING"
  }, T0);
  return { dir, executionPath, proofPath, execution };
}

function initial() {
  return {
    PROOF_ID: "proof-1",
    EXECUTION_ID: "exec-1",
    WORKER_JOB_SHA256: SHA_A,
    RESOURCE_FINGERPRINT_SHA256: SHA_B,
    CREATION_RECEIPT_SHA256: SHA_C,
    OWNERSHIP_ASSERTION_SHA256: SHA_D
  };
}

async function init(f) {
  return initializeDurableResourceOwnershipProofV1(f.proofPath, f.executionPath, initial(), T0);
}

function beginRequest(overrides = {}) {
  return {
    EXPECTED_STATE_VERSION: 0,
    IDEMPOTENCY_KEY: "begin-1",
    OPERATION_ID: "destroy-op-1",
    OPERATION_IDEMPOTENCY_KEY: "remote-destroy-1",
    SUBMITTED_FENCE_TOKEN: "fence-1",
    RUNTIME_NOW_MS: T0 + 1000,
    ...overrides
  };
}

function resultRequest(overrides = {}) {
  return {
    EXPECTED_STATE_VERSION: 1,
    IDEMPOTENCY_KEY: "result-1",
    OPERATION_ID: "destroy-op-1",
    OPERATION_IDEMPOTENCY_KEY: "remote-destroy-1",
    RESULT: "PASS",
    EVIDENCE_SHA256: SHA_A,
    RUNTIME_NOW_MS: T0 + 2000,
    ...overrides
  };
}

function reconcileRequest(overrides = {}) {
  return {
    EXPECTED_STATE_VERSION: 2,
    IDEMPOTENCY_KEY: "reconcile-1",
    OPERATION_ID: "destroy-op-1",
    OPERATION_IDEMPOTENCY_KEY: "remote-destroy-1",
    RECONCILED_RESULT: "PASS",
    EVIDENCE_SHA256: SHA_D,
    RUNTIME_NOW_MS: T0 + 3000,
    ...overrides
  };
}

test("initialization durably binds ownership evidence and current execution lineage", async () => {
  const f = await fixture();
  try {
    const p = await init(f);
    assert.equal(p.PROOF_STATUS, "AVAILABLE");
    assert.equal(p.EXECUTION_EPOCH, 1);
    assert.equal(p.ATTEMPT_ID, "attempt-1");
    assert.equal(p.LEASE_GENERATION, 1);
    assert.equal(p.FENCE_TOKEN, "fence-1");
    assert.equal(p.RESOURCE_FINGERPRINT_SHA256, SHA_B);
    assert.deepEqual(validateDurableResourceOwnershipProofV1(p), { ok: true, errors: [] });
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("initialization rejects missing durable creation receipt", async () => {
  const f = await fixture();
  try {
    const bad = initial();
    delete bad.CREATION_RECEIPT_SHA256;
    await assert.rejects(initializeDurableResourceOwnershipProofV1(f.proofPath, f.executionPath, bad, T0), /CREATION_RECEIPT_SHA256_INVALID/);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("destructive action claim requires current fence and marks proof in use", async () => {
  const f = await fixture();
  try {
    await init(f);
    const r = await beginDestructiveResourceActionV1(f.proofPath, f.executionPath, beginRequest());
    assert.equal(r.proof.PROOF_STATUS, "IN_USE");
    assert.equal(r.proof.ACTIVE_OPERATION.OPERATION_ID, "destroy-op-1");
    assert.equal(r.proof.ACTIVE_OPERATION.CLAIMED_FENCE_TOKEN, "fence-1");
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("stale submitted fence denies destructive action", async () => {
  const f = await fixture();
  try {
    await init(f);
    await assert.rejects(beginDestructiveResourceActionV1(f.proofPath, f.executionPath, beginRequest({ SUBMITTED_FENCE_TOKEN: "fence-old" })), /STALE_FENCE_REJECTED/);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("execution lineage drift denies stale ownership proof", async () => {
  const f = await fixture();
  try {
    await init(f);
    await advanceExecutionFenceV1(f.executionPath, {
      EXPECTED_STATE_VERSION: 0,
      IDEMPOTENCY_KEY: "advance-1",
      SUBMITTED_FENCE_TOKEN: "fence-1",
      RUNTIME_NOW_MS: T0 + 500,
      NEXT_FENCE_SEQUENCE: 2,
      NEXT_FENCE_TOKEN: "fence-2",
      NEXT_ATTEMPT_ID: "attempt-2",
      NEXT_LEASE_GENERATION: 2
    });
    await assert.rejects(beginDestructiveResourceActionV1(f.proofPath, f.executionPath, beginRequest({ SUBMITTED_FENCE_TOKEN: "fence-2" })), /RESOURCE_OWNERSHIP_ATTEMPT_STALE/);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("exact begin replay is idempotent", async () => {
  const f = await fixture();
  try {
    await init(f);
    const first = await beginDestructiveResourceActionV1(f.proofPath, f.executionPath, beginRequest());
    const replay = await beginDestructiveResourceActionV1(f.proofPath, f.executionPath, beginRequest({ RUNTIME_NOW_MS: T0 + 9999 }));
    assert.equal(first.proof.STATE_VERSION, 1);
    assert.equal(replay.replay, true);
    assert.equal(replay.proof.STATE_VERSION, 1);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("changed request under same idempotency key is denied", async () => {
  const f = await fixture();
  try {
    await init(f);
    await beginDestructiveResourceActionV1(f.proofPath, f.executionPath, beginRequest());
    await assert.rejects(beginDestructiveResourceActionV1(f.proofPath, f.executionPath, beginRequest({ OPERATION_ID: "destroy-op-2" })), /IDEMPOTENCY_KEY_CONFLICT/);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("second destructive operation is denied while proof is in use", async () => {
  const f = await fixture();
  try {
    await init(f);
    await beginDestructiveResourceActionV1(f.proofPath, f.executionPath, beginRequest());
    await assert.rejects(beginDestructiveResourceActionV1(f.proofPath, f.executionPath, beginRequest({ EXPECTED_STATE_VERSION: 1, IDEMPOTENCY_KEY: "begin-2", OPERATION_ID: "destroy-op-2", OPERATION_IDEMPOTENCY_KEY: "remote-destroy-2" })), /PROOF_NOT_AVAILABLE/);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("PASS consumes proof and prevents reuse", async () => {
  const f = await fixture();
  try {
    await init(f);
    await beginDestructiveResourceActionV1(f.proofPath, f.executionPath, beginRequest());
    const r = await recordDestructiveResourceActionResultV1(f.proofPath, resultRequest());
    assert.equal(r.proof.PROOF_STATUS, "CONSUMED");
    await assert.rejects(beginDestructiveResourceActionV1(f.proofPath, f.executionPath, beginRequest({ EXPECTED_STATE_VERSION: 2, IDEMPOTENCY_KEY: "begin-2", OPERATION_ID: "destroy-op-2", OPERATION_IDEMPOTENCY_KEY: "remote-destroy-2" })), /PROOF_NOT_AVAILABLE/);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("OUTCOME_UNKNOWN closes proof to reconciliation only", async () => {
  const f = await fixture();
  try {
    await init(f);
    await beginDestructiveResourceActionV1(f.proofPath, f.executionPath, beginRequest());
    const r = await recordDestructiveResourceActionResultV1(f.proofPath, resultRequest({ RESULT: "OUTCOME_UNKNOWN" }));
    assert.equal(r.proof.PROOF_STATUS, "RECONCILIATION_REQUIRED");
    await assert.rejects(beginDestructiveResourceActionV1(f.proofPath, f.executionPath, beginRequest({ EXPECTED_STATE_VERSION: 2, IDEMPOTENCY_KEY: "begin-2" })), /RECONCILIATION_REQUIRED/);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("same operation reconciliation may consume unknown proof", async () => {
  const f = await fixture();
  try {
    await init(f);
    await beginDestructiveResourceActionV1(f.proofPath, f.executionPath, beginRequest());
    await recordDestructiveResourceActionResultV1(f.proofPath, resultRequest({ RESULT: "OUTCOME_UNKNOWN" }));
    const r = await reconcileDestructiveResourceActionV1(f.proofPath, reconcileRequest());
    assert.equal(r.proof.PROOF_STATUS, "CONSUMED");
    assert.equal(r.proof.ACTIVE_OPERATION, null);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("different remote operation idempotency cannot reconcile unknown result", async () => {
  const f = await fixture();
  try {
    await init(f);
    await beginDestructiveResourceActionV1(f.proofPath, f.executionPath, beginRequest());
    await recordDestructiveResourceActionResultV1(f.proofPath, resultRequest({ RESULT: "OUTCOME_UNKNOWN" }));
    await assert.rejects(reconcileDestructiveResourceActionV1(f.proofPath, reconcileRequest({ OPERATION_IDEMPOTENCY_KEY: "remote-other" })), /SECOND_MUTATION_DENIED/);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("definitive FAIL closes proof fail-closed", async () => {
  const f = await fixture();
  try {
    await init(f);
    await beginDestructiveResourceActionV1(f.proofPath, f.executionPath, beginRequest());
    const r = await recordDestructiveResourceActionResultV1(f.proofPath, resultRequest({ RESULT: "FAIL", REASON: "provider-denied" }));
    assert.equal(r.proof.PROOF_STATUS, "FAILED");
    await assert.rejects(beginDestructiveResourceActionV1(f.proofPath, f.executionPath, beginRequest({ EXPECTED_STATE_VERSION: 2, IDEMPOTENCY_KEY: "begin-2" })), /PROOF_NOT_AVAILABLE/);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("result state CAS mismatch is denied", async () => {
  const f = await fixture();
  try {
    await init(f);
    await beginDestructiveResourceActionV1(f.proofPath, f.executionPath, beginRequest());
    await assert.rejects(recordDestructiveResourceActionResultV1(f.proofPath, resultRequest({ EXPECTED_STATE_VERSION: 0 })), /STATE_CAS_MISMATCH/);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("restart reopen preserves consumed authoritative state", async () => {
  const f = await fixture();
  try {
    await init(f);
    await beginDestructiveResourceActionV1(f.proofPath, f.executionPath, beginRequest());
    await recordDestructiveResourceActionResultV1(f.proofPath, resultRequest());
    const reopened = await readDurableResourceOwnershipProofV1(f.proofPath);
    assert.equal(reopened.PROOF_STATUS, "CONSUMED");
    assert.equal(reopened.STATE_VERSION, 2);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("tampered event hash is rejected on reopen", async () => {
  const f = await fixture();
  try {
    await init(f);
    const raw = JSON.parse(await readFile(f.proofPath, "utf8"));
    raw.EVENT_LEDGER[0].EVENT_SHA256 = "0".repeat(64);
    await writeFile(f.proofPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
    await assert.rejects(readDurableResourceOwnershipProofV1(f.proofPath), /EVENT_HASH_MISMATCH/);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("unexpected persisted provider resource identifier is rejected", async () => {
  const f = await fixture();
  try {
    await init(f);
    const raw = JSON.parse(await readFile(f.proofPath, "utf8"));
    raw.PROVIDER_RESOURCE_ID = "provider-secret-resource-id";
    await writeFile(f.proofPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
    await assert.rejects(readDurableResourceOwnershipProofV1(f.proofPath), /STORE_FIELDS_MISMATCH/);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("invalid ownership store shape fails validator without throwing", async () => {
  assert.deepEqual(validateDurableResourceOwnershipProofV1({}), { ok: false, errors: ["RESOURCE_OWNERSHIP_STORE_FIELDS_MISMATCH"] });
});
