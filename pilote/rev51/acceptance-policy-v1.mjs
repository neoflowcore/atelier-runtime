import { createHash } from "node:crypto";
const obj=v=>!!v&&typeof v==="object"&&!Array.isArray(v);
function canon(v){if(v===null)return"null";if(typeof v==="string"||typeof v==="boolean")return JSON.stringify(v);if(typeof v==="number"){if(!Number.isSafeInteger(v))throw Error("ACCEPTANCE_NON_SAFE_INTEGER");return JSON.stringify(v)}if(Array.isArray(v))return`[${v.map(canon).join(",")}]`;if(obj(v))return`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`;throw Error("ACCEPTANCE_UNSUPPORTED_TYPE")}
const hash=v=>createHash("sha256").update(canon(v),"utf8").digest("hex");
const req=(v,c)=>{if(typeof v!=="string"||!v)throw Error(c);return v};
const VALID_SCOPE_STATES=new Set(["PASS","FAIL","BLOCKED","PENDING","NOT_REQUIRED","NOT_GRANTED","STALE"]);
const STAGES={METADATA:0,TELEMETRY:1,MUTATION:2};

export function compileVerificationScopeV1(scope={}){
  const keys=["source","ci","providerBuild","liveAttestation","slo","projectAcceptance","releaseAcceptance"];
  const out={};for(const k of keys){const v=scope[k]??"PENDING";if(!VALID_SCOPE_STATES.has(v))throw Error(`VERIFICATION_SCOPE_STATE_INVALID:${k}`);out[k]=v;}
  const body={SCHEMA_ID:"PILOTE_VERIFICATION_SCOPE_V1",SCHEMA_VERSION:"1",...out};
  return Object.freeze({...body,VERIFICATION_SCOPE_SHA256:hash(body)});
}

export function buildAcceptanceDependencyGraphV1(nodes=[]){
  if(!Array.isArray(nodes)||nodes.length===0)throw Error("ACCEPTANCE_NODES_REQUIRED");const ids=new Set(),map={};
  for(const n of nodes){if(!obj(n))throw Error("ACCEPTANCE_NODE_INVALID");const id=req(n.nodeId,"ACCEPTANCE_NODE_ID_REQUIRED");if(ids.has(id))throw Error("ACCEPTANCE_NODE_DUPLICATE");ids.add(id);map[id]={nodeId:id,requiredEvidenceTypes:[...(n.requiredEvidenceTypes??[])].sort(),prerequisites:[...(n.prerequisites??[])].sort(),blockingPolicy:n.blockingPolicy??"BLOCK",acceptancePolicyVersion:req(n.acceptancePolicyVersion??"1","ACCEPTANCE_POLICY_VERSION_REQUIRED"),status:n.status??"PENDING"};}
  for(const n of Object.values(map))for(const p of n.prerequisites)if(!ids.has(p))throw Error(`ACCEPTANCE_PREREQUISITE_MISSING:${p}`);
  const body={SCHEMA_ID:"PILOTE_ACCEPTANCE_DEPENDENCY_GRAPH_V1",SCHEMA_VERSION:"1",nodes:Object.values(map).sort((a,b)=>a.nodeId.localeCompare(b.nodeId))};
  return Object.freeze({...body,ACCEPTANCE_GRAPH_SHA256:hash(body)});
}

export function evaluateAcceptanceNodeV1({graph,nodeId,evidenceTypes=[]}={}){
  if(!obj(graph)||graph.SCHEMA_ID!=="PILOTE_ACCEPTANCE_DEPENDENCY_GRAPH_V1")throw Error("ACCEPTANCE_GRAPH_REQUIRED");
  const n=graph.nodes.find(x=>x.nodeId===nodeId);if(!n)throw Error("ACCEPTANCE_NODE_NOT_FOUND");
  const unsatisfiedParents=n.prerequisites.filter(p=>graph.nodes.find(x=>x.nodeId===p)?.status!=="PASS");
  const ev=new Set(evidenceTypes);const missingEvidence=n.requiredEvidenceTypes.filter(e=>!ev.has(e));
  if(unsatisfiedParents.length)return Object.freeze({decision:"DENY",reason:"UNSATISFIED_REQUIRED_PARENT",unsatisfiedParents,missingEvidence});
  if(missingEvidence.length)return Object.freeze({decision:"DENY",reason:"REQUIRED_EVIDENCE_MISSING",unsatisfiedParents:[],missingEvidence});
  return Object.freeze({decision:"ACCEPT",reason:"PREREQUISITES_AND_EVIDENCE_SATISFIED",unsatisfiedParents:[],missingEvidence:[]});
}

export function planLeastPrivilegeEvidenceStagingV1({requiredEvidence=[]}={}){
  if(!Array.isArray(requiredEvidence))throw Error("REQUIRED_EVIDENCE_ARRAY_REQUIRED");
  let highest=0;for(const e of requiredEvidence){if(!obj(e)||!Object.hasOwn(STAGES,e.stage))throw Error("EVIDENCE_STAGE_INVALID");highest=Math.max(highest,STAGES[e.stage]);}
  const allowedStages=Object.entries(STAGES).filter(([,n])=>n<=highest).map(([k])=>k);
  return Object.freeze({stages:allowedStages,maximumAuthorityStage:allowedStages.at(-1)??"METADATA",broadCredentialBeforeRequired:false,optionalEvidenceAuthorityEscalation:false});
}

export function evaluateAuthorityExpansionV1(input={}){
  const current=new Set(input.currentAuthority??[]),delta=[...new Set(input.requestedDelta??[])].sort();
  if(delta.length===0)return Object.freeze({decision:"ALLOW",reason:"NO_AUTHORITY_EXPANSION",requestedDelta:[]});
  const undeclared=delta.filter(x=>typeof x!=="string"||!x);if(undeclared.length)throw Error("AUTHORITY_DELTA_INVALID");
  if(input.releaseAuthority===true||input.destructiveAuthority===true||input.costBoundaryExpansion===true||input.providerMutation===true)return Object.freeze({decision:"HARD_AUTHORITY_BOUNDARY",reason:"SENSITIVE_AUTHORITY_EXPANSION",requestedDelta:delta});
  if(input.newExternalSecret===true){return Object.freeze({decision:input.projectDevelopmentComplete===true?"PROJECT_END_AUTH_BOUNDARY":"DEFERRED_POST_DEVELOPMENT_CREDENTIAL_BIND",reason:"NEW_EXTERNAL_AUTH_MATERIAL",requestedDelta:delta});}
  if(delta.every(x=>current.has(x)))return Object.freeze({decision:"ALLOW",reason:"WITHIN_CURRENT_GRANT",requestedDelta:delta});
  const pre=new Set(input.preapprovedReadCapabilities??[]);if(delta.every(x=>pre.has(x)))return Object.freeze({decision:"ALLOW",reason:"PREAPPROVED_LEAST_PRIVILEGE_READ_DELTA",requestedDelta:delta});
  return Object.freeze({decision:"DENY",reason:"AUTHORITY_EXPANSION_NOT_PREAPPROVED",requestedDelta:delta});
}

export function consumeRuntimeEvidenceInvalidationV1({runtimeInvalidation,acceptanceNodes=[]}={}){
  if(!obj(runtimeInvalidation)||!Array.isArray(runtimeInvalidation.staleEvidenceIds))throw Error("RUNTIME_INVALIDATION_RECEIPT_REQUIRED");
  const stale=new Set(runtimeInvalidation.staleEvidenceIds);const affected=[];
  for(const n of acceptanceNodes){const deps=n.requiredEvidenceIds??[];if(deps.some(id=>stale.has(id)))affected.push(n.nodeId);}
  return Object.freeze({affectedAcceptanceNodes:[...new Set(affected)].sort(),fullRevalidationRequired:false,invalidationPolicy:"ONLY_AFFECTED_EVIDENCE"});
}

export function evaluateContentIdentityReuseAcceptanceV1(runtimeReuseReceipt={}){
  if(runtimeReuseReceipt.exactContentIdentity!==true)return Object.freeze({accepted:false,reusableEvidenceIds:[],reason:"CONTENT_IDENTITY_CHANGED"});
  const reusable=(runtimeReuseReceipt.evidence??[]).filter(e=>e.REUSABLE===true&&e.REASON==="EXACT_CONTENT_IDENTITY_MATCH").map(e=>e.EVIDENCE_ID).sort();
  return Object.freeze({accepted:reusable.length>0,reusableEvidenceIds:reusable,reason:reusable.length?"EXACT_CONTENT_EVIDENCE_REUSE_ACCEPTED":"NO_REUSABLE_CONTENT_EVIDENCE"});
}

export function evaluateDependencySecurityPolicyV1({observation,policy={}}={}){
  if(!obj(observation)||observation.MUTATION_AUTHORITY!==false)throw Error("DEPENDENCY_SECURITY_OBSERVATION_REQUIRED");
  const c=observation.SEVERITY_COUNTS??{};const critical=c.CRITICAL??0,high=c.HIGH??0;
  if(critical>(policy.maxCritical??0))return Object.freeze({decision:"BLOCK",reason:"CRITICAL_DEPENDENCY_SECURITY_THRESHOLD"});
  if(high>(policy.maxHigh??Number.MAX_SAFE_INTEGER))return Object.freeze({decision:"DEFER",reason:"HIGH_DEPENDENCY_SECURITY_THRESHOLD"});
  return Object.freeze({decision:"RELEASE",reason:"DEPENDENCY_SECURITY_POLICY_SATISFIED"});
}

export function compileAcceptancePolicyManifestV1(input={}){
  const body={SCHEMA_ID:"PILOTE_ACCEPTANCE_POLICY_MANIFEST_V1",SCHEMA_VERSION:"1",VERIFICATION_SCOPE_SHA256:req(input.verificationScopeSha256,"VERIFICATION_SCOPE_SHA256_REQUIRED"),ACCEPTANCE_GRAPH_SHA256:req(input.acceptanceGraphSha256,"ACCEPTANCE_GRAPH_SHA256_REQUIRED"),STAGED_EVIDENCE_ACQUISITION:"REQUIRED",MINIMUM_AUTHORITY_DELTA:"REQUIRED",REMOTE_VERIFIED_WITHOUT_SCOPE:"DENY",PROJECT_ACCEPTED_NOT_RELEASE_AUTHORITY:true};
  return Object.freeze({...body,ACCEPTANCE_POLICY_SHA256:hash(body)});
}