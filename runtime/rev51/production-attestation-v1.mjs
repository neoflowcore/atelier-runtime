import { createHash } from "node:crypto";
export const PRODUCTION_ATTESTATION_INPUT_SCHEMA_ID="PRODUCTION_ATTESTATION_INPUT_V1";
export const PRODUCTION_ATTESTATION_RECEIPT_SCHEMA_ID="PRODUCTION_ATTESTATION_V1";
const SHA=/^[0-9a-f]{64}$/;
function obj(v){return !!v&&typeof v==="object"&&!Array.isArray(v)}
function canon(v){if(v===null)return"null";if(typeof v==="string"||typeof v==="boolean")return JSON.stringify(v);if(typeof v==="number"){if(!Number.isSafeInteger(v))throw new Error("P15_NON_SAFE_INTEGER");return JSON.stringify(v)}if(Array.isArray(v))return`[${v.map(canon).join(",")}]`;if(obj(v))return`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`;throw new Error("P15_UNSUPPORTED_CANONICAL_TYPE")}
const hash=v=>createHash("sha256").update(canon(v),"utf8").digest("hex");
function s(v,c){if(typeof v!=="string"||!v)throw new Error(c);return v}
function sha(v,c){if(!SHA.test(v??""))throw new Error(c);return v}
export function compileProductionAttestationInputV1(input){
 if(!obj(input))throw new Error("PRODUCTION_ATTESTATION_INPUT_REQUIRED");
 const bindings=(input.EXPECTED_BINDINGS??[]).map(x=>({NAME:s(x.NAME,"BINDING_NAME_REQUIRED"),TYPE:s(x.TYPE,"BINDING_TYPE_REQUIRED"),RESOURCE_ID:s(x.RESOURCE_ID,"BINDING_RESOURCE_ID_REQUIRED")})).sort((a,b)=>a.NAME.localeCompare(b.NAME)||a.TYPE.localeCompare(b.TYPE)||a.RESOURCE_ID.localeCompare(b.RESOURCE_ID));
 const traffic=input.TRAFFIC_POLICY??{MODE:"EXACT_PERCENT",REQUIRED_PERCENT:100};
 if(!["EXACT_PERCENT","CANARY_MINIMUM"].includes(traffic.MODE)||!Number.isSafeInteger(traffic.REQUIRED_PERCENT)||traffic.REQUIRED_PERCENT<0||traffic.REQUIRED_PERCENT>100)throw new Error("TRAFFIC_POLICY_INVALID");
 const body={SCHEMA_ID:PRODUCTION_ATTESTATION_INPUT_SCHEMA_ID,SCHEMA_VERSION:"1",EXPECTED_SOURCE_IDENTITY:s(input.EXPECTED_SOURCE_IDENTITY,"EXPECTED_SOURCE_IDENTITY_REQUIRED"),PROVIDER_TARGET:s(input.PROVIDER_TARGET,"PROVIDER_TARGET_REQUIRED"),EXPECTED_BINDINGS:bindings,TRAFFIC_POLICY:{MODE:traffic.MODE,REQUIRED_PERCENT:traffic.REQUIRED_PERCENT},SLO_CRITERIA_SHA256:sha(input.SLO_CRITERIA_SHA256,"SLO_CRITERIA_SHA256_INVALID"),TELEMETRY_WINDOW_POLICY_SHA256:sha(input.TELEMETRY_WINDOW_POLICY_SHA256,"TELEMETRY_WINDOW_POLICY_SHA256_INVALID"),MAX_AGE_MS:Number.isSafeInteger(input.MAX_AGE_MS)&&input.MAX_AGE_MS>0?input.MAX_AGE_MS:300000};
 return Object.freeze({...body,ATTESTATION_INPUT_SHA256:hash(body)});
}
export function evaluateProductionAttestationV1({input,observation,runtimeNowMs}={}){
 if(!obj(input)||input.SCHEMA_ID!==PRODUCTION_ATTESTATION_INPUT_SCHEMA_ID||!SHA.test(input.ATTESTATION_INPUT_SHA256??""))throw new Error("PRODUCTION_ATTESTATION_INPUT_INVALID");const{ATTESTATION_INPUT_SHA256,...ib}=input;if(hash(ib)!==ATTESTATION_INPUT_SHA256)throw new Error("ATTESTATION_INPUT_SHA256_MISMATCH");
 if(!obj(observation))throw new Error("PRODUCTION_OBSERVATION_REQUIRED");if(!Number.isSafeInteger(runtimeNowMs))throw new Error("RUNTIME_AUTHORITATIVE_TIME_REQUIRED");
 const observedAt=Date.parse(observation.OBSERVED_AT??"");if(!Number.isFinite(observedAt))throw new Error("OBSERVED_AT_INVALID");
 const stale=runtimeNowMs-observedAt>input.MAX_AGE_MS;
 const sourceStatus=observation.SOURCE_PROVENANCE===input.EXPECTED_SOURCE_IDENTITY?"PASS":"BLOCKED";
 const observed=new Map((observation.BINDINGS??[]).map(x=>[`${x.NAME}\0${x.TYPE}`,x.RESOURCE_ID]));
 const bindingResults=input.EXPECTED_BINDINGS.map(x=>{const y=observed.get(`${x.NAME}\0${x.TYPE}`);return{...x,OBSERVED_RESOURCE_ID:y??null,STATUS:y===x.RESOURCE_ID?"PASS":"BLOCKED"}});
 const traffic=observation.TRAFFIC_PERCENT;const tp=input.TRAFFIC_POLICY;const trafficPass=Number.isSafeInteger(traffic)&&(tp.MODE==="EXACT_PERCENT"?traffic===tp.REQUIRED_PERCENT:traffic>=tp.REQUIRED_PERCENT);
 const coverage=observation.TELEMETRY_COVERAGE_STATE;
 let sloStatus="BLOCKED";if(coverage==="INSUFFICIENT_WINDOW")sloStatus="PENDING_WINDOW";else if(coverage==="INSUFFICIENT_DATA")sloStatus="INSUFFICIENT_DATA";else if(coverage==="SUFFICIENT")sloStatus=observation.SLO_PASS===true?"PASS":"ALERT";
 const hardPass=!stale&&sourceStatus==="PASS"&&bindingResults.every(x=>x.STATUS==="PASS")&&trafficPass;
 const overall=!hardPass?"BLOCKED":sloStatus==="PASS"?"PASS":sloStatus;
 const body={SCHEMA_ID:PRODUCTION_ATTESTATION_RECEIPT_SCHEMA_ID,SCHEMA_VERSION:"1",PROVIDER_TARGET:input.PROVIDER_TARGET,ATTESTATION_INPUT_SHA256:input.ATTESTATION_INPUT_SHA256,OBSERVED_AT:observation.OBSERVED_AT,VALID_UNTIL:new Date(observedAt+input.MAX_AGE_MS).toISOString(),DEPLOYMENT_ID:observation.DEPLOYMENT_ID??null,VERSION_ID:observation.VERSION_ID??null,SOURCE_PROVENANCE:{EXPECTED:input.EXPECTED_SOURCE_IDENTITY,OBSERVED:observation.SOURCE_PROVENANCE??null,STATUS:sourceStatus},BINDINGS:bindingResults,TRAFFIC:{OBSERVED_PERCENT:Number.isSafeInteger(traffic)?traffic:null,POLICY:input.TRAFFIC_POLICY,STATUS:trafficPass?"PASS":"BLOCKED"},TELEMETRY:{CRITERIA_SHA256:input.SLO_CRITERIA_SHA256,COVERAGE_STATE:coverage??null,STATUS:sloStatus},FRESHNESS_STATUS:stale?"STALE":"PASS",REMOTE_MUTATION_COUNT:0,PAID_COMPUTE_USED:false,ATTESTATION_STATUS:overall};
 return Object.freeze({...body,RECEIPT_SHA256:hash(body)});
}