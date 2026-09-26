import { createHash } from "node:crypto";

export const A8_AUTHORITATIVE_BINDING=Object.freeze({
  REPOSITORY:"neoflowcore/atelier-runtime",
  BRANCH:"pilote-r51-a8-backward-compatibility-semantic-artifacts",
  HEAD:"96ab5e3b3d9ac17452d0c707b508152b7d09c197",
  TREE:"3f8f0d2fd5795724d88ec7f7b47eed8bfc659774",
  MODULE_SHA256:"6f2ff2b90a505029f05988870329d0f181c8791fb0fa66e18e54b06d760360d1",
  SCHEMA_SHA256:"5b52e8b9d183b6beb8aaee42e8365b64c5faafb67def3cbdbac4b0fe9e9601db",
  TEST_VECTOR_SET_SHA256:"9f08e739759f07abf07fc4c5c95ad4fc27dee901ca74e3014543de1ac99b8a13",
  EXPECTED_RESULT_SET_SHA256:"92be3ace31932d9acde6e39077d055ceb62aa9636bb2b179b28252799770728d",
  SEMANTIC_ARTIFACT_SET_SHA256:"4220684785f382c3dc0d252da8715ceb0ecb79d6783cf6901ac3e26eb21e8ca9",
  SEMANTIC_ARTIFACT_INTERNAL_SHA256:"3f952906794e162f9f392f7bf832c05d1876d3bdcd66bd4c27f17b19494cc292",
  AUTHORITATIVE_MANIFEST_SHA256:"82723878aa150627158c80f14dff38ed82a4d901c474b09c410119cde2568ee5",
  CONTRACT_SET_SHA256:"a8b220c92a47306061e9aca1c65077d357b00bda12e9daad4f37215256083f4a"
});

export const A8_COMPAT_PROFILES=Object.freeze({
  REV42_TASK_V1:Object.freeze({
    ID:"COMPAT_PROFILE_REV42_TASK_V1",VERSION:"1.0.0",
    LEGACY_SEALED_IDENTITY_SHA256:"90b016211babd4f10b7de7700c54ea6e2db9179563d88502fc1d9983ad47b617",
    SHA256:"bb36e0eeb02def246696894b91121348330bc3086124e68753a69a8d40e41be8"
  }),
  REV45_PHASE_V1:Object.freeze({
    ID:"COMPAT_PROFILE_REV45_PHASE_V1",VERSION:"1.0.0",
    LEGACY_SEALED_IDENTITY_SHA256:"3439a7249b6ba9051269c89e6d783a343457cf01e43ec8a62dcffd1b0ed55284",
    SHA256:"b758045aaa65f02e9f22f73c330220b12a9e3b399603d3115026175dce9a4049"
  }),
  REV50_FRAMEWORK_V1:Object.freeze({
    ID:"COMPAT_PROFILE_REV50_FRAMEWORK_V1",VERSION:"1.0.0",
    LEGACY_SEALED_IDENTITY_SHA256:"141fe59a393fe5224833fe0d83ec80589464d08bf2bf7729c3cf7b9d9c0f00f8",
    SHA256:"fca1cea7faa088d7d5e013b12561c654585e7e5b73cc5353a6772d42c4169984"
  })
});

const SHA=/^[0-9a-f]{64}$/;
const INPUT_MODES=new Set(["LEGACY_COMPAT","NATIVE_REV51"]);
const REGISTRY_STATES=new Set(["ACTIVE","DEPRECATED","REVOKED"]);
const SAFE_DEFAULTS=new Set([
  "PROVIDER_AUTO_SELECTION","CHECKPOINT_DISABLED_WHEN_NOT_REQUESTED","CACHE_DISABLED_WHEN_NOT_REQUESTED",
  "ZERO_TOUCH_EXECUTION","FENCING","DURABLE_STATE","ARTIFACT_QUARANTINE","CLEANUP_ENFORCEMENT",
  "BILLING_STOP_ENFORCEMENT"
]);
const DERIVED_DEFAULTS=new Set([
  "CAPABILITY_REQUIREMENTS","RESOURCE_REQUIREMENTS","NETWORK_CLASS","DATA_ACCESS_CLASS","SECRET_CLASS",
  "VERIFIER_REQUIREMENTS","ACCEPTANCE_REQUIREMENTS"
]);
const EXPLICIT_REV51=new Set([
  "EXPLICIT_GPU_TOPOLOGY","ADVANCED_CHECKPOINT_POLICY","ADVANCED_CACHE_POLICY","DATA_LOCALITY",
  "ADVANCED_ISOLATION_SECURITY","ADVANCED_BUDGET_INTENT","HYBRID_EXECUTION_PREFERENCE"
]);
const HARDENING_ALLOW=new Set([
  "DURABLE_STATE","FENCING","ARTIFACT_QUARANTINE","RESOURCE_OWNERSHIP_PROOF","OUTCOME_UNKNOWN_RECONCILIATION",
  "SECRET_REDACTION","CLEANUP_ENFORCEMENT","BILLING_STOP_ENFORCEMENT","ZERO_TOUCH_BOOTSTRAP"
]);
const HARDENING_FORBID_TARGETS=new Set([
  "TASK_SEMANTICS","DEPENDENCY_SEMANTICS","ACCEPTANCE_SEMANTICS","EXPECTED_PROJECT_OUTPUT","DECLARED_EFFECT_BOUNDARY"
]);
const RECEIPT_COMPAT_FIELDS=["INPUT_MODE","COMPAT_PROFILE_ID","COMPAT_PROFILE_VERSION","COMPAT_PROFILE_SHA256"];
const IDENTITY_CHAIN_FIELDS=[
  "LEGACY_SEALED_INPUT_HASH","TASK_CONTRACT_HASH","COMPAT_PROFILE_HASH",
  "RUNTIME_EXECUTION_PLAN_HASH","WORKER_JOB_HASH","EXECUTION_RECEIPT_HASH"
];

const object=v=>!!v&&typeof v==="object"&&!Array.isArray(v);
function canonical(v){
  if(v===null)return"null";
  if(typeof v==="boolean")return v?"true":"false";
  if(typeof v==="number"){if(!Number.isSafeInteger(v))throw Error("A8_NON_SAFE_INTEGER");return String(v)}
  if(typeof v==="string")return JSON.stringify(v);
  if(Array.isArray(v))return"["+v.map(canonical).join(",")+"]";
  if(object(v))return"{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+canonical(v[k])).join(",")+"}";
  throw Error("A8_UNSUPPORTED_CANONICAL_TYPE");
}
function hash(v){return createHash("sha256").update(canonical(v),"utf8").digest("hex")}

export function computeA8ArtifactSha256V1(artifact){
  const copy=structuredClone(artifact);delete copy.A8_ARTIFACT_SHA256;return hash(copy);
}

export function validateA8SemanticArtifactV1(artifact){
  const e=[];
  if(!object(artifact))return{ok:false,errors:["A8_ARTIFACT_REQUIRED"]};
  if(artifact.ARTIFACT_TYPE!=="PILOTE_BACKWARD_COMPATIBILITY_SEMANTIC_ARTIFACTS_V1")e.push("A8_ARTIFACT_TYPE_MISMATCH");
  if(artifact.ARTIFACT_VERSION!=="1.0.0")e.push("A8_ARTIFACT_VERSION_MISMATCH");
  if(artifact.CANONICALIZATION_ID!=="ATELIER_EXECUTION_CANONICAL_JSON_V1")e.push("A8_CANONICALIZATION_ID_MISMATCH");
  if(artifact.CONTRACT_SET_REF?.SHA256!==A8_AUTHORITATIVE_BINDING.CONTRACT_SET_SHA256)e.push("CONTRACT_SET_REF_MISMATCH");
  const p=artifact.COMPATIBILITY_POLICY??{};
  if(p.LEGACY_EXECUTION_COMPATIBILITY_ADAPTER!=="YES")e.push("LEGACY_EXECUTION_COMPATIBILITY_ADAPTER_MISMATCH");
  if(p.LEGACY_SEMANTICS_ADAPTER!=="NO")e.push("LEGACY_SEMANTICS_ADAPTER_MISMATCH");
  if(p.RUNTIME_MAY_REDEFINE_PROFILE_SEMANTICS!=="NO")e.push("RUNTIME_PROFILE_REDEFINITION_DENIED");
  if(p.RUNTIME_DEFINED_EQUIVALENCE!=="DENY")e.push("RUNTIME_DEFINED_EQUIVALENCE_DENIED");
  if(p.LEGACY_REQUIRED_FIELD_ADDITION!=="DENY")e.push("LEGACY_REQUIRED_FIELD_ADDITION_DENIED");
  if(p.SEMANTIC_REINTERPRETATION!=="DENY")e.push("SEMANTIC_REINTERPRETATION_DENIED");
  if(artifact.INPUT_MODE_POLICY?.ONE_EXECUTION_EXACTLY_ONE_INPUT_MODE!=="REQUIRED")e.push("INPUT_MODE_EXCLUSIVITY_MISMATCH");
  if(artifact.INPUT_MODE_POLICY?.NATIVE_TO_LEGACY_DOWNGRADE!=="DENY")e.push("REV51_TO_LEGACY_DOWNGRADE_DENIED");
  if(artifact.INPUT_MODE_POLICY?.LEGACY_TO_REV51_INTENT_SYNTHESIS!=="DENY")e.push("LEGACY_TO_REV51_INTENT_SYNTHESIS_DENIED");
  if(artifact.LEGACY_ACCEPTANCE_ORACLE?.RUNTIME_DEFINED_EQUIVALENCE!=="DENY")e.push("LEGACY_ORACLE_RUNTIME_DEFINED_EQUIVALENCE_DENIED");
  if(!SHA.test(artifact.A8_ARTIFACT_SHA256??""))e.push("A8_ARTIFACT_SHA256_INVALID");
  else if(computeA8ArtifactSha256V1(artifact)!==artifact.A8_ARTIFACT_SHA256)e.push("A8_ARTIFACT_SHA256_MISMATCH");
  if(artifact.A8_ARTIFACT_SHA256!==A8_AUTHORITATIVE_BINDING.SEMANTIC_ARTIFACT_INTERNAL_SHA256)e.push("A8_AUTHORITATIVE_ARTIFACT_IDENTITY_MISMATCH");
  return{ok:!e.length,errors:e};
}

export function selectA8CompatProfileV1(artifact,legacySourceFamily,legacySealedIdentitySha256){
  const a=validateA8SemanticArtifactV1(artifact);if(!a.ok)return{ok:false,outcome:"BLOCKED_LEGACY_COMPATIBILITY_REQUIREMENT",profile:null,errors:a.errors};
  const expected=A8_COMPAT_PROFILES[legacySourceFamily];
  if(!expected)return{ok:false,outcome:"BLOCKED_UNKNOWN_COMPAT_PROFILE",profile:null,errors:[]};
  if(expected.LEGACY_SEALED_IDENTITY_SHA256!==legacySealedIdentitySha256)return{ok:false,outcome:"BLOCKED_LEGACY_IDENTITY_MISMATCH",profile:null,errors:[]};
  const profile=(artifact.COMPAT_PROFILES??[]).find(x=>x.COMPAT_PROFILE_ID===expected.ID&&x.LEGACY_SOURCE_FAMILY===legacySourceFamily);
  if(!profile||profile.COMPAT_PROFILE_SHA256!==expected.SHA256)return{ok:false,outcome:"BLOCKED_LEGACY_COMPATIBILITY_REQUIREMENT",profile:null,errors:["PROFILE_ARTIFACT_BINDING_MISMATCH"]};
  const entry=(artifact.COMPAT_PROFILE_REGISTRY??[]).find(x=>x.PROFILE_SHA256===expected.SHA256);
  if(!entry||!REGISTRY_STATES.has(entry.STATUS))return{ok:false,outcome:"BLOCKED_UNKNOWN_COMPAT_PROFILE",profile:null,errors:[]};
  if(entry.STATUS==="REVOKED")return{ok:false,outcome:"BLOCKED_LEGACY_COMPATIBILITY_REQUIREMENT",profile:null,errors:[]};
  return{ok:true,outcome:"PROFILE_SELECTED",profile:{ID:expected.ID,VERSION:expected.VERSION,SHA256:expected.SHA256},errors:[]};
}

export function validateA8InputModeV1({inputMode,nativeExecutionIntentPresent=false,compatProfileSha256=null}={}){
  if(!INPUT_MODES.has(inputMode))return{ok:false,outcome:"BLOCKED_LEGACY_COMPATIBILITY_REQUIREMENT"};
  if(inputMode==="NATIVE_REV51"&&compatProfileSha256!==null)return{ok:false,outcome:"REV51_TO_LEGACY_DOWNGRADE_DENY"};
  if(inputMode==="LEGACY_COMPAT"&&nativeExecutionIntentPresent)return{ok:false,outcome:"LEGACY_TO_REV51_INTENT_SYNTHESIS_DENY"};
  if(inputMode==="LEGACY_COMPAT"&&!SHA.test(compatProfileSha256??""))return{ok:false,outcome:"BLOCKED_UNKNOWN_COMPAT_PROFILE"};
  return{ok:true,outcome:"INPUT_MODE_ACCEPTED"};
}

export function classifyA8LegacyFeatureV1(feature){
  if(SAFE_DEFAULTS.has(feature))return{ok:true,class:"A_SAFE_RUNTIME_DEFAULT",outcome:"SUPPORTED_TRANSPARENT_RUNTIME_HARDENING"};
  if(DERIVED_DEFAULTS.has(feature))return{ok:true,class:"B_DERIVED_FROM_EXISTING_CONTRACT",outcome:"DERIVE_FROM_EXISTING_CONTRACT"};
  if(EXPLICIT_REV51.has(feature))return{ok:false,class:"C_REQUIRES_EXPLICIT_REV51_INTENT",outcome:"BLOCKED_NEEDS_REV51_EXECUTION_INTENT"};
  return{ok:false,class:null,outcome:"BLOCKED_LEGACY_COMPATIBILITY_REQUIREMENT"};
}

export function validateA8TransparentHardeningV1({hardening,targets=[]}={}){
  if(!HARDENING_ALLOW.has(hardening))return{ok:false,outcome:"BLOCKED_LEGACY_COMPATIBILITY_REQUIREMENT"};
  if(!Array.isArray(targets)||targets.some(x=>HARDENING_FORBID_TARGETS.has(x)))return{ok:false,outcome:"BLOCKED_LEGACY_COMPATIBILITY_REQUIREMENT"};
  return{ok:true,outcome:"TRANSPARENT_HARDENING_ALLOWED"};
}

export function validateA8ReceiptCompatibilityMetadataV1(metadata,profile){
  const e=[];
  if(!object(metadata))return{ok:false,errors:["RECEIPT_COMPATIBILITY_METADATA_REQUIRED"]};
  const keys=Object.keys(metadata).sort(),wanted=[...RECEIPT_COMPAT_FIELDS].sort();
  if(keys.length!==wanted.length||!keys.every((x,i)=>x===wanted[i]))e.push("RECEIPT_COMPATIBILITY_FIELDS_MISMATCH");
  if(metadata.INPUT_MODE!=="LEGACY_COMPAT")e.push("RECEIPT_INPUT_MODE_MISMATCH");
  if(metadata.COMPAT_PROFILE_ID!==profile?.ID)e.push("RECEIPT_COMPAT_PROFILE_ID_MISMATCH");
  if(metadata.COMPAT_PROFILE_VERSION!==profile?.VERSION)e.push("RECEIPT_COMPAT_PROFILE_VERSION_MISMATCH");
  if(metadata.COMPAT_PROFILE_SHA256!==profile?.SHA256)e.push("RECEIPT_COMPAT_PROFILE_SHA256_MISMATCH");
  return{ok:!e.length,errors:e};
}

export function validateA8LegacyIdentityChainV1(chain,profile){
  const e=[];
  if(!object(chain))return{ok:false,errors:["LEGACY_IDENTITY_CHAIN_REQUIRED"]};
  for(const k of IDENTITY_CHAIN_FIELDS)if(!SHA.test(chain[k]??""))e.push(k+"_INVALID");
  if(chain.COMPAT_PROFILE_HASH!==profile?.SHA256)e.push("COMPAT_PROFILE_HASH_BINDING_MISMATCH");
  return{ok:!e.length,errors:e};
}

export function projectA8LegacyAcceptanceV1(receipt){
  if(!object(receipt)||receipt.RUNTIME_SEALED!==true)return{ok:false,outcome:"BLOCKED_LEGACY_ACCEPTANCE_ORACLE_MISSING",projection:null};
  const map={PASS:"PASS",FAIL:"NON_PASS",BLOCKED:"BLOCKED",OUTCOME_UNKNOWN:"OUTCOME_UNKNOWN"};
  const value=map[receipt.VERIFICATION_RESULT];
  if(!value)return{ok:false,outcome:"BLOCKED_LEGACY_COMPATIBILITY_REQUIREMENT",projection:null};
  return{ok:true,outcome:"PROJECTED",projection:{SEMANTIC_RESULT_PROJECTION_ID:"SEMANTIC_RESULT_PROJECTION_LEGACY_ACCEPTANCE_V1",ACCEPTANCE_OUTCOME:value}};
}

export function evaluateA8LegacyAcceptanceOracleV1(projection){
  if(!object(projection)||projection.SEMANTIC_RESULT_PROJECTION_ID!=="SEMANTIC_RESULT_PROJECTION_LEGACY_ACCEPTANCE_V1")return{ok:false,verdict:"BLOCKED_LEGACY_ACCEPTANCE_ORACLE_MISSING"};
  if(projection.ACCEPTANCE_OUTCOME==="PASS")return{ok:true,verdict:"PASS"};
  if(projection.ACCEPTANCE_OUTCOME==="OUTCOME_UNKNOWN")return{ok:false,verdict:"OUTCOME_UNKNOWN"};
  if(["NON_PASS","BLOCKED"].includes(projection.ACCEPTANCE_OUTCOME))return{ok:false,verdict:"FAIL"};
  return{ok:false,verdict:"BLOCKED_LEGACY_ACCEPTANCE_ORACLE_MISSING"};
}

export function validateA8RuntimeBindingV1(input){
  const e=[];
  const artifactCheck=validateA8SemanticArtifactV1(input?.artifact);if(!artifactCheck.ok)e.push(...artifactCheck.errors.map(x=>"A8:"+x));
  const selected=selectA8CompatProfileV1(input?.artifact,input?.legacySourceFamily,input?.legacySealedIdentitySha256);
  if(!selected.ok)e.push("PROFILE_SELECTION:"+selected.outcome);
  const mode=validateA8InputModeV1({inputMode:input?.inputMode,nativeExecutionIntentPresent:input?.nativeExecutionIntentPresent,compatProfileSha256:selected.profile?.SHA256??input?.compatProfileSha256??null});
  if(!mode.ok)e.push("INPUT_MODE:"+mode.outcome);
  if(selected.ok){
    const receiptMeta=validateA8ReceiptCompatibilityMetadataV1(input?.receiptCompatibilityMetadata,selected.profile);e.push(...receiptMeta.errors);
    const chain=validateA8LegacyIdentityChainV1(input?.identityChain,selected.profile);e.push(...chain.errors);
  }
  if(input?.requiredLegacyFeatures)for(const feature of input.requiredLegacyFeatures){const r=classifyA8LegacyFeatureV1(feature);if(!r.ok)e.push("LEGACY_FEATURE:"+feature+":"+r.outcome)}
  if(input?.transparentHardening)for(const h of input.transparentHardening){const r=validateA8TransparentHardeningV1(h);if(!r.ok)e.push("TRANSPARENT_HARDENING:"+r.outcome)}
  const projected=projectA8LegacyAcceptanceV1(input?.executionReceipt);
  if(!projected.ok)e.push("ACCEPTANCE_PROJECTION:"+projected.outcome);
  const oracle=projected.ok?evaluateA8LegacyAcceptanceOracleV1(projected.projection):{ok:false,verdict:"BLOCKED_LEGACY_ACCEPTANCE_ORACLE_MISSING"};
  if(input?.requireAcceptancePass===true&&oracle.verdict!=="PASS")e.push("LEGACY_ACCEPTANCE_ORACLE_NON_PASS");
  return{ok:!e.length,errors:e,profile:selected.profile??null,projection:projected.projection??null,oracle};
}

export function createA8CrossStackBindingReceiptV1(input){
  const r=validateA8RuntimeBindingV1(input);if(!r.ok)throw Error(r.errors.join("|"));
  return Object.freeze({
    PILOTE_A8_HEAD:A8_AUTHORITATIVE_BINDING.HEAD,
    PILOTE_A8_TREE:A8_AUTHORITATIVE_BINDING.TREE,
    SCHEMA_SHA256:A8_AUTHORITATIVE_BINDING.SCHEMA_SHA256,
    TEST_VECTOR_SET_SHA256:A8_AUTHORITATIVE_BINDING.TEST_VECTOR_SET_SHA256,
    EXPECTED_RESULT_SET_SHA256:A8_AUTHORITATIVE_BINDING.EXPECTED_RESULT_SET_SHA256,
    SEMANTIC_ARTIFACT_SET_SHA256:A8_AUTHORITATIVE_BINDING.SEMANTIC_ARTIFACT_SET_SHA256,
    AUTHORITATIVE_MANIFEST_SHA256:A8_AUTHORITATIVE_BINDING.AUTHORITATIVE_MANIFEST_SHA256,
    COMPAT_PROFILE_SET_BINDING:"PASS",
    PROFILE_REGISTRY_BINDING:"PASS",
    INPUT_MODE_EXCLUSIVITY_BINDING:"PASS",
    UNKNOWN_PROFILE_FAIL_CLOSED:"PASS",
    LEGACY_REQUIRED_FIELD_ADDITION_BOUNDARY:"PASS",
    SEMANTIC_REINTERPRETATION_BOUNDARY:"PASS",
    TRANSPARENT_HARDENING_ALLOWLIST_BINDING:"PASS",
    LEGACY_ACCEPTANCE_ORACLE_BINDING:"PASS",
    LEGACY_SEMANTIC_PROJECTION_BINDING:"PASS",
    RECEIPT_COMPATIBILITY_FIELDS_BINDING:"PASS",
    LEGACY_IDENTITY_CHAIN_BINDING:"PASS",
    TASK_CONTRACT_V1_MUTATION:0,
    FROZEN_27_FIELDS_MUTATION:0,
    INTERFACE_V1_MUTATION:0,
    SHARED_CONTRACT_REDESIGN:0,
    PILOTE_SEMANTIC_REINTERPRETATION:0
  });
}
