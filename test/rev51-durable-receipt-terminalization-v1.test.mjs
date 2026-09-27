import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { computeRev51ObjectHash } from "../runtime/rev51/contract-core.mjs";
import { initializeDurableExecutionStateV1 } from "../runtime/rev51/durable-execution-state-v1.mjs";
import { commitDurableResultAcceptanceV1 } from "../runtime/rev51/durable-result-acceptance-v1.mjs";
import {
  initializeOneShotExecutionSessionV1,
  readOneShotExecutionSessionV1,
  recordSessionClientDisconnectV1
} from "../runtime/rev51/one-shot-execution-session-v1.mjs";
import { terminalizeAcceptedReceiptInSessionV1 } from "../runtime/rev51/durable-receipt-terminalization-v1.mjs";

const T0 = Date.parse("2026-09-24T14:00:00.000Z");

function plan() {
  const value = {
    SCHEMA_ID: "RUNTIME_EXECUTION_PLAN_V1",
    SCHEMA_VERSION: "1",
    CANONICALIZATION_ID: "ATELIER_REV51_JCS_V1",
    UPSTREAM_OBJECT_SHA256: "1".repeat(64),
    OBJECT_SHA256: "0".repeat(64),
    EXECUTION_TRANSPORT: "DIRECT_WORKER"
  };
  value.OBJECT_SHA256 = computeRev51ObjectHash(value);
  return value;
}

function workerJob(p) {
  const value = {
    SCHEMA_ID: "WORKER_JOB_V1",
    SCHEMA_VERSION: "1",
    CANONICALIZATION_ID: "ATELIER_REV51_JCS_V1",
    UPSTREAM_OBJECT_SHA256: p.OBJECT_SHA256,
    OBJECT_SHA256: "0".repeat(64),
    EXECUTION_PLAN_HASH: p.OBJECT_SHA256,
    EXECUTION_ID: "exec-001",
    ATTEMPT_ID: "attempt-003",
    FENCE_TOKEN: "fence-007"
  };
  value.OBJECT_SHA256 = computeRev51ObjectHash(value);
  return value;
}

function artifact(id, sha) {
  return {
    ARTIFACT_ID: id,
    CONTENT_SHA256: sha,
    SIZE_BYTES: 10,
    MEDIA_TYPE: "application/octet-stream",
    STORAGE_CLASS: "RUNTIME_LOCAL",
    SECURITY_DOMAIN: "DEFAULT",
    ORIGIN_EXECUTION_ID: "exec-001",
    CREATED_AT: "2026-09-24T14:00:00Z",
    RETENTION_CLASS: "UNTIL_FINAL_ACCEPTANCE",
    LOCATIONS: [`runtime://${id}`],
    ARTIFACT_STATE: "QUARANTINED"
  };
}

function acceptanceRequest(p, w) {
  const artifacts = [
    artifact("artifact-b", "b".repeat(64)),
    artifact("artifact-a", "a".repeat(64))
  ];
  return {
    IDEMPOTENCY_KEY: "accept-001",
    EXPECTED_STATE_VERSION: 0,
    EXPECTED_EXECUTION_EPOCH: 2,
    EXPECTED_LEASE_GENERATION: 4,
    SUBMITTED_FENCE_TOKEN: "fence-007",
    RUNTIME_NOW_MS: T0 + 10,
    PLAN: p,
    WORKER_JOB: w,
    QUARANTINED_ARTIFACTS: artifacts,
    VERIFICATION: {
      VERIFICATION_RESULT: "PASS",
      EXECUTION_ID: w.EXECUTION_ID,
      ATTEMPT_ID: w.ATTEMPT_ID,
      FENCE_TOKEN: w.FENCE_TOKEN,
      WORKER_JOB_HASH: w.OBJECT_SHA256,
      EXECUTION_PLAN_HASH: p.OBJECT_SHA256,
      CONTENT_VERIFIED: true,
      FENCE_VERIFIED: true,
      WORKER_JOB_VERIFIED: true,
      EXECUTION_PLAN_VERIFIED: true,
      SECURITY_OUTPUT_CONTRACT_VERIFIED: true,
      ARTIFACT_CONTENT_BINDINGS: artifacts.map((a) => ({
        ARTIFACT_ID: a.ARTIFACT_ID,
        CONTENT_SHA256: a.CONTENT_SHA256
      }))
    }
  };
}

async function fixture({ sessionPlanHash } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "r51-p2t-"));
  const statePath = join(dir, "execution-state.json");
  const acceptancePath = join(dir, "acceptance.json");
  const sessionPath = join(dir, "session.json");
  const p = plan();
  const w = workerJob(p);

  await initializeDurableExecutionStateV1(statePath, {
    EXECUTION_ID: "exec-001",
    EXECUTION_EPOCH: 2,
    ATTEMPT_ID: "attempt-003",
    LEASE_GENERATION: 4,
    FENCE_SEQUENCE: 7,
    FENCE_TOKEN: "fence-007",
    DESIRED_STATE: "RUNNING",
    MATERIALIZED_STATE: "RESULT_QUARANTINED",
    PROVIDER_OPERATION_STATE: "SUCCEEDED"
  }, T0);

  const accepted = await commitDurableResultAcceptanceV1(
    statePath,
    acceptancePath,
    acceptanceRequest(p, w)
  );

  await initializeOneShotExecutionSessionV1(sessionPath, {
    SESSION_ID: "session-001",
    EXECUTION_PLAN_HASH: sessionPlanHash ?? p.OBJECT_SHA256,
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
  }, T0 + 20);

  return { dir, sessionPath, acceptancePath, acceptance: accepted.acceptance };
}

function terminalRequest(f, overrides = {}) {
  return {
    EXPECTED_SESSION_STATE_VERSION: 0,
    IDEMPOTENCY_KEY: "receipt-terminal-001",
    SUBMITTED_FENCE_TOKEN: "fence-007",
    EXPECTED_ACCEPTANCE_RECORD_SHA256: f.acceptance.ACCEPTANCE_RECORD_SHA256,
    EXPECTED_EXECUTION_RECEIPT_SHA256: f.acceptance.EXECUTION_RECEIPT.OBJECT_SHA256,
    RUNTIME_NOW_MS: T0 + 30,
    ...overrides
  };
}

async function cleanup(f) {
  await rm(f.dir, { recursive: true, force: true });
}

test("authoritative P2F acceptance terminalizes only RECEIPT_TERMINAL", async () => {
  const f = await fixture();
  try {
    const result = await terminalizeAcceptedReceiptInSessionV1(
      f.acceptancePath,
      f.sessionPath,
      terminalRequest(f)
    );
    assert.equal(result.replay, false);
    assert.equal(result.session.RECEIPT_TERMINAL, true);
    assert.equal(result.session.EXECUTION_TERMINAL, false);
    assert.equal(result.session.EXECUTION_TRANSPORT_DEREGISTERED, false);
    assert.equal(result.session.REQUIRED_RESOURCE_CLEANUP_TERMINAL, false);
    assert.equal(result.session.BILLING_STATUS, "ACTIVE");
    assert.equal(result.session.SESSION_STATUS, "ACTIVE");
  } finally { await cleanup(f); }
});

test("SESSION_ID remains independent from EXECUTION_ID", async () => {
  const f = await fixture();
  try {
    const result = await terminalizeAcceptedReceiptInSessionV1(
      f.acceptancePath,
      f.sessionPath,
      terminalRequest(f)
    );
    assert.equal(result.session.SESSION_ID, "session-001");
    assert.equal(result.acceptance.EXECUTION_ID, "exec-001");
    assert.equal(result.session.RECEIPT_TERMINAL, true);
  } finally { await cleanup(f); }
});

test("same terminalization request is idempotent replay", async () => {
  const f = await fixture();
  try {
    const req = terminalRequest(f);
    await terminalizeAcceptedReceiptInSessionV1(f.acceptancePath, f.sessionPath, req);
    const replay = await terminalizeAcceptedReceiptInSessionV1(f.acceptancePath, f.sessionPath, req);
    assert.equal(replay.replay, true);
    assert.equal(replay.session.RECEIPT_TERMINAL, true);
  } finally { await cleanup(f); }
});

test("changed key after receipt terminalization is denied", async () => {
  const f = await fixture();
  try {
    await terminalizeAcceptedReceiptInSessionV1(
      f.acceptancePath,
      f.sessionPath,
      terminalRequest(f)
    );
    await assert.rejects(
      terminalizeAcceptedReceiptInSessionV1(
        f.acceptancePath,
        f.sessionPath,
        terminalRequest(f, {
          IDEMPOTENCY_KEY: "receipt-terminal-002",
          EXPECTED_SESSION_STATE_VERSION: 1,
          RUNTIME_NOW_MS: T0 + 31
        })
      ),
      /SESSION_RECEIPT_ALREADY_TERMINAL/
    );
  } finally { await cleanup(f); }
});

test("acceptance and receipt hashes are exact expected bindings", async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      terminalizeAcceptedReceiptInSessionV1(
        f.acceptancePath,
        f.sessionPath,
        terminalRequest(f, { EXPECTED_ACCEPTANCE_RECORD_SHA256: "9".repeat(64) })
      ),
      /ACCEPTANCE_RECORD_HASH_MISMATCH/
    );
    await assert.rejects(
      terminalizeAcceptedReceiptInSessionV1(
        f.acceptancePath,
        f.sessionPath,
        terminalRequest(f, { EXPECTED_EXECUTION_RECEIPT_SHA256: "8".repeat(64) })
      ),
      /EXECUTION_RECEIPT_HASH_MISMATCH/
    );
  } finally { await cleanup(f); }
});

test("plan lineage mismatch and stale session CAS are denied", async () => {
  const mismatch = await fixture({ sessionPlanHash: "7".repeat(64) });
  try {
    await assert.rejects(
      terminalizeAcceptedReceiptInSessionV1(
        mismatch.acceptancePath,
        mismatch.sessionPath,
        terminalRequest(mismatch)
      ),
      /EXECUTION_PLAN_HASH_MISMATCH/
    );
  } finally { await cleanup(mismatch); }

  const stale = await fixture();
  try {
    await recordSessionClientDisconnectV1(stale.sessionPath, {
      EXPECTED_STATE_VERSION: 0,
      IDEMPOTENCY_KEY: "disconnect-1",
      SUBMITTED_FENCE_TOKEN: "fence-007",
      RUNTIME_NOW_MS: T0 + 25,
      CHANNEL: "CHAT"
    });
    await assert.rejects(
      terminalizeAcceptedReceiptInSessionV1(
        stale.acceptancePath,
        stale.sessionPath,
        terminalRequest(stale)
      ),
      /SESSION_STATE_CAS_MISMATCH/
    );
    const session = await readOneShotExecutionSessionV1(stale.sessionPath);
    assert.equal(session.RECEIPT_TERMINAL, false);
  } finally { await cleanup(stale); }
});
