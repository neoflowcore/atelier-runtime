import test from "node:test";
import assert from "node:assert/strict";
import { compileRuntimeEReleaseDecision, validateRuntimeEReleaseRequest, verifyRuntimeEReleaseDecision } from "../runtime/plan-e-promotion.mjs";

const H64A = "a".repeat(64), H64B = "b".repeat(64), H64C = "c".repeat(64);
const E1 = { receipt_type:"RUNTIME_E1_REMOTE_READBACK_RECEIPT_V1", result:"PASS" };
function req(overrides={}) { return {
  request_type:"RUNTIME_E_RELEASE_REQUEST_V1", request_id:"rel-1", operation:"PROMOTE", environment:"PRODUCTION",
  candidate_tag:"runtime-e-rc1", candidate_commit:"d".repeat(40), artifact_sha256:H64A,
  expected_current_release_sha256:H64B, desired_release_sha256:H64C,
  governance_decision_sha256:"1".repeat(64), security_decision_sha256:"2".repeat(64), authority_evidence_sha256:"3".repeat(64),
  change_ticket_id:"change-2", readback_required:true, ...overrides
};}

test("promotion mechanics prepare only with E1 readback",()=>{
  const d=compileRuntimeEReleaseDecision(req(),E1); assert.equal(d.result,"PREPARED"); assert.deepEqual(verifyRuntimeEReleaseDecision(d),{ok:true,errors:[]});
});
test("E2 does not activate live provider mutation before final seal",()=>{
  const d=compileRuntimeEReleaseDecision(req(),E1); assert.equal(d.live_provider_mutation_authority,"NONE_UNTIL_RUNTIME_E_FINAL_SEAL"); assert.equal(d.activation_state,"PRE_FINAL_MECHANICS_ONLY");
});
test("promotion grants no source or merge authority",()=>{
  const d=compileRuntimeEReleaseDecision(req(),E1); assert.equal(d.source_tree_write_authority,"NONE_FROM_E2"); assert.equal(d.merge_authority,"NONE"); assert.equal(d.final_merge_authority,"HUMAN_ONLY");
});
test("rollback mechanics use exact distinct target",()=>{
  const d=compileRuntimeEReleaseDecision(req({operation:"ROLLBACK",desired_release_sha256:"e".repeat(64)}),E1); assert.equal(d.result,"PREPARED");
});
test("missing E1 readback blocks",()=>{
  const d=compileRuntimeEReleaseDecision(req(),{receipt_type:"x",result:"FAIL"}); assert.equal(d.result,"BLOCKED"); assert.ok(d.reasons.includes("RUNTIME_E1_REMOTE_READBACK_REQUIRED"));
});
test("unknown field fails closed",()=>{
  assert.deepEqual(validateRuntimeEReleaseRequest({...req(),extra:true}),{ok:false,errors:["RELEASE_REQUEST_FIELDS_MISMATCH"]});
});
test("readback cannot be disabled",()=>{
  const v=validateRuntimeEReleaseRequest(req({readback_required:false})); assert.equal(v.ok,false); assert.ok(v.errors.includes("PROVIDER_READBACK_REQUIRED"));
});
