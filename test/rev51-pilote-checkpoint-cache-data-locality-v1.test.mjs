import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildCheckpointCacheDataLocalityIntentV1,
  deriveCachePolicyProjectionV1,
  deriveCheckpointPolicyProjectionV1,
  deriveDataLocalityProjectionV1,
  validateA7CrossStackSemanticBindingV1,
  validateCheckpointCacheDataLocalityIntentV1
} from "../pilote/rev51/checkpoint-cache-data-locality-intent-v1.mjs";

async function loadJson(path) {
  return JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
}

test("A7 binds exactly to A2 checkpoint/cache/locality semantics", async () => {
  const task = await loadJson("../fixtures/rev51/pilote-execution-intent-v1/task-contract-anchor-v1.json");
  const executionIntent = await loadJson("../fixtures/rev51/pilote-execution-intent-v1/valid-native-v1.json");
  const a7 = buildCheckpointCacheDataLocalityIntentV1(task, executionIntent);
  assert.equal(a7.CHECKPOINT_POLICY, executionIntent.CHECKPOINT_POLICY);
  assert.equal(a7.CACHE_POLICY, executionIntent.CACHE_POLICY);
  assert.equal(a7.DATA_LOCALITY_POLICY, executionIntent.DATA_LOCALITY_POLICY);
  assert.deepEqual(validateA7CrossStackSemanticBindingV1(task, executionIntent, a7), { ok: true, errors: [] });
});

test("checkpoint resume requires new attempt lease generation and fence", async () => {
  const task = await loadJson("../fixtures/rev51/pilote-execution-intent-v1/task-contract-anchor-v1.json");
  const executionIntent = await loadJson("../fixtures/rev51/pilote-execution-intent-v1/valid-native-v1.json");
  executionIntent.CHECKPOINT_POLICY = "REQUIRED";
  const a7 = buildCheckpointCacheDataLocalityIntentV1(task, executionIntent);
  assert.equal(a7.CHECKPOINT_RESUME_NEW_ATTEMPT, "REQUIRED");
  assert.equal(a7.CHECKPOINT_RESUME_NEW_LEASE_GENERATION, "REQUIRED");
  assert.equal(a7.CHECKPOINT_RESUME_FENCE_ADVANCE, "REQUIRED");
  assert.equal(a7.CHECKPOINT_STALE_ATTEMPT_ACCEPTANCE, "DENY");
});

test("cache hit never equals verifier pass and never bypasses final gate", async () => {
  const task = await loadJson("../fixtures/rev51/pilote-execution-intent-v1/task-contract-anchor-v1.json");
  const executionIntent = await loadJson("../fixtures/rev51/pilote-execution-intent-v1/valid-native-v1.json");
  executionIntent.CACHE_POLICY = "REQUIRED";
  const a7 = buildCheckpointCacheDataLocalityIntentV1(task, executionIntent);
  assert.equal(a7.CACHE_HIT_VERIFIER_EQUIVALENCE, "DENY");
  assert.equal(a7.CACHE_FINAL_GATE_BYPASS, "DENY");
  assert.equal(a7.CACHE_OBJECT_AUTHORITATIVE_EVIDENCE, "DENY");
});

test("egress restricted locality remains provider neutral and fail closed", () => {
  assert.deepEqual(
    deriveDataLocalityProjectionV1("EGRESS_RESTRICTED"),
    {
      PLACEMENT_CONSTRAINT: "RUNTIME_DECIDES_WITHIN_SECURITY_BOUNDARY",
      EGRESS_CONSTRAINT: "RESTRICTED_FAIL_CLOSED",
      CONCRETE_PROVIDER_SELECTION: "RUNTIME_OWNED"
    }
  );
});

test("sealed policy projections remain deterministic", () => {
  assert.equal(deriveCheckpointPolicyProjectionV1("NOT_REQUESTED").CHECKPOINT_USAGE, "DISABLED");
  assert.equal(deriveCheckpointPolicyProjectionV1("ELIGIBLE").CHECKPOINT_USAGE, "OPTIONAL");
  assert.equal(deriveCheckpointPolicyProjectionV1("REQUIRED").CHECKPOINT_USAGE, "REQUIRED");

  assert.equal(deriveCachePolicyProjectionV1("NOT_REQUESTED").CACHE_USAGE, "DISABLED");
  assert.equal(deriveCachePolicyProjectionV1("ELIGIBLE").CACHE_USAGE, "OPTIONAL");
  assert.equal(deriveCachePolicyProjectionV1("REQUIRED").CACHE_USAGE, "REQUIRED");
});

test("sealed A7 vectors reproduce sealed expected results", async () => {
  const vectors = await loadJson("../fixtures/rev51/pilote-checkpoint-cache-data-locality-intent-v1/test-vector-set-v1.json");
  const expected = await loadJson("../fixtures/rev51/pilote-checkpoint-cache-data-locality-intent-v1/expected-result-set-v1.json");
  assert.equal(vectors.VECTORS.length, expected.RESULTS.length);
  for (const vector of vectors.VECTORS) {
    const exp = expected.RESULTS.find(result => result.ID === vector.ID);
    assert.ok(exp, vector.ID);
    assert.deepEqual(
      validateCheckpointCacheDataLocalityIntentV1(vector.INPUT),
      { ok: exp.OK, errors: exp.ERRORS },
      vector.ID
    );
  }
});
