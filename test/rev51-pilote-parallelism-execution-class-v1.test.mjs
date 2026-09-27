import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildParallelismExecutionClassIntentV1,
  deriveExecutionClassProjectionV1,
  deriveParallelismProjectionV1,
  validateA6CrossStackSemanticBindingV1,
  validateParallelismExecutionClassIntentV1
} from "../pilote/rev51/parallelism-execution-class-intent-v1.mjs";

async function loadJson(path) {
  return JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
}

test("A6 binds frozen execution class and numeric parallelism ceiling", async () => {
  const task = await loadJson("../fixtures/rev51/pilote-execution-intent-v1/task-contract-anchor-v1.json");
  const executionIntent = await loadJson("../fixtures/rev51/pilote-execution-intent-v1/valid-native-v1.json");
  const a6 = buildParallelismExecutionClassIntentV1(task, executionIntent);
  assert.equal(a6.EXECUTION_CLASS, task.RESOURCE_REQUIREMENTS.EXECUTION_CLASS);
  assert.equal(a6.MAX_PARALLELISM, task.ECONOMY_BUDGET.MAX_PARALLELISM);
  assert.equal(a6.PARALLELISM_INTENT, executionIntent.PARALLELISM_INTENT);
  assert.deepEqual(validateA6CrossStackSemanticBindingV1(task, executionIntent, a6), { ok: true, errors: [] });
});

test("serial required forces effective cap one", () => {
  assert.deepEqual(
    deriveParallelismProjectionV1("SERIAL_REQUIRED", 8),
    {
      SCHEDULING_MODE: "SERIAL_ONLY",
      EFFECTIVE_PARALLELISM_CAP: 1,
      PARALLELISM_IS_PERMISSION_ONLY: false,
      SEMANTIC_DAG_MUST_BE_PRESERVED: true
    }
  );
});

test("parallel allowed is permission rather than obligation", () => {
  const p = deriveParallelismProjectionV1("PARALLEL_ALLOWED", 8);
  assert.equal(p.SCHEDULING_MODE, "PARALLEL_PERMITTED");
  assert.equal(p.EFFECTIVE_PARALLELISM_CAP, 8);
  assert.equal(p.PARALLELISM_IS_PERMISSION_ONLY, true);
  assert.equal(p.SEMANTIC_DAG_MUST_BE_PRESERVED, true);
});

test("hard execution classes remain provider-neutral constraints", () => {
  assert.deepEqual(
    deriveExecutionClassProjectionV1("SELF_HOSTED_REQUIRED"),
    {
      CONSTRAINT_KIND: "HARD_REQUIREMENT",
      REQUIRED_CLASS: "SELF_HOSTED",
      HOSTED_ELIGIBLE: false,
      CONCRETE_PROVIDER_SELECTION: "RUNTIME_OWNED",
      SILENT_DOWNGRADE_ALLOWED: false
    }
  );
  assert.deepEqual(
    deriveExecutionClassProjectionV1("HOST_LOCAL_REQUIRED"),
    {
      CONSTRAINT_KIND: "HARD_REQUIREMENT",
      REQUIRED_CLASS: "HOST_LOCAL",
      HOSTED_ELIGIBLE: false,
      CONCRETE_PROVIDER_SELECTION: "RUNTIME_OWNED",
      SILENT_DOWNGRADE_ALLOWED: false
    }
  );
});

test("sealed A6 vectors reproduce sealed expected results", async () => {
  const vectors = await loadJson("../fixtures/rev51/pilote-parallelism-execution-class-intent-v1/test-vector-set-v1.json");
  const expected = await loadJson("../fixtures/rev51/pilote-parallelism-execution-class-intent-v1/expected-result-set-v1.json");
  assert.equal(vectors.VECTORS.length, expected.RESULTS.length);
  for (const vector of vectors.VECTORS) {
    const exp = expected.RESULTS.find(result => result.ID === vector.ID);
    assert.ok(exp, vector.ID);
    assert.deepEqual(
      validateParallelismExecutionClassIntentV1(vector.INPUT),
      { ok: exp.OK, errors: exp.ERRORS },
      vector.ID
    );
  }
});
