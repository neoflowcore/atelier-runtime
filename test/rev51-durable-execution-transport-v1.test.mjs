import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  initializeDurableExecutionTransportV1,
  readDurableExecutionTransportV1,
  recordExecutionTransportConformanceV1,
  beginExecutionTransportActivationV1,
  recordExecutionTransportActivationResultV1,
  reconcileExecutionTransportActivationV1,
  closeExecutionTransportV1,
  validateExecutionTransportDispatchGateV1,
  validateDurableExecutionTransportV1
} from "../runtime/rev51/durable-execution-transport-v1.mjs";
import {
  advanceExecutionFenceV1,
  initializeDurableExecutionStateV1
} from "../runtime/rev51/durable-execution-state-v1.mjs";
import {
  claimWorkerJobLaunchV1,
  initializeDurableWorkerJobLaunchV1
} from "../runtime/rev51/durable-worker-job-launch-v1.mjs";

const H1 = "1".repeat(64);
const H2 = "2".repeat(64);
const H3 = "3".repeat(64);
const BASE_TIME = 1_800_000_000_000;

async function fixture({ transport = "DIRECT_WORKER" } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "r51-p2q-"));
  const execPath = join(dir, "execution.json");
  const launchPath = join(dir, "launch.json");
  const transportPath = join(dir, "transport.json");
  await initializeDurableExecutionStateV1(execPath, {
    EXECUTION_ID:"exec-1",EXECUTION_EPOCH:1,ATTEMPT_ID:"attempt-1",LEASE_GENERATION:1,FENCE_SEQUENCE:1,FENCE_TOKEN:"fence-1",
    DESIRED_STATE:"RUNNING",MATERIALIZED_STATE:"READY",PROVIDER_OPERATION_STATE:"PENDING"
  }, BASE_TIME);
  await initializeDurableWorkerJobLaunchV1(launchPath, execPath, {
    SCHEMA_ID:"WORKER_JOB_V1",OBJECT_SHA256:H1,EXECUTION_ID:"exec-1",ATTEMPT_ID:"attempt-1",FENCE_TOKEN:"fence-1",
    SEMANTIC_REPLANNING:"DENY",
    ENTRYPOINT_SPEC:{schema_id:"ENTRYPOINT_SPEC_V1",executable:"node",argv:["task.mjs"],working_directory:"/workspace",environment_refs:["ENV_A"],stdin_policy:"CLOSED",timeout:60,expected_exit_codes:[0],shell_interpretation:"DENY"}
  }, BASE_TIME);
  const store = await initializeDurableExecutionTransportV1(
    transportPath, execPath, launchPath,
    { EXECUTION_TRANSPORT: transport, WORKER_ID: "worker-1" }, BASE_TIME
  );
  return { dir, execPath, launchPath, transportPath, store };
}
async function setLaunch(execPath, launchPath, status) {
  if (status !== "CLAIMED") throw new Error("TEST_LAUNCH_STATUS_UNSUPPORTED");
  await claimWorkerJobLaunchV1(launchPath, execPath, {
    EXPECTED_STATE_VERSION:0,IDEMPOTENCY_KEY:"launch-claim-1",
    OPERATION_ID:"worker-launch-1",OPERATION_IDEMPOTENCY_KEY:"worker-launch-idem-1",
    SUBMITTED_FENCE_TOKEN:"fence-1",RUNTIME_NOW_MS:BASE_TIME+1
  });
}
async function cleanup(dir) { await rm(dir, { recursive: true, force: true }); }
function conformanceRequest(store, result = "PASS", key = "conf-1") {
  return { EXPECTED_STATE_VERSION: store.STATE_VERSION, IDEMPOTENCY_KEY: key, RUNTIME_NOW_MS: BASE_TIME + 1, CONFORMANCE_RESULT: result, CONFORMANCE_EVIDENCE_SHA256: H2 };
}
function activationRequest(store, key = "activate-1", fence = "fence-1") {
  return { EXPECTED_STATE_VERSION: store.STATE_VERSION, IDEMPOTENCY_KEY: key, RUNTIME_NOW_MS: BASE_TIME + 2, SUBMITTED_FENCE_TOKEN: fence, OPERATION_ID: "transport-op-1", OPERATION_IDEMPOTENCY_KEY: "remote-idem-1" };
}
function activationResult(store, result, key = "activate-result-1") {
  return { EXPECTED_STATE_VERSION: store.STATE_VERSION, IDEMPOTENCY_KEY: key, RUNTIME_NOW_MS: BASE_TIME + 3, OPERATION_ID: "transport-op-1", OPERATION_IDEMPOTENCY_KEY: "remote-idem-1", RESULT: result, EVIDENCE_SHA256: H3 };
}

// 1
test("registers DIRECT_WORKER transport as PREPARING and crash-reopens", async () => {
  const f = await fixture();
  try {
    assert.equal(f.store.TRANSPORT_STATE, "PREPARING");
    assert.equal(f.store.CONFORMANCE_RESULT, "PENDING");
    assert.equal((await readDurableExecutionTransportV1(f.transportPath)).WORKER_JOB_SHA256, H1);
  } finally { await cleanup(f.dir); }
});

// 2
test("registers GITHUB_SELF_HOSTED_JIT without persisting JIT registration material", async () => {
  const f = await fixture({ transport: "GITHUB_SELF_HOSTED_JIT" });
  try {
    assert.equal(f.store.EXECUTION_TRANSPORT, "GITHUB_SELF_HOSTED_JIT");
    assert.equal(JSON.stringify(f.store).includes("JIT_REGISTRATION_ID"), false);
  } finally { await cleanup(f.dir); }
});

// 3
test("rejects unsupported transport", async () => {
  const dir = await mkdtemp(join(tmpdir(), "r51-p2q-"));
  try {
    const execPath = join(dir, "execution.json"), launchPath = join(dir, "launch.json"), transportPath = join(dir, "transport.json");
    await writeFile(execPath, `${JSON.stringify({ EXECUTION_ID:"exec-1", ATTEMPT_ID:"attempt-1", FENCE_TOKEN:"fence-1" })}\n`);
    await writeFile(launchPath, `${JSON.stringify({ EXECUTION_ID:"exec-1", ATTEMPT_ID:"attempt-1", FENCE_TOKEN:"fence-1", WORKER_JOB_SHA256:H1, LAUNCH_STATUS:"AVAILABLE" })}\n`);
    await assert.rejects(() => initializeDurableExecutionTransportV1(transportPath, execPath, launchPath, { EXECUTION_TRANSPORT:"SSH", WORKER_ID:"worker-1" }, BASE_TIME), /EXECUTION_TRANSPORT_INVALID/);
  } finally { await cleanup(dir); }
});

// 4
test("rejects extra provider/JIT material in registration input", async () => {
  const dir = await mkdtemp(join(tmpdir(), "r51-p2q-"));
  try {
    const execPath = join(dir, "execution.json"), launchPath = join(dir, "launch.json"), transportPath = join(dir, "transport.json");
    await writeFile(execPath, `${JSON.stringify({ EXECUTION_ID:"exec-1", ATTEMPT_ID:"attempt-1", FENCE_TOKEN:"fence-1" })}\n`);
    await writeFile(launchPath, `${JSON.stringify({ EXECUTION_ID:"exec-1", ATTEMPT_ID:"attempt-1", FENCE_TOKEN:"fence-1", WORKER_JOB_SHA256:H1, LAUNCH_STATUS:"AVAILABLE" })}\n`);
    await assert.rejects(() => initializeDurableExecutionTransportV1(transportPath, execPath, launchPath, { EXECUTION_TRANSPORT:"GITHUB_SELF_HOSTED_JIT", WORKER_ID:"worker-1", JIT_REGISTRATION_ID:"raw" }, BASE_TIME), /TRANSPORT_INITIAL_FIELDS_MISMATCH/);
  } finally { await cleanup(dir); }
});

// 5
test("PASS conformance moves PREPARING to READY", async () => {
  const f = await fixture();
  try {
    const r = await recordExecutionTransportConformanceV1(f.transportPath, conformanceRequest(f.store));
    assert.equal(r.state.TRANSPORT_STATE, "READY");
    assert.equal(r.state.CONFORMANCE_RESULT, "PASS");
  } finally { await cleanup(f.dir); }
});

// 6
test("FAIL conformance fail-closes transport", async () => {
  const f = await fixture();
  try {
    const r = await recordExecutionTransportConformanceV1(f.transportPath, conformanceRequest(f.store, "FAIL"));
    assert.equal(r.state.TRANSPORT_STATE, "FAILED");
    await setLaunch(f.execPath, f.launchPath, "CLAIMED");
    await assert.rejects(() => beginExecutionTransportActivationV1(f.transportPath, f.execPath, f.launchPath, activationRequest(r.state)), /TRANSPORT_NOT_READY/);
  } finally { await cleanup(f.dir); }
});

// 7
test("activation requires worker launch claim", async () => {
  const f = await fixture();
  try {
    const ready = (await recordExecutionTransportConformanceV1(f.transportPath, conformanceRequest(f.store))).state;
    await assert.rejects(() => beginExecutionTransportActivationV1(f.transportPath, f.execPath, f.launchPath, activationRequest(ready)), /WORKER_JOB_LAUNCH_MUST_BE_CLAIMED/);
  } finally { await cleanup(f.dir); }
});

// 8
test("activation rejects stale fence", async () => {
  const f = await fixture();
  try {
    const ready = (await recordExecutionTransportConformanceV1(f.transportPath, conformanceRequest(f.store))).state;
    await setLaunch(f.execPath, f.launchPath, "CLAIMED");
    await assert.rejects(() => beginExecutionTransportActivationV1(f.transportPath, f.execPath, f.launchPath, activationRequest(ready, "activate-stale", "fence-old")), /STALE_FENCE_REJECTED/);
  } finally { await cleanup(f.dir); }
});

// 9
test("activation claim is exactly idempotent", async () => {
  const f = await fixture();
  try {
    const ready = (await recordExecutionTransportConformanceV1(f.transportPath, conformanceRequest(f.store))).state;
    await setLaunch(f.execPath, f.launchPath, "CLAIMED");
    const req = activationRequest(ready);
    const first = await beginExecutionTransportActivationV1(f.transportPath, f.execPath, f.launchPath, req);
    const replay = await beginExecutionTransportActivationV1(f.transportPath, f.execPath, f.launchPath, req);
    assert.equal(first.replay, false);
    assert.equal(replay.replay, true);
  } finally { await cleanup(f.dir); }
});

// 10
test("changed activation replay conflicts", async () => {
  const f = await fixture();
  try {
    const ready = (await recordExecutionTransportConformanceV1(f.transportPath, conformanceRequest(f.store))).state;
    await setLaunch(f.execPath, f.launchPath, "CLAIMED");
    const req = activationRequest(ready);
    await beginExecutionTransportActivationV1(f.transportPath, f.execPath, f.launchPath, req);
    await assert.rejects(() => beginExecutionTransportActivationV1(f.transportPath, f.execPath, f.launchPath, { ...req, OPERATION_ID:"other-op" }), /IDEMPOTENCY_KEY_CONFLICT/);
  } finally { await cleanup(f.dir); }
});

// 11
test("PASS activation becomes ACTIVE and dispatch gate passes exact binding", async () => {
  const f = await fixture();
  try {
    const ready = (await recordExecutionTransportConformanceV1(f.transportPath, conformanceRequest(f.store))).state;
    await setLaunch(f.execPath, f.launchPath, "CLAIMED");
    const claimed = (await beginExecutionTransportActivationV1(f.transportPath, f.execPath, f.launchPath, activationRequest(ready))).state;
    const active = (await recordExecutionTransportActivationResultV1(f.transportPath, activationResult(claimed, "PASS"))).state;
    assert.equal(active.TRANSPORT_STATE, "ACTIVE");
    assert.deepEqual(validateExecutionTransportDispatchGateV1(active, { EXECUTION_ID:"exec-1", ATTEMPT_ID:"attempt-1", FENCE_TOKEN:"fence-1", WORKER_ID:"worker-1", WORKER_JOB_SHA256:H1 }), { ok:true, code:"EXECUTION_TRANSPORT_ACTIVE" });
  } finally { await cleanup(f.dir); }
});

// 12
test("dispatch gate rejects wrong worker binding", async () => {
  const f = await fixture();
  try {
    const ready = (await recordExecutionTransportConformanceV1(f.transportPath, conformanceRequest(f.store))).state;
    await setLaunch(f.execPath, f.launchPath, "CLAIMED");
    const claimed = (await beginExecutionTransportActivationV1(f.transportPath, f.execPath, f.launchPath, activationRequest(ready))).state;
    const active = (await recordExecutionTransportActivationResultV1(f.transportPath, activationResult(claimed, "PASS"))).state;
    assert.equal(validateExecutionTransportDispatchGateV1(active, { EXECUTION_ID:"exec-1", ATTEMPT_ID:"attempt-1", FENCE_TOKEN:"fence-1", WORKER_ID:"worker-X", WORKER_JOB_SHA256:H1 }).code, "TRANSPORT_WORKER_BINDING_MISMATCH");
  } finally { await cleanup(f.dir); }
});

// 13
test("OUTCOME_UNKNOWN requires same-operation reconciliation", async () => {
  const f = await fixture();
  try {
    const ready = (await recordExecutionTransportConformanceV1(f.transportPath, conformanceRequest(f.store))).state;
    await setLaunch(f.execPath, f.launchPath, "CLAIMED");
    const claimed = (await beginExecutionTransportActivationV1(f.transportPath, f.execPath, f.launchPath, activationRequest(ready))).state;
    const unknown = (await recordExecutionTransportActivationResultV1(f.transportPath, activationResult(claimed, "OUTCOME_UNKNOWN"))).state;
    assert.equal(unknown.TRANSPORT_STATE, "OUTCOME_UNKNOWN");
    await assert.rejects(() => reconcileExecutionTransportActivationV1(f.transportPath, { EXPECTED_STATE_VERSION:unknown.STATE_VERSION, IDEMPOTENCY_KEY:"reconcile-wrong", RUNTIME_NOW_MS:BASE_TIME+4, OPERATION_ID:"other", OPERATION_IDEMPOTENCY_KEY:"remote-idem-1", RECONCILED_RESULT:"PASS", EVIDENCE_SHA256:H3 }), /SECOND_MUTATION_DENIED/);
  } finally { await cleanup(f.dir); }
});

// 14
test("same operation reconciles OUTCOME_UNKNOWN to ACTIVE", async () => {
  const f = await fixture();
  try {
    const ready = (await recordExecutionTransportConformanceV1(f.transportPath, conformanceRequest(f.store))).state;
    await setLaunch(f.execPath, f.launchPath, "CLAIMED");
    const claimed = (await beginExecutionTransportActivationV1(f.transportPath, f.execPath, f.launchPath, activationRequest(ready))).state;
    const unknown = (await recordExecutionTransportActivationResultV1(f.transportPath, activationResult(claimed, "OUTCOME_UNKNOWN"))).state;
    const reconciled = await reconcileExecutionTransportActivationV1(f.transportPath, { EXPECTED_STATE_VERSION:unknown.STATE_VERSION, IDEMPOTENCY_KEY:"reconcile-1", RUNTIME_NOW_MS:BASE_TIME+4, OPERATION_ID:"transport-op-1", OPERATION_IDEMPOTENCY_KEY:"remote-idem-1", RECONCILED_RESULT:"PASS", EVIDENCE_SHA256:H3 });
    assert.equal(reconciled.state.TRANSPORT_STATE, "ACTIVE");
  } finally { await cleanup(f.dir); }
});

// 15
test("blind second activation after OUTCOME_UNKNOWN is denied", async () => {
  const f = await fixture();
  try {
    const ready = (await recordExecutionTransportConformanceV1(f.transportPath, conformanceRequest(f.store))).state;
    await setLaunch(f.execPath, f.launchPath, "CLAIMED");
    const claimed = (await beginExecutionTransportActivationV1(f.transportPath, f.execPath, f.launchPath, activationRequest(ready))).state;
    const unknown = (await recordExecutionTransportActivationResultV1(f.transportPath, activationResult(claimed, "OUTCOME_UNKNOWN"))).state;
    await assert.rejects(() => beginExecutionTransportActivationV1(f.transportPath, f.execPath, f.launchPath, { ...activationRequest(unknown, "activate-2"), OPERATION_ID:"transport-op-2", OPERATION_IDEMPOTENCY_KEY:"remote-idem-2" }), /TRANSPORT_RECONCILIATION_REQUIRED/);
  } finally { await cleanup(f.dir); }
});

// 16
test("ACTIVE transport closes with durable deregistration evidence", async () => {
  const f = await fixture();
  try {
    const ready = (await recordExecutionTransportConformanceV1(f.transportPath, conformanceRequest(f.store))).state;
    await setLaunch(f.execPath, f.launchPath, "CLAIMED");
    const claimed = (await beginExecutionTransportActivationV1(f.transportPath, f.execPath, f.launchPath, activationRequest(ready))).state;
    const active = (await recordExecutionTransportActivationResultV1(f.transportPath, activationResult(claimed, "PASS"))).state;
    const closed = await closeExecutionTransportV1(f.transportPath, { EXPECTED_STATE_VERSION:active.STATE_VERSION, IDEMPOTENCY_KEY:"close-1", RUNTIME_NOW_MS:BASE_TIME+5, DEREGISTRATION_EVIDENCE_SHA256:H2 });
    assert.equal(closed.state.TRANSPORT_STATE, "CLOSED");
    assert.equal(validateExecutionTransportDispatchGateV1(closed.state, { EXECUTION_ID:"exec-1", ATTEMPT_ID:"attempt-1", FENCE_TOKEN:"fence-1", WORKER_ID:"worker-1", WORKER_JOB_SHA256:H1 }).ok, false);
  } finally { await cleanup(f.dir); }
});

// 17
test("state CAS mismatch is denied", async () => {
  const f = await fixture();
  try {
    await assert.rejects(() => recordExecutionTransportConformanceV1(f.transportPath, { ...conformanceRequest(f.store), EXPECTED_STATE_VERSION:99 }), /TRANSPORT_STATE_CAS_MISMATCH/);
  } finally { await cleanup(f.dir); }
});

// 18
test("event ledger tamper is detected on reopen", async () => {
  const f = await fixture();
  try {
    const raw = JSON.parse(await readFile(f.transportPath, "utf8"));
    raw.EVENT_LEDGER[0].PAYLOAD.WORKER_ID = "tampered";
    await writeFile(f.transportPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
    await assert.rejects(() => readDurableExecutionTransportV1(f.transportPath), /TRANSPORT_EVENT_HASH_MISMATCH/);
  } finally { await cleanup(f.dir); }
});

// 19
test("validator accepts intact durable transport store", async () => {
  const f = await fixture();
  try { assert.deepEqual(validateDurableExecutionTransportV1(f.store), { ok:true, errors:[] }); }
  finally { await cleanup(f.dir); }
});

// 20
test("registration rejects lineage drift between execution and launch stores", async () => {
  const dir = await mkdtemp(join(tmpdir(), "r51-p2q-"));
  try {
    const execPath = join(dir, "execution.json"), launchPath = join(dir, "launch.json"), transportPath = join(dir, "transport.json");
    await initializeDurableExecutionStateV1(execPath, {
      EXECUTION_ID:"exec-1",EXECUTION_EPOCH:1,ATTEMPT_ID:"attempt-1",LEASE_GENERATION:1,FENCE_SEQUENCE:1,FENCE_TOKEN:"fence-1",
      DESIRED_STATE:"RUNNING",MATERIALIZED_STATE:"READY",PROVIDER_OPERATION_STATE:"PENDING"
    }, BASE_TIME);
    await initializeDurableWorkerJobLaunchV1(launchPath, execPath, {
      SCHEMA_ID:"WORKER_JOB_V1",OBJECT_SHA256:H1,EXECUTION_ID:"exec-1",ATTEMPT_ID:"attempt-1",FENCE_TOKEN:"fence-1",
      SEMANTIC_REPLANNING:"DENY",
      ENTRYPOINT_SPEC:{schema_id:"ENTRYPOINT_SPEC_V1",executable:"node",argv:["task.mjs"],working_directory:"/workspace",environment_refs:["ENV_A"],stdin_policy:"CLOSED",timeout:60,expected_exit_codes:[0],shell_interpretation:"DENY"}
    }, BASE_TIME);
    await advanceExecutionFenceV1(execPath, {
      EXPECTED_STATE_VERSION:0,IDEMPOTENCY_KEY:"advance-1",SUBMITTED_FENCE_TOKEN:"fence-1",RUNTIME_NOW_MS:BASE_TIME+1,
      NEXT_FENCE_SEQUENCE:2,NEXT_FENCE_TOKEN:"fence-2",NEXT_ATTEMPT_ID:"attempt-2",NEXT_LEASE_GENERATION:2
    });
    await assert.rejects(() => initializeDurableExecutionTransportV1(transportPath, execPath, launchPath, { EXECUTION_TRANSPORT:"DIRECT_WORKER", WORKER_ID:"worker-1" }, BASE_TIME+2), /TRANSPORT_INITIAL_LINEAGE_MISMATCH/);
  } finally { await cleanup(dir); }
});
