import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { computeRev51ObjectHash } from "../runtime/rev51/contract-core.mjs";
import {
  commitDurableResultAcceptanceV1,
  readDurableResultAcceptanceV1,
  validateDurableResultAcceptanceV1
} from "../runtime/rev51/durable-result-acceptance-v1.mjs";

const T0 = Date.parse("2026-09-24T00:00:00.000Z");
const SOURCE_EVENT_HASH = "e".repeat(64);

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

function workerJob(p = plan()) {
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
    CREATED_AT: "2026-09-24T00:00:00Z",
    RETENTION_CLASS: "UNTIL_FINAL_ACCEPTANCE",
    LOCATIONS: [`runtime://${id}`],
    ARTIFACT_STATE: "QUARANTINED"
  };
}

function verification(p, w, artifacts) {
  return {
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
  };
}

function state(overrides = {}) {
  return {
    STORE_SCHEMA_ID: "DURABLE_EXECUTION_STATE_V1",
    STATE_SCHEMA_VERSION: "1",
    EVENT_SCHEMA_VERSION: "1",
    EXECUTION_ID: "exec-001",
    EXECUTION_EPOCH: 2,
    ATTEMPT_ID: "attempt-003",
    LEASE_GENERATION: 4,
    FENCE_SEQUENCE: 7,
    FENCE_TOKEN: "fence-007",
    DESIRED_STATE: "RUNNING",
    MATERIALIZED_STATE: "RESULT_QUARANTINED",
    PROVIDER_OPERATION_STATE: "SUCCEEDED",
    RECONCILIATION_REQUIRED: false,
    BLIND_RETRY_ALLOWED: false,
    STATE_VERSION: 9,
    LAST_EVENT_SEQUENCE: 4,
    CREATED_AT: "2026-09-24T00:00:00Z",
    UPDATED_AT: "2026-09-24T00:00:00Z",
    USED_FENCE_TOKENS: ["fence-007"],
    IDEMPOTENCY_INDEX: {},
    EVENT_LEDGER: [
      { EVENT_SHA256: SOURCE_EVENT_HASH }
    ],
    ...overrides
  };
}

function request(overrides = {}) {
  const p = plan();
  const w = workerJob(p);
  const artifacts = [
    artifact("artifact-b", "b".repeat(64)),
    artifact("artifact-a", "a".repeat(64))
  ];
  return {
    IDEMPOTENCY_KEY: "accept-001",
    EXPECTED_STATE_VERSION: 9,
    EXPECTED_EXECUTION_EPOCH: 2,
    EXPECTED_LEASE_GENERATION: 4,
    SUBMITTED_FENCE_TOKEN: "fence-007",
    RUNTIME_NOW_MS: T0,
    PLAN: p,
    WORKER_JOB: w,
    QUARANTINED_ARTIFACTS: artifacts,
    VERIFICATION: verification(p, w, artifacts),
    ...overrides
  };
}

async function fixture(stateOverrides = {}) {
  const dir = await mkdtemp(join(tmpdir(), "r51-p2f-"));
  const statePath = join(dir, "execution-state.json");
  const journalPath = join(dir, "result-acceptance.json");
  await mkdir(dir, { recursive: true });
  await writeFile(statePath, `${JSON.stringify(state(stateOverrides), null, 2)}\n`, "utf8");
  return { dir, statePath, journalPath };
}

async function cleanup(f) {
  await rm(f.dir, { recursive: true, force: true });
}

test("current fence CAS commits receipt and immutable artifact manifest atomically", async () => {
  const f = await fixture();
  try {
    const r = await commitDurableResultAcceptanceV1(f.statePath, f.journalPath, request());
    assert.equal(r.replay, false);
    assert.equal(r.acceptance.ACCEPTANCE_STATE, "ACCEPTED");
    assert.equal(r.acceptance.SOURCE_STATE_VERSION, 9);
    assert.equal(r.acceptance.SOURCE_EVENT_SHA256, SOURCE_EVENT_HASH);
    assert.deepEqual(r.acceptance.EXECUTION_RECEIPT.ACCEPTED_ARTIFACT_IDS, ["artifact-a", "artifact-b"]);
    assert.ok(r.acceptance.ACCEPTED_ARTIFACT_MANIFEST.every((a) => a.ARTIFACT_STATE === "IMMUTABLE"));
    assert.deepEqual(validateDurableResultAcceptanceV1(r.acceptance), { ok: true, errors: [] });
  } finally { await cleanup(f); }
});

test("quarantined input objects are not mutated by durable commit", async () => {
  const f = await fixture();
  try {
    const req = request();
    await commitDurableResultAcceptanceV1(f.statePath, f.journalPath, req);
    assert.ok(req.QUARANTINED_ARTIFACTS.every((a) => a.ARTIFACT_STATE === "QUARANTINED"));
  } finally { await cleanup(f); }
});

test("stale fence is rejected before journal commit", async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      commitDurableResultAcceptanceV1(f.statePath, f.journalPath, request({ SUBMITTED_FENCE_TOKEN: "stale" })),
      /DURABLE_RESULT_ACCEPTANCE_STALE_FENCE_REJECTED/
    );
    await assert.rejects(readFile(f.journalPath, "utf8"), /ENOENT/);
  } finally { await cleanup(f); }
});

test("attempt binding must match current durable attempt", async () => {
  const f = await fixture();
  try {
    const req = request();
    req.WORKER_JOB.ATTEMPT_ID = "attempt-old";
    req.WORKER_JOB.OBJECT_SHA256 = computeRev51ObjectHash(req.WORKER_JOB);
    req.VERIFICATION.ATTEMPT_ID = "attempt-old";
    req.VERIFICATION.WORKER_JOB_HASH = req.WORKER_JOB.OBJECT_SHA256;
    await assert.rejects(
      commitDurableResultAcceptanceV1(f.statePath, f.journalPath, req),
      /DURABLE_RESULT_ACCEPTANCE_ATTEMPT_ID_MISMATCH/
    );
  } finally { await cleanup(f); }
});

test("state version CAS mismatch is rejected", async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      commitDurableResultAcceptanceV1(f.statePath, f.journalPath, request({ EXPECTED_STATE_VERSION: 8 })),
      /DURABLE_RESULT_ACCEPTANCE_STATE_CAS_MISMATCH/
    );
  } finally { await cleanup(f); }
});

test("execution epoch and lease generation are exact runtime-private bindings", async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      commitDurableResultAcceptanceV1(f.statePath, f.journalPath, request({ EXPECTED_EXECUTION_EPOCH: 1 })),
      /DURABLE_RESULT_ACCEPTANCE_EXECUTION_EPOCH_MISMATCH/
    );
    await assert.rejects(
      commitDurableResultAcceptanceV1(f.statePath, f.journalPath, request({ EXPECTED_LEASE_GENERATION: 3, IDEMPOTENCY_KEY: "accept-002" })),
      /DURABLE_RESULT_ACCEPTANCE_LEASE_GENERATION_MISMATCH/
    );
  } finally { await cleanup(f); }
});

test("unresolved provider outcome blocks authoritative result acceptance", async () => {
  const f = await fixture({ PROVIDER_OPERATION_STATE: "OUTCOME_UNKNOWN", RECONCILIATION_REQUIRED: true });
  try {
    await assert.rejects(
      commitDurableResultAcceptanceV1(f.statePath, f.journalPath, request()),
      /DURABLE_RESULT_ACCEPTANCE_RECONCILIATION_REQUIRED/
    );
  } finally { await cleanup(f); }
});

test("verification failure leaves authoritative acceptance absent", async () => {
  const f = await fixture();
  try {
    const req = request();
    req.VERIFICATION.SECURITY_OUTPUT_CONTRACT_VERIFIED = false;
    await assert.rejects(
      commitDurableResultAcceptanceV1(f.statePath, f.journalPath, req),
      /RESULT_ACCEPTANCE_CHECK_FAILED:SECURITY_OUTPUT_CONTRACT_VERIFIED/
    );
    await assert.rejects(readDurableResultAcceptanceV1(f.journalPath), /ENOENT/);
  } finally { await cleanup(f); }
});

test("same idempotency replay survives restart and later durable state advancement", async () => {
  const f = await fixture();
  try {
    const req = request();
    const first = await commitDurableResultAcceptanceV1(f.statePath, f.journalPath, req);
    await writeFile(f.statePath, `${JSON.stringify(state({
      STATE_VERSION: 10,
      ATTEMPT_ID: "attempt-004",
      LEASE_GENERATION: 5,
      FENCE_SEQUENCE: 8,
      FENCE_TOKEN: "fence-008",
      USED_FENCE_TOKENS: ["fence-007", "fence-008"]
    }), null, 2)}\n`, "utf8");
    const replay = await commitDurableResultAcceptanceV1(f.statePath, f.journalPath, req);
    assert.equal(replay.replay, true);
    assert.deepEqual(replay.acceptance, first.acceptance);
  } finally { await cleanup(f); }
});

test("same idempotency key with changed request is rejected after acceptance", async () => {
  const f = await fixture();
  try {
    const req = request();
    await commitDurableResultAcceptanceV1(f.statePath, f.journalPath, req);
    const changed = request();
    changed.QUARANTINED_ARTIFACTS[0].CONTENT_SHA256 = "c".repeat(64);
    changed.VERIFICATION.ARTIFACT_CONTENT_BINDINGS[0].CONTENT_SHA256 = "c".repeat(64);
    await assert.rejects(
      commitDurableResultAcceptanceV1(f.statePath, f.journalPath, changed),
      /DURABLE_RESULT_ACCEPTANCE_IDEMPOTENCY_KEY_CONFLICT/
    );
  } finally { await cleanup(f); }
});

test("second acceptance under a different idempotency key is denied", async () => {
  const f = await fixture();
  try {
    await commitDurableResultAcceptanceV1(f.statePath, f.journalPath, request());
    await assert.rejects(
      commitDurableResultAcceptanceV1(f.statePath, f.journalPath, request({ IDEMPOTENCY_KEY: "accept-second" })),
      /DURABLE_RESULT_ALREADY_ACCEPTED/
    );
  } finally { await cleanup(f); }
});

test("acceptance journal tamper is rejected on reopen", async () => {
  const f = await fixture();
  try {
    await commitDurableResultAcceptanceV1(f.statePath, f.journalPath, request());
    const raw = JSON.parse(await readFile(f.journalPath, "utf8"));
    raw.ACCEPTANCE_STATE = "TAMPERED";
    await writeFile(f.journalPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
    await assert.rejects(readDurableResultAcceptanceV1(f.journalPath), /DURABLE_RESULT_ACCEPTANCE_STATE_INVALID/);
  } finally { await cleanup(f); }
});

test("acceptance lock prevents concurrent commit and state lock is released", async () => {
  const f = await fixture();
  try {
    await writeFile(`${f.journalPath}.lock`, "busy\n", "utf8");
    await assert.rejects(
      commitDurableResultAcceptanceV1(f.statePath, f.journalPath, request()),
      /DURABLE_RESULT_ACCEPTANCE_LOCKED/
    );
    await rm(`${f.journalPath}.lock`, { force: true });
    const r = await commitDurableResultAcceptanceV1(f.statePath, f.journalPath, request());
    assert.equal(r.replay, false);
  } finally { await cleanup(f); }
});

test("existing durable-state lock blocks acceptance transaction", async () => {
  const f = await fixture();
  try {
    await writeFile(`${f.statePath}.lock`, "busy\n", "utf8");
    await assert.rejects(
      commitDurableResultAcceptanceV1(f.statePath, f.journalPath, request()),
      /DURABLE_EXECUTION_STATE_LOCKED/
    );
    await assert.rejects(readFile(f.journalPath, "utf8"), /ENOENT/);
  } finally { await cleanup(f); }
});

test("stale temporary file is not authoritative acceptance", async () => {
  const f = await fixture();
  try {
    await writeFile(`${f.journalPath}.tmp-stale`, '{"ACCEPTANCE_STATE":"ACCEPTED"}\n', "utf8");
    await assert.rejects(readDurableResultAcceptanceV1(f.journalPath), /ENOENT/);
    const r = await commitDurableResultAcceptanceV1(f.statePath, f.journalPath, request());
    assert.equal(r.acceptance.ACCEPTANCE_STATE, "ACCEPTED");
  } finally { await cleanup(f); }
});

test("receipt and artifact manifest remain byte-stable across reopen", async () => {
  const f = await fixture();
  try {
    const first = await commitDurableResultAcceptanceV1(f.statePath, f.journalPath, request());
    const reopened = await readDurableResultAcceptanceV1(f.journalPath);
    assert.deepEqual(reopened.EXECUTION_RECEIPT, first.acceptance.EXECUTION_RECEIPT);
    assert.deepEqual(reopened.ACCEPTED_ARTIFACT_MANIFEST, first.acceptance.ACCEPTED_ARTIFACT_MANIFEST);
    assert.equal(reopened.ACCEPTANCE_RECORD_SHA256, first.acceptance.ACCEPTANCE_RECORD_SHA256);
  } finally { await cleanup(f); }
});
