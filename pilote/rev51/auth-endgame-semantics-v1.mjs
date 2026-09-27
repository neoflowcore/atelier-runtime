import { createHash } from "node:crypto";
const obj=v=>!!v&&typeof v==="object"&&!Array.isArray(v);
function canon(v){if(v===null)return"null";if(typeof v==="string"||typeof v==="boolean")return JSON.stringify(v);if(typeof v==="number"){if(!Number.isSafeInteger(v))throw Error("AUTH_SEMANTICS_NON_SAFE_INTEGER");return JSON.stringify(v)}if(Array.isArray(v))return`[${v.map(canon).join(",")}]`;if(obj(v))return`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`;throw Error("AUTH_SEMANTICS_UNSUPPORTED_TYPE")}
const hash=v=>createHash("sha256").update(canon(v),"utf8").digest("hex");
const req=(v,c)=>{if(typeof v!=="string"||!v)throw Error(c);return v};

export function compileCredentialRequiredAtPolicyV1(requirements=[]){
  if(!Array.isArray(requirements))throw Error("CREDENTIAL_REQUIREMENTS_ARRAY_REQUIRED");
  const out=requirements.map(r=>{if(!obj(r))throw Error("CREDENTIAL_REQUIREMENT_INVALID");return{provider:req(r.provider,"PROVIDER_REQUIRED"),capability:req(r.capability,"CAPABILITY_REQUIRED"),scope:req(r.scope,"SCOPE_REQUIRED"),requiredAt:r.externalAuth===true?"PROJECT_END_GLOBAL_AUTH_ENDGAME":"RUNTIME_NATIVE_OR_NO_EXTERNAL_BIND",developmentBindingAllowed:false};});
  const body={SCHEMA_ID:"PILOTE_CREDENTIAL_REQUIRED_AT_POLICY_V1",SCHEMA_VERSION:"1",requirements:out.sort((a,b)=>`${a.provider}/${a.capability}/${a.scope}`.localeCompare(`${b.provider}/${b.capability}/${b.scope}`)),rawSecretChatNormalPath:"DENY",developmentCredentialPrompt:"DENY"};
  return Object.freeze({...body,REQUIRED_AT_POLICY_SHA256:hash(body)});
}

export function compileFinalAuthBindSemanticManifestV1({projectDevelopmentComplete=false,requirements=[]}={}){
  const seen=new Map();for(const r of requirements){if(!obj(r))throw Error("AUTH_REQUIREMENT_INVALID");const n={provider:req(r.provider,"PROVIDER_REQUIRED"),capability:req(r.capability,"CAPABILITY_REQUIRED"),scope:req(r.scope,"SCOPE_REQUIRED")};seen.set(`${n.provider}\0${n.capability}\0${n.scope}`,n)}
  const normalized=[...seen.values()].sort((a,b)=>a.provider.localeCompare(b.provider)||a.capability.localeCompare(b.capability)||a.scope.localeCompare(b.scope));
  const body={SCHEMA_ID:"PILOTE_FINAL_AUTH_BIND_SEMANTIC_MANIFEST_V1",SCHEMA_VERSION:"1",state:projectDevelopmentComplete?"SEALED_FOR_BIND":"DRAFT_DEFERRED_DEVELOPMENT",requirements:normalized,existingAuthReuseFirst:true,interactiveAuthPromptMaxPerProjectRun:1,partialBindThenDiscoverMore:false,rawSecretChatNormalPath:"DENY"};
  return Object.freeze({...body,SEMANTIC_AUTH_MANIFEST_SHA256:hash(body)});
}

export function evaluateAuthEndgameBoundarySemanticsV1(input={}){
  if(input.projectDevelopmentComplete!==true)return Object.freeze({decision:"DEFER_AUTH_CONTINUE_DEVELOPMENT",interactivePromptAllowed:0});
  const unresolved=Number.isSafeInteger(input.unresolvedRequirementCount)?input.unresolvedRequirementCount:0;
  if(unresolved===0)return Object.freeze({decision:"REUSE_EXISTING_AUTH_NO_INTERACTION",interactivePromptAllowed:0});
  const used=Number.isSafeInteger(input.interactivePromptCount)?input.interactivePromptCount:0;
  if(used>=1)return Object.freeze({decision:"SECOND_AUTH_PROMPT_DENIED",interactivePromptAllowed:0});
  return Object.freeze({decision:"ONE_AGGREGATED_AUTH_BOUNDARY",interactivePromptAllowed:1});
}

export function compileAuthEndgameTransactionSemanticsV1({semanticAuthManifest,boundaryDecision}={}){
  if(!obj(semanticAuthManifest)||semanticAuthManifest.state!=="SEALED_FOR_BIND")throw Error("SEALED_AUTH_MANIFEST_REQUIRED");
  if(!obj(boundaryDecision)||!["REUSE_EXISTING_AUTH_NO_INTERACTION","ONE_AGGREGATED_AUTH_BOUNDARY"].includes(boundaryDecision.decision))throw Error("AUTH_BOUNDARY_NOT_READY");
  const sequence=["BIND_MINIMUM_AUTH_SET","VALIDATE_BINDINGS","LIVE_PREFLIGHT","LIVE_INTEGRATION","LIVE_ATTESTATION","CANONICAL_EVIDENCE","CLEANUP_OR_REVOKE_TEMP_AUTH","BILLABLE_RESIDUE_SCAN","FINAL_ACCEPTANCE","FINAL_LIVE_SEAL"];
  const body={SCHEMA_ID:"PILOTE_AUTH_ENDGAME_TRANSACTION_SEMANTICS_V1",SCHEMA_VERSION:"1",SEMANTIC_AUTH_MANIFEST_SHA256:semanticAuthManifest.SEMANTIC_AUTH_MANIFEST_SHA256,interactionMode:boundaryDecision.decision,sequence,secondAuthPromptAllowed:false,postBindAuthRediscoveryNormalPath:false};
  return Object.freeze({...body,AUTH_ENDGAME_SEMANTICS_SHA256:hash(body)});
}
