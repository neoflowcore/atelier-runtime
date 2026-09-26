import test from "node:test";
import assert from "node:assert/strict";
import * as a from "../runtime/rev51/pilote-backward-compatibility-consumer-v1.mjs";
import artifact from "../fixtures/rev51/runtime-a8-backward-compatibility/semantic-artifact-set-v1.json" with { type: "json" };

const H="1".repeat(64);
const baseChain=(profileSha)=>({
  LEGACY_SEALED_INPUT_HASH:H,
  TASK_CONTRACT_HASH:H,
  COMPAT_PROFILE_HASH:profileSha,
  RUNTIME_EXECUTION_PLAN_HASH:H,
  WORKER_JOB_HASH:H,
  EXECUTION_RECEIPT_HASH:H
});
const sealed=(result="PASS")=>({RUNTIME_SEALED:true,VERIFICATION_RESULT:result});

test("pins A8 exact identities",()=>{
  assert.equal(a.A8_AUTHORITATIVE_BINDING.HEAD,"96ab5e3b3d9ac17452d0c707b508152b7d09c197");
  assert.equal(a.A8_AUTHORITATIVE_BINDING.TREE,"3f8f0d2fd5795724d88ec7f7b47eed8bfc659774");
  assert.equal(a.A8_AUTHORITATIVE_BINDING.SEMANTIC_ARTIFACT_SET_SHA256,"4220684785f382c3dc0d252da8715ceb0ecb79d6783cf6901ac3e26eb21e8ca9");
});

test("sealed artifact validates and exact profiles select",()=>{
  assert.equal(a.validateA8SemanticArtifactV1(artifact).ok,true);
  for(const family of ["REV42_TASK_V1","REV45_PHASE_V1","REV50_FRAMEWORK_V1"]){
    const expected=a.A8_COMPAT_PROFILES[family];
    const r=a.selectA8CompatProfileV1(artifact,family,expected.LEGACY_SEALED_IDENTITY_SHA256);
    assert.equal(r.ok,true,family);
    assert.equal(r.profile.SHA256,expected.SHA256);
  }
});

test("unknown or mismatched legacy identity fails closed",()=>{
  assert.equal(a.selectA8CompatProfileV1(artifact,"UNKNOWN","0".repeat(64)).outcome,"BLOCKED_UNKNOWN_COMPAT_PROFILE");
  assert.equal(a.selectA8CompatProfileV1(artifact,"REV45_PHASE_V1","0".repeat(64)).outcome,"BLOCKED_LEGACY_IDENTITY_MISMATCH");
});

test("input modes are exclusive with no synthesis or downgrade",()=>{
  const p=a.A8_COMPAT_PROFILES.REV42_TASK_V1;
  assert.equal(a.validateA8InputModeV1({inputMode:"LEGACY_COMPAT",compatProfileSha256:p.SHA256}).ok,true);
  assert.equal(a.validateA8InputModeV1({inputMode:"LEGACY_COMPAT",nativeExecutionIntentPresent:true,compatProfileSha256:p.SHA256}).outcome,"LEGACY_TO_REV51_INTENT_SYNTHESIS_DENY");
  assert.equal(a.validateA8InputModeV1({inputMode:"NATIVE_REV51",nativeExecutionIntentPresent:true,compatProfileSha256:p.SHA256}).outcome,"REV51_TO_LEGACY_DOWNGRADE_DENY");
});

test("legacy feature classes and transparent hardening are fail closed",()=>{
  assert.equal(a.classifyA8LegacyFeatureV1("FENCING").class,"A_SAFE_RUNTIME_DEFAULT");
  assert.equal(a.classifyA8LegacyFeatureV1("CAPABILITY_REQUIREMENTS").class,"B_DERIVED_FROM_EXISTING_CONTRACT");
  assert.equal(a.classifyA8LegacyFeatureV1("DATA_LOCALITY").outcome,"BLOCKED_NEEDS_REV51_EXECUTION_INTENT");
  assert.equal(a.validateA8TransparentHardeningV1({hardening:"FENCING",targets:[]}).ok,true);
  assert.equal(a.validateA8TransparentHardeningV1({hardening:"FENCING",targets:["TASK_SEMANTICS"]}).ok,false);
});

test("receipt metadata and identity chain bind selected profile exactly",()=>{
  const p=a.A8_COMPAT_PROFILES.REV45_PHASE_V1;
  const meta={INPUT_MODE:"LEGACY_COMPAT",COMPAT_PROFILE_ID:p.ID,COMPAT_PROFILE_VERSION:p.VERSION,COMPAT_PROFILE_SHA256:p.SHA256};
  assert.equal(a.validateA8ReceiptCompatibilityMetadataV1(meta,p).ok,true);
  assert.equal(a.validateA8ReceiptCompatibilityMetadataV1({...meta,COMPAT_PROFILE_SHA256:H},p).ok,false);
  assert.equal(a.validateA8LegacyIdentityChainV1(baseChain(p.SHA256),p).ok,true);
  assert.equal(a.validateA8LegacyIdentityChainV1(baseChain(H),p).ok,false);
});

test("legacy acceptance uses sealed semantic projection, not byte equality",()=>{
  const pass=a.projectA8LegacyAcceptanceV1(sealed("PASS"));
  assert.equal(pass.ok,true);
  assert.deepEqual(pass.projection,{SEMANTIC_RESULT_PROJECTION_ID:"SEMANTIC_RESULT_PROJECTION_LEGACY_ACCEPTANCE_V1",ACCEPTANCE_OUTCOME:"PASS"});
  assert.deepEqual(a.evaluateA8LegacyAcceptanceOracleV1(pass.projection),{ok:true,verdict:"PASS"});
  assert.equal(a.evaluateA8LegacyAcceptanceOracleV1(a.projectA8LegacyAcceptanceV1(sealed("FAIL")).projection).verdict,"FAIL");
  assert.equal(a.evaluateA8LegacyAcceptanceOracleV1(a.projectA8LegacyAcceptanceV1(sealed("OUTCOME_UNKNOWN")).projection).verdict,"OUTCOME_UNKNOWN");
  assert.equal(a.projectA8LegacyAcceptanceV1({RUNTIME_SEALED:false,VERIFICATION_RESULT:"PASS"}).ok,false);
});

test("full runtime bind produces requested cross-stack receipt",()=>{
  const p=a.A8_COMPAT_PROFILES.REV50_FRAMEWORK_V1;
  const input={
    artifact,
    legacySourceFamily:"REV50_FRAMEWORK_V1",
    legacySealedIdentitySha256:p.LEGACY_SEALED_IDENTITY_SHA256,
    inputMode:"LEGACY_COMPAT",
    nativeExecutionIntentPresent:false,
    receiptCompatibilityMetadata:{INPUT_MODE:"LEGACY_COMPAT",COMPAT_PROFILE_ID:p.ID,COMPAT_PROFILE_VERSION:p.VERSION,COMPAT_PROFILE_SHA256:p.SHA256},
    identityChain:baseChain(p.SHA256),
    requiredLegacyFeatures:["FENCING","CAPABILITY_REQUIREMENTS"],
    transparentHardening:[{hardening:"FENCING",targets:[]}],
    executionReceipt:sealed("PASS"),
    requireAcceptancePass:true
  };
  const r=a.validateA8RuntimeBindingV1(input);
  assert.equal(r.ok,true);
  const receipt=a.createA8CrossStackBindingReceiptV1(input);
  assert.equal(receipt.LEGACY_ACCEPTANCE_ORACLE_BINDING,"PASS");
  assert.equal(receipt.RECEIPT_COMPATIBILITY_FIELDS_BINDING,"PASS");
  assert.equal(receipt.LEGACY_IDENTITY_CHAIN_BINDING,"PASS");
});
