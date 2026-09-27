import test from "node:test";
import assert from "node:assert/strict";
import {
  A3_AUTHORITATIVE_BINDING,
  computePiloteVerifierPolicySha256V1,
  createA3CrossStackBindingReceiptV1,
  validateA3CrossStackBindingV1,
  validatePiloteVerifierPolicyV1
} from "../runtime/rev51/pilote-verifier-acceptance-consumer-v1.mjs";

const C = A3_AUTHORITATIVE_BINDING.CONTRACT_SET_SHA256;

const vectors = [
  ["V001_RUNTIME_REQUIRED_VALID", {VERIFIER_POLICY_ID:"verifier.runtime.required",VERIFIER_POLICY:"RUNTIME_REQUIRED",ACCEPTANCE_REQUIREMENT_REF:"task-contract:ACCEPTANCE_REQUIREMENTS",RUNTIME_DEFINED_ACCEPTANCE_SEMANTICS:"DENY",RUNTIME_DEFINED_TOLERANCE:"DENY",RAW_WORKER_SUCCESS_DIRECT_ACCEPTANCE:"DENY",CONTRACT_SET_REF:{ID:"ATELIER_REV51_CONTRACT_SET_V1",VERSION:"1.0.0",SHA256:C},VERIFIER_POLICY_SHA256:"3e1640da42dd97a43cd66e6ccaea0af6eb647a66c4eea7f48f47d40a67b2d569"}, true, []],
  ["V002_PROJECT_CI_REQUIRED_VALID", {VERIFIER_POLICY_ID:"verifier.project-ci.required",VERIFIER_POLICY:"PROJECT_CI_REQUIRED",ACCEPTANCE_REQUIREMENT_REF:"project:ci-acceptance/rev51",RUNTIME_DEFINED_ACCEPTANCE_SEMANTICS:"DENY",RUNTIME_DEFINED_TOLERANCE:"DENY",RAW_WORKER_SUCCESS_DIRECT_ACCEPTANCE:"DENY",CONTRACT_SET_REF:{ID:"ATELIER_REV51_CONTRACT_SET_V1",VERSION:"1.0.0",SHA256:C},VERIFIER_POLICY_SHA256:"1fa9b995c59006504a78689fc0f56c41f4b690ae453aa83265065ef3c05350c4"}, true, []],
  ["V003_RUNTIME_PLUS_PROJECT_CI_VALID", {VERIFIER_POLICY_ID:"verifier.runtime-plus-project-ci",VERIFIER_POLICY:"RUNTIME_PLUS_PROJECT_CI",ACCEPTANCE_REQUIREMENT_REF:"phase:hybrid-acceptance/rev51",RUNTIME_DEFINED_ACCEPTANCE_SEMANTICS:"DENY",RUNTIME_DEFINED_TOLERANCE:"DENY",RAW_WORKER_SUCCESS_DIRECT_ACCEPTANCE:"DENY",CONTRACT_SET_REF:{ID:"ATELIER_REV51_CONTRACT_SET_V1",VERSION:"1.0.0",SHA256:C},VERIFIER_POLICY_SHA256:"b71b84ee4040a5c1f978f6c45446c3901964ce031dbd3e2d2f880d66374de9ab"}, true, []],
  ["V004_RUNTIME_ACCEPTANCE_NAMESPACE_DENY", {VERIFIER_POLICY_ID:"verifier.runtime.required",VERIFIER_POLICY:"RUNTIME_REQUIRED",ACCEPTANCE_REQUIREMENT_REF:"runtime:invented-acceptance",RUNTIME_DEFINED_ACCEPTANCE_SEMANTICS:"DENY",RUNTIME_DEFINED_TOLERANCE:"DENY",RAW_WORKER_SUCCESS_DIRECT_ACCEPTANCE:"DENY",CONTRACT_SET_REF:{ID:"ATELIER_REV51_CONTRACT_SET_V1",VERSION:"1.0.0",SHA256:C},VERIFIER_POLICY_SHA256:"5493c5d2bf23771d5360ac44b43c6174f90fbb8f5c317d642d80df77d0a265a7"}, false, ["ACCEPTANCE_REQUIREMENT_OWNER_NOT_PILOTE_SEMANTIC"]],
  ["V005_RUNTIME_DEFINED_ACCEPTANCE_DENY", {VERIFIER_POLICY_ID:"verifier.runtime.required",VERIFIER_POLICY:"RUNTIME_REQUIRED",ACCEPTANCE_REQUIREMENT_REF:"task-contract:ACCEPTANCE_REQUIREMENTS",RUNTIME_DEFINED_ACCEPTANCE_SEMANTICS:"ALLOW",RUNTIME_DEFINED_TOLERANCE:"DENY",RAW_WORKER_SUCCESS_DIRECT_ACCEPTANCE:"DENY",CONTRACT_SET_REF:{ID:"ATELIER_REV51_CONTRACT_SET_V1",VERSION:"1.0.0",SHA256:C},VERIFIER_POLICY_SHA256:"6ff0ac29d6680ac484306a6657eeb7bdf8fbcfd9df3b59c47f265f6a5240784e"}, false, ["RUNTIME_DEFINED_ACCEPTANCE_SEMANTICS_MUST_BE_DENY"]],
  ["V006_RAW_WORKER_SUCCESS_DIRECT_ACCEPTANCE_DENY", {VERIFIER_POLICY_ID:"verifier.runtime-plus-project-ci",VERIFIER_POLICY:"RUNTIME_PLUS_PROJECT_CI",ACCEPTANCE_REQUIREMENT_REF:"phase:hybrid-acceptance/rev51",RUNTIME_DEFINED_ACCEPTANCE_SEMANTICS:"DENY",RUNTIME_DEFINED_TOLERANCE:"DENY",RAW_WORKER_SUCCESS_DIRECT_ACCEPTANCE:"ALLOW",CONTRACT_SET_REF:{ID:"ATELIER_REV51_CONTRACT_SET_V1",VERSION:"1.0.0",SHA256:C},VERIFIER_POLICY_SHA256:"ce6af4247e99a4d8cf13a0f99b4e6da4ba28859ee11e0a2e77b8d393f858353a"}, false, ["RAW_WORKER_SUCCESS_DIRECT_ACCEPTANCE_MUST_BE_DENY"]],
  ["V007_POLICY_TAMPER_DENY", {VERIFIER_POLICY_ID:"verifier.runtime.required",VERIFIER_POLICY:"PROJECT_CI_REQUIRED",ACCEPTANCE_REQUIREMENT_REF:"task-contract:ACCEPTANCE_REQUIREMENTS",RUNTIME_DEFINED_ACCEPTANCE_SEMANTICS:"DENY",RUNTIME_DEFINED_TOLERANCE:"DENY",RAW_WORKER_SUCCESS_DIRECT_ACCEPTANCE:"DENY",CONTRACT_SET_REF:{ID:"ATELIER_REV51_CONTRACT_SET_V1",VERSION:"1.0.0",SHA256:C},VERIFIER_POLICY_SHA256:"3e1640da42dd97a43cd66e6ccaea0af6eb647a66c4eea7f48f47d40a67b2d569"}, false, ["VERIFIER_POLICY_SHA256_MISMATCH"]],
  ["V008_CONTRACT_SET_DRIFT_DENY", {VERIFIER_POLICY_ID:"verifier.project-ci.required",VERIFIER_POLICY:"PROJECT_CI_REQUIRED",ACCEPTANCE_REQUIREMENT_REF:"project:ci-acceptance/rev51",RUNTIME_DEFINED_ACCEPTANCE_SEMANTICS:"DENY",RUNTIME_DEFINED_TOLERANCE:"DENY",RAW_WORKER_SUCCESS_DIRECT_ACCEPTANCE:"DENY",CONTRACT_SET_REF:{ID:"ATELIER_REV51_CONTRACT_SET_V1",VERSION:"1.0.0",SHA256:"0".repeat(64)},VERIFIER_POLICY_SHA256:"f199a586e6a7f288b5d02d63af611bafecc07106a6de772ed96bcaaa2d90dcab"}, false, ["CONTRACT_SET_REF_MISMATCH"]]
];

function fullPolicy(partial) {
  return {
    POLICY_TYPE:"PILOTE_VERIFIER_POLICY_V1",
    POLICY_VERSION:"1.0.0",
    CANONICALIZATION_ID:"ATELIER_EXECUTION_CANONICAL_JSON_V1",
    VERIFIER_POLICY_VERSION:"1.0.0",
    ...partial
  };
}

function intent(policy, overrides={}) {
  return {
    INTENT_SHA256:"9".repeat(64),
    VERIFIER_POLICY_REF:{ID:policy.VERIFIER_POLICY_ID,VERSION:policy.VERIFIER_POLICY_VERSION,SHA256:policy.VERIFIER_POLICY_SHA256},
    ACCEPTANCE_REQUIREMENT_REF:policy.ACCEPTANCE_REQUIREMENT_REF,
    ...overrides
  };
}

function plan(policy, overrides={}) {
  return {
    EXECUTION_INTENT_SHA256:"9".repeat(64),
    VERIFIER_POLICY:policy.VERIFIER_POLICY,
    VERIFIER_POLICY_REF_SHA256:policy.VERIFIER_POLICY_SHA256,
    ACCEPTANCE_REQUIREMENT_REF:policy.ACCEPTANCE_REQUIREMENT_REF,
    CONTRACT_SET_SHA256:C,
    ...overrides
  };
}

test("A3 authoritative identities are exact", () => {
  assert.equal(A3_AUTHORITATIVE_BINDING.HEAD,"8a87ddb7fba03165339f86b26047417624b43899");
  assert.equal(A3_AUTHORITATIVE_BINDING.TREE,"fc8ce3ce6c7a1650c2894937699c51876b6428bc");
  assert.equal(A3_AUTHORITATIVE_BINDING.SCHEMA_SHA256,"59652f22bbf361b496947b26671aae81d58ff79c579561c050bf0e54b830cf58");
  assert.equal(A3_AUTHORITATIVE_BINDING.TEST_VECTOR_SET_SHA256,"080b23a76005d83bfdd8495c51c486959d6ba53e6be9181e460e01fa0202e61f");
  assert.equal(A3_AUTHORITATIVE_BINDING.EXPECTED_RESULT_SET_SHA256,"7d884b47d4c2f1c47f404dd3bf148036447324d86ef93e88be34a1b4f77c93bd");
  assert.equal(A3_AUTHORITATIVE_BINDING.AUTHORITATIVE_MANIFEST_SHA256,"ad914089dec666fb5befc4ba9084736043bd1466b3f543a11823c3a6e4fab6ca");
});

for (const [id, partial, ok, errors] of vectors) {
  test(`${id} reproduces A3 expected result`, () => {
    const actual=validatePiloteVerifierPolicyV1(fullPolicy(partial));
    assert.equal(actual.ok,ok,id);
    assert.deepEqual(actual.errors,errors,id);
  });
}

test("canonical hash matches authoritative valid policy hash", () => {
  const policy=fullPolicy(vectors[0][1]);
  assert.equal(computePiloteVerifierPolicySha256V1(policy),policy.VERIFIER_POLICY_SHA256);
});

test("A2 intent, A3 policy and Runtime plan bind exactly", () => {
  const policy=fullPolicy(vectors[2][1]);
  assert.deepEqual(validateA3CrossStackBindingV1(intent(policy),policy,plan(policy)),{ok:true,errors:[]});
});

test("verifier policy ref drift is rejected", () => {
  const policy=fullPolicy(vectors[0][1]);
  const actual=validateA3CrossStackBindingV1(intent(policy,{VERIFIER_POLICY_REF:{ID:policy.VERIFIER_POLICY_ID,VERSION:"1.0.0",SHA256:"f".repeat(64)}}),policy,plan(policy));
  assert.ok(actual.errors.includes("VERIFIER_POLICY_REF_BINDING_MISMATCH"));
});

test("acceptance reference drift is rejected", () => {
  const policy=fullPolicy(vectors[1][1]);
  const actual=validateA3CrossStackBindingV1(intent(policy,{ACCEPTANCE_REQUIREMENT_REF:"project:different"}),policy,plan(policy));
  assert.ok(actual.errors.includes("ACCEPTANCE_REQUIREMENT_REF_BINDING_MISMATCH"));
});

test("Runtime plan verifier mode cannot diverge from Pilote policy", () => {
  const policy=fullPolicy(vectors[0][1]);
  const actual=validateA3CrossStackBindingV1(intent(policy),policy,plan(policy,{VERIFIER_POLICY:"PROJECT_CI_REQUIRED"}));
  assert.ok(actual.errors.includes("RUNTIME_PLAN_VERIFIER_POLICY_MISMATCH"));
});

test("Runtime plan acceptance ref cannot diverge", () => {
  const policy=fullPolicy(vectors[0][1]);
  const actual=validateA3CrossStackBindingV1(intent(policy),policy,plan(policy,{ACCEPTANCE_REQUIREMENT_REF:"project:different"}));
  assert.ok(actual.errors.includes("RUNTIME_PLAN_ACCEPTANCE_REQUIREMENT_REF_MISMATCH"));
});

test("binding receipt preserves exact semantic refs and no Runtime acceptance authority", () => {
  const policy=fullPolicy(vectors[0][1]);
  const receipt=createA3CrossStackBindingReceiptV1(intent(policy),policy,plan(policy));
  assert.equal(receipt.VERIFIER_POLICY_REF.SHA256,policy.VERIFIER_POLICY_SHA256);
  assert.equal(receipt.ACCEPTANCE_REQUIREMENT_REF,policy.ACCEPTANCE_REQUIREMENT_REF);
  assert.equal(receipt.RUNTIME_DEFINED_ACCEPTANCE_SEMANTICS,0);
  assert.equal(receipt.RAW_WORKER_SUCCESS_DIRECT_PROJECT_ACCEPTANCE,0);
});
