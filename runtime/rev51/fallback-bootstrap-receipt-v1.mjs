import { createHash } from "node:crypto";
export const FALLBACK_BOOTSTRAP_RECEIPT_SCHEMA_ID="FALLBACK_BOOTSTRAP_RECEIPT_V1";
const SHA=/^[0-9a-f]{40}$/;
function obj(v){return !!v&&typeof v==="object"&&!Array.isArray(v)}
function canon(v){if(v===null)return"null";if(typeof v==="string"||typeof v==="boolean")return JSON.stringify(v);if(typeof v==="number"){if(!Number.isSafeInteger(v))throw new Error("P12_NON_SAFE_INTEGER");return JSON.stringify(v)}if(Array.isArray(v))return`[${v.map(canon).join(",")}]`;if(obj(v))return`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`;throw new Error("P12_UNSUPPORTED_CANONICAL_TYPE")}
const hash=v=>createHash("sha256").update(canon(v),"utf8").digest("hex");
function s(v,c){if(typeof v!=="string"||!v)throw new Error(c);return v}
export function buildFallbackBootstrapReceiptV1(input){
 if(!obj(input))throw new Error("FALLBACK_BOOTSTRAP_INPUT_REQUIRED");
 if(!SHA.test(input.EXACT_CANDIDATE_SHA??""))throw new Error("EXACT_CANDIDATE_SHA_INVALID");
 if(!Number.isSafeInteger(input.REMOTE_VALIDATION_RUNS)||input.REMOTE_VALIDATION_RUNS<0||input.REMOTE_VALIDATION_RUNS>1)throw new Error("REMOTE_VALIDATION_RUN_BUDGET_EXCEEDED");
 if(!["EXACT_SHA_CHECKOUT","IMMUTABLE_SOURCE_BUNDLE","EPHEMERAL_VALIDATION_REF"].includes(input.SOURCE_TRANSPORT))throw new Error("SOURCE_TRANSPORT_INVALID");
 if(input.SOURCE_TRANSPORT==="EPHEMERAL_VALIDATION_REF"&&input.EPHEMERAL_REF_CREATED!==true)throw new Error("EPHEMERAL_REF_CREATION_EVIDENCE_REQUIRED");
 if(input.SOURCE_TRANSPORT!=="EPHEMERAL_VALIDATION_REF"&&input.EPHEMERAL_REF_CREATED===true)throw new Error("EPHEMERAL_REF_UNEXPECTED");
 if(!["NONE","ELIGIBLE","PROMOTED","DEFERRED"].includes(input.PROMOTION_STATE))throw new Error("PROMOTION_STATE_INVALID");
 if(!["PASS","NOT_REQUIRED"].includes(input.CLEANUP_STATE))throw new Error("CLEANUP_STATE_INVALID");
 const artifacts=Array.isArray(input.GENERATED_ARTIFACTS)?[...new Set(input.GENERATED_ARTIFACTS.map(x=>s(x,"GENERATED_ARTIFACT_INVALID")))].sort():[];
 const body={SCHEMA_ID:FALLBACK_BOOTSTRAP_RECEIPT_SCHEMA_ID,SCHEMA_VERSION:"1",EXACT_CANDIDATE_SHA:input.EXACT_CANDIDATE_SHA,REJECTED_PROVIDER:s(input.REJECTED_PROVIDER,"REJECTED_PROVIDER_REQUIRED"),REJECTION_REASON:s(input.REJECTION_REASON,"REJECTION_REASON_REQUIRED"),SELECTED_PROVIDER:s(input.SELECTED_PROVIDER,"SELECTED_PROVIDER_REQUIRED"),EXECUTION_ADAPTER_STATE:s(input.EXECUTION_ADAPTER_STATE,"EXECUTION_ADAPTER_STATE_REQUIRED"),SOURCE_TRANSPORT:input.SOURCE_TRANSPORT,EPHEMERAL_REF_CREATED:input.EPHEMERAL_REF_CREATED===true,REMOTE_VALIDATION_RUNS:input.REMOTE_VALIDATION_RUNS,GENERATED_ARTIFACTS:artifacts,PROMOTION_STATE:input.PROMOTION_STATE,CLEANUP_STATE:input.CLEANUP_STATE};
 return Object.freeze({...body,RECEIPT_SHA256:hash(body)});
}