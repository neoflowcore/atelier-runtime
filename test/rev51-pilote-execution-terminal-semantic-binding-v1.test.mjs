import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildExecutionTerminalSemanticBindingV1,
  deriveExecutionTerminalProjectionV1,
  validateExecutionTerminalSemanticBindingV1
} from "../pilote/rev51/execution-terminal-semantic-binding-v1.mjs";

async function loadJson(path) {
  return JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
}

test("sealed binding validates", () => {
  const binding = buildExecutionTerminalSemanticBindingV1();
  assert.deepEqual(validateExecutionTerminalSemanticBindingV1(binding), { ok: true, errors: [] });
});

test("all execution states project deterministically", async () => {
  const vectors = await loadJson("../fixtures/rev51/pilote-execution-terminal-semantic-binding-v1/test-vector-set-v1.json");
  for (const expected of vectors.PROJECTION_CASES) {
    assert.deepEqual(
      deriveExecutionTerminalProjectionV1(expected.EXECUTION_STATE),
      expected,
      expected.EXECUTION_STATE
    );
  }
});

test("OUTCOME_UNKNOWN remains non-terminal and requires reconciliation", () => {
  assert.deepEqual(
    deriveExecutionTerminalProjectionV1("OUTCOME_UNKNOWN"),
    {
      EXECUTION_STATE: "OUTCOME_UNKNOWN",
      EXECUTION_TERMINAL: false,
      RECONCILIATION_REQUIRED: true,
      ACCEPTANCE_IMPLIED: false,
      RUNTIME_EVIDENCE_REQUIRED: true
    }
  );
});

test("success terminality does not imply acceptance", () => {
  const p = deriveExecutionTerminalProjectionV1("SUCCEEDED");
  assert.equal(p.EXECUTION_TERMINAL, true);
  assert.equal(p.ACCEPTANCE_IMPLIED, false);
});

test("sealed vectors reproduce sealed expected results", async () => {
  const vectors = await loadJson("../fixtures/rev51/pilote-execution-terminal-semantic-binding-v1/test-vector-set-v1.json");
  const expected = await loadJson("../fixtures/rev51/pilote-execution-terminal-semantic-binding-v1/expected-result-set-v1.json");
  assert.equal(vectors.VECTORS.length, expected.RESULTS.length);
  for (const vector of vectors.VECTORS) {
    const exp = expected.RESULTS.find(result => result.ID === vector.ID);
    assert.ok(exp, vector.ID);
    assert.deepEqual(
      validateExecutionTerminalSemanticBindingV1(vector.INPUT),
      { ok: exp.OK, errors: exp.ERRORS },
      vector.ID
    );
  }
});
