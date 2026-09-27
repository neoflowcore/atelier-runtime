import { createHash } from "node:crypto";
const FORBIDDEN=/token|authorization|secret|signed.?url|raw.?log|raw.?body/i;
function obj(v){return !!v&&typeof v==="object"&&!Array.isArray(v)}
function canon(v){if(v===null)return"null";if(typeof v==="string"||typeof v==="boolean")return JSON.stringify(v);if(typeof v==="number"){if(!Number.isSafeInteger(v))throw new Error("P17_NON_SAFE_INTEGER");return JSON.stringify(v)}if(Array.isArray(v))return`[${v.map(canon).join(",")}]`;if(obj(v))return`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`;throw new Error("P17_UNSUPPORTED_CANONICAL_TYPE")}
const hash=v=>createHash("sha256").update(canon(v),"utf8").digest("hex");
export function buildPrivacyMinimalProviderEvidenceV1({providerIdentity,resourceIdentity,deploymentId,versionId,bindingIdentities=[],measurementWindow=null,criteriaSha256=null,metricSummary=null,result}={}){
 const body={PROVIDER_IDENTITY:providerIdentity??null,RESOURCE_IDENTITY:resourceIdentity??null,DEPLOYMENT_ID:deploymentId??null,VERSION_ID:versionId??null,BINDING_IDENTITIES:bindingIdentities,MEASUREMENT_WINDOW:measurementWindow,CRITERIA_SHA256:criteriaSha256,NORMALIZED_METRIC_SUMMARY:metricSummary,RESULT:result??null};
 for(const k of Object.keys(body))if(FORBIDDEN.test(k))throw new Error("FORBIDDEN_EVIDENCE_FIELD");
 const text=JSON.stringify(body);if(/authorization|bearer\s+|access[_-]?token|signed[_-]?url/i.test(text))throw new Error("SENSITIVE_EVIDENCE_VALUE_DETECTED");
 return Object.freeze({...body,EVIDENCE_SHA256:hash(body)});
}
export function computeProviderDriftFingerprintV1(state){
 if(!obj(state))throw new Error("PROVIDER_STATE_REQUIRED");
 const body={DEPLOYMENT_ID:state.DEPLOYMENT_ID??null,VERSION_ID:state.VERSION_ID??null,TRAFFIC:state.TRAFFIC??null,BINDINGS:state.BINDINGS??[],SETTINGS:state.SETTINGS??{},CREDENTIAL_CAPABILITY_FINGERPRINT:state.CREDENTIAL_CAPABILITY_FINGERPRINT??null};
 return hash(body);
}
export function evaluateProviderDriftV1({acceptedFingerprint,currentState}={}){
 if(typeof acceptedFingerprint!=="string"||!/^[0-9a-f]{64}$/.test(acceptedFingerprint))throw new Error("ACCEPTED_FINGERPRINT_INVALID");
 const currentFingerprint=computeProviderDriftFingerprintV1(currentState);
 return Object.freeze({changed:currentFingerprint!==acceptedFingerprint,currentFingerprint,action:currentFingerprint===acceptedFingerprint?"REUSE_EVIDENCE":"STALE_AFFECTED_EVIDENCE_AND_REATTEST"});
}