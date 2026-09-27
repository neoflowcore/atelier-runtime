import { createHash } from "node:crypto";

export const CROSS_STACK_SYNC_SCHEMA_ID = "R51_CREDENTIAL_INDEPENDENT_CROSS_STACK_SYNC_V1";
const SHA=/^[0-9a-f]{64}$/;
const PASS_LIKE=new Set(["PASS","PASS_REUSED","PASS_SYNTHETIC_CREDENTIAL_INDEPENDENT","PASS_OR_EXISTING_DURABLE_TRANSPORT_REUSE","QUALIFIED_LIMIT_GITHUB_HOSTED","RECORDED"]);
function obj(v){return !!v&&typeof v==="object"&&!Array.isArray(v)}
function canon(v){if(v===null)return"null";if(typeof v==="string"||typeof v==="boolean")return JSON.stringify(v);if(typeof v==="number"){if(!Number.isSafeInteger(v))throw Error("CROSS_STACK_NON_SAFE_INTEGER");return JSON.stringify(v)}if(Array.isArray(v))return`[${v.map(canon).join(",")}]`;if(obj(v))return`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`;throw Error("CROSS_STACK_UNSUPPORTED_TYPE")}
const hash=v=>createHash("sha256").update(canon(v),"utf8").digest("hex");
function reqSha(v,c){if(!SHA.test(v??""))throw Error(c);return v}

export function compileCrossStackCompatibilityReceiptV1(input={}){
  const errors=[];
  for(const [k,v] of Object.entries(input.gates??{})) if(!PASS_LIKE.has(v)) errors.push(`GATE_NOT_PASS_LIKE:${k}:${v}`);
  if(input.runtimeDevelopmentSeal!=="PASS") errors.push("RUNTIME_DEVELOPMENT_SEAL_REQUIRED");
  if(input.piloteDevelopmentAcceptance!=="PASS") errors.push("PILOTE_DEVELOPMENT_ACCEPTANCE_REQUIRED");
  if(input.runtimeDecisionToPiloteResponseGate!=="PASS") errors.push("RUNTIME_DECISION_RESPONSE_GATE_COMPATIBILITY_REQUIRED");
  if(input.aliasContinuationCompatibility!=="PASS") errors.push("ALIAS_CONTINUATION_COMPATIBILITY_REQUIRED");
  if(input.acceptanceBridgeCompatibility!=="PASS") errors.push("ACCEPTANCE_BRIDGE_COMPATIBILITY_REQUIRED");
  if(input.evidenceInvalidationCompatibility!=="PASS") errors.push("EVIDENCE_INVALIDATION_COMPATIBILITY_REQUIRED");
  if(input.authorityDeltaCompatibility!=="PASS") errors.push("AUTHORITY_DELTA_COMPATIBILITY_REQUIRED");
  if(input.authTimingCompatibility!=="PASS") errors.push("AUTH_TIMING_COMPATIBILITY_REQUIRED");
  const remaining=Number.isSafeInteger(input.remainingCredentialIndependentRequiredWork)?input.remainingCredentialIndependentRequiredWork:-1;
  if(remaining!==0) errors.push("CREDENTIAL_INDEPENDENT_WORK_REMAINS");
  const body={
    SCHEMA_ID:CROSS_STACK_SYNC_SCHEMA_ID,SCHEMA_VERSION:"1",
    RUNTIME_INTERFACE_IDENTITY_SHA256:reqSha(input.runtimeInterfaceIdentitySha256,"RUNTIME_INTERFACE_IDENTITY_REQUIRED"),
    RUNTIME_COMPATIBILITY_IDENTITY_SHA256:reqSha(input.runtimeCompatibilityIdentitySha256,"RUNTIME_COMPATIBILITY_IDENTITY_REQUIRED"),
    RUNTIME_CONTRACT_SET_SHA256:reqSha(input.runtimeContractSetSha256,"RUNTIME_CONTRACT_SET_REQUIRED"),
    RUNTIME_DEVELOPMENT_SEAL:input.runtimeDevelopmentSeal,
    PILOTE_DEVELOPMENT_ACCEPTANCE:input.piloteDevelopmentAcceptance,
    CREDENTIAL_INDEPENDENT_CROSS_STACK_SYNC:errors.length===0?"PASS":"DENY",
    REMAINING_CREDENTIAL_INDEPENDENT_REQUIRED_WORK:remaining,
    PROJECT_DEVELOPMENT_COMPLETE:errors.length===0,
    GLOBAL_AUTH_ENDGAME_TRIGGER:errors.length===0,
    LIVE_ACCEPTANCE:"NOT_YET_EXECUTED",
    ERRORS:errors.sort()
  };
  return Object.freeze({...body,CROSS_STACK_RECEIPT_SHA256:hash(body)});
}

export function evaluateProjectDevelopmentCompleteV1(receipt){
  if(!obj(receipt)||receipt.SCHEMA_ID!==CROSS_STACK_SYNC_SCHEMA_ID)return Object.freeze({projectDevelopmentComplete:false,globalAuthEndgameTrigger:false,code:"CROSS_STACK_RECEIPT_REQUIRED"});
  const ok=receipt.RUNTIME_DEVELOPMENT_SEAL==="PASS"&&receipt.PILOTE_DEVELOPMENT_ACCEPTANCE==="PASS"&&receipt.CREDENTIAL_INDEPENDENT_CROSS_STACK_SYNC==="PASS"&&receipt.REMAINING_CREDENTIAL_INDEPENDENT_REQUIRED_WORK===0&&receipt.ERRORS.length===0;
  return Object.freeze({projectDevelopmentComplete:ok,globalAuthEndgameTrigger:ok,code:ok?"PROJECT_DEVELOPMENT_COMPLETE":"PROJECT_DEVELOPMENT_INCOMPLETE"});
}
