import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PLAN_A_WORKER_ADMISSION_SCOPE,
  buildPlanAWorkerAttestationReceipt,
  computeWorkerFingerprint,
  evaluatePlanAWorkerAdmission,
  validatePlanAWorkerAttestationReceipt
} from "../runtime/worker-attestation-plan-a.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const runtimeSha = "ae2ffe270eb714ec2612dd4feb9aa51f1901ecea";

function worker(overrides = {}) {
  return {
    runner_environment: "self-hosted",
    runner_os: "Linux",
    runner_arch: "X64",
    runner_name: "atelier-runtime-worker-01",
    node_version: "v22.13.0",
    ...overrides
  };
}

function receipt(overrides = {}) {
  return buildPlanAWorkerAttestationReceipt({
    requestId: "req-worker-a",
    idempotencyKey: "idem-worker-a",
    requestedRuntimeSha: runtimeSha,
    runtimeEngineSha: runtimeSha,
    observedWorker: worker(),
    ...overrides
  });
}

test("fixed Plan A worker is admitted only to the foundation probe", () => {
  const value = receipt();
  assert.equal(value.result, "PASS");
  assert.equal(value.admission_scope, PLAN_A_WORKER_ADMISSION_SCOPE);
  assert.equal(value.lease_state, "NOT_IMPLEMENTED_PLAN_D");
  assert.equal(value.remote_source_write_authority, "NONE");
  assert.deepEqual(validatePlanAWorkerAttestationReceipt(value), { ok: true, errors: [] });
});

test("worker fingerprint is deterministic and bound to observed runner identity", () => {
  const first = worker();
  const second = worker();
  assert.equal(computeWorkerFingerprint(first), computeWorkerFingerprint(second));
  second.runner_name = "atelier-runtime-worker-02";
  assert.notEqual(computeWorkerFingerprint(first), computeWorkerFingerprint(second));
});

test("hosted runner is infrastructure failure and never fallback", () => {
  const value = receipt({ observedWorker: worker({ runner_environment: "github-hosted" }) });
  assert.equal(value.result, "INFRA_FAILURE");
  assert.equal(value.failure_reason, "RUNNER_ENVIRONMENT_NOT_SELF_HOSTED");
});

test("wrong OS architecture and Node version are independently fail-closed", () => {
  for (const [field, value, reason] of [
    ["runner_os", "Windows", "RUNNER_OS_NOT_LINUX"],
    ["runner_arch", "ARM64", "RUNNER_ARCH_NOT_X64"],
    ["node_version", "v22.16.0", "NODE_VERSION_NOT_22_13_0"]
  ]) {
    const admission = evaluatePlanAWorkerAdmission({
      requestedRuntimeSha: runtimeSha,
      runtimeEngineSha: runtimeSha,
      observedWorker: worker({ [field]: value })
    });
    assert.equal(admission.ok, false);
    assert.ok(admission.reasons.includes(reason));
  }
});

test("missing or unsafe runner name is rejected", () => {
  for (const runner_name of [null, "", "bad runner", "../worker"]) {
    const value = receipt({ observedWorker: worker({ runner_name }) });
    assert.equal(value.result, "INFRA_FAILURE");
    assert.equal(value.failure_reason, "RUNNER_NAME_INVALID_OR_MISSING");
  }
});

test("runtime SHA mismatch cannot be admitted", () => {
  const value = receipt({ runtimeEngineSha: "1".repeat(40) });
  assert.equal(value.result, "INFRA_FAILURE");
  assert.equal(value.failure_reason, "RUNTIME_SHA_MISMATCH");
});

test("PASS receipt validator detects worker fingerprint tampering", () => {
  const value = receipt();
  value.worker_fingerprint_sha256 = "0".repeat(64);
  const validation = validatePlanAWorkerAttestationReceipt(value);
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.includes("PASS_WORKER_FINGERPRINT_MISMATCH"));
});

test("worker attestation schema is closed and explicitly defers leases to Plan D", async () => {
  const schema = JSON.parse(await readFile(join(here, "..", "schemas", "runtime-a-worker-attestation.schema.json"), "utf8"));
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.lease_state.const, "NOT_IMPLEMENTED_PLAN_D");
  assert.equal(schema.properties.remote_source_write_authority.const, "NONE");
});
