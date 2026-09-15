import test from "node:test";
import assert from "node:assert/strict";
import { compileRuntimeEReleaseDecision } from "../runtime/plan-e-promotion.mjs";
import { verifyRuntimeEProviderReadback } from "../runtime/plan-e-provider-readback.mjs";

const E1={receipt_type:"RUNTIME_E1_REMOTE_READBACK_RECEIPT_V1",result:"PASS"};
const request={request_type:"RUNTIME_E_RELEASE_REQUEST_V1",request_id:"rel-1",operation:"PROMOTE",environment:"PRODUCTION",candidate_tag:"runtime-e-rc1",candidate_commit:"d".repeat(40),artifact_sha256:"a".repeat(64),expected_current_release_sha256:"b".repeat(64),desired_release_sha256:"c".repeat(64),governance_decision_sha256:"1".repeat(64),security_decision_sha256:"2".repeat(64),authority_evidence_sha256:"3".repeat(64),change_ticket_id:"change-2",readback_required:true};
const decision=compileRuntimeEReleaseDecision(request,E1);
function rb(overrides={}) { return {readback_type:"RUNTIME_E_PROVIDER_READBACK_V1",provider_request_id:"provider-1",release_decision_sha256:decision.decision_sha256,observed_environment:"PRODUCTION",observed_release_sha256:"c".repeat(64),observed_artifact_sha256:"a".repeat(64),observed_candidate_tag:"runtime-e-rc1",provider_state_sha256:"f".repeat(64),status:"CONFIRMED",...overrides}; }

test("exact provider readback confirms release evidence",()=>{const r=verifyRuntimeEProviderReadback(rb(),decision);assert.equal(r.ok,true);assert.equal(r.evidence.source_tree_write,0);assert.equal(r.evidence.final_merge_authority,"HUMAN_ONLY");});
test("release mismatch blocks",()=>{const r=verifyRuntimeEProviderReadback(rb({observed_release_sha256:"0".repeat(64)}),decision);assert.equal(r.ok,false);assert.ok(r.errors.includes("RELEASE_READBACK_MISMATCH"));});
test("artifact mismatch blocks",()=>{const r=verifyRuntimeEProviderReadback(rb({observed_artifact_sha256:"0".repeat(64)}),decision);assert.equal(r.ok,false);assert.ok(r.errors.includes("ARTIFACT_READBACK_MISMATCH"));});
test("candidate tag mismatch blocks",()=>{const r=verifyRuntimeEProviderReadback(rb({observed_candidate_tag:"other"}),decision);assert.equal(r.ok,false);assert.ok(r.errors.includes("CANDIDATE_TAG_READBACK_MISMATCH"));});
test("pending provider state cannot confirm",()=>{const r=verifyRuntimeEProviderReadback(rb({status:"PENDING"}),decision);assert.equal(r.ok,false);assert.ok(r.errors.includes("PROVIDER_STATE_NOT_CONFIRMED"));});
