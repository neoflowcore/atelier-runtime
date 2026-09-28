import test from "node:test";
import assert from "node:assert/strict";
import {compileSourceMutationAuthorityEnvelopeV1,detectRedundantMutationReapprovalV1,evaluateSourceMutationAuthorityReuseV1} from "../runtime/rev52/source-mutation-authority-v1.mjs";
import {compileSourceMutationV1,evaluateSemanticCiV1} from "../runtime/rev51/source-mutation-compiler-v1.mjs";

const envelope=()=>compileSourceMutationAuthorityEnvelopeV1({projectIdentityDigest:"1".repeat(64),authoritativePlanSetDigest:"2".repeat(64),repositorySet:["neoflowcore/atelier-runtime"],targetRepository:"neoflowcore/atelier-runtime",developmentBranchOrBranchClass:"runtime-r52-track-a",authoritySource:"USER_CONTINUE_CURRENT_APPROVED_TRACK",createdCheckpoint:"r52-r0"});

test("ordinary in-scope work-unit and file-set changes reuse authority",()=>{const e=envelope();for(const reason of ["WORK_UNIT_CHANGE","FILE_SET_CHANGE","NEW_COMMIT","TEST_ADDITION_OR_FIX","DOC_OR_BUILD_FILE_CHANGE","NEXT_PHASE_WITHIN_APPROVED_SCOPE"]){const reuse=evaluateSourceMutationAuthorityReuseV1({envelope:e,current:{projectIdentityDigest:e.projectIdentityDigest,authoritativePlanSetDigest:e.authoritativePlanSetDigest},proposed:{targetRepository:e.targetRepository,developmentBranchOrBranchClass:e.developmentBranchOrBranchClass}});assert.equal(reuse.reusable,true);assert.equal(reuse.userReapprovalRequired,false);assert.equal(detectRedundantMutationReapprovalV1({envelopeReusable:true,reason}).redundant,true)}});

test("real scope and risk boundaries invalidate the envelope",()=>{const e=envelope();for(const boundaryType of ["PROJECT_SWITCH","APPROVED_PLAN_SCOPE_EXPANSION","NEW_SECRET_OR_CREDENTIAL_AUTHORITY","NEW_PAID_RESOURCE_OR_COST_AUTHORITY","PROJECT_FINAL_MERGE_OR_RELEASE_AUTHORITY"]){const result=evaluateSourceMutationAuthorityReuseV1({envelope:e,proposed:{boundaryType}});assert.equal(result.reusable,false);assert.equal(result.userReapprovalRequired,true)}});

test("underspecified mutation requests request reads, not user approval",()=>{const result=compileSourceMutationV1({targetRepository:"neoflowcore/atelier-runtime",targetRef:"runtime-r52-track-a",operations:[{kind:"UPDATE",path:"runtime/rev52/example.mjs"}]});assert.equal(result.status,"READ_REQUIRED");assert.equal(result.userApprovalRequired,false);assert.equal(result.retryAllowedAfterNewInformation,true);assert.ok(result.missingInputs.includes("freshHead"));assert.ok(result.missingInputs.some((x)=>x.includes("currentBlobSha")))});

test("semantic CI ignores non-contractual test-count drift",()=>{const result=evaluateSemanticCiV1({requiredAssertions:[{id:"required-behavior",status:"PASS"}],unexpectedFunctionalFailures:0,countIsContract:false,expectedTestCount:8,observedTestCount:9});assert.equal(result.status,"PASS");assert.deepEqual(result.warnings,["TEST_COUNT_DRIFT_NON_CONTRACTUAL"])});

test("semantic CI fails required behavior even if count matches",()=>{const result=evaluateSemanticCiV1({requiredAssertions:[{id:"required-behavior",status:"FAIL"}],unexpectedFunctionalFailures:0,countIsContract:true,expectedTestCount:8,observedTestCount:8});assert.equal(result.status,"FAIL");assert.deepEqual(result.failedAssertions,["required-behavior"])});
