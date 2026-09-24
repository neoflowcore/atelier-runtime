import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  claimWorkerJobLaunchV1,
  initializeDurableWorkerJobLaunchV1,
  readDurableWorkerJobLaunchV1,
  recordWorkerJobLaunchResultV1,
  reconcileWorkerJobLaunchV1,
  validateDurableWorkerJobLaunchV1
} from "../runtime/rev51/durable-worker-job-launch-v1.mjs";
import {
  advanceExecutionFenceV1,
  initializeDurableExecutionStateV1
} from "../runtime/rev51/durable-execution-state-v1.mjs";

const T0=Date.parse("2026-09-24T00:00:00.000Z");
const JOB_SHA="a".repeat(64), EVIDENCE="b".repeat(64);
async function fx(){const dir=await mkdtemp(join(tmpdir(),"r51-p2o-"));const executionPath=join(dir,"execution.json"),launchPath=join(dir,"launch.json");const execution=await initializeDurableExecutionStateV1(executionPath,{EXECUTION_ID:"exec-1",EXECUTION_EPOCH:1,ATTEMPT_ID:"attempt-1",LEASE_GENERATION:1,FENCE_SEQUENCE:1,FENCE_TOKEN:"fence-1",DESIRED_STATE:"RUNNING",MATERIALIZED_STATE:"READY",PROVIDER_OPERATION_STATE:"PENDING"},T0);return{dir,executionPath,launchPath,execution}}
function job(overrides={}){return{SCHEMA_ID:"WORKER_JOB_V1",OBJECT_SHA256:JOB_SHA,EXECUTION_ID:"exec-1",ATTEMPT_ID:"attempt-1",FENCE_TOKEN:"fence-1",SEMANTIC_REPLANNING:"DENY",ENTRYPOINT_SPEC:{schema_id:"ENTRYPOINT_SPEC_V1",executable:"node",argv:["task.mjs"],working_directory:"/workspace",environment_refs:["ENV_A"],stdin_policy:"CLOSED",timeout:60,expected_exit_codes:[0],shell_interpretation:"DENY"},...overrides}}
async function init(f,j=job()){return initializeDurableWorkerJobLaunchV1(f.launchPath,f.executionPath,j,T0)}
function claim(overrides={}){return{EXPECTED_STATE_VERSION:0,IDEMPOTENCY_KEY:"claim-1",OPERATION_ID:"launch-op-1",OPERATION_IDEMPOTENCY_KEY:"remote-launch-1",SUBMITTED_FENCE_TOKEN:"fence-1",RUNTIME_NOW_MS:T0+1000,...overrides}}
function result(overrides={}){return{EXPECTED_STATE_VERSION:1,IDEMPOTENCY_KEY:"result-1",OPERATION_ID:"launch-op-1",OPERATION_IDEMPOTENCY_KEY:"remote-launch-1",RESULT:"PASS",EVIDENCE_SHA256:EVIDENCE,RUNTIME_NOW_MS:T0+2000,...overrides}}
function reconcile(overrides={}){return{EXPECTED_STATE_VERSION:2,IDEMPOTENCY_KEY:"reconcile-1",OPERATION_ID:"launch-op-1",OPERATION_IDEMPOTENCY_KEY:"remote-launch-1",RECONCILED_RESULT:"PASS",EVIDENCE_SHA256:EVIDENCE,RUNTIME_NOW_MS:T0+3000,...overrides}}

test("registers structured shell-free entrypoint against current lineage",async()=>{const f=await fx();try{const s=await init(f);assert.equal(s.LAUNCH_STATUS,"AVAILABLE");assert.equal(s.WORKER_JOB_SHA256,JOB_SHA);assert.deepEqual(validateDurableWorkerJobLaunchV1(s),{ok:true,errors:[]})}finally{await rm(f.dir,{recursive:true,force:true})}});
test("shell field is denied before durable registration",async()=>{const f=await fx();try{const j=job();j.ENTRYPOINT_SPEC.shell="bash";await assert.rejects(init(f,j),/SHELL_ENTRYPOINT_FIELD_DENY/)}finally{await rm(f.dir,{recursive:true,force:true})}});
test("semantic replanning is denied",async()=>{const f=await fx();try{await assert.rejects(init(f,job({SEMANTIC_REPLANNING:"ALLOW"})),/SEMANTIC_REPLANNING_DENIED/)}finally{await rm(f.dir,{recursive:true,force:true})}});
test("worker job lineage must equal current execution state",async()=>{const f=await fx();try{await assert.rejects(init(f,job({ATTEMPT_ID:"attempt-old"})),/LINEAGE_MISMATCH/)}finally{await rm(f.dir,{recursive:true,force:true})}});
test("claim requires current fence",async()=>{const f=await fx();try{await init(f);const r=await claimWorkerJobLaunchV1(f.launchPath,f.executionPath,claim());assert.equal(r.launch.LAUNCH_STATUS,"CLAIMED")}finally{await rm(f.dir,{recursive:true,force:true})}});
test("stale submitted fence denies launch",async()=>{const f=await fx();try{await init(f);await assert.rejects(claimWorkerJobLaunchV1(f.launchPath,f.executionPath,claim({SUBMITTED_FENCE_TOKEN:"old"})),/STALE_FENCE_REJECTED/)}finally{await rm(f.dir,{recursive:true,force:true})}});
test("execution attempt drift denies stale launch store",async()=>{const f=await fx();try{await init(f);await advanceExecutionFenceV1(f.executionPath,{EXPECTED_STATE_VERSION:0,IDEMPOTENCY_KEY:"advance-1",SUBMITTED_FENCE_TOKEN:"fence-1",RUNTIME_NOW_MS:T0+500,NEXT_FENCE_SEQUENCE:2,NEXT_FENCE_TOKEN:"fence-2",NEXT_ATTEMPT_ID:"attempt-2",NEXT_LEASE_GENERATION:2});await assert.rejects(claimWorkerJobLaunchV1(f.launchPath,f.executionPath,claim({SUBMITTED_FENCE_TOKEN:"fence-2"})),/ATTEMPT_STALE/)}finally{await rm(f.dir,{recursive:true,force:true})}});
test("exact claim replay is idempotent",async()=>{const f=await fx();try{await init(f);const a=await claimWorkerJobLaunchV1(f.launchPath,f.executionPath,claim());const b=await claimWorkerJobLaunchV1(f.launchPath,f.executionPath,claim({RUNTIME_NOW_MS:T0+9999}));assert.equal(a.launch.STATE_VERSION,1);assert.equal(b.replay,true);assert.equal(b.launch.STATE_VERSION,1)}finally{await rm(f.dir,{recursive:true,force:true})}});
test("changed replay under same idempotency key is denied",async()=>{const f=await fx();try{await init(f);await claimWorkerJobLaunchV1(f.launchPath,f.executionPath,claim());await assert.rejects(claimWorkerJobLaunchV1(f.launchPath,f.executionPath,claim({OPERATION_ID:"other"})),/IDEMPOTENCY_KEY_CONFLICT/)}finally{await rm(f.dir,{recursive:true,force:true})}});
test("PASS starts job and prevents second launch",async()=>{const f=await fx();try{await init(f);await claimWorkerJobLaunchV1(f.launchPath,f.executionPath,claim());const r=await recordWorkerJobLaunchResultV1(f.launchPath,result());assert.equal(r.launch.LAUNCH_STATUS,"STARTED");await assert.rejects(claimWorkerJobLaunchV1(f.launchPath,f.executionPath,claim({EXPECTED_STATE_VERSION:2,IDEMPOTENCY_KEY:"claim-2",OPERATION_ID:"launch-op-2",OPERATION_IDEMPOTENCY_KEY:"remote-2"})),/NOT_AVAILABLE/)}finally{await rm(f.dir,{recursive:true,force:true})}});
test("OUTCOME_UNKNOWN permits same-operation reconcile only",async()=>{const f=await fx();try{await init(f);await claimWorkerJobLaunchV1(f.launchPath,f.executionPath,claim());const u=await recordWorkerJobLaunchResultV1(f.launchPath,result({RESULT:"OUTCOME_UNKNOWN"}));assert.equal(u.launch.LAUNCH_STATUS,"OUTCOME_UNKNOWN");await assert.rejects(claimWorkerJobLaunchV1(f.launchPath,f.executionPath,claim({EXPECTED_STATE_VERSION:2,IDEMPOTENCY_KEY:"claim-2"})),/RECONCILIATION_REQUIRED/);const r=await reconcileWorkerJobLaunchV1(f.launchPath,reconcile());assert.equal(r.launch.LAUNCH_STATUS,"STARTED")}finally{await rm(f.dir,{recursive:true,force:true})}});
test("different remote idempotency cannot reconcile unknown launch",async()=>{const f=await fx();try{await init(f);await claimWorkerJobLaunchV1(f.launchPath,f.executionPath,claim());await recordWorkerJobLaunchResultV1(f.launchPath,result({RESULT:"OUTCOME_UNKNOWN"}));await assert.rejects(reconcileWorkerJobLaunchV1(f.launchPath,reconcile({OPERATION_IDEMPOTENCY_KEY:"other"})),/SECOND_MUTATION_DENIED/)}finally{await rm(f.dir,{recursive:true,force:true})}});
test("crash reopen preserves STARTED state",async()=>{const f=await fx();try{await init(f);await claimWorkerJobLaunchV1(f.launchPath,f.executionPath,claim());await recordWorkerJobLaunchResultV1(f.launchPath,result());const s=await readDurableWorkerJobLaunchV1(f.launchPath);assert.equal(s.LAUNCH_STATUS,"STARTED");assert.equal(s.STATE_VERSION,2)}finally{await rm(f.dir,{recursive:true,force:true})}});
test("tampered event ledger is rejected",async()=>{const f=await fx();try{await init(f);const raw=JSON.parse(await readFile(f.launchPath,"utf8"));raw.EVENT_LEDGER[0].EVENT_SHA256="0".repeat(64);await writeFile(f.launchPath,`${JSON.stringify(raw,null,2)}\n`);await assert.rejects(readDurableWorkerJobLaunchV1(f.launchPath),/EVENT_HASH_MISMATCH/)}finally{await rm(f.dir,{recursive:true,force:true})}});
test("unexpected persisted shell command field is rejected by exact store shape",async()=>{const f=await fx();try{await init(f);const raw=JSON.parse(await readFile(f.launchPath,"utf8"));raw.SHELL_COMMAND="rm -rf /";await writeFile(f.launchPath,`${JSON.stringify(raw,null,2)}\n`);await assert.rejects(readDurableWorkerJobLaunchV1(f.launchPath),/STORE_FIELDS_MISMATCH/)}finally{await rm(f.dir,{recursive:true,force:true})}});
