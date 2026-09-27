import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  computeWorkerReadyAttestationHashV1,
  initializeDurableWorkerReadinessV1,
  readDurableWorkerReadinessV1,
  reconcileWorkerReadinessExpiryV1,
  replaceExpiredWorkerReadyAttestationV1,
  validateDurableWorkerReadinessV1,
  validateExecutionGateAgainstReadinessV1,
  validateSessionReadinessBindingV1,
  validateWorkerReadyAttestationForReadinessV1
} from "../runtime/rev51/readiness-expiry-reconciliation-v1.mjs";

const PLAN = "a".repeat(64);
const T0 = Date.parse("2026-09-23T00:00:00.000Z");
const T1 = T0 + 60_000;
const T2 = T0 + 120_000;

function attestation(id="att-1", issued=T0, expires=T2) {
  return {
    ATTESTATION_ID: id,
    WORKER_ID: "worker-1",
    EXECUTION_PLAN_HASH: PLAN,
    ATTESTATION_STATE: "READY",
    ISSUED_AT: new Date(issued).toISOString(),
    EXPIRES_AT: new Date(expires).toISOString()
  };
}

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "r51-p2d-"));
  return { dir, path: join(dir, "readiness.json") };
}

test("ready attestation validates before expiry", () => {
  assert.deepEqual(validateWorkerReadyAttestationForReadinessV1(attestation(), T1), { ok: true, errors: [] });
});

test("ready attestation rejects at exact expiry boundary", () => {
  assert.ok(validateWorkerReadyAttestationForReadinessV1(attestation(), T2).errors.includes("READY_ATTESTATION_EXPIRED"));
});

test("initialization durably binds worker plan and attestation hash", async () => {
  const f=await fixture();
  try {
    const a=attestation();
    const s=await initializeDurableWorkerReadinessV1(f.path,{EXECUTION_ID:"exec-1",WORKER_READY_ATTESTATION:a},T1);
    assert.equal(s.ATTESTATION_HASH,computeWorkerReadyAttestationHashV1(a));
    assert.equal(s.READINESS_STATUS,"READY");
    assert.equal(s.EXECUTION_GATE_OPEN,true);
    assert.deepEqual(validateDurableWorkerReadinessV1(s),{ok:true,errors:[]});
  } finally { await rm(f.dir,{recursive:true,force:true}); }
});

test("restart reopen preserves durable readiness state", async () => {
  const f=await fixture();
  try {
    const s=await initializeDurableWorkerReadinessV1(f.path,{EXECUTION_ID:"exec-1",WORKER_READY_ATTESTATION:attestation()},T1);
    const reopened=await readDurableWorkerReadinessV1(f.path);
    assert.deepEqual(reopened,s);
  } finally { await rm(f.dir,{recursive:true,force:true}); }
});

test("pre-expiry reconciliation makes no durable mutation", async () => {
  const f=await fixture();
  try {
    await initializeDurableWorkerReadinessV1(f.path,{EXECUTION_ID:"exec-1",WORKER_READY_ATTESTATION:attestation()},T0);
    const before=await readFile(f.path,"utf8");
    const r=await reconcileWorkerReadinessExpiryV1(f.path,{EXPECTED_STATE_VERSION:0,IDEMPOTENCY_KEY:"expire-1",RUNTIME_NOW_MS:T1});
    assert.equal(r.changed,false);
    assert.equal(r.code,"READINESS_STILL_VALID");
    assert.equal(await readFile(f.path,"utf8"),before);
  } finally { await rm(f.dir,{recursive:true,force:true}); }
});

test("expiry reconciliation durably closes execution gate", async () => {
  const f=await fixture();
  try {
    await initializeDurableWorkerReadinessV1(f.path,{EXECUTION_ID:"exec-1",WORKER_READY_ATTESTATION:attestation()},T0);
    const r=await reconcileWorkerReadinessExpiryV1(f.path,{EXPECTED_STATE_VERSION:0,IDEMPOTENCY_KEY:"expire-1",RUNTIME_NOW_MS:T2});
    assert.equal(r.state.READINESS_STATUS,"EXPIRED");
    assert.equal(r.state.REATTESTATION_REQUIRED,true);
    assert.equal(r.state.EXECUTION_GATE_OPEN,false);
    assert.equal(r.state.EVENT_LEDGER.at(-1).EVENT_TYPE,"READY_ATTESTATION_EXPIRED");
  } finally { await rm(f.dir,{recursive:true,force:true}); }
});

test("expired readiness stays closed after restart", async () => {
  const f=await fixture();
  try {
    await initializeDurableWorkerReadinessV1(f.path,{EXECUTION_ID:"exec-1",WORKER_READY_ATTESTATION:attestation()},T0);
    await reconcileWorkerReadinessExpiryV1(f.path,{EXPECTED_STATE_VERSION:0,IDEMPOTENCY_KEY:"expire-1",RUNTIME_NOW_MS:T2});
    const reopened=await readDurableWorkerReadinessV1(f.path);
    assert.equal(reopened.READINESS_STATUS,"EXPIRED");
    assert.deepEqual(validateExecutionGateAgainstReadinessV1(reopened,T2),{ok:false,code:"READY_ATTESTATION_EXPIRED"});
  } finally { await rm(f.dir,{recursive:true,force:true}); }
});

test("expiry reconcile replay is idempotent", async () => {
  const f=await fixture();
  try {
    await initializeDurableWorkerReadinessV1(f.path,{EXECUTION_ID:"exec-1",WORKER_READY_ATTESTATION:attestation()},T0);
    const first=await reconcileWorkerReadinessExpiryV1(f.path,{EXPECTED_STATE_VERSION:0,IDEMPOTENCY_KEY:"expire-1",RUNTIME_NOW_MS:T2});
    const second=await reconcileWorkerReadinessExpiryV1(f.path,{EXPECTED_STATE_VERSION:0,IDEMPOTENCY_KEY:"expire-1",RUNTIME_NOW_MS:T2+1000});
    assert.equal(first.state.STATE_VERSION,1);
    assert.equal(second.state.STATE_VERSION,1);
    assert.equal(second.code,"READINESS_ALREADY_EXPIRED");
  } finally { await rm(f.dir,{recursive:true,force:true}); }
});

test("replacement requires expired readiness", async () => {
  const f=await fixture();
  try {
    await initializeDurableWorkerReadinessV1(f.path,{EXECUTION_ID:"exec-1",WORKER_READY_ATTESTATION:attestation()},T0);
    await assert.rejects(
      replaceExpiredWorkerReadyAttestationV1(f.path,{EXPECTED_STATE_VERSION:0,IDEMPOTENCY_KEY:"replace-1",RUNTIME_NOW_MS:T1,WORKER_READY_ATTESTATION:attestation("att-2",T1,T2+60_000)}),
      /REATTESTATION_NOT_REQUIRED/
    );
  } finally { await rm(f.dir,{recursive:true,force:true}); }
});

test("replacement requires same worker and execution plan", async () => {
  const f=await fixture();
  try {
    await initializeDurableWorkerReadinessV1(f.path,{EXECUTION_ID:"exec-1",WORKER_READY_ATTESTATION:attestation()},T0);
    await reconcileWorkerReadinessExpiryV1(f.path,{EXPECTED_STATE_VERSION:0,IDEMPOTENCY_KEY:"expire-1",RUNTIME_NOW_MS:T2});
    await assert.rejects(
      replaceExpiredWorkerReadyAttestationV1(f.path,{EXPECTED_STATE_VERSION:1,IDEMPOTENCY_KEY:"replace-1",RUNTIME_NOW_MS:T2+1000,WORKER_READY_ATTESTATION:{...attestation("att-2",T2+1000,T2+120_000),WORKER_ID:"worker-2"}}),
      /REATTESTATION_WORKER_ID_MISMATCH/
    );
  } finally { await rm(f.dir,{recursive:true,force:true}); }
});

test("replacement reopens readiness gate with new attestation hash", async () => {
  const f=await fixture();
  try {
    const old=attestation();
    await initializeDurableWorkerReadinessV1(f.path,{EXECUTION_ID:"exec-1",WORKER_READY_ATTESTATION:old},T0);
    await reconcileWorkerReadinessExpiryV1(f.path,{EXPECTED_STATE_VERSION:0,IDEMPOTENCY_KEY:"expire-1",RUNTIME_NOW_MS:T2});
    const fresh=attestation("att-2",T2+1000,T2+120_000);
    const r=await replaceExpiredWorkerReadyAttestationV1(f.path,{EXPECTED_STATE_VERSION:1,IDEMPOTENCY_KEY:"replace-1",RUNTIME_NOW_MS:T2+1000,WORKER_READY_ATTESTATION:fresh});
    assert.equal(r.state.READINESS_STATUS,"READY");
    assert.equal(r.state.REATTESTATION_REQUIRED,false);
    assert.equal(r.state.EXECUTION_GATE_OPEN,true);
    assert.equal(r.state.REPLACEMENT_COUNT,1);
    assert.notEqual(r.state.ATTESTATION_HASH,computeWorkerReadyAttestationHashV1(old));
  } finally { await rm(f.dir,{recursive:true,force:true}); }
});

test("old one-shot session is not silently rebound after reattestation", async () => {
  const f=await fixture();
  try {
    const old=attestation();
    const oldHash=computeWorkerReadyAttestationHashV1(old);
    await initializeDurableWorkerReadinessV1(f.path,{EXECUTION_ID:"exec-1",WORKER_READY_ATTESTATION:old},T0);
    await reconcileWorkerReadinessExpiryV1(f.path,{EXPECTED_STATE_VERSION:0,IDEMPOTENCY_KEY:"expire-1",RUNTIME_NOW_MS:T2});
    const fresh=attestation("att-2",T2+1000,T2+120_000);
    const r=await replaceExpiredWorkerReadyAttestationV1(f.path,{EXPECTED_STATE_VERSION:1,IDEMPOTENCY_KEY:"replace-1",RUNTIME_NOW_MS:T2+1000,WORKER_READY_ATTESTATION:fresh});
    const oldSession={WORKER_ID:"worker-1",EXECUTION_PLAN_HASH:PLAN,WORKER_READY_ATTESTATION_HASH:oldHash};
    assert.deepEqual(validateSessionReadinessBindingV1(oldSession,r.state,T2+2000),{ok:false,code:"SESSION_ATTESTATION_HASH_MISMATCH"});
  } finally { await rm(f.dir,{recursive:true,force:true}); }
});

test("new session binding may bind the replacement attestation", async () => {
  const f=await fixture();
  try {
    await initializeDurableWorkerReadinessV1(f.path,{EXECUTION_ID:"exec-1",WORKER_READY_ATTESTATION:attestation()},T0);
    await reconcileWorkerReadinessExpiryV1(f.path,{EXPECTED_STATE_VERSION:0,IDEMPOTENCY_KEY:"expire-1",RUNTIME_NOW_MS:T2});
    const fresh=attestation("att-2",T2+1000,T2+120_000);
    const r=await replaceExpiredWorkerReadyAttestationV1(f.path,{EXPECTED_STATE_VERSION:1,IDEMPOTENCY_KEY:"replace-1",RUNTIME_NOW_MS:T2+1000,WORKER_READY_ATTESTATION:fresh});
    const newSession={WORKER_ID:"worker-1",EXECUTION_PLAN_HASH:PLAN,WORKER_READY_ATTESTATION_HASH:r.state.ATTESTATION_HASH};
    assert.deepEqual(validateSessionReadinessBindingV1(newSession,r.state,T2+2000),{ok:true,code:"SESSION_READINESS_BINDING_CURRENT"});
  } finally { await rm(f.dir,{recursive:true,force:true}); }
});

test("replacement does not issue attempt lease or fence identity", async () => {
  const f=await fixture();
  try {
    await initializeDurableWorkerReadinessV1(f.path,{EXECUTION_ID:"exec-1",WORKER_READY_ATTESTATION:attestation()},T0);
    await reconcileWorkerReadinessExpiryV1(f.path,{EXPECTED_STATE_VERSION:0,IDEMPOTENCY_KEY:"expire-1",RUNTIME_NOW_MS:T2});
    const fresh=attestation("att-2",T2+1000,T2+120_000);
    const r=await replaceExpiredWorkerReadyAttestationV1(f.path,{EXPECTED_STATE_VERSION:1,IDEMPOTENCY_KEY:"replace-1",RUNTIME_NOW_MS:T2+1000,WORKER_READY_ATTESTATION:fresh});
    for (const key of ["ATTEMPT_ID","LEASE_GENERATION","FENCE_TOKEN","FENCE_SEQUENCE"]) assert.equal(Object.hasOwn(r.state,key),false);
  } finally { await rm(f.dir,{recursive:true,force:true}); }
});

test("tampered durable event hash is rejected after reopen", async () => {
  const f=await fixture();
  try {
    await initializeDurableWorkerReadinessV1(f.path,{EXECUTION_ID:"exec-1",WORKER_READY_ATTESTATION:attestation()},T0);
    const raw=JSON.parse(await readFile(f.path,"utf8"));
    raw.EVENT_LEDGER[0].EVENT_SHA256="0".repeat(64);
    await import("node:fs/promises").then(({writeFile})=>writeFile(f.path,`${JSON.stringify(raw,null,2)}\n`,"utf8"));
    await assert.rejects(readDurableWorkerReadinessV1(f.path),/READINESS_EVENT_HASH_MISMATCH/);
  } finally { await rm(f.dir,{recursive:true,force:true}); }
});
