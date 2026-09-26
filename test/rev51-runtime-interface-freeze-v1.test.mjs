import test from "node:test";
import assert from "node:assert/strict";
import {
  compilePromotedRuntimeContractSetV1,
  compileRuntimeCompatibilityIdentityV1,
  compileRuntimeInterfaceIdentityV1,
  evaluateRuntimeInterfaceFreezeV1,
  validateCanonicalCiEvidenceV1
} from "../runtime/rev51/runtime-interface-freeze-v1.mjs";

const H = (x) => x.repeat(64);
const modules = [
  { path: "runtime/rev51/auth-endgame-transaction-v1.mjs", sha256: H("1") },
  { path: "runtime/rev51/continuation-decision-v1.mjs", sha256: H("2") }
];
const baseline = {
  INTERFACE_VERSION: "1.0.0",
  INTERFACE_MANIFEST_SHA256: H("3"),
  TASK_CONTRACT_SCHEMA_SHA256: H("4"),
  TASK_CONTRACT_MACHINE_SCHEMA_SHA256: H("5"),
  FROZEN_FIELDS: 27,
  TASK_CONTRACT_V1_MUTATION: 0,
  INTERFACE_V1_MUTATION: 0
};
const ci = {
  head: "a".repeat(40), tree: "b".repeat(40), runId: 1, jobId: 2,
  conclusion: "success", observedTests: 913, fail: 0, releaseGate: "PASS",
  rerun: 0, workflowDispatch: 0
};

test("promoted contract set is order-independent and deterministic", () => {
  const a = compilePromotedRuntimeContractSetV1(modules);
  const b = compilePromotedRuntimeContractSetV1([...modules].reverse());
  assert.equal(a.CONTRACT_SET_SHA256, b.CONTRACT_SET_SHA256);
});

test("promoted contract set rejects duplicate paths", () => {
  assert.throws(() => compilePromotedRuntimeContractSetV1([modules[0], modules[0]]), /PROMOTED_MODULE_PATH_DUPLICATE/);
});

test("runtime interface identity preserves frozen v1 interface and 27 fields", () => {
  const set = compilePromotedRuntimeContractSetV1(modules);
  const identity = compileRuntimeInterfaceIdentityV1({ legacyInterfaceBaseline: baseline, promotedContractSetSha256: set.CONTRACT_SET_SHA256 });
  assert.equal(identity.LEGACY_INTERFACE_VERSION, "1.0.0");
  assert.equal(identity.LEGACY_FROZEN_FIELDS, 27);
  assert.equal(identity.TASK_CONTRACT_V1_MUTATION, 0);
  assert.equal(identity.INTERFACE_V1_MUTATION, 0);
  assert.match(identity.RUNTIME_INTERFACE_IDENTITY_SHA256, /^[0-9a-f]{64}$/);
});

test("runtime interface identity denies legacy interface mutation", () => {
  const set = compilePromotedRuntimeContractSetV1(modules);
  assert.throws(() => compileRuntimeInterfaceIdentityV1({ legacyInterfaceBaseline: { ...baseline, INTERFACE_V1_MUTATION: 1 }, promotedContractSetSha256: set.CONTRACT_SET_SHA256 }), /INTERFACE_V1_MUTATION_DENIED/);
});

test("compatibility identity binds active legacy profiles and denies semantic reinterpretation", () => {
  const set = compilePromotedRuntimeContractSetV1(modules);
  const identity = compileRuntimeInterfaceIdentityV1({ legacyInterfaceBaseline: baseline, promotedContractSetSha256: set.CONTRACT_SET_SHA256 });
  const compat = compileRuntimeCompatibilityIdentityV1({
    runtimeInterfaceIdentitySha256: identity.RUNTIME_INTERFACE_IDENTITY_SHA256,
    legacyCompatibilityArtifactSha256: H("6"),
    compatProfiles: [{ id: "REV50", sha256: H("7"), status: "ACTIVE" }]
  });
  assert.equal(compat.SEMANTIC_REINTERPRETATION, "DENY");
  assert.equal(compat.LEGACY_REQUIRED_FIELD_ADDITION, "DENY");
  assert.match(compat.RUNTIME_COMPATIBILITY_IDENTITY_SHA256, /^[0-9a-f]{64}$/);
});

test("canonical CI evidence requires success, zero failures, release gate, rerun zero and dispatch zero", () => {
  assert.equal(validateCanonicalCiEvidenceV1(ci).ok, true);
  assert.ok(validateCanonicalCiEvidenceV1({ ...ci, rerun: 1 }).errors.includes("CI_RERUN_NONZERO"));
  assert.ok(validateCanonicalCiEvidenceV1({ ...ci, fail: 1 }).errors.includes("CI_FUNCTIONAL_FAILURES_PRESENT"));
});

test("interface freeze passes after promotion but development seal waits for deferred auth endgame", () => {
  const out = evaluateRuntimeInterfaceFreezeV1({
    canonicalCi: ci,
    runtimeInterfaceIdentitySha256: H("8"),
    runtimeCompatibilityIdentitySha256: H("9"),
    promotionCoverageComplete: true,
    credentialIndependentGatesComplete: true,
    remainingCredentialIndependentRequiredWork: 0,
    unexpectedBillableResidue: 0,
    deferredGlobalAuthEndgame: ["SOURCE_PROVENANCE_LIVE_VERIFICATION"]
  });
  assert.equal(out.interfaceFreeze, "PASS");
  assert.equal(out.projectDevelopmentComplete, true);
  assert.equal(out.globalAuthEndgameTrigger, true);
  assert.equal(out.runtimeDevelopmentSeal, "PENDING_GLOBAL_AUTH_ENDGAME");
});

test("development seal passes when no auth endgame requirement remains", () => {
  const out = evaluateRuntimeInterfaceFreezeV1({
    canonicalCi: ci,
    runtimeInterfaceIdentitySha256: H("8"),
    runtimeCompatibilityIdentitySha256: H("9"),
    promotionCoverageComplete: true,
    credentialIndependentGatesComplete: true,
    remainingCredentialIndependentRequiredWork: 0,
    unexpectedBillableResidue: 0,
    deferredGlobalAuthEndgame: []
  });
  assert.equal(out.runtimeDevelopmentSeal, "PASS");
  assert.equal(out.globalAuthEndgameTrigger, false);
});

test("freeze fails closed on missing promotion or billable residue", () => {
  assert.equal(evaluateRuntimeInterfaceFreezeV1({ canonicalCi: ci, runtimeInterfaceIdentitySha256: H("8"), runtimeCompatibilityIdentitySha256: H("9"), promotionCoverageComplete: false, credentialIndependentGatesComplete: true, remainingCredentialIndependentRequiredWork: 0, unexpectedBillableResidue: 0 }).interfaceFreeze, "DENY");
  assert.equal(evaluateRuntimeInterfaceFreezeV1({ canonicalCi: ci, runtimeInterfaceIdentitySha256: H("8"), runtimeCompatibilityIdentitySha256: H("9"), promotionCoverageComplete: true, credentialIndependentGatesComplete: true, remainingCredentialIndependentRequiredWork: 0, unexpectedBillableResidue: 1 }).interfaceFreeze, "DENY");
});
