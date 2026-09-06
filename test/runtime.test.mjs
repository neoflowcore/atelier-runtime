import test from "node:test";
import assert from "node:assert/strict";
import { validateRuntimeContract } from "../runtime/preflight.mjs";
import { createReceipt } from "../runtime/receipt.mjs";
import { trackedSourceChanged } from "../runtime/source-integrity.mjs";
import { validateRoutesDocument } from "../runtime/http-check.mjs";
import { declaredStagePlan } from "../runtime/stages.mjs";

const packageJson = { scripts: { lint: "node lint.mjs", "test:integration": "node integration.mjs" } };
const valid = {
  schema_version: 1,
  profile: "NODE_WEB_VERIFY",
  node_version: "22.13.0",
  package_manager: "npm",
  scripts: { lint: "lint", integration: "test:integration" }
};

test("valid contract passes", () => assert.equal(validateRuntimeContract(valid, packageJson).ok, true));
test("arbitrary command field is blocked", () => assert.equal(validateRuntimeContract({ ...valid, command: "npm test" }, packageJson).ok, false));
test("shell-like script is blocked", () => assert.equal(validateRuntimeContract({ ...valid, scripts: { test: "test && echo unsafe" } }, packageJson).ok, false));
test("missing package script is blocked", () => {
  const result = validateRuntimeContract({ ...valid, scripts: { test: "missing" } }, packageJson);
  assert.deepEqual(result.errors, ["MISSING_PACKAGE_SCRIPT:missing"]);
});
test("declared stage plan is fixed-order and marks omissions skipped", () => {
  const plan = declaredStagePlan(valid);
  assert.deepEqual(plan.map(({ slot }) => slot), ["format", "lint", "typecheck", "build", "test", "integration"]);
  assert.equal(plan.find(({ slot }) => slot === "lint").script, "lint");
  assert.equal(plan.find(({ slot }) => slot === "test").state, "SKIPPED");
});
test("unsupported profile and package manager are blocked", () => {
  assert.equal(validateRuntimeContract({ ...valid, profile: "OTHER" }, packageJson).ok, false);
  assert.equal(validateRuntimeContract({ ...valid, package_manager: "pnpm" }, packageJson).ok, false);
});
test("receipt binds run attempt and denies source write", () => {
  const receipt = createReceipt({
    request_id: "r", idempotency_key: "i", run_id: "1", run_attempt: 2,
    repository: "owner/repo", requested_sha: "0".repeat(40),
    runtime_engine_version: "1.0.0-dev", runtime_engine_sha: "1".repeat(40)
  });
  assert.equal(receipt.run_attempt, 2);
  assert.equal(receipt.source_integrity.remote_source_write_authority, "NONE");
});
test("tracked source comparison ignores untracked output by construction", () => {
  const state = { head_sha: "a", tree_sha: "b", tracked_status: "" };
  assert.equal(trackedSourceChanged(state, { ...state }), false);
});
test("HTTP route contract stays declarative", () => {
  assert.equal(validateRoutesDocument({ schema_version: 1, routes: [{ path: "/", status: 200 }] }).ok, true);
  assert.equal(validateRoutesDocument({ schema_version: 1, routes: [{ path: "/", status: 200, command: "x" }] }).ok, false);
});
