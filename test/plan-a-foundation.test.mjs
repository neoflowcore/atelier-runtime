import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPlanAFoundationReceipt, validatePlanAFoundationReceipt } from "../runtime/plan-a-foundation.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, "..", "fixtures", "runtime-a", "self_hosted_read_only.json");

async function contract() {
  return JSON.parse(await readFile(fixturePath, "utf8"));
}

function sourceState(overrides = {}) {
  return {
    head_sha: "2f82365b7270fd7b4cb15dcf4f87fe7e0e05f4d9",
    tree_sha: "4fc4081accb3ad2a649c90dc236f4284612e7f4f",
    tracked_status: "",
    ...overrides
  };
}

function backend(overrides = {}) {
  return {
    runner_environment: "self-hosted",
    runner_os: "Linux",
    runner_arch: "X64",
    node_version: "v22.13.0",
    ...overrides
  };
}

async function build(overrides = {}) {
  const taskContract = overrides.taskContract ?? await contract();
  const before = overrides.sourceBefore ?? sourceState();
  const after = overrides.sourceAfter ?? sourceState();
  return buildPlanAFoundationReceipt({
    requestId: "req-a1",
    idempotencyKey: "idem-a1",
    repository: "neoflowcore/atelier-runtime",
    requestedSha: "2f82365b7270fd7b4cb15dcf4f87fe7e0e05f4d9",
    executedSha: after?.head_sha ?? null,
    requestedRuntimeSha: "31063092153436df28ea3b61428d764e975ad2e6",
    runtimeEngineSha: "31063092153436df28ea3b61428d764e975ad2e6",
    taskContract,
    observedBackend: overrides.observedBackend ?? backend(),
    sourceBefore: before,
    sourceAfter: after
  });
}

test("foundation probe PASS binds fixed self-hosted backend and source identity", async () => {
  const receipt = await build();
  assert.equal(receipt.result, "PASS", receipt.failure_reason);
  assert.equal(receipt.probe_scope, "BACKEND_FOUNDATION_READ_ONLY_PROBE");
  assert.equal(receipt.backend_identity.backend_id, "SELF_HOSTED_LINUX_X64_V1");
  assert.deepEqual(receipt.backend_identity.expected_runner_labels, ["self-hosted", "linux", "x64", "atelier-runtime-v1"]);
  assert.equal(receipt.backend_identity.fallback_backend_id, null);
  assert.equal(receipt.source_integrity.remote_source_write_authority, "NONE");
  assert.deepEqual(validatePlanAFoundationReceipt(receipt), { ok: true, errors: [] });
});

test("non-self-hosted observation is infrastructure failure, never fallback", async () => {
  const receipt = await build({ observedBackend: backend({ runner_environment: "github-hosted" }) });
  assert.equal(receipt.result, "INFRA_FAILURE");
  assert.equal(receipt.failure_reason, "RUNNER_ENVIRONMENT_NOT_SELF_HOSTED");
  assert.equal(receipt.backend_identity.fallback_backend_id, null);
});

test("task/request source identity mismatch is blocked", async () => {
  const taskContract = await contract();
  taskContract.EXPECTED_HEAD = "1".repeat(40);
  const receipt = await build({ taskContract });
  assert.equal(receipt.result, "BLOCKED");
  assert.ok(receipt.failure_reason);
});

test("tracked source mutation fails the read-only foundation probe", async () => {
  const receipt = await build({ sourceAfter: sourceState({ tracked_status: " M README.md" }) });
  assert.equal(receipt.result, "APP_FAILURE");
  assert.equal(receipt.failure_reason, "TRACKED_SOURCE_MUTATION");
  assert.equal(receipt.source_integrity.tracked_source_mutation_detected, true);
});

test("receipt validator rejects PASS when fixed Node version is not observed", async () => {
  const receipt = await build();
  receipt.backend_identity.node_version = "v22.16.0";
  const validation = validatePlanAFoundationReceipt(receipt);
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.includes("PASS_NODE_VERSION_MISMATCH"));
});

test("foundation receipt JSON schema is parseable and closed", async () => {
  const schema = JSON.parse(await readFile(join(here, "..", "schemas", "runtime-a-foundation-receipt.schema.json"), "utf8"));
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.backend_identity.properties.backend_id.const, "SELF_HOSTED_LINUX_X64_V1");
  assert.deepEqual(schema.properties.backend_identity.properties.expected_runner_labels.const, ["self-hosted", "linux", "x64", "atelier-runtime-v1"]);
});
