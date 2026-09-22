import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildCapabilityResourceSecurityIntentV1,
  computeCapabilityResourceSecurityIntentSha256V1,
  validateA5CrossStackSemanticBindingV1,
  validateCapabilityResourceSecurityIntentV1
} from "../pilote/rev51/capability-resource-security-intent-v1.mjs";

async function loadJson(path) {
  return JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
}

test("read-only task builds A5 intent without Runtime-owned identities", async () => {
  const task = await loadJson("../fixtures/rev51/pilote-execution-intent-v1/task-contract-anchor-v1.json");
  const executionIntent = await loadJson("../fixtures/rev51/pilote-execution-intent-v1/valid-native-v1.json");
  const a5 = buildCapabilityResourceSecurityIntentV1(task, executionIntent);
  assert.deepEqual(a5.CAPABILITY_REQUIREMENT_REFS, ["SOURCE_READ"]);
  assert.equal(a5.CAPABILITY_ATTESTATION_POLICY, "STATIC_AND_DYNAMIC_REQUIRED");
  assert.equal(a5.RESOURCE_OWNERSHIP_PROOF_POLICY, "DURABLE_PROOF_REQUIRED_BEFORE_DESTRUCTIVE_ACTION");
  assert.equal(a5.PRIVILEGED_WORKER, "DENY_DEFAULT");
  assert.deepEqual(validateA5CrossStackSemanticBindingV1(task, executionIntent, a5), { ok: true, errors: [] });
});

test("capability escalation outside task/execution intent is denied", async () => {
  const task = await loadJson("../fixtures/rev51/pilote-execution-intent-v1/task-contract-anchor-v1.json");
  const executionIntent = await loadJson("../fixtures/rev51/pilote-execution-intent-v1/valid-native-v1.json");
  const a5 = buildCapabilityResourceSecurityIntentV1(task, executionIntent);
  a5.CAPABILITY_REQUIREMENT_REFS = ["SOURCE_READ", "PROVIDER_API_MUTATE"];
  a5.A5_INTENT_SHA256 = computeCapabilityResourceSecurityIntentSha256V1(a5);
  const result = validateA5CrossStackSemanticBindingV1(task, executionIntent, a5);
  assert.ok(result.errors.includes("CAPABILITY_REQUIREMENT_BINDING_MISMATCH"));
  assert.ok(result.errors.includes("CAPABILITY_ESCALATION_DENY:PROVIDER_API_MUTATE"));
});

test("resource intent drift from A2 is denied", async () => {
  const task = await loadJson("../fixtures/rev51/pilote-execution-intent-v1/task-contract-anchor-v1.json");
  const executionIntent = await loadJson("../fixtures/rev51/pilote-execution-intent-v1/valid-native-v1.json");
  const a5 = buildCapabilityResourceSecurityIntentV1(task, executionIntent);
  a5.RESOURCE_INTENT.MEMORY_MIN_MIB = 4096;
  a5.A5_INTENT_SHA256 = computeCapabilityResourceSecurityIntentSha256V1(a5);
  const result = validateA5CrossStackSemanticBindingV1(task, executionIntent, a5);
  assert.ok(result.errors.includes("RESOURCE_INTENT_BINDING_MISMATCH"));
});

test("security requirement drift from A2 is denied", async () => {
  const task = await loadJson("../fixtures/rev51/pilote-execution-intent-v1/task-contract-anchor-v1.json");
  const executionIntent = await loadJson("../fixtures/rev51/pilote-execution-intent-v1/valid-native-v1.json");
  const a5 = buildCapabilityResourceSecurityIntentV1(task, executionIntent);
  a5.SECURITY_REQUIREMENT.SECRET_CLASS = "PRODUCTION_CONTROL";
  a5.A5_INTENT_SHA256 = computeCapabilityResourceSecurityIntentSha256V1(a5);
  const result = validateA5CrossStackSemanticBindingV1(task, executionIntent, a5);
  assert.ok(result.errors.includes("SECURITY_REQUIREMENT_BINDING_MISMATCH"));
});

test("sealed A5 vectors reproduce sealed expected results", async () => {
  const vectors = await loadJson("../fixtures/rev51/pilote-capability-resource-security-intent-v1/test-vector-set-v1.json");
  const expected = await loadJson("../fixtures/rev51/pilote-capability-resource-security-intent-v1/expected-result-set-v1.json");
  assert.equal(vectors.VECTORS.length, expected.RESULTS.length);
  for (const vector of vectors.VECTORS) {
    const exp = expected.RESULTS.find(result => result.ID === vector.ID);
    assert.ok(exp, vector.ID);
    assert.deepEqual(validateCapabilityResourceSecurityIntentV1(vector.INPUT), { ok: exp.OK, errors: exp.ERRORS }, vector.ID);
  }
});
