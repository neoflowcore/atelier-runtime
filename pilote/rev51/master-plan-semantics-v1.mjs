import { createHash } from "node:crypto";

export const FROZEN_RUNTIME_INTERFACE_IDENTITY_SHA256 = "39e686591f169e62416726518d1e6917a8ed3cded43b284e2d3a2216c546548b";
export const FROZEN_RUNTIME_COMPATIBILITY_IDENTITY_SHA256 = "35cbae1c4a6d42b27a45e5faeba37fe3a86a319c6944a9eb046482dea3e59dec";
export const FROZEN_RUNTIME_CONTRACT_SET_SHA256 = "d72564952b8a57b8f494306e882817f366e8f14b8c6baf367a37fb16015412fa";

const SHA=/^[0-9a-f]{64}$/;
const CONTINUE=new Set(["ㅇㅇ","dd","continue","resume","reattach","ㅈㄱ"]);
const STRICT=new Set(["ㄹㄹ","ff"]);
const FORCE=new Set(["ㅈㅈ","ww"]);
const STOP_DECISIONS=new Set(["STOP_PROJECT_COMPLETE","STOP_GLOBAL_HARD_BOUNDARY","STOP_NO_GLOBAL_LEGAL_NEXT_ACTION","STOP_USER_REQUESTED","PAUSE_CHANNEL_INTERRUPTED"]);
const NONSTOP_DECISIONS=new Set(["CONTINUE","ADVANCE_PHASE","DEFER_LOCAL_BLOCKER_AND_CONTINUE","ENTER_PROJECT_AUTH_ENDGAME"]);
const REAL_GLOBAL_BOUNDARIES=new Set([
  "SCOPE_EXPANSION_OUTSIDE_APPROVED_MASTER_PLAN","NEW_COST_CAP_OR_PAID_RESOURCE_AUTHORITY","IRREVERSIBLE_DESTRUCTIVE_PRODUCTION_AUTHORITY",
  "FINAL_RELEASE_MERGE_AUTHORITY_REQUIRED","SEMANTIC_CONTRACT_DRIFT","UNRECONCILABLE_HIGH_RISK_UNKNOWN","PROJECT_END_AGGREGATED_AUTH_BOUNDARY",
  "ALL_APPROVED_LEGAL_WORK_EXHAUSTED","CHANNEL_CAPACITY_CHECKPOINT_PAUSE","USER_EXPLICIT_STOP"
]);
const LOCAL_NON_BOUNDARIES=new Set(["PHASE_COMPLETE","CURRENT_PHASE_EXHAUSTED","PR_WAIT","CI_PASS","COMMIT_CREATED","RECEIPT_CREATED","DEVELOPMENT_CREDENTIAL_ABSENCE","LOCAL_PROVIDER_BLOCKER","BENIGN_DRIFT"]);

const obj=v=>!!v&&typeof v==="object"&&!Array.isArray(v);
function canon(v){if(v===null)return"null";if(typeof v==="string"||typeof v==="boolean")return JSON.stringify(v);if(typeof v==="number"){if(!Number.isSafeInteger(v))throw Error("PILOTE_NON_SAFE_INTEGER");return JSON.stringify(v)}if(Array.isArray(v))return`[${v.map(canon).join(",")}]`;if(obj(v))return`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`;throw Error("PILOTE_UNSUPPORTED_CANONICAL_TYPE")}
const hash=v=>createHash("sha256").update(canon(v),"utf8").digest("hex");
const req=(v,c)=>{if(typeof v!=="string"||!v)throw Error(c);return v};
const sha=(v,c)=>{if(!SHA.test(v??""))throw Error(c);return v};
function sorted(v,c){if(!Array.isArray(v)||v.some(x=>typeof x!=="string"||!x))throw Error(c);return[...new Set(v)].sort()}

export function validateFrozenRuntimeInterfaceV1(input={}){
  const errors=[];
  if(input.runtimeInterfaceIdentitySha256!==FROZEN_RUNTIME_INTERFACE_IDENTITY_SHA256)errors.push("RUNTIME_INTERFACE_IDENTITY_MISMATCH");
  if(input.runtimeCompatibilityIdentitySha256!==FROZEN_RUNTIME_COMPATIBILITY_IDENTITY_SHA256)errors.push("RUNTIME_COMPATIBILITY_IDENTITY_MISMATCH");
  if(input.runtimeContractSetSha256!==FROZEN_RUNTIME_CONTRACT_SET_SHA256)errors.push("RUNTIME_CONTRACT_SET_IDENTITY_MISMATCH");
  return Object.freeze({ok:errors.length===0,errors});
}

export function normalizePiloteAliasV1(value){
  if(typeof value!=="string")return Object.freeze({matched:false,alias:null,operation:null,mode:null});
  const alias=value.trim().toLowerCase();
  if(CONTINUE.has(alias))return Object.freeze({matched:true,alias,operation:"UNIVERSAL_CONTINUE_RESUME_REATTACH",mode:"CONTINUE"});
  if(STRICT.has(alias))return Object.freeze({matched:true,alias,operation:"STRICT_MASTER_PLAN_ONE_SHOT",mode:"CONTINUE"});
  if(FORCE.has(alias))return Object.freeze({matched:true,alias,operation:"FORCE_REATTACH_DIAGNOSTIC_RESUME",mode:"CONTINUE"});
  return Object.freeze({matched:false,alias,operation:null,mode:null});
}

export function compileMasterPlanSemanticContractV1(input={}){
  const runtime=validateFrozenRuntimeInterfaceV1(input);if(!runtime.ok)throw Error(runtime.errors.join("|"));
  const body={
    SCHEMA_ID:"PILOTE_MASTER_PLAN_SEMANTIC_CONTRACT_V1",SCHEMA_VERSION:"1",
    PROJECT_ID:req(input.projectId,"PROJECT_ID_REQUIRED"),MASTER_PLAN_ID:req(input.masterPlanId,"MASTER_PLAN_ID_REQUIRED"),
    MASTER_PLAN_MANIFEST_SHA256:sha(input.masterPlanManifestSha256,"MASTER_PLAN_MANIFEST_SHA256_REQUIRED"),
    MASTER_PLAN_EXECUTION_GRANT_SHA256:sha(input.masterPlanExecutionGrantSha256,"MASTER_PLAN_EXECUTION_GRANT_SHA256_REQUIRED"),
    RUNTIME_INTERFACE_IDENTITY_SHA256:FROZEN_RUNTIME_INTERFACE_IDENTITY_SHA256,
    RUNTIME_COMPATIBILITY_IDENTITY_SHA256:FROZEN_RUNTIME_COMPATIBILITY_IDENTITY_SHA256,
    RUNTIME_CONTRACT_SET_SHA256:FROZEN_RUNTIME_CONTRACT_SET_SHA256,
    LONGRUN_EXECUTION_UNIT:"APPROVED_FULL_MASTER_PLAN",PHASE_ROLE:"CHECKPOINT_BRANCH_LOCAL_ACCEPTANCE_NODE",
    PHASE_COMPLETE_STOP_PERMISSION:false,CURRENT_PHASE_EXHAUSTION_STOP_PERMISSION:false,DEVELOPMENT_AUTH_STOP_PERMISSION:false,
    AUTO_PHASE_TRANSITION:true,GLOBAL_BLOCKER_BYPASS:true,FINAL_RESPONSE_REQUIRES_RUNTIME_STOP_DECISION:true
  };
  return Object.freeze({...body,SEMANTIC_CONTRACT_SHA256:hash(body)});
}

export function compilePhaseRunContractV1(input={}){
  const body={SCHEMA_ID:"PHASE_RUN_CONTRACT_V1",SCHEMA_VERSION:"1",PHASE_ID:req(input.phaseId,"PHASE_ID_REQUIRED"),
    MASTER_PLAN_SEMANTIC_CONTRACT_SHA256:sha(input.masterPlanSemanticContractSha256,"MASTER_PLAN_SEMANTIC_CONTRACT_SHA256_REQUIRED"),
    DEVELOPMENT_BRANCH:req(input.developmentBranch,"DEVELOPMENT_BRANCH_REQUIRED"),BRANCH_LIFETIME:"MASTER_PLAN_RUN_PERSISTENT_COMPATIBLE",
    INTERMEDIATE_MERGE:"DENY",WORK_UNIT_MERGE:"DENY",FINAL_PHASE_MERGE:"POLICY_GATED",PHASE_COMPLETE_BEHAVIOR:"CHECKPOINT_THEN_RESOLVE_GLOBAL_NEXT",
    CREDENTIAL_TIMING:"DEFER_EXTERNAL_AUTH_UNTIL_PROJECT_DEVELOPMENT_COMPLETE",NEW_CHAT_BEHAVIOR:"REATTACH_SAME_MASTER_PLAN_RUN"};
  return Object.freeze({...body,PHASE_RUN_CONTRACT_SHA256:hash(body)});
}

export function compileContinuationPolicyV1(input={}){
  const body={SCHEMA_ID:"PILOTE_CONTINUATION_POLICY_V1",SCHEMA_VERSION:"1",MASTER_PLAN_SEMANTIC_CONTRACT_SHA256:sha(input.masterPlanSemanticContractSha256,"MASTER_PLAN_SEMANTIC_CONTRACT_SHA256_REQUIRED"),
    PROJECT_REMAINING_WORK:input.projectRemainingWork===true,ALTERNATE_LEGAL_ACTION_SEARCH:"REQUIRED",LOCAL_BLOCKER_BEHAVIOR:"DEFER_AND_CONTINUE_IF_ALTERNATE_EXISTS",
    PHASE_COMPLETE_BEHAVIOR:"ADVANCE_OR_CONTINUE",DEVELOPMENT_CREDENTIAL_BEHAVIOR:"DEFER_TO_PROJECT_END_AUTH",FINAL_RESPONSE_POLICY:"ALLOW_ONLY_RUNTIME_STOP_DECISION"};
  return Object.freeze({...body,CONTINUATION_POLICY_SHA256:hash(body)});
}

export function bindPhaseExecutionGrantContinuationV1({grant,phaseRunContract,continuationPolicy}={}){
  const errors=[];
  if(!obj(grant)||!["PHASE_EXECUTION_GRANT_V2","MASTER_PLAN_EXECUTION_GRANT_V1"].includes(grant.SCHEMA_ID))errors.push("EXECUTION_GRANT_SCHEMA_UNSUPPORTED");
  if(grant?.STATE&&grant.STATE!=="ACTIVE")errors.push("ACTIVE_EXECUTION_GRANT_REQUIRED");
  if(!obj(phaseRunContract)||phaseRunContract.SCHEMA_ID!=="PHASE_RUN_CONTRACT_V1")errors.push("PHASE_RUN_CONTRACT_REQUIRED");
  if(!obj(continuationPolicy)||continuationPolicy.SCHEMA_ID!=="PILOTE_CONTINUATION_POLICY_V1")errors.push("CONTINUATION_POLICY_REQUIRED");
  return Object.freeze({ok:errors.length===0,errors,continuationBound:errors.length===0,reapprovalRequired:false});
}

export function classifyHardBoundaryV1(reason){
  if(REAL_GLOBAL_BOUNDARIES.has(reason))return Object.freeze({scope:"GLOBAL",decision:"STOP_OR_AUTH_BOUNDARY",reason});
  if(LOCAL_NON_BOUNDARIES.has(reason))return Object.freeze({scope:"LOCAL_OR_MILESTONE",decision:"CONTINUE",reason});
  return Object.freeze({scope:"UNKNOWN",decision:"FAIL_CLOSED_RECONCILE",reason});
}

export function evaluatePiloteResponseFinalizationV1(runtimeDecision={}){
  const d=runtimeDecision.decision;
  if(NONSTOP_DECISIONS.has(d))return Object.freeze({finalResponseAllowed:false,executeImmediately:true,decision:d});
  if(STOP_DECISIONS.has(d))return Object.freeze({finalResponseAllowed:true,executeImmediately:false,decision:d});
  return Object.freeze({finalResponseAllowed:false,executeImmediately:false,decision:"UNKNOWN_RUNTIME_DECISION",errors:["RUNTIME_CONTINUATION_DECISION_UNRECOGNIZED"]});
}

export function evaluateFinalMergePolicyV1(input={}){
  if(input.explicitMergeAuthority!==true)return Object.freeze({allowed:false,code:"FINAL_MERGE_AUTHORITY_REQUIRED"});
  if(input.projectFinalIntegration!==true&&input.structurallyRequiredMerge!==true)return Object.freeze({allowed:false,code:"INTERMEDIATE_MERGE_SUPPRESSED"});
  return Object.freeze({allowed:true,code:"FINAL_OR_STRUCTURAL_MERGE_ALLOWED"});
}

export function compileGrantLifecycleV1(input={}){
  const body={SCHEMA_ID:"PILOTE_GRANT_LIFECYCLE_V1",SCHEMA_VERSION:"1",GRANT_ID:req(input.grantId,"GRANT_ID_REQUIRED"),STATE:input.state??"ACTIVE",PERSIST_ACROSS_CHAT:true,AUTO_RENEW:false,REVOKE_REQUIRES_EXPLICIT_REASON:true};
  if(!["ACTIVE","SUSPENDED","REVOKED","CONSUMED"].includes(body.STATE))throw Error("GRANT_STATE_INVALID");
  return Object.freeze({...body,GRANT_LIFECYCLE_SHA256:hash(body)});
}

export function revokeGrantV1(lifecycle,reason){if(!obj(lifecycle)||lifecycle.SCHEMA_ID!=="PILOTE_GRANT_LIFECYCLE_V1")throw Error("GRANT_LIFECYCLE_REQUIRED");req(reason,"REVOKE_REASON_REQUIRED");return compileGrantLifecycleV1({grantId:lifecycle.GRANT_ID,state:"REVOKED"});}
