import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  initializeOneShotExecutionSessionV1,
  recordOneShotSessionProgressV1
} from "../runtime/rev51/one-shot-execution-session-v1.mjs";
import {
  commitDurableSessionClosureSealV1,
  readDurableSessionClosureSealV1,
  validateDurableSessionClosureSealV1
} from "../runtime/rev51/durable-session-closure-seal-v1.mjs";

const T0 = Date.parse("2026-09-25T00:00:00.000Z");
const PLAN = "a".repeat(64);

async function fixture({ complete = true } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "r51-p2v-"));
  const sessionPath = join(dir, "session.json");
  const sealPath = join(dir, "closure-seal.json");
  await initializeOneShotExecutionSessionV1(sessionPath, {
    SESSION_ID: "session-001",
    EXECUTION_PLAN_HASH: PLAN,
    EXECUTION_EPOCH: 2,
    ATTEMPT_ID: "attempt-003",
    LEASE_GENERATION: 4,
    FENCE_TOKEN: "fence-007",
    COMPUTE_PROVIDER_BINDING: {
      BINDING_ID: "compute-binding-1",
      BINDING_SHA256: "b".repeat(64)
    },
    EXECUTION_TRANSPORT_BINDING: {
      BINDING_ID: "transport-binding-1",
      BINDING_SHA256: "c".repeat(64)
    },
    WORKER_ID: "worker-001",
    WORKER_READY_ATTESTATION_HASH: "d".repeat(64),
    APPROVAL_GRANT_ID: "approval-001",
    BUDGET_RESERVATION_ID: "budget-001"
  }, T0);

  if (complete) {
    await recordOneShotSessionProgressV1(sessionPath, {
      EXPECTED_STATE_VERSION: 0,
      IDEMPOTENCY_KEY: "complete-fixture",
      SUBMITTED_FENCE_TOKEN: "fence-007",
      RUNTIME_NOW_MS: T0 + 1,
      EXECUTION_TERMINAL: true,
      RECEIPT_TERMINAL: true,
      EXECUTION_TRANSPORT_DEREGISTERED: true,
      REQUIRED_RESOURCE_CLEANUP_TERMINAL: true,
      BILLING_STATUS: "STOPPED"
    });
  }

  const session = JSON.parse(await readFile(sessionPath, "utf8"));
  return { dir, sessionPath, sealPath, session };
}

function request(f, overrides = {}) {
  return {
    EXPECTED_SESSION_STATE_VERSION: f.session.STATE_VERSION,
    EXPECTED_SESSION_EVENT_SHA256: f.session.EVENT_LEDGER.at(-1).EVENT_SHA256,
    IDEMPOTENCY_KEY: "seal-001",
    RUNTIME_NOW_MS: T0 + 10,
    ...overrides
  };
}

async function cleanup(f) {
  await rm(f.dir, { recursive: true, force: true });
}

test("complete one-shot session is sealed without mutating the session", async () => {
  const f = await fixture();
  try {
    const before = await readFile(f.sessionPath, "utf8");
    const result = await commitDurableSessionClosureSealV1(f.sessionPath, f.sealPath, request(f));
    const after = await readFile(f.sessionPath, "utf8");
    assert.equal(result.replay, false);
    assert.equal(result.seal.SESSION_ID, "session-001");
    assert.equal(result.seal.SESSION_STATE_VERSION, 1);
    assert.equal(result.seal.BILLING_STATUS, "STOPPED");
    assert.ok(Object.values(result.seal.TERMINAL_FLAGS).every((value) => value === true));
    assert.equal(before, after);
    assert.deepEqual(validateDurableSessionClosureSealV1(result.seal), { ok: true, errors: [] });
  } finally { await cleanup(f); }
});

test("incomplete session cannot be closure sealed", async () => {
  const f = await fixture({ complete: false });
  try {
    await assert.rejects(
      commitDurableSessionClosureSealV1(f.sessionPath, f.sealPath, request(f)),
      /COMPLETE_SESSION_REQUIRED/
    );
  } finally { await cleanup(f); }
});

test("session state version and terminal event hash are exact bindings", async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      commitDurableSessionClosureSealV1(
        f.sessionPath,
        f.sealPath,
        request(f, { EXPECTED_SESSION_STATE_VERSION: 0 })
      ),
      /SESSION_STATE_CAS_MISMATCH/
    );
    await assert.rejects(
      commitDurableSessionClosureSealV1(
        f.sessionPath,
        f.sealPath,
        request(f, { EXPECTED_SESSION_EVENT_SHA256: "9".repeat(64) })
      ),
      /SESSION_EVENT_HASH_MISMATCH/
    );
  } finally { await cleanup(f); }
});

test("same closure request replays after reopen", async () => {
  const f = await fixture();
  try {
    const req = request(f);
    const first = await commitDurableSessionClosureSealV1(f.sessionPath, f.sealPath, req);
    const replay = await commitDurableSessionClosureSealV1(
      f.sessionPath,
      f.sealPath,
      { ...req, RUNTIME_NOW_MS: T0 + 20 }
    );
    assert.equal(replay.replay, true);
    assert.deepEqual(replay.seal, first.seal);
  } finally { await cleanup(f); }
});

test("changed request under same key and second key are denied", async () => {
  const f = await fixture();
  try {
    await commitDurableSessionClosureSealV1(f.sessionPath, f.sealPath, request(f));
    await assert.rejects(
      commitDurableSessionClosureSealV1(
        f.sessionPath,
        f.sealPath,
        request(f, { EXPECTED_SESSION_STATE_VERSION: 0 })
      ),
      /SESSION_STATE_CAS_MISMATCH/
    );
    await assert.rejects(
      commitDurableSessionClosureSealV1(
        f.sessionPath,
        f.sealPath,
        request(f, { IDEMPOTENCY_KEY: "seal-002" })
      ),
      /SESSION_ALREADY_CLOSURE_SEALED/
    );
  } finally { await cleanup(f); }
});

test("tampered closure seal is rejected on reopen", async () => {
  const f = await fixture();
  try {
    await commitDurableSessionClosureSealV1(f.sessionPath, f.sealPath, request(f));
    const raw = JSON.parse(await readFile(f.sealPath, "utf8"));
    raw.SESSION_ID = "tampered";
    await writeFile(f.sealPath, JSON.stringify(raw));
    await assert.rejects(readDurableSessionClosureSealV1(f.sealPath), /HASH_MISMATCH/);
  } finally { await cleanup(f); }
});

test("existing session lock blocks closure seal commit", async () => {
  const f = await fixture();
  try {
    await writeFile(`${f.sessionPath}.lock`, "busy\n");
    await assert.rejects(
      commitDurableSessionClosureSealV1(f.sessionPath, f.sealPath, request(f)),
      /SESSION_STATE_LOCKED_FOR_CLOSURE_SEAL/
    );
  } finally { await cleanup(f); }
});
