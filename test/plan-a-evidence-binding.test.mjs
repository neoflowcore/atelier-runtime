import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPlanAFoundationReceipt } from "../runtime/plan-a-foundation.mjs";
import {
  buildPlanAEvidenceBindingReceipt,
  comparePlanAEvidenceReceipts,
  validatePlanAEvidenceBindingReceipt
} from "../runtime/plan-a-evidence-binding.mjs";
import { buildPlanAWorkerAttestationReceipt } from "../runtime/worker-attestation-plan-a.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, "..", "fixtures", "runtime-a", "self_hosted_read_only.json");
const runtimeSha = "5d58262733544406f12619ebf9bfaece4daad7a4";
const targetSha = "2f82365b7270fd7b4cb15dcf4f87fe7e0e05f4d9";
const targetTree = "4fc4081accb3ad2a649c90dc236f4284612e7f4f";

async function contract() {
  return JSON.parse(await readFile(fixturePath, "utf8"));
}

function workerObserved(overrides = {}) {
  return {
    runner_environment: "self-hosted",
    runner_os: "Linux",
    runner_arch: "X64",
    runner_name: "atelier-runtime-worker-01",
    node_version: "v22.13.0",
    ...overrides
  };
}

function sourceState(overrides = {}) {
  return {
    head_sha: targetSha,
    tree_sha: targetTree,
    tracked_status: "",
    ...overrides
  };
}

function workerReceipt(overrides = {}) {
  return buildPlanAWorkerAttestationReceipt({
    requestId: "req-a4",
    idempotencyKey: "idem-a4",
    requestedRuntimeSha: runtimeSha,
    runtimeEngineSha: runtimeSha,
    observedWorker: workerObserved(),
    ...overrides
  });
}

async function foundationReceipt(overrides = {}) {
  const taskContract = overrides.taskContract ?? await contract();
  const before = overrides.sourceBefore ?? sourceState();
  const after = overrides.sourceAfter ?? sourceState();
  return buildPlanAFoundationReceipt({
    requestId: "req-a4",
    idempotencyKey: "idem-a4",
    repository: "neoflowcore/atelier-runtime",
    requestedSha: targetSha,
    executedSha: after?.head_sha ?? null,
    requestedRuntimeSha: runtimeSha,
    runtimeEngineSha: runtimeSha,
    taskContract,
    observedBackend: {
      runner_environment: "self-hosted",
      runner_os: "Linux",
      runner_arch: "X64",
      node_version: "v22.13.0"
    },
    sourceBefore: before,
    sourceAfter: after,
    ...overrides.fields
  });
}

async function validBundle() {
  const worker = workerReceipt();
  const foundation = await foundationReceipt();
  const workerReceiptSha256 = "a".repeat(64);
  const foundationReceiptSha256 = "b".repeat(64);
  const binding = buildPlanAEvidenceBindingReceipt({ workerReceipt: worker, foundationReceipt: foundation, workerReceiptSha256, foundationReceiptSha256 });
  return { worker, foundation, binding, workerReceiptSha256, foundationReceiptSha256 };
}

test("valid worker and foundation evidence cross-bind to PASS", async () => {
  const value = await validBundle();
  assert.deepEqual(comparePlanAEvidenceReceipts(value.worker, value.foundation), { ok: true, errors: [] });
  assert.equal(value.binding.result, "PASS");
  assert.equal(value.binding.worker_fingerprint_sha256, value.worker.worker_fingerprint_sha256);
  assert.equal(value.binding.task_contract_hash, value.foundation.task_contract_hash);
  assert.equal(value.binding.lease_state, "NOT_IMPLEMENTED_PLAN_D");
  assert.equal(value.binding.remote_source_write_authority, "NONE");
  assert.deepEqual(validatePlanAEvidenceBindingReceipt(value.binding, {
    workerReceipt: value.worker,
    foundationReceipt: value.foundation,
    workerReceiptSha256: value.workerReceiptSha256,
    foundationReceiptSha256: value.foundationReceiptSha256
  }), { ok: true, errors: [] });
});

test("request identity mismatch between individually valid child receipts fails closed", async () => {
  const worker = workerReceipt({ requestId: "req-worker" });
  const foundation = await foundationReceipt({ fields: { requestId: "req-foundation" } });
  const binding = buildPlanAEvidenceBindingReceipt({
    workerReceipt: worker,
    foundationReceipt: foundation,
    workerReceiptSha256: "a".repeat(64),
    foundationReceiptSha256: "b".repeat(64)
  });
  assert.equal(binding.result, "INFRA_FAILURE");
  assert.equal(binding.failure_reason, "REQUEST_ID_MISMATCH");
});

test("idempotency mismatch between child receipts fails closed", async () => {
  const worker = workerReceipt({ idempotencyKey: "worker-idem" });
  const foundation = await foundationReceipt({ fields: { idempotencyKey: "foundation-idem" } });
  const pair = comparePlanAEvidenceReceipts(worker, foundation);
  assert.equal(pair.ok, false);
  assert.ok(pair.errors.includes("IDEMPOTENCY_KEY_MISMATCH"));
});

test("runtime identity cannot be reused across a different runtime execution", async () => {
  const worker = workerReceipt();
  const otherRuntimeSha = "1".repeat(40);
  const foundation = await foundationReceipt({ fields: { requestedRuntimeSha: otherRuntimeSha, runtimeEngineSha: otherRuntimeSha } });
  const pair = comparePlanAEvidenceReceipts(worker, foundation);
  assert.equal(pair.ok, false);
  assert.ok(pair.errors.includes("REQUESTED_RUNTIME_SHA_MISMATCH"));
  assert.ok(pair.errors.includes("RUNTIME_ENGINE_SHA_MISMATCH"));
});

test("child evidence digest tampering is rejected by contextual validation", async () => {
  const value = await validBundle();
  const validation = validatePlanAEvidenceBindingReceipt(value.binding, {
    workerReceipt: value.worker,
    foundationReceipt: value.foundation,
    workerReceiptSha256: "c".repeat(64),
    foundationReceiptSha256: value.foundationReceiptSha256
  });
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.includes("WORKER_ATTESTATION_DIGEST_MISMATCH"));
});

test("worker fingerprint substitution is rejected", async () => {
  const value = await validBundle();
  value.binding.worker_fingerprint_sha256 = "0".repeat(64);
  const validation = validatePlanAEvidenceBindingReceipt(value.binding, {
    workerReceipt: value.worker,
    foundationReceipt: value.foundation,
    workerReceiptSha256: value.workerReceiptSha256,
    foundationReceiptSha256: value.foundationReceiptSha256
  });
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.includes("WORKER_FINGERPRINT_BINDING_MISMATCH"));
});

test("foundation APP_FAILURE propagates without being converted into authority", async () => {
  const worker = workerReceipt();
  const foundation = await foundationReceipt({ sourceAfter: sourceState({ tracked_status: " M README.md" }) });
  assert.equal(foundation.result, "APP_FAILURE");
  const binding = buildPlanAEvidenceBindingReceipt({
    workerReceipt: worker,
    foundationReceipt: foundation,
    workerReceiptSha256: "a".repeat(64),
    foundationReceiptSha256: "b".repeat(64)
  });
  assert.equal(binding.result, "APP_FAILURE");
  assert.equal(binding.failure_reason, "FOUNDATION:TRACKED_SOURCE_MUTATION");
  assert.equal(binding.remote_source_write_authority, "NONE");
});

test("PASS binding rejects divergent source trees even if receipt is tampered to hide mutation", async () => {
  const value = await validBundle();
  value.binding.source_integrity.tree_sha_after = "1".repeat(40);
  const validation = validatePlanAEvidenceBindingReceipt(value.binding);
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.includes("PASS_TREE_SHA_MISMATCH"));
});

test("contextual validation binds source-integrity fields to the foundation receipt", async () => {
  const value = await validBundle();
  value.binding.source_integrity.tree_sha_before = "1".repeat(40);
  value.binding.source_integrity.tree_sha_after = "1".repeat(40);
  const validation = validatePlanAEvidenceBindingReceipt(value.binding, {
    workerReceipt: value.worker,
    foundationReceipt: value.foundation,
    workerReceiptSha256: value.workerReceiptSha256,
    foundationReceiptSha256: value.foundationReceiptSha256
  });
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.includes("SOURCE_INTEGRITY_BINDING_MISMATCH"));
});

test("evidence binding schema is closed and preserves Plan D lease boundary", async () => {
  const schema = JSON.parse(await readFile(join(here, "..", "schemas", "runtime-a-evidence-binding.schema.json"), "utf8"));
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.lease_state.const, "NOT_IMPLEMENTED_PLAN_D");
  assert.equal(schema.properties.remote_source_write_authority.const, "NONE");
  assert.equal(schema.properties.backend_id.const, "SELF_HOSTED_LINUX_X64_V1");
});
