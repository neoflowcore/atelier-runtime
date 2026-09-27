import { createHash } from "node:crypto";

export const EPHEMERAL_VALIDATION_REF_LEASE_SCHEMA_ID="EPHEMERAL_VALIDATION_REF_LEASE_V1";
export const GENERATED_SOURCE_ARTIFACT_PROVENANCE_SCHEMA_ID="GENERATED_SOURCE_ARTIFACT_PROVENANCE_V1";
export const SOURCE_PROMOTION_RECEIPT_SCHEMA_ID="SOURCE_PROMOTION_RECEIPT_V1";
const SHA=/^[0-9a-f]{64}$/;
function obj(v){return !!v&&typeof v==="object"&&!Array.isArray(v)}
function canon(v){if(v===null)return"null";if(typeof v==="string"||typeof v==="boolean")return JSON.stringify(v);if(typeof v==="number"){if(!Number.isSafeInteger(v))throw new Error("P11_NON_SAFE_INTEGER");return JSON.stringify(v)}if(Array.isArray(v))return`[${v.map(canon).join(",")}]`;if(obj(v))return`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`;throw new Error("P11_UNSUPPORTED_CANONICAL_TYPE")}
const hash=v=>createHash("sha256").update(canon(v),"utf8").digest("hex");
function str(v,c){if(typeof v!=="string"||!v)throw new Error(c);return v}
function sha(v,c){if(!SHA.test(v??""))throw new Error(c);return v}
function iso(v,c){if(!Number.isFinite(Date.parse(v??"")))throw new Error(c);return v}

export function createEphemeralValidationRefLeaseV1(input){
  if(!obj(input))throw new Error("VALIDATION_REF_LEASE_INPUT_REQUIRED");
  const body={SCHEMA_ID:EPHEMERAL_VALIDATION_REF_LEASE_SCHEMA_ID,SCHEMA_VERSION:"1",JOB_ID:str(input.JOB_ID,"JOB_ID_REQUIRED"),REF_NAME:str(input.REF_NAME,"REF_NAME_REQUIRED"),CANDIDATE_SHA:str(input.CANDIDATE_SHA,"CANDIDATE_SHA_REQUIRED"),OWNER_JOB:str(input.OWNER_JOB??input.JOB_ID,"OWNER_JOB_REQUIRED"),CREATED_AT:iso(input.CREATED_AT,"CREATED_AT_INVALID"),DELETE_AFTER:iso(input.DELETE_AFTER,"DELETE_AFTER_INVALID"),CLEANUP_AUTHORITY_READY:input.CLEANUP_AUTHORITY_READY===true};
  if(!body.REF_NAME.startsWith("runtime/validation/"))throw new Error("VALIDATION_REF_NAMESPACE_INVALID");
  if(body.REF_NAME==="main"||body.REF_NAME.endsWith("/main"))throw new Error("MAIN_MUTATION_FOR_VALIDATION_DENIED");
  if(Date.parse(body.DELETE_AFTER)<=Date.parse(body.CREATED_AT))throw new Error("VALIDATION_REF_TTL_INVALID");
  if(!body.CLEANUP_AUTHORITY_READY)throw new Error("VALIDATION_REF_CLEANUP_AUTHORITY_REQUIRED");
  return Object.freeze({...body,LEASE_SHA256:hash(body)});
}
export function createGeneratedSourceArtifactProvenanceV1(input){
  if(!obj(input))throw new Error("GENERATED_SOURCE_ARTIFACT_INPUT_REQUIRED");
  const body={SCHEMA_ID:GENERATED_SOURCE_ARTIFACT_PROVENANCE_SCHEMA_ID,SCHEMA_VERSION:"1",INPUT_SOURCE_SHA:str(input.INPUT_SOURCE_SHA,"INPUT_SOURCE_SHA_REQUIRED"),INPUT_TREE_SHA:str(input.INPUT_TREE_SHA,"INPUT_TREE_SHA_REQUIRED"),ARTIFACT_PATH:str(input.ARTIFACT_PATH,"ARTIFACT_PATH_REQUIRED"),ARTIFACT_SHA256:sha(input.ARTIFACT_SHA256,"ARTIFACT_SHA256_INVALID"),ENVIRONMENT_FINGERPRINT_SHA256:sha(input.ENVIRONMENT_FINGERPRINT_SHA256,"ENVIRONMENT_FINGERPRINT_SHA256_INVALID"),PACKAGE_MANAGER_VERSION:str(input.PACKAGE_MANAGER_VERSION,"PACKAGE_MANAGER_VERSION_REQUIRED"),REGISTRY_PROFILE_SHA256:sha(input.REGISTRY_PROFILE_SHA256,"REGISTRY_PROFILE_SHA256_INVALID"),DEPENDENCY_RESOLUTION_POLICY_SHA256:sha(input.DEPENDENCY_RESOLUTION_POLICY_SHA256,"DEPENDENCY_RESOLUTION_POLICY_SHA256_INVALID"),TRACE_ID:str(input.TRACE_ID,"TRACE_ID_REQUIRED"),JOB_ID:str(input.JOB_ID,"JOB_ID_REQUIRED"),CANONICAL_VALIDATION_STATUS:input.CANONICAL_VALIDATION_STATUS};
  if(!["PASS","PENDING","FAIL"].includes(body.CANONICAL_VALIDATION_STATUS))throw new Error("CANONICAL_VALIDATION_STATUS_INVALID");
  return Object.freeze({...body,PROVENANCE_SHA256:hash(body)});
}
export function evaluateSourcePromotionEligibilityV1({provenance,freshHead,freshTree,currentBlobSha256=null,sourceMutationAuthorized=false}={}){
  if(!obj(provenance)||provenance.SCHEMA_ID!==GENERATED_SOURCE_ARTIFACT_PROVENANCE_SCHEMA_ID||!SHA.test(provenance.PROVENANCE_SHA256??""))throw new Error("SOURCE_PROVENANCE_INVALID");
  const{PROVENANCE_SHA256,...b}=provenance;if(hash(b)!==PROVENANCE_SHA256)throw new Error("SOURCE_PROVENANCE_SHA256_MISMATCH");
  if(provenance.CANONICAL_VALIDATION_STATUS!=="PASS")return Object.freeze({eligible:false,code:"CANONICAL_VALIDATION_REQUIRED"});
  str(freshHead,"FRESH_HEAD_REQUIRED");str(freshTree,"FRESH_TREE_REQUIRED");
  if(freshHead!==provenance.INPUT_SOURCE_SHA||freshTree!==provenance.INPUT_TREE_SHA)return Object.freeze({eligible:false,code:"SOURCE_BASE_DRIFT_REQUIRES_RECOMPILE"});
  if(currentBlobSha256!==null&&currentBlobSha256===provenance.ARTIFACT_SHA256)return Object.freeze({eligible:true,code:"SUCCESS_NOOP",mutationRequired:false});
  if(sourceMutationAuthorized!==true)return Object.freeze({eligible:false,code:"SOURCE_MUTATION_AUTHORITY_REQUIRED"});
  return Object.freeze({eligible:true,code:"SOURCE_PROMOTION_ELIGIBLE",mutationRequired:true});
}
export function buildSourcePromotionReceiptV1({provenance,eligibility,baseHead,baseTree,resultHead,resultTree,promotedBlobSha256}={}){
  if(!eligibility?.eligible)throw new Error("SOURCE_PROMOTION_NOT_ELIGIBLE");
  const body={SCHEMA_ID:SOURCE_PROMOTION_RECEIPT_SCHEMA_ID,SCHEMA_VERSION:"1",PROVENANCE_SHA256:provenance.PROVENANCE_SHA256,BASE_HEAD:str(baseHead,"BASE_HEAD_REQUIRED"),BASE_TREE:str(baseTree,"BASE_TREE_REQUIRED"),RESULT_HEAD:str(resultHead,"RESULT_HEAD_REQUIRED"),RESULT_TREE:str(resultTree,"RESULT_TREE_REQUIRED"),PROMOTED_BLOB_SHA256:sha(promotedBlobSha256,"PROMOTED_BLOB_SHA256_INVALID"),OUTCOME:eligibility.code==="SUCCESS_NOOP"?"SUCCESS_NOOP":"SUCCESS_CHANGED"};
  return Object.freeze({...body,RECEIPT_SHA256:hash(body)});
}
