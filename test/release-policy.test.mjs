import test from "node:test";
import assert from "node:assert/strict";
import { evaluateReleasePolicy, EXPECTED_INPUTS, REQUIRED_PATHS } from "../runtime/release-policy.mjs";

const baseWorkflow = `name: Atelier Runtime V1
on:
  workflow_call:
    inputs:
      request_id:
      idempotency_key:
      runtime_sha:
      target_sha:
      profile:
      profile_version:
permissions:
  contents: read
concurrency:
  group: atelier-runtime-\${{ github.repository_id }}-\${{ inputs.idempotency_key }}
  cancel-in-progress: false
jobs:
  bootstrap:
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@${"a".repeat(40)}
        with:
          repository: neoflowcore/atelier-runtime
          ref: \${{ inputs.runtime_sha }}
          path: runtime
          persist-credentials: false
      - uses: actions/checkout@${"b".repeat(40)}
        with:
          repository: \${{ github.repository }}
          ref: \${{ inputs.target_sha }}
          path: target
          persist-credentials: false
      - uses: actions/setup-node@${"c".repeat(40)}
        with:
          node-version: 22.13.0
      - run: node runtime/runtime/run-receipt-init.mjs target runtime
      - run: node runtime/runtime/run-preflight.mjs target
      - run: node runtime/runtime/run-stages.mjs target
      - run: node runtime/runtime/run-web.mjs target
      - run: node runtime/runtime/run-browser.mjs target
      - run: node runtime/runtime/run-receipt-finalize.mjs target runtime
      - run: node runtime/runtime/run-receipt-gate.mjs runtime-evidence/runtime-receipt.json
`;

const security = `SOURCE_WRITE=DENY
REMOTE_SOURCE_WRITE_AUTHORITY=NONE
RAW_SHELL_INPUT=DENY
ARBITRARY_COMMAND_INPUT=DENY
ARBITRARY_ARGS_INPUT=DENY
ARBITRARY_ENV_INPUT=DENY
CHECKOUT_PERSIST_CREDENTIALS=FALSE
AUTO_RETRY=0
ACTION_DEPENDENCY_PINNING=FULL_COMMIT_SHA`;
const scope = `SOURCE_REF=EXACT_SHA
AUTO_RETRY=0`;
const pkg = { version: "1.0.0", engines: { node: "22.13.0" } };
const lock = { version: "1.0.0", packages: { "": { version: "1.0.0" } } };

function evaluate(overrides = {}) {
  return evaluateReleasePolicy({
    workflowText: overrides.workflowText ?? baseWorkflow,
    versionText: overrides.versionText ?? "1.0.0\n",
    packageJson: overrides.packageJson ?? pkg,
    lockJson: overrides.lockJson ?? lock,
    securityBoundaryText: overrides.securityBoundaryText ?? security,
    scopeLockText: overrides.scopeLockText ?? scope,
    availablePaths: overrides.availablePaths ?? [...REQUIRED_PATHS]
  });
}

test("G8 canonical release policy passes", () => {
  const result = evaluate();
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
  assert.deepEqual(EXPECTED_INPUTS, ["idempotency_key", "profile", "profile_version", "request_id", "runtime_sha", "target_sha"]);
});

test("G8 floating Action release reference is blocked", () => {
  const result = evaluate({ workflowText: baseWorkflow.replace(`actions/setup-node@${"c".repeat(40)}`, "actions/setup-node@v6") });
  assert.equal(result.ok, false);
  assert.equal(result.errors.some((value) => value.startsWith("FLOATING_ACTION:")), true);
});

test("G8 arbitrary caller command input is blocked", () => {
  const result = evaluate({ workflowText: baseWorkflow.replace("      target_sha:\n", "      target_sha:\n      command:\n") });
  assert.equal(result.ok, false);
  assert.equal(result.gates.raw_shell_input_zero, false);
});

test("G8 release version must be exact 1.0.0 across Runtime metadata", () => {
  const result = evaluate({ versionText: "1.0.0-dev\n" });
  assert.equal(result.ok, false);
  assert.equal(result.gates.runtime_version_binding, false);
});

test("G8 dual checkout and persisted-credential guards are release blocking", () => {
  const result = evaluate({ workflowText: baseWorkflow.replace("          path: target\n", "          path: application\n").replace("          persist-credentials: false\n", "          persist-credentials: true\n") });
  assert.equal(result.ok, false);
  assert.equal(result.gates.dual_checkout, false);
  assert.equal(result.gates.source_write_zero, false);
});

test("G8 auto retry must remain zero", () => {
  const result = evaluate({ securityBoundaryText: security.replace("AUTO_RETRY=0", "AUTO_RETRY=1") });
  assert.equal(result.ok, false);
  assert.equal(result.gates.auto_retry_zero, false);
});

test("G8 required release artifact inventory is fail-closed", () => {
  const result = evaluate({ availablePaths: REQUIRED_PATHS.filter((path) => path !== "schemas/runtime-receipt.schema.json") });
  assert.equal(result.ok, false);
  assert.equal(result.errors.includes("RELEASE_ARTIFACT_MISSING:schemas/runtime-receipt.schema.json"), true);
});
