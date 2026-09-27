import { createHash } from "node:crypto";
export const PROVIDER_EXECUTION_ADAPTER_READINESS_SCHEMA_ID="PROVIDER_EXECUTION_ADAPTER_READINESS_V1";
export const FALLBACK_EXECUTION_PLAN_SCHEMA_ID="FALLBACK_EXECUTION_PLAN_V1";
const SHA=/^[0-9a-f]{64}$/;
function obj(v){return !!v&&typeof v==="object"&&!Array.isArray(v)}
function canon(v){if(v===null)return"null";if(typeof v==="string"||typeof v==="boolean")return JSON.stringify(v);if(typeof v==="number"){if(!Number.isSafeInteger(v))throw new Error("P10_NON_SAFE_INTEGER");return JSON.stringify(v)}if(Array.isArray(v))return`[${v.map(canon).join(",")}]`;if(obj(v))return`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`;throw new Error("P10_UNSUPPORTED_CANONICAL_TYPE")}
const hash=v=>createHash("sha256").update(canon(v),"utf8").digest("hex");
function nonempty(v,c){if(typeof v!=="string"||!v)throw new Error(c);return v}
function bool(v,c){if(typeof v!=="boolean")throw new Error(c);return v}
function iso(v,c){if(!Number.isFinite(Date.parse(v??"")))throw new Error(c);return v}
function sha(v,c){if(!SHA.test(v??""))throw new Error(c);return v}
export function createProviderExecutionAdapterReadinessV1(input){
  if(!obj(input))throw new Error("PROVIDER_EXECUTION_ADAPTER_READINESS_INPUT_REQUIRED");
  const body={SCHEMA_ID:PROVIDER_EXECUTION_ADAPTER_READINESS_SCHEMA_ID,SCHEMA_VERSION:"1",PROVIDER_ID:nonempty(input.PROVIDER_ID,"PROVIDER_ID_REQUIRED"),STATE:input.STATE,CONTROL_PLANE_AUTHORITY_READY:bool(input.CONTROL_PLANE_AUTHORITY_READY,"CONTROL_PLANE_AUTHORITY_READY_REQUIRED"),EXACT_SHA_CHECKOUT_READY:bool(input.EXACT_SHA_CHECKOUT_READY,"EXACT_SHA_CHECKOUT_READY_REQUIRED"),SOURCE_BUNDLE_IMPORT_READY:bool(input.SOURCE_BUNDLE_IMPORT_READY,"SOURCE_BUNDLE_IMPORT_READY_REQUIRED"),EPHEMERAL_REF_CHECKOUT_READY:bool(input.EPHEMERAL_REF_CHECKOUT_READY,"EPHEMERAL_REF_CHECKOUT_READY_REQUIRED"),ARTIFACT_RETURN_READY:bool(input.ARTIFACT_RETURN_READY,"ARTIFACT_RETURN_READY_REQUIRED"),WORKFLOW_DISPATCH_READY:bool(input.WORKFLOW_DISPATCH_READY,"WORKFLOW_DISPATCH_READY_REQUIRED"),CLEANUP_READY:bool(input.CLEANUP_READY,"CLEANUP_READY_REQUIRED"),VALIDATION_HARNESS_SHA256:sha(input.VALIDATION_HARNESS_SHA256,"VALIDATION_HARNESS_SHA256_INVALID"),OBSERVED_AT:iso(input.OBSERVED_AT,"OBSERVED_AT_INVALID"),VALID_UNTIL:iso(input.VALID_UNTIL,"VALID_UNTIL_INVALID")};
  if(!["READY","BOOTSTRAP_REQUIRED","UNAVAILABLE"].includes(body.STATE))throw new Error("ADAPTER_STATE_INVALID");
  if(Date.parse(body.VALID_UNTIL)<=Date.parse(body.OBSERVED_AT))throw new Error("ADAPTER_FRESHNESS_INVALID");
  if(body.STATE==="READY"&&(!body.ARTIFACT_RETURN_READY||!body.CLEANUP_READY||!(body.EXACT_SHA_CHECKOUT_READY||body.SOURCE_BUNDLE_IMPORT_READY||body.EPHEMERAL_REF_CHECKOUT_READY)))throw new Error("READY_ADAPTER_REQUIRED_CAPABILITY_MISSING");
  return Object.freeze({...body,READINESS_SHA256:hash(body)});
}
function validate(r,now){if(!obj(r)||r.SCHEMA_ID!==PROVIDER_EXECUTION_ADAPTER_READINESS_SCHEMA_ID||!SHA.test(r.READINESS_SHA256??""))throw new Error("ADAPTER_READINESS_INVALID");const{READINESS_SHA256,...b}=r;if(hash(b)!==READINESS_SHA256)throw new Error("ADAPTER_READINESS_SHA256_MISMATCH");if(!Number.isSafeInteger(now)||Date.parse(r.VALID_UNTIL)<=now)return{ok:false,code:"ADAPTER_READINESS_STALE"};return{ok:true,code:"ADAPTER_READINESS_CURRENT"}}
export function planFallbackExecutionV1({readiness,runtimeNowMs,candidateSha,sourceBundleSha256=null,remoteFullRunBudget=1,ephemeralRefAllowed=false}={}){
  const v=validate(readiness,runtimeNowMs);if(!v.ok)return Object.freeze({ok:false,code:v.code});
  if(readiness.STATE!=="READY")return Object.freeze({ok:false,code:"EXECUTION_ADAPTER_NOT_READY"});
  nonempty(candidateSha,"CANDIDATE_SHA_REQUIRED");if(sourceBundleSha256!==null)sha(sourceBundleSha256,"SOURCE_BUNDLE_SHA256_INVALID");
  if(!Number.isSafeInteger(remoteFullRunBudget)||remoteFullRunBudget!==1)throw new Error("REMOTE_FULL_RUN_BUDGET_MUST_EQUAL_ONE");
  let transport="UNAVAILABLE";
  if(readiness.EXACT_SHA_CHECKOUT_READY)transport="EXACT_SHA_CHECKOUT";
  else if(readiness.SOURCE_BUNDLE_IMPORT_READY&&sourceBundleSha256)transport="IMMUTABLE_SOURCE_BUNDLE";
  else if(readiness.EPHEMERAL_REF_CHECKOUT_READY&&ephemeralRefAllowed)transport="EPHEMERAL_VALIDATION_REF";
  if(transport==="UNAVAILABLE")return Object.freeze({ok:false,code:"SOURCE_TRANSPORT_UNAVAILABLE"});
  const body={SCHEMA_ID:FALLBACK_EXECUTION_PLAN_SCHEMA_ID,SCHEMA_VERSION:"1",PROVIDER_ID:readiness.PROVIDER_ID,READINESS_SHA256:readiness.READINESS_SHA256,CANDIDATE_SHA:candidateSha,SOURCE_TRANSPORT:transport,SOURCE_BUNDLE_SHA256:transport==="IMMUTABLE_SOURCE_BUNDLE"?sourceBundleSha256:null,REMOTE_FULL_RUN_BUDGET:1,MATRIX_EXPANSION_ALLOWED:false,INTERMEDIATE_REMOTE_GATE_ALLOWED:false,EPHEMERAL_REF_ALLOWED:transport==="EPHEMERAL_VALIDATION_REF"};
  return Object.freeze({ok:true,code:"FALLBACK_EXECUTION_PLANNED",plan:Object.freeze({...body,PLAN_SHA256:hash(body)})});
}
