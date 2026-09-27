import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildVerifierPolicyV1,
  computeVerifierPolicySha256,
  toVerifierPolicyRefV1,
  validateAcceptanceRequirementRefV1,
  validateExecutionIntentVerifierBindingV1,
  validateVerifierPolicyV1
} from "../pilote/rev51/verifier-acceptance-intent-v1.mjs";

const MODES = ["RUNTIME_REQUIRED", "PROJECT_CI_REQUIRED", "RUNTIME_PLUS_PROJECT_CI"];

for (const mode of MODES) {
  test(`${mode} builds and validates`, () => {
    const policy = buildVerifierPolicyV1({ verifierPolicy: mode });
    assert.deepEqual(validateVerifierPolicyV1(policy), { ok: true, errors: [] });
    assert.match(policy.VERIFIER_POLICY_SHA256, /^[0-9a-f]{64}$/);
  });
}

test("A2 verifier policy ref has exact ID/version/SHA shape", () => {
  const ref = toVerifierPolicyRefV1(buildVerifierPolicyV1({ verifierPolicy: "RUNTIME_REQUIRED" }));
  assert.deepEqual(Object.keys(ref).sort(), ["ID", "SHA256", "VERSION"]);
});

test("Runtime-owned acceptance namespace is rejected", () => {
  const result = validateAcceptanceRequirementRefV1("runtime:accept-whatever");
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("ACCEPTANCE_REQUIREMENT_OWNER_NOT_PILOTE_SEMANTIC"));
});

test("runtime-defined acceptance semantics cannot be enabled", () => {
  const policy = buildVerifierPolicyV1({ verifierPolicy: "RUNTIME_REQUIRED" });
  policy.RUNTIME_DEFINED_ACCEPTANCE_SEMANTICS = "ALLOW";
  policy.VERIFIER_POLICY_SHA256 = computeVerifierPolicySha256(policy);
  assert.ok(validateVerifierPolicyV1(policy).errors.includes("RUNTIME_DEFINED_ACCEPTANCE_SEMANTICS_MUST_BE_DENY"));
});

test("runtime-defined tolerance cannot be enabled", () => {
  const policy = buildVerifierPolicyV1({ verifierPolicy: "PROJECT_CI_REQUIRED" });
  policy.RUNTIME_DEFINED_TOLERANCE = "ALLOW";
  policy.VERIFIER_POLICY_SHA256 = computeVerifierPolicySha256(policy);
  assert.ok(validateVerifierPolicyV1(policy).errors.includes("RUNTIME_DEFINED_TOLERANCE_MUST_BE_DENY"));
});

test("raw worker success cannot become project acceptance", () => {
  const policy = buildVerifierPolicyV1({ verifierPolicy: "RUNTIME_PLUS_PROJECT_CI" });
  policy.RAW_WORKER_SUCCESS_DIRECT_ACCEPTANCE = "ALLOW";
  policy.VERIFIER_POLICY_SHA256 = computeVerifierPolicySha256(policy);
  assert.ok(validateVerifierPolicyV1(policy).errors.includes("RAW_WORKER_SUCCESS_DIRECT_ACCEPTANCE_MUST_BE_DENY"));
});

test("contract-set drift fails closed", () => {
  const policy = buildVerifierPolicyV1({ verifierPolicy: "RUNTIME_REQUIRED" });
  policy.CONTRACT_SET_REF.SHA256 = "0".repeat(64);
  policy.VERIFIER_POLICY_SHA256 = computeVerifierPolicySha256(policy);
  assert.ok(validateVerifierPolicyV1(policy).errors.includes("CONTRACT_SET_REF_MISMATCH"));
});

test("policy tamper without rehash fails closed", () => {
  const policy = buildVerifierPolicyV1({ verifierPolicy: "RUNTIME_REQUIRED" });
  policy.VERIFIER_POLICY = "PROJECT_CI_REQUIRED";
  assert.ok(validateVerifierPolicyV1(policy).errors.includes("VERIFIER_POLICY_SHA256_MISMATCH"));
});

test("A2 execution intent verifier/acceptance refs bind exactly", () => {
  const policy = buildVerifierPolicyV1({ verifierPolicy: "RUNTIME_PLUS_PROJECT_CI", acceptanceRequirementRef: "project:acceptance/rev51" });
  const intent = { VERIFIER_POLICY_REF: toVerifierPolicyRefV1(policy), ACCEPTANCE_REQUIREMENT_REF: "project:acceptance/rev51" };
  assert.deepEqual(validateExecutionIntentVerifierBindingV1(intent, policy), { ok: true, errors: [] });
});

test("A2 acceptance ref drift is rejected", () => {
  const policy = buildVerifierPolicyV1({ verifierPolicy: "RUNTIME_REQUIRED" });
  const intent = { VERIFIER_POLICY_REF: toVerifierPolicyRefV1(policy), ACCEPTANCE_REQUIREMENT_REF: "project:different" };
  assert.ok(validateExecutionIntentVerifierBindingV1(intent, policy).errors.includes("ACCEPTANCE_REQUIREMENT_REF_BINDING_MISMATCH"));
});

test("sealed verifier fixture set matches exact expected validation", async () => {
  const set = JSON.parse(await readFile(new URL("../fixtures/rev51/pilote-verifier-policy-v1/fixture-set-v1.json", import.meta.url), "utf8"));
  assert.equal(set.CONTRACT_SET_SHA256, "a8b220c92a47306061e9aca1c65077d357b00bda12e9daad4f37215256083f4a");
  assert.equal(set.FIXTURES.length, 8);
  for (const fixture of set.FIXTURES) {
    const actual = validateVerifierPolicyV1(fixture.INPUT);
    assert.deepEqual(actual, { ok: fixture.EXPECTED.OK, errors: fixture.EXPECTED.ERRORS }, fixture.ID);
  }
});
