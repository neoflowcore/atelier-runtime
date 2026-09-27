import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildExecutionIntentV1
} from "../pilote/rev51/execution-intent-v1.mjs";
import {
  buildApprovalEffectOperatorIntentV1,
  computeApprovalEffectOperatorIntentSha256V1,
  validateA4CrossStackSemanticBindingV1,
  validateApprovalEffectOperatorIntentV1
} from "../pilote/rev51/approval-effect-operator-intent-v1.mjs";

const verifierPolicyRef = {
  ID: "verifier.runtime.required",
  VERSION: "1.0.0",
  SHA256: "2".repeat(64)
};

async function loadJson(path) {
  return JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
}

test("read-only task builds an authority-neutral A4 intent", async () => {
  const task = await loadJson("../fixtures/rev51/pilote-execution-intent-v1/task-contract-anchor-v1.json");
  const executionIntent = await loadJson("../fixtures/rev51/pilote-execution-intent-v1/valid-native-v1.json");
  const a4 = buildApprovalEffectOperatorIntentV1(task, executionIntent);
  assert.equal(a4.APPROVAL_MODE, "INHERIT_TASK");
  assert.deepEqual(a4.EFFECT_CLASS_REFS, ["READ_ONLY"]);
  assert.equal(a4.AUTHORITY_GRANT_POLICY, "DECLARATION_NEVER_GRANTS_AUTHORITY");
  assert.deepEqual(validateA4CrossStackSemanticBindingV1(task, executionIntent, a4), { ok: true, errors: [] });
});

test("exact-approval write task requires explicit human approval", async () => {
  const task = await loadJson("../fixtures/runtime-a/interface-v1/valid_02_candidate_write_intent.json");
  const executionIntent = buildExecutionIntentV1(task, { verifierPolicyRef });
  const a4 = buildApprovalEffectOperatorIntentV1(task, executionIntent);
  assert.equal(a4.APPROVAL_MODE, "EXPLICIT_HUMAN_APPROVAL");
  assert.deepEqual(a4.EFFECT_CLASS_REFS, task.EFFECT_CLASSES);
  assert.deepEqual(a4.SCOPE_REFS, task.ALLOWED_SCOPE);
  assert.deepEqual(validateA4CrossStackSemanticBindingV1(task, executionIntent, a4), { ok: true, errors: [] });
});

test("effect escalation outside Task Contract is denied", async () => {
  const task = await loadJson("../fixtures/rev51/pilote-execution-intent-v1/task-contract-anchor-v1.json");
  const executionIntent = await loadJson("../fixtures/rev51/pilote-execution-intent-v1/valid-native-v1.json");
  const a4 = buildApprovalEffectOperatorIntentV1(task, executionIntent);
  a4.EFFECT_CLASS_REFS = ["READ_ONLY", "REMOTE_SOURCE_WRITE"];
  a4.A4_INTENT_SHA256 = computeApprovalEffectOperatorIntentSha256V1(a4);
  const result = validateA4CrossStackSemanticBindingV1(task, executionIntent, a4);
  assert.ok(result.errors.includes("APPROVAL_EFFECT_BINDING_MISMATCH"));
  assert.ok(result.errors.includes("EFFECT_CLASS_ESCALATION_DENY:REMOTE_SOURCE_WRITE"));
});

test("scope escalation outside Task Contract is denied", async () => {
  const task = await loadJson("../fixtures/rev51/pilote-execution-intent-v1/task-contract-anchor-v1.json");
  const executionIntent = await loadJson("../fixtures/rev51/pilote-execution-intent-v1/valid-native-v1.json");
  const a4 = buildApprovalEffectOperatorIntentV1(task, executionIntent);
  a4.SCOPE_REFS = ["repo:neoflowcore/atelier-runtime", "repo:foreign/example"];
  a4.A4_INTENT_SHA256 = computeApprovalEffectOperatorIntentSha256V1(a4);
  const result = validateA4CrossStackSemanticBindingV1(task, executionIntent, a4);
  assert.ok(result.errors.includes("APPROVAL_SCOPE_BINDING_MISMATCH"));
  assert.ok(result.errors.includes("SCOPE_ESCALATION_DENY:repo:foreign/example"));
});

test("Runtime-owned approval grant identity is forbidden", async () => {
  const set = await loadJson("../fixtures/rev51/pilote-approval-effect-operator-intent-v1/test-vector-set-v1.json");
  const result = validateApprovalEffectOperatorIntentV1(set.VECTORS.find(v => v.ID === "V002_RUNTIME_OWNED_APPROVAL_ID_DENY").INPUT);
  assert.ok(result.errors.includes("FORBIDDEN_RUNTIME_OWNED_KEY:$.APPROVAL_GRANT_ID"));
});

test("effect declaration never grants authority", async () => {
  const set = await loadJson("../fixtures/rev51/pilote-approval-effect-operator-intent-v1/test-vector-set-v1.json");
  const result = validateApprovalEffectOperatorIntentV1(set.VECTORS.find(v => v.ID === "V003_DECLARATION_AUTHORITY_GRANT_DENY").INPUT);
  assert.ok(result.errors.includes("AUTHORITY_GRANT_POLICY_MISMATCH"));
});

test("first irreversible remote submission requires atomic approval claim", async () => {
  const set = await loadJson("../fixtures/rev51/pilote-approval-effect-operator-intent-v1/test-vector-set-v1.json");
  const result = validateApprovalEffectOperatorIntentV1(set.VECTORS.find(v => v.ID === "V004_POST_SUBMISSION_CLAIM_DENY").INPUT);
  assert.ok(result.errors.includes("FIRST_IRREVERSIBLE_REMOTE_SUBMISSION_POLICY_MISMATCH"));
});

test("OUTCOME_UNKNOWN cannot reopen approval and blind retry", async () => {
  const set = await loadJson("../fixtures/rev51/pilote-approval-effect-operator-intent-v1/test-vector-set-v1.json");
  const result = validateApprovalEffectOperatorIntentV1(set.VECTORS.find(v => v.ID === "V005_OUTCOME_UNKNOWN_REOPEN_DENY").INPUT);
  assert.ok(result.errors.includes("OUTCOME_UNKNOWN_APPROVAL_POLICY_MISMATCH"));
});

test("state-affecting intervention cannot preserve trust", async () => {
  const set = await loadJson("../fixtures/rev51/pilote-approval-effect-operator-intent-v1/test-vector-set-v1.json");
  const result = validateApprovalEffectOperatorIntentV1(set.VECTORS.find(v => v.ID === "V006_STATE_AFFECTING_TRUST_PRESERVE_DENY").INPUT);
  assert.ok(result.errors.includes("STATE_AFFECTING_INTERVENTION_POLICY_MISMATCH"));
});

test("contract-set drift fails closed", async () => {
  const set = await loadJson("../fixtures/rev51/pilote-approval-effect-operator-intent-v1/test-vector-set-v1.json");
  const result = validateApprovalEffectOperatorIntentV1(set.VECTORS.find(v => v.ID === "V007_CONTRACT_SET_DRIFT_DENY").INPUT);
  assert.deepEqual(result, { ok: false, errors: ["CONTRACT_SET_REF_MISMATCH"] });
});

test("unknown operator policy is rejected", async () => {
  const set = await loadJson("../fixtures/rev51/pilote-approval-effect-operator-intent-v1/test-vector-set-v1.json");
  const result = validateApprovalEffectOperatorIntentV1(set.VECTORS.find(v => v.ID === "V008_OPERATOR_POLICY_INVALID").INPUT);
  assert.deepEqual(result, { ok: false, errors: ["OPERATOR_POLICY_INVALID"] });
});

test("sealed A4 vectors reproduce sealed expected results", async () => {
  const vectors = await loadJson("../fixtures/rev51/pilote-approval-effect-operator-intent-v1/test-vector-set-v1.json");
  const expected = await loadJson("../fixtures/rev51/pilote-approval-effect-operator-intent-v1/expected-result-set-v1.json");
  assert.equal(vectors.VECTORS.length, expected.RESULTS.length);
  for (const vector of vectors.VECTORS) {
    const exp = expected.RESULTS.find(result => result.ID === vector.ID);
    assert.ok(exp, vector.ID);
    assert.deepEqual(validateApprovalEffectOperatorIntentV1(vector.INPUT), { ok: exp.OK, errors: exp.ERRORS }, vector.ID);
  }
});
