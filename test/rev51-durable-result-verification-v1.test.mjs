import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { computeRev51ObjectHash } from "../runtime/rev51/contract-core.mjs";
import { A3_AUTHORITATIVE_BINDING } from "../runtime/rev51/pilote-verifier-acceptance-consumer-v1.mjs";
import {
  initializeDurableExecutionStateV1
} from "../runtime/rev51/durable-execution-state-v1.mjs";
import {
  claimWorkerJobLaunchV1,
  initializeDurableWorkerJobLaunchV1
} from "../runtime/rev51/durable-worker-job-launch-v1.mjs";
import {
  beginExecutionTransportActivationV1,
  initializeDurableExecutionTransportV1,
  recordExecutionTransportActivationResultV1,
  recordExecutionTransportConformanceV1
} from "../runtime/rev51/durable-execution-transport-v1.mjs";
import {
  commitDurableResultCollectionV1
} from "../runtime/rev51/durable-result-collection-v1.mjs";
import {
  buildDurableResultAcceptanceRequestFromVerificationV1,
  commitDurableResultVerificationV1,
  readDurableResultVerificationV1,
  validateDurableResultVerificationV1
} from "../runtime/rev51/durable-result-verification-v1.mjs";
import { commitDurableResultAcceptanceV1 } from "../runtime/rev51/durable-result-acceptance-v1.mjs";

const T0 = Date.parse("2026-09-24T12:00:00.000Z");
const H2 = "2".repeat(64), H3 = "3".repeat(64), H4 = "4".repeat(64);
const CONTRACT_SET_SHA256 = A3_AUTHORITATIVE_BINDING.CONTRACT_SET_SHA256;

function policyRuntime() {
  return {
    POLICY_TYPE:"PILOTE_VERIFIER_POLICY_V1",
    POLICY_VERSION:"1.0.0",
    CANONICALIZATION_ID:"ATELIER_EXECUTION_CANONICAL_JSON_V1",
    VERIFIER_POLICY_ID:"verifier.runtime.required",
    VERIFIER_POLICY_VERSION:"1.0.0",
    VERIFIER_POLICY:"RUNTIME_REQUIRED",
    ACCEPTANCE_REQUIREMENT_REF:"task-contract:ACCEPTANCE_REQUIREMENTS",
    RUNTIME_DEFINED_ACCEPTANCE_SEMANTICS:"DENY",
    RUNTIME_DEFINED_TOLERANCE:"DENY",
    RAW_WORKER_SUCCESS_DIRECT_ACCEPTANCE:"DENY",
    CONTRACT_SET_REF:{ID:"ATELIER_REV51_CONTRACT_SET_V1",VERSION:"1.0.0",SHA256:CONTRACT_SET_SHA256},
    VERIFIER_POLICY_SHA256:"3e1640da42dd97a43cd66e6ccaea0af6eb647a66c4eea7f48f47d40a67b2d569"
  };
}
function policyProjectCi() {
  return {
    POLICY_TYPE:"PILOTE_VERIFIER_POLICY_V1",
    POLICY_VERSION:"1.0.0",
    CANONICALIZATION_ID:"ATELIER_EXECUTION_CANONICAL_JSON_V1",
    VERIFIER_POLICY_ID:"verifier.project-ci.required",
    VERIFIER_POLICY_VERSION:"1.0.0",
    VERIFIER_POLICY:"PROJECT_CI_REQUIRED",
    ACCEPTANCE_REQUIREMENT_REF:"project:ci-acceptance/rev51",
    RUNTIME_DEFINED_ACCEPTANCE_SEMANTICS:"DENY",
    RUNTIME_DEFINED_TOLERANCE:"DENY",
    RAW_WORKER_SUCCESS_DIRECT_ACCEPTANCE:"DENY",
    CONTRACT_SET_REF:{ID:"ATELIER_REV51_CONTRACT_SET_V1",VERSION:"1.0.0",SHA256:CONTRACT_SET_SHA256},
    VERIFIER_POLICY_SHA256:"1fa9b995c59006504a78689fc0f56c41f4b690ae453aa83265065ef3c05350c4"
  };
}
function plan(policy = policyRuntime()) {
  const value = {
    SCHEMA_ID:"RUNTIME_EXECUTION_PLAN_V1",
    SCHEMA_VERSION:"1",
    CANONICALIZATION_ID:"ATELIER_REV51_JCS_V1",
    UPSTREAM_OBJECT_SHA256:"9".repeat(64),
    OBJECT_SHA256:"0".repeat(64),
    CONTRACT_SET_SHA256,
    EXECUTION_TRANSPORT:"DIRECT_WORKER",
    VERIFIER_POLICY:policy.VERIFIER_POLICY,
    VERIFIER_POLICY_REF_SHA256:policy.VERIFIER_POLICY_SHA256,
    ACCEPTANCE_REQUIREMENT_REF:policy.ACCEPTANCE_REQUIREMENT_REF
  };
  value.OBJECT_SHA256 = computeRev51ObjectHash(value);
  return value;
}
function workerJob(p = plan()) {
  const value = {
    SCHEMA_ID:"WORKER_JOB_V1",
    SCHEMA_VERSION:"1",
    CANONICALIZATION_ID:"ATELIER_REV51_JCS_V1",
    UPSTREAM_OBJECT_SHA256:p.OBJECT_SHA256,
    OBJECT_SHA256:"0".repeat(64),
    EXECUTION_PLAN_HASH:p.OBJECT_SHA256,
    EXECUTION_ID:"exec-1",
    ATTEMPT_ID:"attempt-1",
    FENCE_TOKEN:"fence-1",
    EXECUTION_MODE:"DIRECT_REMOTE",
    ENTRYPOINT_SPEC:{schema_id:"ENTRYPOINT_SPEC_V1",executable:"node",argv:["task.mjs"],working_directory:"/workspace",environment_refs:["ENV_A"],stdin_policy:"CLOSED",timeout:60,expected_exit_codes:[0],shell_interpretation:"DENY"},
    SEMANTIC_REPLANNING:"DENY"
  };
  value.OBJECT_SHA256 = computeRev51ObjectHash(value);
  return value;
}
function artifact(id, sha) {
  return {ARTIFACT_ID:id,CONTENT_SHA256:sha,SIZE_BYTES:10,MEDIA_TYPE:"application/octet-stream",STORAGE_CLASS:"RUNTIME_LOCAL",SECURITY_DOMAIN:"DEFAULT",ORIGIN_EXECUTION_ID:"exec-1",CREATED_AT:"2026-09-24T12:00:00Z",RETENTION_CLASS:"UNTIL_FINAL_ACCEPTANCE",LOCATIONS:[`runtime://${id}`],ARTIFACT_STATE:"STAGING"};
}
function verification(p, w, artifacts, result = "PASS") {
  const pass = result === "PASS";
  return {
    VERIFICATION_RESULT:result,
    EXECUTION_ID:w.EXECUTION_ID,
    ATTEMPT_ID:w.ATTEMPT_ID,
    FENCE_TOKEN:w.FENCE_TOKEN,
    WORKER_JOB_HASH:w.OBJECT_SHA256,
    EXECUTION_PLAN_HASH:p.OBJECT_SHA256,
    CONTENT_VERIFIED:pass,
    FENCE_VERIFIED:true,
    WORKER_JOB_VERIFIED:true,
    EXECUTION_PLAN_VERIFIED:true,
    SECURITY_OUTPUT_CONTRACT_VERIFIED:true,
    ARTIFACT_CONTENT_BINDINGS:artifacts.map((a)=>({ARTIFACT_ID:a.ARTIFACT_ID,CONTENT_SHA256:a.CONTENT_SHA256}))
  };
}

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "r51-p2s-"));
  const statePath=join(dir,"execution.json"), launchPath=join(dir,"launch.json"), transportPath=join(dir,"transport.json"), collectionPath=join(dir,"collection.json"), verificationPath=join(dir,"verification.json"), acceptancePath=join(dir,"acceptance.json");
  const policy = policyRuntime(), p = plan(policy), w = workerJob(p);
  const staging = [artifact("artifact-b","b".repeat(64)),artifact("artifact-a","a".repeat(64))];
  await initializeDurableExecutionStateV1(statePath,{EXECUTION_ID:"exec-1",EXECUTION_EPOCH:1,ATTEMPT_ID:"attempt-1",LEASE_GENERATION:1,FENCE_SEQUENCE:1,FENCE_TOKEN:"fence-1",DESIRED_STATE:"RUNNING",MATERIALIZED_STATE:"READY",PROVIDER_OPERATION_STATE:"SUCCEEDED"},T0);
  await initializeDurableWorkerJobLaunchV1(launchPath,statePath,w,T0+1);
  const transport0=await initializeDurableExecutionTransportV1(transportPath,statePath,launchPath,{EXECUTION_TRANSPORT:"DIRECT_WORKER",WORKER_ID:"worker-1"},T0+2);
  const ready=(await recordExecutionTransportConformanceV1(transportPath,{EXPECTED_STATE_VERSION:transport0.STATE_VERSION,IDEMPOTENCY_KEY:"conf-1",RUNTIME_NOW_MS:T0+3,CONFORMANCE_RESULT:"PASS",CONFORMANCE_EVIDENCE_SHA256:H3})).state;
  await claimWorkerJobLaunchV1(launchPath,statePath,{EXPECTED_STATE_VERSION:0,IDEMPOTENCY_KEY:"launch-1",SUBMITTED_FENCE_TOKEN:"fence-1",RUNTIME_NOW_MS:T0+4,OPERATION_ID:"launch-op",OPERATION_IDEMPOTENCY_KEY:"launch-remote"});
  const claimed=(await beginExecutionTransportActivationV1(transportPath,statePath,launchPath,{EXPECTED_STATE_VERSION:ready.STATE_VERSION,IDEMPOTENCY_KEY:"activate-1",SUBMITTED_FENCE_TOKEN:"fence-1",RUNTIME_NOW_MS:T0+5,OPERATION_ID:"transport-op",OPERATION_IDEMPOTENCY_KEY:"transport-remote"})).state;
  const active=(await recordExecutionTransportActivationResultV1(transportPath,{EXPECTED_STATE_VERSION:claimed.STATE_VERSION,IDEMPOTENCY_KEY:"activate-result-1",RUNTIME_NOW_MS:T0+6,OPERATION_ID:"transport-op",OPERATION_IDEMPOTENCY_KEY:"transport-remote",RESULT:"PASS",EVIDENCE_SHA256:H3})).state;
  const collection=(await commitDurableResultCollectionV1(statePath,transportPath,collectionPath,{IDEMPOTENCY_KEY:"collect-1",EXPECTED_STATE_VERSION:0,EXPECTED_EXECUTION_EPOCH:1,EXPECTED_LEASE_GENERATION:1,SUBMITTED_FENCE_TOKEN:"fence-1",EXPECTED_TRANSPORT_STATE_VERSION:active.STATE_VERSION,WORKER_ID:"worker-1",WORKER_JOB_SHA256:w.OBJECT_SHA256,RESULT_EVIDENCE_SHA256:H2,STAGING_ARTIFACTS:staging,RUNTIME_NOW_MS:T0+7})).collection;
  return {dir,statePath,launchPath,transportPath,collectionPath,verificationPath,acceptancePath,collection,policy,p,w,staging};
}
function request(f, result="PASS", overrides={}) {
  return {IDEMPOTENCY_KEY:"verify-1",RUNTIME_NOW_MS:T0+8,PLAN:f.p,WORKER_JOB:f.w,PILOTE_VERIFIER_POLICY:f.policy,VERIFIER_EVIDENCE_SHA256:H4,VERIFICATION:verification(f.p,f.w,f.collection.QUARANTINED_ARTIFACTS,result),...overrides};
}
async function cleanup(f){await rm(f.dir,{recursive:true,force:true});}

test("PASS result is durably sealed against exact P2R collection and A3 policy", async()=>{const f=await fixture();try{const r=await commitDurableResultVerificationV1(f.collectionPath,f.verificationPath,request(f));assert.equal(r.replay,false);assert.equal(r.verification.VERIFICATION_RESULT,"PASS");assert.equal(r.verification.COLLECTION_RECORD_SHA256,f.collection.COLLECTION_RECORD_SHA256);assert.equal(r.verification.VERIFIER_POLICY_REF_SHA256,f.policy.VERIFIER_POLICY_SHA256);assert.deepEqual(validateDurableResultVerificationV1(r.verification),{ok:true,errors:[]});assert.deepEqual(await readDurableResultVerificationV1(f.verificationPath),r.verification);}finally{await cleanup(f);}});

test("same durable verification request replays exactly", async()=>{const f=await fixture();try{const q=request(f),a=await commitDurableResultVerificationV1(f.collectionPath,f.verificationPath,q),b=await commitDurableResultVerificationV1(f.collectionPath,f.verificationPath,q);assert.equal(b.replay,true);assert.deepEqual(b.verification,a.verification);}finally{await cleanup(f);}});

test("changed request under same key and second verification key are denied", async()=>{const f=await fixture();try{await commitDurableResultVerificationV1(f.collectionPath,f.verificationPath,request(f));await assert.rejects(commitDurableResultVerificationV1(f.collectionPath,f.verificationPath,request(f,"PASS",{VERIFIER_EVIDENCE_SHA256:H3})),/IDEMPOTENCY_KEY_CONFLICT/);await assert.rejects(commitDurableResultVerificationV1(f.collectionPath,f.verificationPath,request(f,"PASS",{IDEMPOTENCY_KEY:"verify-2"})),/ALREADY_VERIFIED/);}finally{await cleanup(f);}});

for (const result of ["FAIL","BLOCKED"]) test(`${result} is durable terminal verification but cannot enter P2F acceptance`,async()=>{const f=await fixture();try{const out=await commitDurableResultVerificationV1(f.collectionPath,f.verificationPath,request(f,result));assert.equal(out.verification.VERIFICATION_RESULT,result);assert.throws(()=>buildDurableResultAcceptanceRequestFromVerificationV1(f.collection,out.verification,{IDEMPOTENCY_KEY:"accept-1",RUNTIME_NOW_MS:T0+9,PLAN:f.p,WORKER_JOB:f.w}),/REQUIRES_DURABLE_VERIFICATION_PASS/);}finally{await cleanup(f);}});

test("valid alternate A3 policy cannot drift from the Runtime plan binding",async()=>{const f=await fixture();try{await assert.rejects(commitDurableResultVerificationV1(f.collectionPath,f.verificationPath,request(f,"PASS",{PILOTE_VERIFIER_POLICY:policyProjectCi()})),/PLAN_POLICY_MODE_MISMATCH/);}finally{await cleanup(f);}});

test("tampered A3 policy is rejected before durable verification",async()=>{const f=await fixture();try{const bad={...f.policy,RAW_WORKER_SUCCESS_DIRECT_ACCEPTANCE:"ALLOW"};await assert.rejects(commitDurableResultVerificationV1(f.collectionPath,f.verificationPath,request(f,"PASS",{PILOTE_VERIFIER_POLICY:bad})),/PILOTE_POLICY_INVALID/);}finally{await cleanup(f);}});

test("verification lineage and PASS checks are fail-closed",async()=>{const f=await fixture();try{const badFence=verification(f.p,f.w,f.collection.QUARANTINED_ARTIFACTS);badFence.FENCE_TOKEN="stale";await assert.rejects(commitDurableResultVerificationV1(f.collectionPath,f.verificationPath,request(f,"PASS",{VERIFICATION:badFence})),/FENCE_TOKEN_MISMATCH/);const badCheck=verification(f.p,f.w,f.collection.QUARANTINED_ARTIFACTS);badCheck.SECURITY_OUTPUT_CONTRACT_VERIFIED=false;await assert.rejects(commitDurableResultVerificationV1(f.collectionPath,f.verificationPath,request(f,"PASS",{IDEMPOTENCY_KEY:"verify-check",VERIFICATION:badCheck})),/PASS_CHECK_FAILED:SECURITY_OUTPUT_CONTRACT_VERIFIED/);}finally{await cleanup(f);}});

test("PASS artifact content bindings must exactly match quarantined collection",async()=>{const f=await fixture();try{const bad=verification(f.p,f.w,f.collection.QUARANTINED_ARTIFACTS);bad.ARTIFACT_CONTENT_BINDINGS[0].CONTENT_SHA256="c".repeat(64);await assert.rejects(commitDurableResultVerificationV1(f.collectionPath,f.verificationPath,request(f,"PASS",{VERIFICATION:bad})),/ARTIFACT_CONTENT_BINDING_MISMATCH/);}finally{await cleanup(f);}});

test("raw credential or provider material is forbidden from verification request",async()=>{const f=await fixture();try{await assert.rejects(commitDurableResultVerificationV1(f.collectionPath,f.verificationPath,request(f,"PASS",{CREDENTIAL_VALUE:"secret"})),/FORBIDDEN_RESULT_VERIFICATION_MATERIAL/);}finally{await cleanup(f);}});

test("verification record tamper is detected on reopen",async()=>{const f=await fixture();try{await commitDurableResultVerificationV1(f.collectionPath,f.verificationPath,request(f));const raw=JSON.parse(await readFile(f.verificationPath,"utf8"));raw.VERIFIER_EVIDENCE_SHA256=H3;await writeFile(f.verificationPath,`${JSON.stringify(raw,null,2)}\n`);await assert.rejects(readDurableResultVerificationV1(f.verificationPath),/RECORD_HASH_MISMATCH/);}finally{await cleanup(f);}});

test("collection journal tamper and collection lock both fail closed",async()=>{const f=await fixture();try{const raw=JSON.parse(await readFile(f.collectionPath,"utf8"));raw.WORKER_ID="tampered";await writeFile(f.collectionPath,`${JSON.stringify(raw,null,2)}\n`);await assert.rejects(commitDurableResultVerificationV1(f.collectionPath,f.verificationPath,request(f)),/COLLECTION_RECORD_HASH_MISMATCH/);}finally{await cleanup(f);}const g=await fixture();try{await writeFile(`${g.collectionPath}.lock`,`busy\n`);await assert.rejects(commitDurableResultVerificationV1(g.collectionPath,g.verificationPath,request(g)),/COLLECTION_LOCKED_FOR_VERIFICATION/);}finally{await cleanup(g);}});

test("durable PASS verification bridges into existing P2F atomic acceptance",async()=>{const f=await fixture();try{const vr=(await commitDurableResultVerificationV1(f.collectionPath,f.verificationPath,request(f))).verification;const acceptanceRequest=buildDurableResultAcceptanceRequestFromVerificationV1(f.collection,vr,{IDEMPOTENCY_KEY:"accept-1",RUNTIME_NOW_MS:T0+9,PLAN:f.p,WORKER_JOB:f.w});const accepted=await commitDurableResultAcceptanceV1(f.statePath,f.acceptancePath,acceptanceRequest);assert.equal(accepted.acceptance.ACCEPTANCE_STATE,"ACCEPTED");assert.equal(accepted.acceptance.EXECUTION_RECEIPT.VERIFICATION_RESULT,"PASS");assert.deepEqual(accepted.acceptance.EXECUTION_RECEIPT.ACCEPTED_ARTIFACT_IDS,["artifact-a","artifact-b"]);}finally{await cleanup(f);}});
