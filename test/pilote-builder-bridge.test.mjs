import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildApplyBundle, validateBuilderSchema, writeApplyBundle } from "../tools/pilote-builder-bridge/builder-bridge.mjs";

const fixturePath = "fixtures/pilote-builder/rev39/PILOTE_REV39_ACTIONS_OPENAPI_CANDIDATE_v002.yaml";
const policyPath = "fixtures/pilote-builder/rev39/baseline-operation-ids.json";
const schemaText = await readFile(fixturePath, "utf8");
const policy = JSON.parse(await readFile(policyPath, "utf8"));

test("Rev3.9 v002 fixture passes the exact Builder Bridge contract", () => {
  const result = validateBuilderSchema(schemaText, policy);
  assert.equal(result.ok, true, result.manifest.errors.join("\n"));
  assert.equal(result.receipt.schema_sha256, policy.expected_schema_sha256);
  assert.equal(result.receipt.operation_total, 24);
  assert.equal(result.receipt.operation_unique, 24);
  assert.equal(result.receipt.baseline_preserved, true);
  assert.equal(result.receipt.exact_expected_additions, true);
  assert.equal(result.receipt.forbidden_surface_zero, true);
  assert.equal(result.receipt.null_value_zero, true);
  assert.deepEqual(result.manifest.baseline.actual_added, policy.expected_added_operation_ids.slice().sort());
});

test("bundle output is byte-deterministic for identical input", async () => {
  const first = buildApplyBundle(schemaText, policy);
  const second = buildApplyBundle(schemaText, policy);
  assert.deepEqual(first.files, second.files);

  const firstDir = await mkdtemp(join(tmpdir(), "pilote-bridge-a-"));
  const secondDir = await mkdtemp(join(tmpdir(), "pilote-bridge-b-"));
  await writeApplyBundle({ schemaText, policy, outputDir: firstDir });
  await writeApplyBundle({ schemaText, policy, outputDir: secondDir });
  for (const name of Object.keys(first.files)) {
    assert.equal(await readFile(join(firstDir, name), "utf8"), await readFile(join(secondDir, name), "utf8"));
  }
});

test("arbitrary workflow selection is rejected", () => {
  const mutated = schemaText.replace(
    "/actions/workflows/atelier-runtime-v1.yml/dispatches:",
    "/actions/workflows/{workflow_id}/dispatches:"
  );
  const mutatedPolicy = { ...policy, expected_schema_sha256: "0".repeat(64) };
  const result = validateBuilderSchema(mutated, mutatedPolicy);
  assert.equal(result.ok, false);
  assert.equal(result.receipt.forbidden_surface_zero, false);
  assert.ok(result.manifest.dispatch.forbidden_hits.some((hit) => hit.reason === "ARBITRARY_WORKFLOW_DISPATCH"));
});

test("duplicate operationId is rejected", () => {
  const mutated = schemaText.replace("operationId: getBranch", "operationId: getRepository");
  const mutatedPolicy = { ...policy, expected_schema_sha256: "0".repeat(64) };
  const result = validateBuilderSchema(mutated, mutatedPolicy);
  assert.equal(result.ok, false);
  assert.ok(result.manifest.errors.some((error) => error.startsWith("OPERATION_ID_DUPLICATE:")));
});

test("accidental YAML null values are rejected", () => {
  const mutated = schemaText.replace(
    "'200': {description: Repository metadata}",
    "'200': {description: Repository metadata, accidental:}"
  );
  const mutatedPolicy = { ...policy, expected_schema_sha256: "0".repeat(64) };
  const result = validateBuilderSchema(mutated, mutatedPolicy);
  assert.equal(result.ok, false);
  assert.equal(result.receipt.null_value_zero, false);
  assert.ok(result.manifest.null_value_paths.some((path) => path.endsWith(".accidental")));
});
