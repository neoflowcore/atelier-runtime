import {
  claimApprovalGrant,
  confirmApprovalSuccess,
  invalidateApprovalGrant,
  markApprovalOutcomeUnknown
} from "./approval-grant-v1.mjs";
import {
  reserveAdmissionBudgetV1,
  deriveAdmissionBudgetProjectionV1,
  validateDurableAdmissionBudgetV1
} from "./durable-admission-budget-cancellation-v1.mjs";
import {
  validateExecutionGateAgainstReadinessV1
} from "./readiness-expiry-reconciliation-v1.mjs";
import {
  operatorInteractionEffect,
  validateExecutionPreflight
} from "./zero-touch-preflight-v1.mjs";
import {
  deriveA6ExecutionClassProjectionV1
} from "./pilote-parallelism-execution-class-consumer-v1.mjs";

export const P3_POLICY_VERSION="1.0.0";
export const P3_ROUTER_POLICY="DETERMINISTIC_PRIORITY_THEN_BACKEND_ID";
export const P3_VERIFIER_SEPARATION_POLICY="EXACT_POLICY_HASH_INDEPENDENT_OF_PROVIDER_AND_TRANSPORT";
export const P3_PREFLIGHT_EFFECT="READ_ONLY";
export const P3_MANUAL_FALLBACK_POLICY="RECOVERY_ONLY";
export const P3_PLAN_DRIFT_POLICY="INVALIDATE_APPROVAL";
export const P3_PRETRIGGER_READINESS_POLICY="REVALIDATE_AT_AUTHORITATIVE_TIME";
export const P3_REASON_CODES=Object.freeze([
  "ROUTE_SELECTED",
  "ROUTER_NO_CANDIDATE",
  "BACKEND_NOT_READY",
  "EXECUTION_TRANSPORT_NOT_READY",
  "CAPABILITY_MISMATCH",
  "EXECUTION_CLASS_MISMATCH",
  "VERIFIER_POLICY_MISMATCH",
  "PREFLIGHT_PASS_READ_ONLY",
  "PREFLIGHT_BLOCKED",
  "MANUAL_FALLBACK_DENIED_NORMAL_PATH",
  "MANUAL_FALLBACK_RECOVERY_ALLOWED",
  "PLAN_CURRENT",
  "PLAN_INVALIDATED",
  "READY_PRETRIGGER_VALID",
  "READY_PRETRIGGER_BLOCKED"
]);

const SHA256_RE=/^[0-9a-f]{64}$/;

function object(v){return !!v&&typeof v==="object"&&!Array.isArray(v)}
function nonempty(v){return typeof v==="string"&&v.length>0}
function uniqueStrings(v){return Array.isArray(v)&&v.every(nonempty)&&new Set(v).size===v.length}

function requiredExecutionClass(executionClass){
  const p=deriveA6ExecutionClassProjectionV1(executionClass);
  return p.CONSTRAINT_KIND==="HARD_REQUIREMENT"?p.REQUIRED_CLASS:null;
}

function candidateValidation(candidate){
  const errors=[];
  if(!object(candidate))return["BACKEND_CANDIDATE_REQUIRED"];
  if(!nonempty(candidate.BACKEND_ID))errors.push("BACKEND_ID_REQUIRED");
  if(!Number.isSafeInteger(candidate.ROUTER_PRIORITY)||candidate.ROUTER_PRIORITY<0)errors.push("ROUTER_PRIORITY_INVALID");
  if(!["HOSTED","SELF_HOSTED","HOST_LOCAL"].includes(candidate.EXECUTION_CLASS_REALIZATION))errors.push("EXECUTION_CLASS_REALIZATION_INVALID");
  if(!uniqueStrings(candidate.CAPABILITIES))errors.push("BACKEND_CAPABILITIES_INVALID");
  if(!Array.isArray(candidate.VERIFIER_POLICY_SHA256S)||candidate.VERIFIER_POLICY_SHA256S.some(x=>!SHA256_RE.test(x)))errors.push("BACKEND_VERIFIER_POLICY_SET_INVALID");
  if(typeof candidate.READY!=="boolean")errors.push("BACKEND_READY_INVALID");
  if(typeof candidate.EXECUTION_TRANSPORT_READY!=="boolean")errors.push("EXECUTION_TRANSPORT_READY_INVALID");
  return errors;
}

export function evaluateBackendCandidateV1({candidate,capabilityRequirements,executionClass,verifierPolicySha256}={}){
  const reasons=candidateValidation(candidate);
  if(!uniqueStrings(capabilityRequirements))reasons.push("CAPABILITY_REQUIREMENTS_INVALID");
  if(!SHA256_RE.test(verifierPolicySha256??""))reasons.push("VERIFIER_POLICY_SHA256_INVALID");
  let requiredClass=null;
  try{requiredClass=requiredExecutionClass(executionClass)}catch{reasons.push("EXECUTION_CLASS_INVALID")}
  if(reasons.length)return{ok:false,reasons};

  if(candidate.READY!==true)reasons.push("BACKEND_NOT_READY");
  if(candidate.EXECUTION_TRANSPORT_READY!==true)reasons.push("EXECUTION_TRANSPORT_NOT_READY");

  const available=new Set(candidate.CAPABILITIES);
  if(capabilityRequirements.some(x=>!available.has(x)))reasons.push("CAPABILITY_MISMATCH");
  if(requiredClass!==null&&candidate.EXECUTION_CLASS_REALIZATION!==requiredClass)reasons.push("EXECUTION_CLASS_MISMATCH");
  if(!candidate.VERIFIER_POLICY_SHA256S.includes(verifierPolicySha256))reasons.push("VERIFIER_POLICY_MISMATCH");

  return{ok:reasons.length===0,reasons};
}

export function routeExecutionDeterministicallyV1({taskContract,executionIntent,a6Intent,candidates}={}){
  const errors=[];
  if(!object(taskContract))errors.push("TASK_CONTRACT_REQUIRED");
  if(!object(executionIntent))errors.push("EXECUTION_INTENT_REQUIRED");
  if(!object(a6Intent))errors.push("A6_INTENT_REQUIRED");
  if(!Array.isArray(candidates)||candidates.length===0)errors.push("BACKEND_CANDIDATES_REQUIRED");
  if(errors.length)return{ok:false,code:"ROUTER_NO_CANDIDATE",errors,selected:null,evaluations:[]};

  if(executionIntent.TASK_CONTRACT_SHA256!==taskContract.TASK_CONTRACT_HASH)errors.push("EXECUTION_INTENT_TASK_BINDING_MISMATCH");
  if(a6Intent.TASK_CONTRACT_SHA256!==taskContract.TASK_CONTRACT_HASH)errors.push("A6_TASK_BINDING_MISMATCH");
  if(a6Intent.EXECUTION_INTENT_SHA256!==executionIntent.INTENT_SHA256)errors.push("A6_EXECUTION_INTENT_BINDING_MISMATCH");
  if(a6Intent.EXECUTION_CLASS!==taskContract.RESOURCE_REQUIREMENTS?.EXECUTION_CLASS)errors.push("A6_EXECUTION_CLASS_BINDING_MISMATCH");
  if(errors.length)return{ok:false,code:"ROUTER_NO_CANDIDATE",errors,selected:null,evaluations:[]};

  const verifierSha=executionIntent.VERIFIER_POLICY_REF?.SHA256;
  const requirements=taskContract.CAPABILITY_REQUIREMENTS;
  const executionClass=a6Intent.EXECUTION_CLASS;

  const evaluations=candidates.map(candidate=>({
    BACKEND_ID:candidate?.BACKEND_ID??null,
    ROUTER_PRIORITY:candidate?.ROUTER_PRIORITY??null,
    ...evaluateBackendCandidateV1({
      candidate,
      capabilityRequirements:requirements,
      executionClass,
      verifierPolicySha256:verifierSha
    })
  }));

  const eligible=candidates
    .map((candidate,index)=>({candidate,evaluation:evaluations[index]}))
    .filter(x=>x.evaluation.ok)
    .sort((a,b)=>a.candidate.ROUTER_PRIORITY-b.candidate.ROUTER_PRIORITY||a.candidate.BACKEND_ID.localeCompare(b.candidate.BACKEND_ID));

  if(eligible.length===0)return{ok:false,code:"ROUTER_NO_CANDIDATE",errors:[],selected:null,evaluations};

  const selected=structuredClone(eligible[0].candidate);
  return{
    ok:true,
    code:"ROUTE_SELECTED",
    errors:[],
    selected,
    evaluations,
    ROUTER_POLICY:P3_ROUTER_POLICY,
    VERIFIER_POLICY_SHA256:verifierSha,
    PROVIDER_SELECTION_OWNERSHIP:"RUNTIME"
  };
}

export function validateVerifierSeparationV1({executionIntent,selectedBackend,executionTransport}={}){
  const errors=[];
  const sha=executionIntent?.VERIFIER_POLICY_REF?.SHA256;
  if(!SHA256_RE.test(sha??""))errors.push("VERIFIER_POLICY_SHA256_INVALID");
  if(!object(selectedBackend))errors.push("SELECTED_BACKEND_REQUIRED");
  else if(!selectedBackend.VERIFIER_POLICY_SHA256S?.includes(sha))errors.push("VERIFIER_POLICY_MISMATCH");
  if(!nonempty(executionTransport))errors.push("EXECUTION_TRANSPORT_REQUIRED");
  if(selectedBackend?.BACKEND_ID===sha||executionTransport===sha)errors.push("VERIFIER_IDENTITY_MUST_BE_SEPARATE");
  return{ok:errors.length===0,errors,policy:P3_VERIFIER_SEPARATION_POLICY};
}

export function runReadOnlyExecutionPreflightV1(preflight,runtimeNowMs){
  const result=validateExecutionPreflight({...structuredClone(preflight),GATE_TRIGGERED:false},runtimeNowMs);
  return{
    ok:result.ok,
    code:result.ok?"PREFLIGHT_PASS_READ_ONLY":"PREFLIGHT_BLOCKED",
    errors:result.errors,
    EFFECT:P3_PREFLIGHT_EFFECT,
    MUTATION_PERFORMED:false
  };
}

export async function reserveAggregateAdmissionV1(admissionPath,executionStatePath,request){
  return reserveAdmissionBudgetV1(admissionPath,executionStatePath,request);
}

export function validateAggregateAdmissionStateV1(store){
  const valid=validateDurableAdmissionBudgetV1(store);
  if(!valid.ok)return{ok:false,errors:valid.errors,projection:null};
  return{ok:true,errors:[],projection:deriveAdmissionBudgetProjectionV1(store)};
}

export function validateOperatorInteractionPolicyV1({operatorPolicy,interactionClass,manualFallbackRequested=false}={}){
  const effect=operatorInteractionEffect(interactionClass);
  if(!effect.ok)return{ok:false,code:effect.code,effect:null};
  if(manualFallbackRequested!==true)return{ok:true,code:"NO_MANUAL_FALLBACK",effect};
  if(operatorPolicy==="RECOVERY_INTERACTION_ALLOWED"&&interactionClass==="RECOVERY_MUTATION"){
    return{ok:true,code:"MANUAL_FALLBACK_RECOVERY_ALLOWED",effect,policy:P3_MANUAL_FALLBACK_POLICY};
  }
  return{ok:false,code:"MANUAL_FALLBACK_DENIED_NORMAL_PATH",effect,policy:P3_MANUAL_FALLBACK_POLICY};
}

export function validatePlanCurrentV1({approvedPlanHash,currentPlanHash,planInvalidated=false}={}){
  if(!SHA256_RE.test(approvedPlanHash??"")||!SHA256_RE.test(currentPlanHash??""))return{ok:false,code:"PLAN_INVALIDATED",reason:"PLAN_HASH_INVALID"};
  if(planInvalidated===true)return{ok:false,code:"PLAN_INVALIDATED",reason:"PLAN_EXPLICITLY_INVALIDATED"};
  if(approvedPlanHash!==currentPlanHash)return{ok:false,code:"PLAN_INVALIDATED",reason:"PLAN_HASH_DRIFT"};
  return{ok:true,code:"PLAN_CURRENT",reason:null};
}

export function invalidateApprovalForPlanDriftV1(grant,{currentPlanHash,planInvalidated=false}={}){
  const current=validatePlanCurrentV1({approvedPlanHash:grant?.PLAN_HASH,currentPlanHash,planInvalidated});
  if(current.ok)return{ok:true,code:"PLAN_CURRENT",grant:structuredClone(grant)};
  const invalidated=invalidateApprovalGrant(grant,current.reason);
  return{...invalidated,plan:current};
}

export function validatePreTriggerReadinessV1(readinessState,runtimeNowMs){
  const result=validateExecutionGateAgainstReadinessV1(readinessState,runtimeNowMs);
  return{
    ok:result.ok,
    code:result.ok?"READY_PRETRIGGER_VALID":"READY_PRETRIGGER_BLOCKED",
    reason:result.code,
    policy:P3_PRETRIGGER_READINESS_POLICY
  };
}

export function claimApprovedMutationV1(grant,operation){
  return claimApprovalGrant(grant,operation);
}
export function consumeApprovedMutationV1(grant,operation){
  return confirmApprovalSuccess(grant,operation);
}
export function markApprovedMutationOutcomeUnknownV1(grant,operation){
  return markApprovalOutcomeUnknown(grant,operation);
}

export function validateP3CompositePolicyV1(input){
  const errors=[];
  const route=routeExecutionDeterministicallyV1(input);
  if(!route.ok)errors.push("ROUTER:"+route.code);

  let verifier={ok:false,errors:["ROUTE_NOT_SELECTED"]};
  if(route.ok){
    verifier=validateVerifierSeparationV1({
      executionIntent:input.executionIntent,
      selectedBackend:route.selected,
      executionTransport:input.executionTransport
    });
    if(!verifier.ok)errors.push(...verifier.errors.map(x=>"VERIFIER:"+x));
  }

  const readiness=validatePreTriggerReadinessV1(input.readinessState,input.runtimeNowMs);
  if(!readiness.ok)errors.push("READINESS:"+readiness.reason);

  const plan=validatePlanCurrentV1({
    approvedPlanHash:input.approvalGrant?.PLAN_HASH,
    currentPlanHash:input.currentPlanHash,
    planInvalidated:input.planInvalidated
  });
  if(!plan.ok)errors.push("PLAN:"+plan.reason);

  const operator=validateOperatorInteractionPolicyV1({
    operatorPolicy:input.executionIntent?.OPERATOR_POLICY,
    interactionClass:input.interactionClass??"OBSERVE_ONLY",
    manualFallbackRequested:input.manualFallbackRequested??false
  });
  if(!operator.ok)errors.push("OPERATOR:"+operator.code);

  return{
    ok:errors.length===0,
    errors,
    route,
    verifier,
    readiness,
    plan,
    operator,
    P3_POLICY_VERSION
  };
}
