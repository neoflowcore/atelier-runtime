import test from "node:test";
import assert from "node:assert/strict";
import {
  A4_AUTHORITATIVE_BINDING,
  computePiloteA4IntentSha256V1,
  createA4CrossStackBindingReceiptV1,
  validateA4CrossStackBindingV1,
  validatePiloteA4IntentV1
} from "../runtime/rev51/pilote-approval-effect-operator-consumer-v1.mjs";
import { claimApprovalGrant, markApprovalOutcomeUnknown, reconcileClaimedApproval } from "../runtime/rev51/approval-grant-v1.mjs";

const C=A4_AUTHORITATIVE_BINDING.CONTRACT_SET_SHA256;
const TASK="d2fb156b45cb2f78f97e1550b2c972ada5e739ae0477fdc2944cb8e5b23ddb66";
const EXEC="68f231d23a0181ee08bab90df8619ae8b4e8c8ba9ba57ccbe1fa02d75069127e";

function baseA4(overrides={}) {
  return {
    INTENT_TYPE:"PILOTE_APPROVAL_EFFECT_OPERATOR_INTENT_V1", INTENT_VERSION:"1.0.0", CANONICALIZATION_ID:"ATELIER_EXECUTION_CANONICAL_JSON_V1",
    PROJECT_ID:"ATELIER-PILOTE", PHASE_ID:"R42-P2P3", TASK_ID:"R42-FIXTURE-READ-001", TASK_CONTRACT_SHA256:TASK, EXECUTION_INTENT_SHA256:EXEC,
    APPROVAL_MODE:"INHERIT_TASK", EFFECT_CLASS_REFS:["READ_ONLY"], SCOPE_REFS:["repo:neoflowcore/atelier-runtime"], REMOTE_MUTATION_INTENT:"NONE", HOST_OPERATION_INTENT:"NONE",
    OPERATOR_POLICY:"ZERO_TOUCH_AFTER_APPROVAL", INTERVENTION_POLICY:"BLOCK_ON_AMBIGUITY", INTERVENTION_POLICY_REF:"task-contract:INTERVENTION_POLICY",
    AUTHORITY_GRANT_POLICY:"DECLARATION_NEVER_GRANTS_AUTHORITY", FIRST_IRREVERSIBLE_REMOTE_SUBMISSION_POLICY:"ATOMIC_APPROVAL_CLAIM_REQUIRED",
    OUTCOME_UNKNOWN_APPROVAL_POLICY:"SAME_OPERATION_RECONCILE_APPROVAL_REOPEN_DENY", NORMAL_PATH_POLICY:"ZERO_TOUCH_AFTER_APPROVAL",
    STATE_AFFECTING_INTERVENTION_POLICY:"TRUST_RESET_REQUIRED", OBSERVE_ONLY_INTERVENTION_POLICY:"TRUST_PRESERVED",
    CONTRACT_SET_REF:{ID:"ATELIER_REV51_CONTRACT_SET_V1",VERSION:"1.0.0",SHA256:C}, A4_INTENT_SHA256:"3c629b703e6ee522f11af045f029163cacc71d7b456786fa9fabe1cc77f19acd",
    ...overrides
  };
}

const vectors=[
 ["V001_VALID_READ_ONLY",baseA4(),true,[]],
 ["V002_RUNTIME_OWNED_APPROVAL_ID_DENY",baseA4({APPROVAL_GRANT_ID:"runtime-grant-001"}),false,["A4_TOP_LEVEL_FIELDS_MISMATCH","FORBIDDEN_RUNTIME_OWNED_KEY:$.APPROVAL_GRANT_ID","A4_INTENT_SHA256_MISMATCH"]],
 ["V003_DECLARATION_AUTHORITY_GRANT_DENY",baseA4({AUTHORITY_GRANT_POLICY:"DECLARATION_GRANTS_AUTHORITY"}),false,["AUTHORITY_GRANT_POLICY_MISMATCH","A4_INTENT_SHA256_MISMATCH"]],
 ["V004_POST_SUBMISSION_CLAIM_DENY",baseA4({FIRST_IRREVERSIBLE_REMOTE_SUBMISSION_POLICY:"SUBMIT_THEN_CLAIM"}),false,["FIRST_IRREVERSIBLE_REMOTE_SUBMISSION_POLICY_MISMATCH","A4_INTENT_SHA256_MISMATCH"]],
 ["V005_OUTCOME_UNKNOWN_REOPEN_DENY",baseA4({OUTCOME_UNKNOWN_APPROVAL_POLICY:"REOPEN_AND_RETRY"}),false,["OUTCOME_UNKNOWN_APPROVAL_POLICY_MISMATCH","A4_INTENT_SHA256_MISMATCH"]],
 ["V006_STATE_AFFECTING_TRUST_PRESERVE_DENY",baseA4({STATE_AFFECTING_INTERVENTION_POLICY:"TRUST_PRESERVED"}),false,["STATE_AFFECTING_INTERVENTION_POLICY_MISMATCH","A4_INTENT_SHA256_MISMATCH"]],
 ["V007_CONTRACT_SET_DRIFT_DENY",baseA4({CONTRACT_SET_REF:{ID:"ATELIER_REV51_CONTRACT_SET_V1",VERSION:"1.0.0",SHA256:"0".repeat(64)},A4_INTENT_SHA256:"f054ce02ee19688e14609ee6e3dcbfc3486bde0161acf38d5a0d719e26ab99e5"}),false,["CONTRACT_SET_REF_MISMATCH"]],
 ["V008_OPERATOR_POLICY_INVALID",baseA4({OPERATOR_POLICY:"AUTONOMOUS_PRIVILEGED_MUTATION",A4_INTENT_SHA256:"c646d8b2e806c181ed9bcb352cec3031d41cc1bd099ea14bd946b13526e8dd40"}),false,["OPERATOR_POLICY_INVALID"]]
];

function task(overrides={}) { return {PROJECT_ID:"ATELIER-PILOTE",PHASE_ID:"R42-P2P3",TASK_ID:"R42-FIXTURE-READ-001",TASK_CONTRACT_HASH:TASK,EFFECT_CLASSES:["READ_ONLY"],ALLOWED_SCOPE:["repo:neoflowcore/atelier-runtime"],REMOTE_MUTATION_INTENT:"NONE",HOST_OPERATION_INTENT:"NONE",INTERVENTION_POLICY:"BLOCK_ON_AMBIGUITY",...overrides}; }
function intent(overrides={}) { return {PROJECT_ID:"ATELIER-PILOTE",PHASE_ID:"R42-P2P3",TASK_ID:"R42-FIXTURE-READ-001",TASK_CONTRACT_SHA256:TASK,INTENT_SHA256:EXEC,OPERATOR_POLICY:"ZERO_TOUCH_AFTER_APPROVAL",APPROVAL_BOUNDARY:{MODE:"INHERIT_TASK",EFFECT_CLASS_REFS:["READ_ONLY"],SCOPE_REFS:["repo:neoflowcore/atelier-runtime"]},...overrides}; }
function plan(overrides={}) { return {EXECUTION_INTENT_SHA256:EXEC,CONTRACT_SET_SHA256:C,OPERATOR_POLICY:"ZERO_TOUCH_AFTER_APPROVAL",APPROVAL_BOUNDARY:{MODE:"INHERIT_TASK",EFFECT_CLASS_REFS:["READ_ONLY"],SCOPE_REFS:["repo:neoflowcore/atelier-runtime"]},...overrides}; }

test("A4 authoritative identities are exact",()=>{
 assert.equal(A4_AUTHORITATIVE_BINDING.HEAD,"395779f3ff04fb56d2aaa6a836a05b6600d18747");
 assert.equal(A4_AUTHORITATIVE_BINDING.TREE,"a0615fd74f6d7235744453f46b3430037afd4858");
 assert.equal(A4_AUTHORITATIVE_BINDING.SCHEMA_SHA256,"7848f5983ef42ea06e1909530990961ca3db6d34e268a414cd238ad7ef1afa5d");
 assert.equal(A4_AUTHORITATIVE_BINDING.TEST_VECTOR_SET_SHA256,"18fafc3b42b3fb1a7df852003d2499dce9ab9cdcd7f4c032a7949a35962f589b");
 assert.equal(A4_AUTHORITATIVE_BINDING.EXPECTED_RESULT_SET_SHA256,"2ec752e64d99da612c82fe9e316e7e2e2835160226c78d3740670fdaf132ca95");
 assert.equal(A4_AUTHORITATIVE_BINDING.AUTHORITATIVE_MANIFEST_SHA256,"bc8085b27534092a7dc22d2a0f79ff4a7ba48af9c06cbbcf940fbc8fa0486554");
});
for (const [id,input,ok,errors] of vectors) test(`${id} reproduces A4 expected result`,()=>{ const actual=validatePiloteA4IntentV1(input); assert.equal(actual.ok,ok,id); assert.deepEqual(actual.errors,errors,id); });

test("canonical hash matches authoritative V001",()=>assert.equal(computePiloteA4IntentSha256V1(baseA4()),"3c629b703e6ee522f11af045f029163cacc71d7b456786fa9fabe1cc77f19acd"));
test("Task Contract, A2 boundary, Runtime plan and A4 intent bind exactly",()=>assert.deepEqual(validateA4CrossStackBindingV1(task(),intent(),plan(),baseA4()),{ok:true,errors:[]}));
test("approval mode drift is rejected",()=>assert.ok(validateA4CrossStackBindingV1(task(),intent({APPROVAL_BOUNDARY:{MODE:"NO_ADDITIONAL_APPROVAL",EFFECT_CLASS_REFS:["READ_ONLY"],SCOPE_REFS:["repo:neoflowcore/atelier-runtime"]}}),plan(),baseA4()).errors.includes("APPROVAL_MODE_BINDING_MISMATCH")));
test("effect escalation is rejected",()=>{const a=baseA4({EFFECT_CLASS_REFS:["READ_ONLY","REMOTE_SOURCE_WRITE"]});a.A4_INTENT_SHA256=computePiloteA4IntentSha256V1(a);const r=validateA4CrossStackBindingV1(task(),intent({APPROVAL_BOUNDARY:{MODE:"INHERIT_TASK",EFFECT_CLASS_REFS:a.EFFECT_CLASS_REFS,SCOPE_REFS:a.SCOPE_REFS}}),plan({APPROVAL_BOUNDARY:{MODE:"INHERIT_TASK",EFFECT_CLASS_REFS:a.EFFECT_CLASS_REFS,SCOPE_REFS:a.SCOPE_REFS}}),a);assert.ok(r.errors.includes("EFFECT_CLASS_ESCALATION_DENY:REMOTE_SOURCE_WRITE"));});
test("scope escalation is rejected",()=>{const a=baseA4({SCOPE_REFS:["repo:neoflowcore/atelier-runtime","repo:foreign/example"]});a.A4_INTENT_SHA256=computePiloteA4IntentSha256V1(a);const b={MODE:"INHERIT_TASK",EFFECT_CLASS_REFS:a.EFFECT_CLASS_REFS,SCOPE_REFS:a.SCOPE_REFS};const r=validateA4CrossStackBindingV1(task(),intent({APPROVAL_BOUNDARY:b}),plan({APPROVAL_BOUNDARY:b}),a);assert.ok(r.errors.includes("SCOPE_ESCALATION_DENY:repo:foreign/example"));});
test("Runtime plan approval boundary cannot diverge",()=>assert.ok(validateA4CrossStackBindingV1(task(),intent(),plan({APPROVAL_BOUNDARY:{MODE:"NO_ADDITIONAL_APPROVAL",EFFECT_CLASS_REFS:["READ_ONLY"],SCOPE_REFS:["repo:neoflowcore/atelier-runtime"]}}),baseA4()).errors.includes("RUNTIME_PLAN_APPROVAL_MODE_MISMATCH")));
test("Runtime plan operator policy cannot diverge",()=>assert.ok(validateA4CrossStackBindingV1(task(),intent(),plan({OPERATOR_POLICY:"RECOVERY_INTERACTION_ALLOWED"}),baseA4()).errors.includes("RUNTIME_PLAN_OPERATOR_POLICY_MISMATCH")));
test("binding receipt carries no Runtime-owned approval or operation identity",()=>{const r=createA4CrossStackBindingReceiptV1(task(),intent(),plan(),baseA4());assert.equal(r.DECLARATION_GRANTS_AUTHORITY,0);assert.equal(r.FIRST_IRREVERSIBLE_REMOTE_SUBMISSION_REQUIRES_ATOMIC_APPROVAL_CLAIM,1);assert.equal(r.RUNTIME_OWNED_APPROVAL_ID_EMISSION,0);assert.equal(r.RUNTIME_OWNED_OPERATION_ID_EMISSION,0);assert.equal(r.RUNTIME_OWNED_FENCE_IDENTITY_EMISSION,0);});
test("existing Runtime grant enforcement matches A4 claim-before-submit and OUTCOME_UNKNOWN boundary",()=>{const grant={STATE:"AVAILABLE",PLAN_HASH:"p",ALLOWED_EFFECT_CLASSES:["REMOTE_SOURCE_WRITE"],ALLOWED_SCOPE:["repo:neoflowcore/atelier-runtime"]};const op={PLAN_HASH:"p",EFFECT_CLASS:"REMOTE_SOURCE_WRITE",SCOPE:"repo:neoflowcore/atelier-runtime",OPERATION_ID:"op-1",IDEMPOTENCY_KEY:"idem-1"};const claimed=claimApprovalGrant(grant,op);assert.equal(claimed.code,"APPROVAL_CLAIMED");const unknown=markApprovalOutcomeUnknown(claimed.grant,op);assert.equal(unknown.code,"OUTCOME_UNKNOWN_RECONCILIATION_ONLY");assert.equal(reconcileClaimedApproval(unknown.grant,op).code,"RECONCILE_SAME_OPERATION_ONLY");assert.equal(reconcileClaimedApproval(unknown.grant,{...op,OPERATION_ID:"op-2"}).code,"SECOND_MUTATION_DENIED");});
