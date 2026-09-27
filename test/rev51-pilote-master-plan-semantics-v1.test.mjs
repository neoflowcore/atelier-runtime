import test from "node:test";
import assert from "node:assert/strict";
import {
  FROZEN_RUNTIME_INTERFACE_IDENTITY_SHA256,FROZEN_RUNTIME_COMPATIBILITY_IDENTITY_SHA256,FROZEN_RUNTIME_CONTRACT_SET_SHA256,
  validateFrozenRuntimeInterfaceV1,normalizePiloteAliasV1,compileMasterPlanSemanticContractV1,compilePhaseRunContractV1,
  compileContinuationPolicyV1,bindPhaseExecutionGrantContinuationV1,classifyHardBoundaryV1,evaluatePiloteResponseFinalizationV1,
  evaluateFinalMergePolicyV1,compileGrantLifecycleV1,revokeGrantV1
} from "../pilote/rev51/master-plan-semantics-v1.mjs";
const H=x=>x.repeat(64);
const runtime={runtimeInterfaceIdentitySha256:FROZEN_RUNTIME_INTERFACE_IDENTITY_SHA256,runtimeCompatibilityIdentitySha256:FROZEN_RUNTIME_COMPATIBILITY_IDENTITY_SHA256,runtimeContractSetSha256:FROZEN_RUNTIME_CONTRACT_SET_SHA256};
function master(){return compileMasterPlanSemanticContractV1({...runtime,projectId:"ephemdrop",masterPlanId:"v016",masterPlanManifestSha256:H("1"),masterPlanExecutionGrantSha256:H("2")})}

test("P28 freezes exact Runtime interface identities",()=>{assert.equal(validateFrozenRuntimeInterfaceV1(runtime).ok,true);assert.equal(validateFrozenRuntimeInterfaceV1({...runtime,runtimeInterfaceIdentitySha256:H("f")}).ok,false)});
test("P28 continue aliases preserve universal resume semantics",()=>{for(const a of ["ㅇㅇ","dd","continue","resume","reattach","ㅈㄱ"])assert.equal(normalizePiloteAliasV1(a).operation,"UNIVERSAL_CONTINUE_RESUME_REATTACH")});
test("P28 strict and diagnostic aliases are distinguished",()=>{assert.equal(normalizePiloteAliasV1("ㄹㄹ").operation,"STRICT_MASTER_PLAN_ONE_SHOT");assert.equal(normalizePiloteAliasV1("ww").operation,"FORCE_REATTACH_DIAGNOSTIC_RESUME")});
test("P28 master-plan semantic contract denies phase milestone stop permissions",()=>{const m=master();assert.equal(m.LONGRUN_EXECUTION_UNIT,"APPROVED_FULL_MASTER_PLAN");assert.equal(m.PHASE_COMPLETE_STOP_PERMISSION,false);assert.equal(m.DEVELOPMENT_AUTH_STOP_PERMISSION,false)});
test("P28 phase run contract is nested and persistent-branch compatible",()=>{const m=master(),p=compilePhaseRunContractV1({phaseId:"P28",masterPlanSemanticContractSha256:m.SEMANTIC_CONTRACT_SHA256,developmentBranch:"runtime-r51-p8-dependency-lock-cache"});assert.equal(p.PHASE_COMPLETE_BEHAVIOR,"CHECKPOINT_THEN_RESOLVE_GLOBAL_NEXT");assert.equal(p.INTERMEDIATE_MERGE,"DENY")});
test("P28 continuation policy compiles auth deferral and response gate semantics",()=>{const m=master(),p=compileContinuationPolicyV1({masterPlanSemanticContractSha256:m.SEMANTIC_CONTRACT_SHA256,projectRemainingWork:true});assert.equal(p.DEVELOPMENT_CREDENTIAL_BEHAVIOR,"DEFER_TO_PROJECT_END_AUTH");assert.equal(p.FINAL_RESPONSE_POLICY,"ALLOW_ONLY_RUNTIME_STOP_DECISION")});
test("P28 active grant binds continuation without reapproval",()=>{const m=master(),phase=compilePhaseRunContractV1({phaseId:"P28",masterPlanSemanticContractSha256:m.SEMANTIC_CONTRACT_SHA256,developmentBranch:"dev"}),pol=compileContinuationPolicyV1({masterPlanSemanticContractSha256:m.SEMANTIC_CONTRACT_SHA256,projectRemainingWork:true});const r=bindPhaseExecutionGrantContinuationV1({grant:{SCHEMA_ID:"MASTER_PLAN_EXECUTION_GRANT_V1",STATE:"ACTIVE"},phaseRunContract:phase,continuationPolicy:pol});assert.equal(r.ok,true);assert.equal(r.reapprovalRequired,false)});
test("P28 local milestones are not hard boundaries",()=>{for(const x of ["PHASE_COMPLETE","CI_PASS","DEVELOPMENT_CREDENTIAL_ABSENCE","BENIGN_DRIFT"])assert.equal(classifyHardBoundaryV1(x).decision,"CONTINUE")});
test("P28 true global boundary taxonomy remains fail closed",()=>{assert.equal(classifyHardBoundaryV1("SEMANTIC_CONTRACT_DRIFT").scope,"GLOBAL");assert.equal(classifyHardBoundaryV1("unknown-new-reason").decision,"FAIL_CLOSED_RECONCILE")});
test("P28 response finalization blocks final while Runtime says continue",()=>{assert.equal(evaluatePiloteResponseFinalizationV1({decision:"CONTINUE"}).finalResponseAllowed,false);assert.equal(evaluatePiloteResponseFinalizationV1({decision:"STOP_PROJECT_COMPLETE"}).finalResponseAllowed,true)});
test("P28 intermediate merge stays suppressed",()=>{assert.equal(evaluateFinalMergePolicyV1({explicitMergeAuthority:true,projectFinalIntegration:false}).allowed,false);assert.equal(evaluateFinalMergePolicyV1({explicitMergeAuthority:true,projectFinalIntegration:true}).allowed,true)});
test("P28 grant persistence requires explicit revocation",()=>{const g=compileGrantLifecycleV1({grantId:"g1"});assert.equal(g.PERSIST_ACROSS_CHAT,true);assert.equal(g.AUTO_RENEW,false);const r=revokeGrantV1(g,"user-stop");assert.equal(r.STATE,"REVOKED")});
