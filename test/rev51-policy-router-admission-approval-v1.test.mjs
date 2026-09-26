import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  claimApprovedMutationV1,
  consumeApprovedMutationV1,
  evaluateBackendCandidateV1,
  invalidateApprovalForPlanDriftV1,
  markApprovedMutationOutcomeUnknownV1,
  reserveAggregateAdmissionV1,
  routeExecutionDeterministicallyV1,
  runReadOnlyExecutionPreflightV1,
  validateOperatorInteractionPolicyV1,
  validatePlanCurrentV1,
  validatePreTriggerReadinessV1,
  validateVerifierSeparationV1
} from "../runtime/rev51/policy-router-admission-approval-v1.mjs";
import { initializeDurableExecutionStateV1 } from "../runtime/rev51/durable-execution-state-v1.mjs";
import { initializeDurableAdmissionBudgetV1 } from "../runtime/rev51/durable-admission-budget-cancellation-v1.mjs";
import { initializeDurableWorkerReadinessV1 } from "../runtime/rev51/readiness-expiry-reconciliation-v1.mjs";

const TASK="1".repeat(64);
const INTENT="2".repeat(64);
const PLAN="3".repeat(64);
const VERIFIER="4".repeat(64);
const T0=Date.parse("2026-09-26T00:00:00.000Z");

function contract(){
  return {
    TASK_CONTRACT_HASH:TASK,
    CAPABILITY_REQUIREMENTS:["SOURCE_READ","PROCESS_EXEC"],
    RESOURCE_REQUIREMENTS:{EXECUTION_CLASS:"SELF_HOSTED_REQUIRED"}
  };
}
function intent(){
  return {
    TASK_CONTRACT_SHA256:TASK,
    INTENT_SHA256:INTENT,
    VERIFIER_POLICY_REF:{ID:"vp",VERSION:"1.0.0",SHA256:VERIFIER},
    OPERATOR_POLICY:"ZERO_TOUCH_AFTER_APPROVAL"
  };
}
function a6(){
  return {
    TASK_CONTRACT_SHA256:TASK,
    EXECUTION_INTENT_SHA256:INTENT,
    EXECUTION_CLASS:"SELF_HOSTED_REQUIRED"
  };
}
function backend(id,priority,extra={}){
  return {
    BACKEND_ID:id,
    ROUTER_PRIORITY:priority,
    EXECUTION_CLASS_REALIZATION:"SELF_HOSTED",
    CAPABILITIES:["SOURCE_READ","PROCESS_EXEC"],
    VERIFIER_POLICY_SHA256S:[VERIFIER],
    READY:true,
    EXECUTION_TRANSPORT_READY:true,
    ...extra
  };
}
function grant(){
  return {
    STATE:"AVAILABLE",
    PLAN_HASH:PLAN,
    ALLOWED_EFFECT_CLASSES:["REMOTE_PROVIDER_MUTATION"],
    ALLOWED_SCOPE:["provider:test"]
  };
}
function operation(){
  return {
    PLAN_HASH:PLAN,
    EFFECT_CLASS:"REMOTE_PROVIDER_MUTATION",
    SCOPE:"provider:test",
    OPERATION_ID:"op-1",
    IDEMPOTENCY_KEY:"idem-1"
  };
}

test("router selects deterministically by priority then backend id",()=>{
  const r=routeExecutionDeterministicallyV1({
    taskContract:contract(),executionIntent:intent(),a6Intent:a6(),
    candidates:[backend("z",2),backend("b",1),backend("a",1)]
  });
  assert.equal(r.ok,true);
  assert.equal(r.selected.BACKEND_ID,"a");
  assert.equal(r.ROUTER_POLICY,"DETERMINISTIC_PRIORITY_THEN_BACKEND_ID");
});

test("router capability mismatch fails closed with reason code",()=>{
  const r=evaluateBackendCandidateV1({
    candidate:backend("x",1,{CAPABILITIES:["SOURCE_READ"]}),
    capabilityRequirements:["SOURCE_READ","PROCESS_EXEC"],
    executionClass:"SELF_HOSTED_REQUIRED",
    verifierPolicySha256:VERIFIER
  });
  assert.equal(r.ok,false);
  assert.ok(r.reasons.includes("CAPABILITY_MISMATCH"));
});

test("hard execution class cannot silently downgrade",()=>{
  const r=evaluateBackendCandidateV1({
    candidate:backend("hosted",1,{EXECUTION_CLASS_REALIZATION:"HOSTED"}),
    capabilityRequirements:["SOURCE_READ","PROCESS_EXEC"],
    executionClass:"SELF_HOSTED_REQUIRED",
    verifierPolicySha256:VERIFIER
  });
  assert.equal(r.ok,false);
  assert.ok(r.reasons.includes("EXECUTION_CLASS_MISMATCH"));
});

test("verifier policy stays exact and separate from backend and transport",()=>{
  const good=backend("self-1",1);
  assert.equal(validateVerifierSeparationV1({executionIntent:intent(),selectedBackend:good,executionTransport:"DIRECT_WORKER"}).ok,true);
  assert.equal(validateVerifierSeparationV1({executionIntent:intent(),selectedBackend:{...good,VERIFIER_POLICY_SHA256S:["5".repeat(64)]},executionTransport:"DIRECT_WORKER"}).ok,false);
});

test("preflight is read-only and expired attestation blocks",()=>{
  const base={
    EXECUTION_PLAN_HASH:PLAN,
    READY_ATTESTATION_VALID:true,
    SOURCE_IDENTITY_EXACT:true,
    EXECUTION_PLAN_VALID:true,
    APPROVAL_VALID:true,
    BUDGET_RESERVATION_VALID:true,
    VERIFIER_POLICY_EXACT:true,
    EXECUTION_TRANSPORT_READY:true,
    WORKER_READY_ATTESTATION:{
      ATTESTATION_STATE:"READY",WORKER_ID:"worker-1",EXECUTION_PLAN_HASH:PLAN,
      EXPIRES_AT:new Date(T0+60_000).toISOString()
    }
  };
  const pass=runReadOnlyExecutionPreflightV1(base,T0);
  assert.equal(pass.ok,true);
  assert.equal(pass.EFFECT,"READ_ONLY");
  assert.equal(pass.MUTATION_PERFORMED,false);
  assert.equal(runReadOnlyExecutionPreflightV1(base,T0+60_000).ok,false);
});

test("manual fallback is recovery-only",()=>{
  assert.equal(validateOperatorInteractionPolicyV1({operatorPolicy:"ZERO_TOUCH_AFTER_APPROVAL",interactionClass:"RECOVERY_MUTATION",manualFallbackRequested:true}).ok,false);
  assert.equal(validateOperatorInteractionPolicyV1({operatorPolicy:"RECOVERY_INTERACTION_ALLOWED",interactionClass:"RECOVERY_MUTATION",manualFallbackRequested:true}).code,"MANUAL_FALLBACK_RECOVERY_ALLOWED");
});

test("plan drift invalidates approval rather than silently proceeding",()=>{
  assert.equal(validatePlanCurrentV1({approvedPlanHash:PLAN,currentPlanHash:PLAN}).ok,true);
  const r=invalidateApprovalForPlanDriftV1(grant(),{currentPlanHash:"9".repeat(64)});
  assert.equal(r.ok,true);
  assert.equal(r.grant.STATE,"INVALID");
  assert.equal(r.grant.INVALID_REASON,"PLAN_HASH_DRIFT");
});

test("approval grant is atomic claim then consume",()=>{
  const c=claimApprovedMutationV1(grant(),operation());
  assert.equal(c.ok,true);
  assert.equal(c.grant.STATE,"CLAIMED");
  const done=consumeApprovedMutationV1(c.grant,operation());
  assert.equal(done.ok,true);
  assert.equal(done.grant.STATE,"CONSUMED");
});

test("OUTCOME_UNKNOWN keeps claimed approval reconciliation-only",()=>{
  const c=claimApprovedMutationV1(grant(),operation());
  const u=markApprovedMutationOutcomeUnknownV1(c.grant,operation());
  assert.equal(u.ok,true);
  assert.equal(u.grant.STATE,"CLAIMED");
  assert.equal(u.grant.OUTCOME,"OUTCOME_UNKNOWN");
});

test("pre-trigger readiness uses authoritative runtime time and TTL",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"r51-p3-ready-"));
  const path=join(dir,"readiness.json");
  try{
    const s=await initializeDurableWorkerReadinessV1(path,{
      EXECUTION_ID:"exec-1",
      WORKER_READY_ATTESTATION:{
        ATTESTATION_ID:"att-1",WORKER_ID:"worker-1",EXECUTION_PLAN_HASH:PLAN,
        ATTESTATION_STATE:"READY",ISSUED_AT:new Date(T0).toISOString(),EXPIRES_AT:new Date(T0+60_000).toISOString()
      }
    },T0);
    assert.equal(validatePreTriggerReadinessV1(s,T0+1).ok,true);
    assert.equal(validatePreTriggerReadinessV1(s,T0+60_000).ok,false);
  }finally{await rm(dir,{recursive:true,force:true})}
});

test("aggregate budget reservation delegates to durable admission and binds fence",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"r51-p3-budget-"));
  const statePath=join(dir,"state.json"),admissionPath=join(dir,"admission.json");
  try{
    await initializeDurableExecutionStateV1(statePath,{
      EXECUTION_ID:"exec-1",EXECUTION_EPOCH:1,ATTEMPT_ID:"attempt-1",LEASE_GENERATION:1,
      FENCE_SEQUENCE:1,FENCE_TOKEN:"fence-1",DESIRED_STATE:"RUNNING",MATERIALIZED_STATE:"READY",PROVIDER_OPERATION_STATE:"PENDING"
    },T0);
    await initializeDurableAdmissionBudgetV1(admissionPath,{
      TASK_CONTRACT_SHA256:TASK,EXECUTION_INTENT_SHA256:INTENT,EXECUTION_PLAN_SHA256:PLAN,
      ECONOMY_BUDGET:{MAX_EXECUTIONS:1,MAX_RETRIES:0,MAX_REPAIRS:0,MAX_PARALLELISM:1},
      BUDGET_INTENT:{MAX_RUNTIME_SECONDS:60,MAX_COST_MICRO_USD:100}
    },T0);
    const r=await reserveAggregateAdmissionV1(admissionPath,statePath,{
      EXPECTED_ADMISSION_STATE_VERSION:0,EXPECTED_EXECUTION_STATE_VERSION:0,EXECUTION_ID:"exec-1",
      SUBMITTED_FENCE_TOKEN:"fence-1",IDEMPOTENCY_KEY:"reserve-1",RESERVATION_ID:"reservation-1",
      KIND:"EXECUTION",RUNTIME_SECONDS:30,COST_MICRO_USD:50,RUNTIME_NOW_MS:T0+1000
    });
    assert.equal(r.store.TOTAL_EXECUTIONS_RESERVED,1);
    assert.equal(r.store.RESERVATIONS["reservation-1"].FENCE_TOKEN,"fence-1");
  }finally{await rm(dir,{recursive:true,force:true})}
});
