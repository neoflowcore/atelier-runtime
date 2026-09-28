import { createHash } from "node:crypto";
import { compileAuthEndgameTransactionV1 } from "../../runtime/rev51/auth-endgame-transaction-v1.mjs";

const SHA=/^[0-9a-f]{64}$/;
function obj(v){return !!v&&typeof v==="object"&&!Array.isArray(v)}
function canon(v){if(v===null)return"null";if(typeof v==="string"||typeof v==="boolean")return JSON.stringify(v);if(typeof v==="number"){if(!Number.isSafeInteger(v))throw new Error("C52_LIVE_NON_SAFE_INTEGER");return JSON.stringify(v)}if(Array.isArray(v))return`[${v.map(canon).join(",")}]`;if(obj(v))return`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`;throw new Error("C52_LIVE_UNSUPPORTED_CANONICAL_TYPE")}
const hash=v=>createHash("sha256").update(canon(v),"utf8").digest("hex");
function sh(v,c){if(!SHA.test(v??""))throw new Error(c);return v}

export function compileGlobalAuthEndgameV1({closurePreflight,authObservation}={}){
  if(!closurePreflight||closurePreflight.SCHEMA_ID!=="C52_AUTH_ENDGAME_CLOSURE_PREFLIGHT_V1"||closurePreflight.status!=="PASS")throw new Error("C52_CLOSURE_PREFLIGHT_PASS_REQUIRED");
  if(!obj(authObservation))throw new Error("C52_AUTH_OBSERVATION_REQUIRED");
  const interactionCount=Number.isSafeInteger(authObservation.interactionCount)?authObservation.interactionCount:-1;
  if(interactionCount<0||interactionCount>1)throw new Error("C52_AUTH_INTERACTION_BUDGET_EXCEEDED");
  if(authObservation.rawSecretMaterialObserved===true)throw new Error("C52_RAW_SECRET_MATERIAL_DENIED");
  if(authObservation.existingAuthReused!==true)throw new Error("C52_EXISTING_AUTH_REUSE_REQUIRED");
  const runtimeTransaction=compileAuthEndgameTransactionV1({
    authManifest:closurePreflight.FINAL_AUTH_BIND_MANIFEST_V1,
    closure:closurePreflight.transitiveLiveFinalDependencyClosure,
    preflight:{decision:closurePreflight.runtimePreflightDecision}
  });
  const required=closurePreflight.minimumAuthoritySet.map(x=>`${x.provider}:${x.capability}:${x.scope}`).sort();
  const observed=[...(authObservation.authoritySet??[])].sort();
  const missing=required.filter(x=>!observed.includes(x));
  const body={
    SCHEMA_ID:"C52_GLOBAL_AUTH_ENDGAME_V1",SCHEMA_VERSION:"1",
    closurePreflightSha256:sh(closurePreflight.CLOSURE_PREFLIGHT_SHA256,"C52_PREFLIGHT_SHA_REQUIRED"),
    runtimeAuthEndgameTransactionSha256:runtimeTransaction.AUTH_ENDGAME_TRANSACTION_SHA256,
    authMode:authObservation.authMode??"EXISTING_PLATFORM_MANAGED_JOB_TOKEN",
    existingAuthReused:true,interactionCount,rawSecretMaterialObserved:false,
    requiredAuthoritySet:required,observedAuthoritySet:observed,missingAuthority:missing,
    perProviderMicroAuthLoop:false,secondAuthPromptAllowed:false,
    authResiduePolicy:"PLATFORM_MANAGED_EPHEMERAL_NOT_PERSISTED",
    status:missing.length===0?"PASS":"FAIL"
  };
  return Object.freeze({...body,PROJECT_AUTH_ENDGAME_SHA256:hash(body)});
}

export function compileFinalLiveQualificationV1(input={}){
  const errors=[];
  if(!input.authEndgame||input.authEndgame.status!=="PASS")errors.push("PROJECT_AUTH_ENDGAME_NOT_PASS");
  for(const k of ["sourceProvenance","bindingIdentity","productionAttestation","providerQualification","liveIntegration","recoveryRehearsal","canonicalEvidence","cleanupClosure","deleteTerminateReadback","residueScan"]) if(input[k]!=="PASS")errors.push(`${k.toUpperCase()}_NOT_PASS`);
  const activePaidCompute=Number.isSafeInteger(input.activePaidCompute)?input.activePaidCompute:-1;
  const orphanedBillableResource=Number.isSafeInteger(input.orphanedBillableResource)?input.orphanedBillableResource:-1;
  const billableResidue=Number.isSafeInteger(input.billableResidue)?input.billableResidue:-1;
  if(activePaidCompute!==0)errors.push("ACTIVE_PAID_COMPUTE_NOT_ZERO");
  if(orphanedBillableResource!==0)errors.push("ORPHANED_BILLABLE_RESOURCE_NOT_ZERO");
  if(billableResidue!==0)errors.push("BILLABLE_RESIDUE_NOT_ZERO");
  if(input.thirdPartyPaidExecutionNormalPathCount!==0)errors.push("THIRD_PARTY_PAID_EXECUTION_USED");
  if(input.authInteractionCount>1)errors.push("AUTH_INTERACTION_BUDGET_EXCEEDED");
  const body={
    SCHEMA_ID:"C52_FINAL_LIVE_QUALIFICATION_V1",SCHEMA_VERSION:"1",
    projectAuthEndgameSha256:sh(input.authEndgame?.PROJECT_AUTH_ENDGAME_SHA256,"PROJECT_AUTH_ENDGAME_SHA_REQUIRED"),
    executionHead:input.executionHead??null,executionTree:input.executionTree??null,runId:input.runId??null,jobId:input.jobId??null,
    sourceProvenance:input.sourceProvenance,bindingIdentity:input.bindingIdentity,productionAttestation:input.productionAttestation,
    providerQualification:input.providerQualification,liveIntegration:input.liveIntegration,recoveryRehearsal:input.recoveryRehearsal,
    canonicalEvidence:input.canonicalEvidence,cleanupClosure:input.cleanupClosure,deleteTerminateReadback:input.deleteTerminateReadback,residueScan:input.residueScan,
    activePaidCompute,orphanedBillableResource,billableResidue,
    authInteractionCount:input.authInteractionCount,thirdPartyPaidExecutionNormalPathCount:input.thirdPartyPaidExecutionNormalPathCount,
    newPaidProviderResourceCreated:false,projectCreatedEphemeralCredential:false,
    platformManagedCredentialExpiry:"REQUIRED_AUTOMATIC",
    errors,LIVE_ACCEPTANCE:errors.length===0?"PASS":"FAIL"
  };
  return Object.freeze({...body,FINAL_LIVE_QUALIFICATION_SHA256:hash(body)});
}

export function finalizeCanonicalLiveEvidenceV1({qualification,artifact}={}){
  if(!qualification||qualification.SCHEMA_ID!=="C52_FINAL_LIVE_QUALIFICATION_V1"||qualification.LIVE_ACCEPTANCE!=="PASS")throw new Error("C52_LIVE_QUALIFICATION_PASS_REQUIRED");
  if(!obj(artifact)||!Number.isSafeInteger(artifact.id)||typeof artifact.name!=="string"||!artifact.name||artifact.expired===true)throw new Error("C52_CANONICAL_ARTIFACT_REQUIRED");
  const body={
    SCHEMA_ID:"C52_FINAL_LIVE_ACCEPTANCE_RECEIPT_V1",SCHEMA_VERSION:"1",
    qualificationSha256:qualification.FINAL_LIVE_QUALIFICATION_SHA256,
    canonicalEvidenceArtifact:{id:artifact.id,name:artifact.name,sizeInBytes:artifact.size_in_bytes??null,digest:artifact.digest??null,createdAt:artifact.created_at??null,expired:false},
    authResidue:"PASS_PLATFORM_MANAGED_TOKEN_NOT_PERSISTED",
    cleanupResidue:"PASS_ZERO",
    FINAL_LIVE_SEAL:"PASS",
    finalMergeReleaseAuthorityGranted:false,
    nextBoundary:"FINAL_RELEASE_MERGE_AUTHORITY_REQUIRED"
  };
  return Object.freeze({...body,FINAL_LIVE_ACCEPTANCE_SHA256:hash(body)});
}
