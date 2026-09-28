import { createHash } from "node:crypto";
const SHA=/^[0-9a-f]{64}$/;const SHA40=/^[0-9a-f]{40}$/;
function obj(v){return !!v&&typeof v==="object"&&!Array.isArray(v)}
function canon(v){if(v===null)return"null";if(typeof v==="string"||typeof v==="boolean")return JSON.stringify(v);if(typeof v==="number"){if(!Number.isSafeInteger(v))throw new Error("C52_FINAL_NON_SAFE_INTEGER");return JSON.stringify(v)}if(Array.isArray(v))return`[${v.map(canon).join(",")}]`;if(obj(v))return`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`;throw new Error("C52_FINAL_UNSUPPORTED_CANONICAL_TYPE")}
const hash=v=>createHash("sha256").update(canon(v),"utf8").digest("hex");
function sh(v,c){if(!SHA.test(v??""))throw new Error(c);return v}
function h40(v,c){if(!SHA40.test(v??""))throw new Error(c);return v}
function pass(v,c){if(v!=="PASS")throw new Error(c);return v}

export function compileRev52FinalSealV1(input={}){
  const body={
    SCHEMA_ID:"ATELIER_REV52_FINAL_SEAL_V1",SCHEMA_VERSION:"1",REVISION:"5.2",
    runtimeDevelopmentSealSha256:sh(input.runtimeDevelopmentSealSha256,"RUNTIME_SEAL_SHA_REQUIRED"),
    piloteDevelopmentSealSha256:sh(input.piloteDevelopmentSealSha256,"PILOTE_SEAL_SHA_REQUIRED"),
    crossStackSyncSha256:sh(input.crossStackSyncSha256,"CROSS_STACK_SYNC_SHA_REQUIRED"),
    authClosurePreflightSha256:sh(input.authClosurePreflightSha256,"AUTH_CLOSURE_PREFLIGHT_SHA_REQUIRED"),
    finalLiveAcceptanceSha256:sh(input.finalLiveAcceptanceSha256,"FINAL_LIVE_ACCEPTANCE_SHA_REQUIRED"),
    liveExecutionHead:h40(input.liveExecutionHead,"LIVE_EXECUTION_HEAD_REQUIRED"),
    liveExecutionTree:h40(input.liveExecutionTree,"LIVE_EXECUTION_TREE_REQUIRED"),
    liveRunId:Number.isSafeInteger(input.liveRunId)&&input.liveRunId>0?input.liveRunId:(()=>{throw new Error("LIVE_RUN_ID_REQUIRED")})(),
    liveJobId:Number.isSafeInteger(input.liveJobId)&&input.liveJobId>0?input.liveJobId:(()=>{throw new Error("LIVE_JOB_ID_REQUIRED")})(),
    canonicalPreArtifactId:Number.isSafeInteger(input.canonicalPreArtifactId)?input.canonicalPreArtifactId:null,
    canonicalPreArtifactDigest:input.canonicalPreArtifactDigest??null,
    canonicalFinalArtifactId:Number.isSafeInteger(input.canonicalFinalArtifactId)?input.canonicalFinalArtifactId:null,
    canonicalFinalArtifactDigest:input.canonicalFinalArtifactDigest??null,
    RUNTIME_REV5_2:pass(input.RUNTIME_REV5_2,"RUNTIME_REV52_NOT_SEALED"),
    PILOTE_REV5_2:pass(input.PILOTE_REV5_2,"PILOTE_REV52_NOT_SEALED"),
    CROSS_STACK_COMPATIBILITY:pass(input.CROSS_STACK_COMPATIBILITY,"CROSS_STACK_NOT_PASS"),
    PROJECT_AUTH_ENDGAME:pass(input.PROJECT_AUTH_ENDGAME,"AUTH_ENDGAME_NOT_PASS"),
    FINAL_LIVE_SEAL:pass(input.FINAL_LIVE_SEAL,"FINAL_LIVE_NOT_PASS"),
    ACTION_ECONOMY:pass(input.ACTION_ECONOMY,"ACTION_ECONOMY_NOT_PASS"),
    HUMAN_INTERVENTION_KPI:pass(input.HUMAN_INTERVENTION_KPI,"HUMAN_INTERVENTION_KPI_NOT_PASS"),
    AUTH_INTERACTION_COUNT:input.AUTH_INTERACTION_COUNT,
    THIRD_PARTY_PAID_EXECUTION_NORMAL_PATH:input.THIRD_PARTY_PAID_EXECUTION_NORMAL_PATH,
    ACTIVE_PAID_COMPUTE:input.ACTIVE_PAID_COMPUTE,
    ORPHANED_BILLABLE_RESOURCE:input.ORPHANED_BILLABLE_RESOURCE,
    BILLABLE_RESIDUE:input.BILLABLE_RESIDUE,
    finalMergeReleaseAuthorityGranted:false,
    FINAL_MERGE_BOUNDARY:"FINAL_RELEASE_MERGE_AUTHORITY_REQUIRED"
  };
  if(body.AUTH_INTERACTION_COUNT!==0)throw new Error("AUTH_INTERACTION_COUNT_NOT_ZERO");
  if(body.THIRD_PARTY_PAID_EXECUTION_NORMAL_PATH!==0)throw new Error("THIRD_PARTY_PAID_EXECUTION_NORMAL_PATH_NOT_ZERO");
  if(body.ACTIVE_PAID_COMPUTE!==0||body.ORPHANED_BILLABLE_RESOURCE!==0||body.BILLABLE_RESIDUE!==0)throw new Error("BILLING_RESIDUE_NOT_ZERO");
  return Object.freeze({...body,FINAL_SEAL_SHA256:hash(body)});
}

export function validateRev52FinalSealV1(seal){
  if(!seal||seal.SCHEMA_ID!=="ATELIER_REV52_FINAL_SEAL_V1")return Object.freeze({ok:false,errors:["REV52_FINAL_SEAL_REQUIRED"]});
  const {FINAL_SEAL_SHA256,...body}=seal;const errors=[];
  if(!SHA.test(FINAL_SEAL_SHA256??"")||hash(body)!==FINAL_SEAL_SHA256)errors.push("FINAL_SEAL_DIGEST_MISMATCH");
  for(const k of ["RUNTIME_REV5_2","PILOTE_REV5_2","CROSS_STACK_COMPATIBILITY","PROJECT_AUTH_ENDGAME","FINAL_LIVE_SEAL","ACTION_ECONOMY","HUMAN_INTERVENTION_KPI"])if(seal[k]!=="PASS")errors.push(`${k}_NOT_PASS`);
  if(seal.AUTH_INTERACTION_COUNT!==0||seal.THIRD_PARTY_PAID_EXECUTION_NORMAL_PATH!==0||seal.ACTIVE_PAID_COMPUTE!==0||seal.ORPHANED_BILLABLE_RESOURCE!==0||seal.BILLABLE_RESIDUE!==0)errors.push("FINAL_ZERO_KPI_VIOLATION");
  if(seal.finalMergeReleaseAuthorityGranted!==false||seal.FINAL_MERGE_BOUNDARY!=="FINAL_RELEASE_MERGE_AUTHORITY_REQUIRED")errors.push("FINAL_MERGE_BOUNDARY_INVALID");
  return Object.freeze({ok:errors.length===0,errors});
}
