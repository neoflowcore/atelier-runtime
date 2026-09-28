import { createHash } from "node:crypto";
import { collectAuthRequirementsV1 } from "../../pilote/rev52/auth-authority-policy-v1.mjs";
import { compileFinalCredentialBindManifestV1,compileFinalAuthBindManifestV1,evaluateAuthEndgameClosurePreflightV1,compileTransitiveLiveAuthDependencyClosureV1 } from "../../runtime/rev51/auth-endgame-transaction-v1.mjs";
const SHA=/^[0-9a-f]{64}$/;
function obj(v){return !!v&&typeof v==="object"&&!Array.isArray(v)}
function canon(v){if(v===null)return"null";if(typeof v==="string"||typeof v==="boolean")return JSON.stringify(v);if(typeof v==="number"){if(!Number.isSafeInteger(v))throw new Error("C52_PREFLIGHT_NON_SAFE_INTEGER");return JSON.stringify(v)}if(Array.isArray(v))return`[${v.map(canon).join(",")}]`;if(obj(v))return`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`;throw new Error("C52_PREFLIGHT_UNSUPPORTED_CANONICAL_TYPE")}
const hash=v=>createHash("sha256").update(canon(v),"utf8").digest("hex");
function sh(v,c){if(!SHA.test(v??""))throw new Error(c);return v}

export function compileCrossStackAuthClosurePreflightV1(input={}){
 if(!input.crossStackSync||input.crossStackSync.CROSS_STACK_COMPATIBILITY!=="PASS")throw new Error("C52_CROSS_STACK_SYNC_PASS_REQUIRED");
 const reqSet=collectAuthRequirementsV1(input.authRequirements??[]);
 const credentialManifest=compileFinalCredentialBindManifestV1(reqSet.requirements.map(r=>({provider:r.provider,capability:r.capability,scope:r.scope,reason:r.reason})));
 const authManifest=compileFinalAuthBindManifestV1({projectIdentityDigest:sh(input.projectIdentityDigest,"PROJECT_IDENTITY_DIGEST_REQUIRED"),credentialManifest});
 const closure=compileTransitiveLiveAuthDependencyClosureV1({roots:input.liveDependencyRoots??[],dependencies:input.liveDependencies??{}});
 const runtimePreflight=evaluateAuthEndgameClosurePreflightV1({projectDevelopmentComplete:true,unresolvedRequirementCount:credentialManifest.requirements.length,interactivePromptCount:input.interactivePromptCount??0});
 const costEnvelope={mode:input.costEnvelope?.mode??"EXISTING_REPOSITORY_CI_ENVELOPE",newPaidResourceAllowed:false,maxNewPaidResourceMilliUsd:0,runnerBudgetClass:input.costEnvelope?.runnerBudgetClass??"EXISTING_CI_ENVELOPE"};
 const cleanup={userOwnedProviderResourceCreated:false,ephemeralCredentialCreatedByProject:false,platformManagedCredentialExpiryRequired:true,deleteOrTerminateReadbackRequired:true,residueScanRequired:true,...(input.cleanupObligations??{})};
 const errors=[];
 if(!["READY_NO_INTERACTION","ONE_AGGREGATED_AUTH_BOUNDARY"].includes(runtimePreflight.decision))errors.push("RUNTIME_AUTH_PREFLIGHT_NOT_READY");
 if(costEnvelope.newPaidResourceAllowed!==false||costEnvelope.maxNewPaidResourceMilliUsd!==0)errors.push("NEW_PAID_RESOURCE_NOT_ALLOWED_IN_PREFLIGHT");
 const body={SCHEMA_ID:"C52_AUTH_ENDGAME_CLOSURE_PREFLIGHT_V1",SCHEMA_VERSION:"1",crossStackSyncSha256:sh(input.crossStackSync.CROSS_STACK_SYNC_SHA256,"CROSS_STACK_SYNC_SHA_REQUIRED"),authRequirementSet:reqSet,FINAL_CREDENTIAL_BIND_MANIFEST_V1:credentialManifest,FINAL_AUTH_BIND_MANIFEST_V1:authManifest,transitiveLiveFinalDependencyClosure:closure,minimumAuthoritySet:credentialManifest.requirements,costEnvelope,cleanupObligations:cleanup,runtimePreflightDecision:runtimePreflight.decision,AUTH_ENDGAME_CLOSURE_PREFLIGHT_REQUIRES_AUTH:false,AUTH_ENDGAME_CLOSURE_PREFLIGHT_REQUIRES_PROVIDER_MUTATION:false,AUTH_ENDGAME_CLOSURE_PREFLIGHT_REQUIRES_PAID_COMPUTE:false,AUTH_BIND_INTERACTION_BUDGET_PER_PROJECT_RUN:1,errors,status:errors.length===0?"PASS":"FAIL"};
 return Object.freeze({...body,CLOSURE_PREFLIGHT_SHA256:hash(body)});
}

export function validateCrossStackAuthClosurePreflightV1(receipt){if(!receipt||receipt.SCHEMA_ID!=="C52_AUTH_ENDGAME_CLOSURE_PREFLIGHT_V1")return Object.freeze({ok:false,errors:["C52_CLOSURE_PREFLIGHT_REQUIRED"]});const {CLOSURE_PREFLIGHT_SHA256,...body}=receipt;const errors=[];if(!SHA.test(CLOSURE_PREFLIGHT_SHA256??"")||hash(body)!==CLOSURE_PREFLIGHT_SHA256)errors.push("CLOSURE_PREFLIGHT_DIGEST_MISMATCH");if(receipt.status!=="PASS")errors.push("CLOSURE_PREFLIGHT_NOT_PASS");if(receipt.AUTH_ENDGAME_CLOSURE_PREFLIGHT_REQUIRES_AUTH!==false||receipt.AUTH_ENDGAME_CLOSURE_PREFLIGHT_REQUIRES_PROVIDER_MUTATION!==false||receipt.AUTH_ENDGAME_CLOSURE_PREFLIGHT_REQUIRES_PAID_COMPUTE!==false)errors.push("CLOSURE_PREFLIGHT_CREDENTIAL_INDEPENDENCE_VIOLATION");return Object.freeze({ok:errors.length===0,errors})}
