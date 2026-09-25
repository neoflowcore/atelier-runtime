import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildBackwardCompatibilitySemanticArtifactsV1, runA8VectorV1, validateBackwardCompatibilitySemanticArtifactsV1 } from "../pilote/rev51/backward-compatibility-semantic-artifacts-v1.mjs";

async function loadJson(path) { return JSON.parse(await readFile(new URL(path, import.meta.url), "utf8")); }

test("published semantic artifact set equals the module sealed artifact", async () => {
  const published=await loadJson("../fixtures/rev51/pilote-backward-compatibility-semantic-artifacts-v1/semantic-artifact-set-v1.json");
  const built=buildBackwardCompatibilitySemanticArtifactsV1();
  assert.deepEqual(published,built);
  assert.deepEqual(validateBackwardCompatibilitySemanticArtifactsV1(published),{ok:true,errors:[]});
});

test("sealed A8 vectors reproduce sealed expected results", async () => {
  const vectors=await loadJson("../fixtures/rev51/pilote-backward-compatibility-semantic-artifacts-v1/test-vector-set-v1.json");
  const expected=await loadJson("../fixtures/rev51/pilote-backward-compatibility-semantic-artifacts-v1/expected-result-set-v1.json");
  assert.equal(vectors.VECTORS.length,expected.RESULTS.length);
  for (const vector of vectors.VECTORS) {
    const exp=expected.RESULTS.find(x=>x.ID===vector.ID);
    assert.ok(exp,vector.ID);
    assert.deepEqual(runA8VectorV1(vector),exp.RESULT,vector.ID);
  }
});
