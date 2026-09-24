import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  initializeDurableWorkerIsolationBoundaryV1,
  claimWorkerIsolationBoundaryV1,
  invalidateWorkerIsolationBoundaryV1,
  readDurableWorkerIsolationBoundaryV1,
  validateWorkerIsolationBoundaryV1
} from "../runtime/rev51/durable-worker-isolation-boundary-v1.mjs";

const H=(c)=>c.repeat(64);
const baseInitial=()=>({
  EXECUTION_ID:"exec-1", ATTEMPT_ID:"attempt-1", FENCE_TOKEN:"fence-1",
  WORKER_ID:"worker-1", WORKER_JOB_SHA256:H("a"), WORKER_READY_ATTESTATION_HASH:H("b"), ISOLATION_PROFILE_SHA256:H("c"),
  WORKER_PRIVILEGED:false, HOST_MOUNT_GRANTED:false, HOST_SECRET_INHERITED:false,
  PERSISTENT_WORKER:true, UNTRUSTED_CODE_ON_PERSISTENT_WORKER:false
});
const claimReq=(over={})=>({
  EXPECTED_STATE_VERSION:0, IDEMPOTENCY_KEY:"claim-1", RUNTIME_NOW_MS:2000,
  SUBMITTED_FENCE_TOKEN:"fence-1", WORKER_ID:"worker-1", WORKER_READY_ATTESTATION_HASH:H("b"), ISOLATION_PROFILE_SHA256:H("c"),
  OPERATION_ID:"launch-op-1", OPERATION_IDEMPOTENCY_KEY:"launch-idem-1", ...over
});
async function fixture(){
  const dir=await mkdtemp(join(tmpdir(),"r51-p2p-"));
  const state=join(dir,"execution.json"), launch=join(dir,"launch.json"), iso=join(dir,"isolation.json");
  await writeFile(state,JSON.stringify({EXECUTION_ID:"exec-1",ATTEMPT_ID:"attempt-1",FENCE_TOKEN:"fence-1"})+"\n");
  await writeFile(launch,JSON.stringify({WORKER_JOB_SHA256:H("a"),EXECUTION_ID:"exec-1",ATTEMPT_ID:"attempt-1",FENCE_TOKEN:"fence-1",LAUNCH_STATUS:"AVAILABLE"})+"\n");
  return {dir,state,launch,iso};
}

async function init(over={}){ const f=await fixture(); const s=await initializeDurableWorkerIsolationBoundaryV1(f.iso,f.state,f.launch,{...baseInitial(),...over},1000); return {f,s}; }
async function rejectsCode(fn, code){ await assert.rejects(fn,(e)=>e?.message===code); }

test("01 initialize valid durable isolation boundary", async()=>{ const {s}=await init(); assert.equal(s.ISOLATION_STATUS,"AVAILABLE"); assert.equal(validateWorkerIsolationBoundaryV1(s).ok,true); });
test("02 privileged worker denied", async()=>{ const f=await fixture(); await rejectsCode(()=>initializeDurableWorkerIsolationBoundaryV1(f.iso,f.state,f.launch,{...baseInitial(),WORKER_PRIVILEGED:true},1000),"PRIVILEGED_WORKER_DENY_DEFAULT"); });
test("03 host mount denied", async()=>{ const f=await fixture(); await rejectsCode(()=>initializeDurableWorkerIsolationBoundaryV1(f.iso,f.state,f.launch,{...baseInitial(),HOST_MOUNT_GRANTED:true},1000),"HOST_MOUNT_DENY_DEFAULT"); });
test("04 host secret inheritance denied", async()=>{ const f=await fixture(); await rejectsCode(()=>initializeDurableWorkerIsolationBoundaryV1(f.iso,f.state,f.launch,{...baseInitial(),HOST_SECRET_INHERITED:true},1000),"HOST_SECRET_INHERITANCE_DENIED"); });
test("05 untrusted code on persistent worker denied", async()=>{ const f=await fixture(); await rejectsCode(()=>initializeDurableWorkerIsolationBoundaryV1(f.iso,f.state,f.launch,{...baseInitial(),UNTRUSTED_CODE_ON_PERSISTENT_WORKER:true},1000),"UNTRUSTED_CODE_ON_PERSISTENT_WORKER_DENIED"); });
test("06 stale fence denied at initialization", async()=>{ const f=await fixture(); await rejectsCode(()=>initializeDurableWorkerIsolationBoundaryV1(f.iso,f.state,f.launch,{...baseInitial(),FENCE_TOKEN:"stale"},1000),"STALE_FENCE_REJECTED"); });
test("07 successful exactly-once claim", async()=>{ const {f}=await init(); const r=await claimWorkerIsolationBoundaryV1(f.iso,f.state,f.launch,claimReq()); assert.equal(r.state.ISOLATION_STATUS,"CLAIMED"); assert.equal(r.replay,false); });
test("08 exact idempotent replay", async()=>{ const {f}=await init(); await claimWorkerIsolationBoundaryV1(f.iso,f.state,f.launch,claimReq()); const r=await claimWorkerIsolationBoundaryV1(f.iso,f.state,f.launch,claimReq({RUNTIME_NOW_MS:3000})); assert.equal(r.replay,true); });
test("09 changed replay denied", async()=>{ const {f}=await init(); await claimWorkerIsolationBoundaryV1(f.iso,f.state,f.launch,claimReq()); await rejectsCode(()=>claimWorkerIsolationBoundaryV1(f.iso,f.state,f.launch,claimReq({RUNTIME_NOW_MS:3000,OPERATION_ID:"changed"})),"ISOLATION_IDEMPOTENCY_KEY_CONFLICT"); });
test("10 second claim denied", async()=>{ const {f}=await init(); await claimWorkerIsolationBoundaryV1(f.iso,f.state,f.launch,claimReq()); await rejectsCode(()=>claimWorkerIsolationBoundaryV1(f.iso,f.state,f.launch,claimReq({IDEMPOTENCY_KEY:"claim-2",OPERATION_ID:"launch-op-2",OPERATION_IDEMPOTENCY_KEY:"launch-idem-2",EXPECTED_STATE_VERSION:1})),"WORKER_ISOLATION_BOUNDARY_NOT_AVAILABLE"); });
test("11 stale execution fence denied after registration", async()=>{ const {f}=await init(); await writeFile(f.state,JSON.stringify({EXECUTION_ID:"exec-1",ATTEMPT_ID:"attempt-2",FENCE_TOKEN:"fence-2"})+"\n"); await rejectsCode(()=>claimWorkerIsolationBoundaryV1(f.iso,f.state,f.launch,claimReq()),"STALE_FENCE_REJECTED"); });
test("12 launch no longer available denies isolation claim", async()=>{ const {f}=await init(); await writeFile(f.launch,JSON.stringify({WORKER_JOB_SHA256:H("a"),EXECUTION_ID:"exec-1",ATTEMPT_ID:"attempt-1",FENCE_TOKEN:"fence-1",LAUNCH_STATUS:"CLAIMED"})+"\n"); await rejectsCode(()=>claimWorkerIsolationBoundaryV1(f.iso,f.state,f.launch,claimReq()),"ISOLATION_REQUIRES_AVAILABLE_LAUNCH"); });
test("13 worker binding mismatch denied", async()=>{ const {f}=await init(); await rejectsCode(()=>claimWorkerIsolationBoundaryV1(f.iso,f.state,f.launch,claimReq({WORKER_ID:"worker-2"})),"ISOLATION_WORKER_BINDING_MISMATCH"); });
test("14 readiness attestation mismatch denied", async()=>{ const {f}=await init(); await rejectsCode(()=>claimWorkerIsolationBoundaryV1(f.iso,f.state,f.launch,claimReq({WORKER_READY_ATTESTATION_HASH:H("d")})),"ISOLATION_ATTESTATION_BINDING_MISMATCH"); });
test("15 isolation profile mismatch denied", async()=>{ const {f}=await init(); await rejectsCode(()=>claimWorkerIsolationBoundaryV1(f.iso,f.state,f.launch,claimReq({ISOLATION_PROFILE_SHA256:H("d")})),"ISOLATION_PROFILE_BINDING_MISMATCH"); });
test("16 available boundary can be invalidated and then not claimed", async()=>{ const {f}=await init(); const r=await invalidateWorkerIsolationBoundaryV1(f.iso,{EXPECTED_STATE_VERSION:0,IDEMPOTENCY_KEY:"inv-1",RUNTIME_NOW_MS:2000,REASON:"TRUST_RESET"}); assert.equal(r.state.ISOLATION_STATUS,"INVALID"); await rejectsCode(()=>claimWorkerIsolationBoundaryV1(f.iso,f.state,f.launch,claimReq({EXPECTED_STATE_VERSION:1,IDEMPOTENCY_KEY:"claim-after-invalid"})),"WORKER_ISOLATION_BOUNDARY_NOT_AVAILABLE"); });
test("17 claimed boundary can be invalidated on policy drift", async()=>{ const {f}=await init(); await claimWorkerIsolationBoundaryV1(f.iso,f.state,f.launch,claimReq()); const r=await invalidateWorkerIsolationBoundaryV1(f.iso,{EXPECTED_STATE_VERSION:1,IDEMPOTENCY_KEY:"inv-2",RUNTIME_NOW_MS:3000,REASON:"POLICY_DRIFT"}); assert.equal(r.state.ISOLATION_STATUS,"INVALID"); await rejectsCode(()=>claimWorkerIsolationBoundaryV1(f.iso,f.state,f.launch,claimReq({EXPECTED_STATE_VERSION:2,RUNTIME_NOW_MS:4000,IDEMPOTENCY_KEY:"claim-after-invalid",OPERATION_ID:"launch-op-2",OPERATION_IDEMPOTENCY_KEY:"launch-idem-2"})),"WORKER_ISOLATION_BOUNDARY_NOT_AVAILABLE"); });
test("18 invalidated boundary blocks old exact replay", async()=>{ const {f}=await init(); await claimWorkerIsolationBoundaryV1(f.iso,f.state,f.launch,claimReq()); await invalidateWorkerIsolationBoundaryV1(f.iso,{EXPECTED_STATE_VERSION:1,IDEMPOTENCY_KEY:"inv-old-replay",RUNTIME_NOW_MS:3000,REASON:"TRUST_RESET"}); await rejectsCode(()=>claimWorkerIsolationBoundaryV1(f.iso,f.state,f.launch,claimReq({RUNTIME_NOW_MS:4000})),"WORKER_ISOLATION_BOUNDARY_NOT_AVAILABLE"); });
test("19 exact replay survives launch state progress", async()=>{ const {f}=await init(); await claimWorkerIsolationBoundaryV1(f.iso,f.state,f.launch,claimReq()); await writeFile(f.launch,JSON.stringify({WORKER_JOB_SHA256:H("a"),EXECUTION_ID:"exec-1",ATTEMPT_ID:"attempt-1",FENCE_TOKEN:"fence-1",LAUNCH_STATUS:"STARTED"})+"\n"); const r=await claimWorkerIsolationBoundaryV1(f.iso,f.state,f.launch,claimReq({RUNTIME_NOW_MS:4000})); assert.equal(r.replay,true); });
test("20 crash reopen and event tamper detection", async()=>{ const {f}=await init(); await claimWorkerIsolationBoundaryV1(f.iso,f.state,f.launch,claimReq()); const reopened=await readDurableWorkerIsolationBoundaryV1(f.iso); assert.equal(reopened.ISOLATION_STATUS,"CLAIMED"); const raw=JSON.parse(await readFile(f.iso,"utf8")); raw.EVENT_LEDGER[1].PAYLOAD.WORKER_ID="tampered"; await writeFile(f.iso,JSON.stringify(raw)+"\n"); await rejectsCode(()=>readDurableWorkerIsolationBoundaryV1(f.iso),"ISOLATION_EVENT_HASH_MISMATCH"); });
