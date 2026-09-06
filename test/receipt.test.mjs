import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { buildReceipt, validateReceipt, verifyOverlapGuard } from "../runtime/receipt.mjs";

const shaA = "a".repeat(40);
const shaB = "b".repeat(40);
const tree = "c".repeat(40);
const runtimeSha = "d".repeat(40);

function baseEnvironment() {
  return {
    runner_image: "ubuntu24@test",
    os: "linux",
    arch: "x64",
    node_version: "v22.13.0",
    npm_version: "10.9.2",
    playwright_version: "1.61.0",
    chromium_version: "149.0.7827.55",
    locale: "C.UTF-8",
    timezone: "UTC"
  };
}
function baseStart() {
  return {
    target: { head_sha: shaA, tree_sha: tree, tracked_status: "" },
    runtime_engine_sha: runtimeSha,
    runtime_engine_version: "1.0.0-dev"
  };
}
function baseAfter() {
  return { head_sha: shaA, tree_sha: tree, tracked_status: "" };
}
function baseIdentity() {
  return {
    request_id: "request-1",
    idempotency_key: "idem-1",
    run_id: "12345",
    run_attempt: 1,
    repository: "owner/repo",
    requested_sha: shaA,
    profile: "NODE_WEB_VERIFY",
    profile_version: 1,
    runtime_engine_sha: runtimeSha,
    runtime_engine_version: "1.0.0-dev"
  };
}
function baseContract() {
  return {
    scripts: { test: "test", dev: "dev", browser: "browser" },
    http_routes_file: ".atelier/routes.json"
  };
}
function successEvidence() {
  return {
    preflight: { ok: true, exitCode: 0 },
    stages: {
      ok: true,
      exitCode: 0,
      failureStage: null,
      stages: [
        { slot: "format", state: "SKIPPED" },
        { slot: "lint", state: "SKIPPED" },
        { slot: "typecheck", state: "SKIPPED" },
        { slot: "build", state: "SKIPPED" },
        { slot: "test", state: "PASS" },
        { slot: "integration", state: "SKIPPED" }
      ]
    },
    web: { ok: true, devServer: "PASS", http: "PASS", cleanup: "PASS", exitCode: 0 },
    browser: { ok: true, playwrightCli: "PASS", chromiumProvision: "PASS", browserScript: "PASS", exitCode: 0 }
  };
}
function build(overrides = {}) {
  return buildReceipt({
    identity: overrides.identity ?? baseIdentity(),
    contract: overrides.contract ?? baseContract(),
    start: overrides.start ?? baseStart(),
    after: overrides.after ?? baseAfter(),
    environment: overrides.environment ?? baseEnvironment(),
    evidence: overrides.evidence ?? successEvidence(),
    stepOutcomes: overrides.stepOutcomes ?? { preflight: "success", stages: "success", web: "success", browser: "success" },
    overlapGuard: overrides.overlapGuard ?? true
  });
}

test("G7 PASS receipt validates", () => {
  const receipt = build();
  assert.equal(receipt.result, "PASS");
  assert.deepEqual(validateReceipt(receipt), { ok: true, errors: [] });
  assert.equal(receipt.run_attempt, 1);
  assert.equal(receipt.runtime_engine_sha, runtimeSha);
  assert.equal(receipt.source_integrity.remote_source_write_authority, "NONE");
});

test("G7 BLOCKED receipt validates", () => {
  const evidence = successEvidence();
  evidence.preflight = { ok: false, classification: "BLOCKED", failureStage: "PREFLIGHT", failureReason: "INVALID_CONFIG", exitCode: 2 };
  const receipt = build({ evidence, stepOutcomes: { preflight: "failure", stages: "skipped", web: "skipped", browser: "skipped" } });
  assert.equal(receipt.result, "BLOCKED");
  assert.equal(receipt.failure_stage, "PREFLIGHT");
  assert.equal(validateReceipt(receipt).ok, true);
});

test("G7 APP_FAILURE receipt validates", () => {
  const evidence = successEvidence();
  evidence.stages = {
    ok: false,
    exitCode: 1,
    failureStage: "test",
    stages: [
      { slot: "format", state: "SKIPPED" }, { slot: "lint", state: "SKIPPED" },
      { slot: "typecheck", state: "SKIPPED" }, { slot: "build", state: "SKIPPED" },
      { slot: "test", state: "FAIL" }, { slot: "integration", state: "SKIPPED" }
    ]
  };
  const receipt = build({ evidence, stepOutcomes: { preflight: "success", stages: "failure", web: "skipped", browser: "skipped" } });
  assert.equal(receipt.result, "APP_FAILURE");
  assert.equal(receipt.failure_stage, "TEST");
  assert.equal(validateReceipt(receipt).ok, true);
});

test("G7 INFRA_FAILURE receipt validates when failed step evidence is missing", () => {
  const evidence = successEvidence();
  evidence.browser = null;
  const receipt = build({ evidence, stepOutcomes: { preflight: "success", stages: "success", web: "success", browser: "failure" } });
  assert.equal(receipt.result, "INFRA_FAILURE");
  assert.equal(receipt.failure_stage, "BROWSER");
  assert.equal(validateReceipt(receipt).ok, true);
});

test("G7 TIMEOUT receipt validates", () => {
  const evidence = successEvidence();
  evidence.browser = { ok: false, classification: "TIMEOUT", failureStage: "BROWSER", failureReason: "BROWSER_SCRIPT_TIMEOUT", exitCode: 124 };
  const receipt = build({ evidence, stepOutcomes: { preflight: "success", stages: "success", web: "success", browser: "failure" } });
  assert.equal(receipt.result, "TIMEOUT");
  assert.equal(receipt.stages.browser, "TIMEOUT");
  assert.equal(validateReceipt(receipt).ok, true);
});

test("G7 CANCELLED receipt validates", () => {
  const receipt = build({ evidence: { preflight: { ok: true }, stages: null, web: null, browser: null }, stepOutcomes: { preflight: "success", stages: "cancelled", web: "skipped", browser: "skipped" } });
  assert.equal(receipt.result, "CANCELLED");
  assert.equal(receipt.failure_stage, "STAGES");
  assert.equal(validateReceipt(receipt).ok, true);
});

test("G7 run_attempt is mandatory", () => {
  const receipt = build();
  receipt.run_attempt = null;
  assert.equal(validateReceipt(receipt).ok, false);
});

test("G7 requested/executed SHA mismatch never PASS", () => {
  const receipt = build({ after: { head_sha: shaB, tree_sha: tree, tracked_status: "" } });
  assert.equal(receipt.result, "BLOCKED");
  assert.equal(receipt.failure_reason, "TARGET_SHA_MISMATCH");
  assert.equal(validateReceipt(receipt).ok, true);
});

test("G7 tracked source mutation never PASS", () => {
  const receipt = build({ after: { head_sha: shaA, tree_sha: tree, tracked_status: " M server.mjs" } });
  assert.equal(receipt.result, "APP_FAILURE");
  assert.equal(receipt.failure_stage, "SOURCE_INTEGRITY");
  assert.equal(receipt.source_integrity.tracked_source_mutation_detected, true);
  assert.equal(validateReceipt(receipt).ok, true);
});

test("G7 Runtime SHA mismatch never PASS", () => {
  const identity = baseIdentity();
  identity.runtime_engine_sha = shaB;
  const receipt = build({ identity });
  assert.equal(receipt.result, "BLOCKED");
  assert.equal(receipt.failure_reason, "RUNTIME_SHA_MISMATCH");
});

test("G7 environment evidence permits explicit null without guessing", () => {
  const environment = Object.fromEntries(Object.keys(baseEnvironment()).map((key) => [key, null]));
  const receipt = build({ environment });
  assert.equal(receipt.result, "PASS");
  assert.equal(validateReceipt(receipt).ok, true);
});

test("G7 overlap guard is fixed in reusable workflow", async () => {
  assert.equal(await verifyOverlapGuard(resolve(".")), true);
});

test("G7 receipt finalization failure cannot validate as canonical PASS", () => {
  const receipt = build();
  receipt.stages.receipt_finalize = "FAIL";
  assert.equal(validateReceipt(receipt).ok, false);
});
