import { createHash } from "node:crypto";
import { evaluateCapabilityAdmissionV1, buildCapabilityAdmissionReceiptV1 } from "./capability-admission-v1.mjs";
import { validateExecutionEnvironmentAtStartV1 } from "./exact-runtime-provisioner-v1.mjs";

export const PROVIDER_SCHEDULING_POLICY_SCHEMA_ID = "PROVIDER_SCHEDULING_POLICY_V1";
export const PROVIDER_CIRCUIT_BREAKER_SCHEMA_ID = "PROVIDER_CIRCUIT_BREAKER_V1";
export const PROVIDER_SCHEDULE_RECEIPT_SCHEMA_ID = "PROVIDER_SCHEDULE_RECEIPT_V1";
export const EXECUTION_START_REATTESTATION_SCHEMA_ID = "EXECUTION_START_REATTESTATION_V1";

const SHA=/^[0-9a-f]{64}$/;
function obj(v){return !!v&&typeof v==="object"&&!Array.isArray(v)}
function canon(v){if(v===null)return"null";if(typeof v==="string"||typeof v==="boolean")return JSON.stringify(v);if(typeof v==="number"){if(!Number.isSafeInteger(v))throw new Error("P9_NON_SAFE_INTEGER");return JSON.stringify(v)}if(Array.isArray(v))return`[${v.map(canon).join(",")}]`;if(obj(v))return`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`;throw new Error("P9_UNSUPPORTED_CANONICAL_TYPE")}
const hash=v=>createHash("sha256").update(canon(v),"utf8").digest("hex");
function uniqueStrings(v,code){if(!Array.isArray(v)||v.some(x=>typeof x!=="string"||!x))throw new Error(code);const s=[...new Set(v)];if(s.length!==v.length)throw new Error(code+"_DUPLICATE");return [...s].sort()}
function bool(v,code){if(typeof v!=="boolean")throw new Error(code);return v}
function integer(v,code,min=0){if(!Number.isSafeInteger(v)||v<min)throw new Error(code);return v}

export function compileProviderSchedulingPolicyV1(input){
  if(!obj(input))throw new Error("PROVIDER_SCHEDULING_POLICY_INPUT_REQUIRED");
  const body={SCHEMA_ID:PROVIDER_SCHEDULING_POLICY_SCHEMA_ID,SCHEMA_VERSION:"1",
    PROVIDER_ORDER:uniqueStrings(input.PROVIDER_ORDER??[],"PROVIDER_ORDER_INVALID"),
    ALLOWED_COST_CLASSES:uniqueStrings(input.ALLOWED_COST_CLASSES??["FREE"],"ALLOWED_COST_CLASSES_INVALID"),
    DATA_CLASSIFICATION:typeof input.DATA_CLASSIFICATION==="string"&&input.DATA_CLASSIFICATION?input.DATA_CLASSIFICATION:"PROJECT_INTERNAL",
    ALLOWED_EXECUTION_ZONES:uniqueStrings(input.ALLOWED_EXECUTION_ZONES??[],"ALLOWED_EXECUTION_ZONES_INVALID"),
    ALLOWED_PROVIDERS:uniqueStrings(input.ALLOWED_PROVIDERS??[],"ALLOWED_PROVIDERS_INVALID"),
    EXTERNAL_UPLOAD_ALLOWED:bool(input.EXTERNAL_UPLOAD_ALLOWED??false,"EXTERNAL_UPLOAD_ALLOWED_INVALID"),
    SOURCE_EGRESS_ALLOWED:bool(input.SOURCE_EGRESS_ALLOWED??false,"SOURCE_EGRESS_ALLOWED_INVALID"),
    ARTIFACT_EGRESS_ALLOWED:bool(input.ARTIFACT_EGRESS_ALLOWED??false,"ARTIFACT_EGRESS_ALLOWED_INVALID"),
    INFRA_FAILURE_THRESHOLD:integer(input.INFRA_FAILURE_THRESHOLD??2,"INFRA_FAILURE_THRESHOLD_INVALID",1)};
  return Object.freeze({...body,POLICY_SHA256:hash(body)});
}
function validatePolicy(p){if(!obj(p)||p.SCHEMA_ID!==PROVIDER_SCHEDULING_POLICY_SCHEMA_ID||!SHA.test(p.POLICY_SHA256??""))throw new Error("PROVIDER_SCHEDULING_POLICY_INVALID");const{POLICY_SHA256,...b}=p;if(hash(b)!==POLICY_SHA256)throw new Error("PROVIDER_SCHEDULING_POLICY_SHA256_MISMATCH");return p}
export function createProviderCircuitBreakerV1(policy){validatePolicy(policy);const body={SCHEMA_ID:PROVIDER_CIRCUIT_BREAKER_SCHEMA_ID,SCHEMA_VERSION:"1",POLICY_SHA256:policy.POLICY_SHA256,FAILURES:{},QUARANTINED:[]};return Object.freeze({...body,STATE_SHA256:hash(body)})}
function validateBreaker(s){if(!obj(s)||s.SCHEMA_ID!==PROVIDER_CIRCUIT_BREAKER_SCHEMA_ID||!SHA.test(s.STATE_SHA256??""))throw new Error("PROVIDER_CIRCUIT_BREAKER_INVALID");const{STATE_SHA256,...b}=s;if(hash(b)!==s.STATE_SHA256)throw new Error("PROVIDER_CIRCUIT_BREAKER_SHA256_MISMATCH");return s}
export function recordProviderOutcomeV1(state,policy,{providerId,outcomeClass}={}){
  validateBreaker(state);validatePolicy(policy);
  if(typeof providerId!=="string"||!providerId)throw new Error("PROVIDER_ID_REQUIRED");
  if(!["INFRA_FAILURE","APPLICATION_FAILURE","HEALTH_RECHECK_PASS"].includes(outcomeClass))throw new Error("PROVIDER_OUTCOME_CLASS_INVALID");
  const next=structuredClone(state);delete next.STATE_SHA256;const failures={...next.FAILURES};let n=failures[providerId]??0;const q=new Set(next.QUARANTINED);
  if(outcomeClass==="INFRA_FAILURE"){n++;failures[providerId]=n;if(n>=policy.INFRA_FAILURE_THRESHOLD)q.add(providerId)}
  else if(outcomeClass==="HEALTH_RECHECK_PASS"){failures[providerId]=0;q.delete(providerId)}
  next.FAILURES=failures;next.QUARANTINED=[...q].sort();return Object.freeze({...next,STATE_SHA256:hash(next)});
}
function policyReasons(policy,providerId,profile,facts){
  const r=[];const f=obj(facts)?facts:{};
  if(policy.ALLOWED_PROVIDERS.length&&!policy.ALLOWED_PROVIDERS.includes(providerId))r.push("PROVIDER_NOT_ALLOWED");
  if(!policy.ALLOWED_COST_CLASSES.includes(profile?.COST_CLASS))r.push("COST_POLICY_MISMATCH");
  const zones=Array.isArray(f.EXECUTION_ZONES)?f.EXECUTION_ZONES:[];
  if(policy.ALLOWED_EXECUTION_ZONES.length&&!policy.ALLOWED_EXECUTION_ZONES.some(z=>zones.includes(z)))r.push("EXECUTION_ZONE_MISMATCH");
  const classes=Array.isArray(f.DATA_CLASSIFICATIONS)?f.DATA_CLASSIFICATIONS:[];
  if(!classes.includes(policy.DATA_CLASSIFICATION))r.push("DATA_CLASSIFICATION_MISMATCH");
  if(policy.EXTERNAL_UPLOAD_ALLOWED===false&&f.EXTERNAL_UPLOAD_CAPABLE===true)r.push("EXTERNAL_UPLOAD_POLICY_MISMATCH");
  if(policy.SOURCE_EGRESS_ALLOWED===false&&f.SOURCE_EGRESS_REQUIRED===true)r.push("SOURCE_EGRESS_POLICY_MISMATCH");
  if(policy.ARTIFACT_EGRESS_ALLOWED===false&&f.ARTIFACT_EGRESS_REQUIRED===true)r.push("ARTIFACT_EGRESS_POLICY_MISMATCH");
  return r;
}
export function selectProviderDeterministicallyV1({policy,requiredCapabilities,registry,runtimeNowMs,backendCandidates={},providerPolicyFacts={},executionClass,verifierPolicySha256,circuitBreaker}={}){
  validatePolicy(policy);validateBreaker(circuitBreaker);
  const order=policy.PROVIDER_ORDER.length?policy.PROVIDER_ORDER:Object.keys(registry?.PROFILES??{}).sort(),evaluations=[];
  for(const providerId of order){
    if(circuitBreaker.QUARANTINED.includes(providerId)){evaluations.push({PROVIDER_ID:providerId,DECISION:"REJECT",REASONS:["PROVIDER_QUARANTINED"]});continue}
    const profile=registry?.PROFILES?.[providerId]??null;
    const admission=evaluateCapabilityAdmissionV1({requiredCapabilities,registry,providerId,runtimeNowMs,backendCandidate:backendCandidates[providerId]??null,executionClass,verifierPolicySha256,allowedCostClasses:policy.ALLOWED_COST_CLASSES});
    const reasons=[...new Set([...(admission.reasons??[]),...policyReasons(policy,providerId,profile,providerPolicyFacts[providerId])])].sort();
    evaluations.push({PROVIDER_ID:providerId,DECISION:reasons.length?"REJECT":"ADMIT",REASONS:reasons,PROFILE_SHA256:profile?.PROFILE_SHA256??null});
    if(reasons.length===0){const body={SCHEMA_ID:PROVIDER_SCHEDULE_RECEIPT_SCHEMA_ID,SCHEMA_VERSION:"1",POLICY_SHA256:policy.POLICY_SHA256,REQUIRED_CAPABILITIES_SHA256:requiredCapabilities?.REQUIRED_CAPABILITIES_SHA256??null,SELECTED_PROVIDER_ID:providerId,SELECTED_PROFILE_SHA256:profile.PROFILE_SHA256,EVALUATIONS:evaluations};return Object.freeze({ok:true,selectedProviderId:providerId,evaluations,receipt:Object.freeze({...body,RECEIPT_SHA256:hash(body)})})}
  }
  return Object.freeze({ok:false,selectedProviderId:null,evaluations,receipt:null});
}
export function executionStartReattestationV1({policy,requiredCapabilities,registry,providerId,runtimeNowMs,backendCandidate,providerPolicyFacts={},executionClass,verifierPolicySha256,circuitBreaker,provisioningPlan,environmentObservation}={}){
  validatePolicy(policy);validateBreaker(circuitBreaker);
  if(circuitBreaker.QUARANTINED.includes(providerId))return Object.freeze({ok:false,startAllowed:false,code:"PROVIDER_QUARANTINED"});
  const admissionReceipt=buildCapabilityAdmissionReceiptV1({requiredCapabilities,registry,providerId,runtimeNowMs,backendCandidate,executionClass,verifierPolicySha256,allowedCostClasses:policy.ALLOWED_COST_CLASSES});
  const profile=registry?.PROFILES?.[providerId]??null,extra=policyReasons(policy,providerId,profile,providerPolicyFacts[providerId]);
  if(admissionReceipt.DECISION!=="ADMIT"||extra.length)return Object.freeze({ok:false,startAllowed:false,code:"ADMISSION_OR_POLICY_DRIFT",reasons:[...new Set([...(admissionReceipt.REASONS??[]),...extra])].sort(),admissionReceipt});
  const env=validateExecutionEnvironmentAtStartV1(provisioningPlan,environmentObservation);
  if(!env.startAllowed)return Object.freeze({ok:false,startAllowed:false,code:"EXECUTION_ENVIRONMENT_DRIFT",environment:env,admissionReceipt});
  const body={SCHEMA_ID:EXECUTION_START_REATTESTATION_SCHEMA_ID,SCHEMA_VERSION:"1",PROVIDER_ID:providerId,POLICY_SHA256:policy.POLICY_SHA256,ADMISSION_RECEIPT_SHA256:admissionReceipt.RECEIPT_SHA256,ENVIRONMENT_ATTESTATION_SHA256:env.attestation.ATTESTATION_SHA256,STATUS:"PASS"};
  return Object.freeze({ok:true,startAllowed:true,code:"EXECUTION_START_ATTESTED",admissionReceipt,environment:env,receipt:Object.freeze({...body,RECEIPT_SHA256:hash(body)})});
}
