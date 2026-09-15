import test from "node:test";
import assert from "node:assert/strict";
import { evaluateRuntimeDLeaseAcquisition } from "../runtime/plan-d-lease.mjs";
import { evaluateRuntimeDSchedule } from "../runtime/plan-d-scheduler.mjs";
import {
  buildRuntimeDExactMergeEnvelope,
  evaluateRuntimeDMechanicalMergeActivation,
  verifyRuntimeDExactMergeEnvelope
} from "../runtime/plan-d-exact-merge.mjs";

const HASH = "d".repeat(64);
const APPROVAL_SHA = "e".repeat(64);
const BASE_HEAD = "1".repeat(40);
const HEAD_SHA = "2".repeat(40);

function coordinated() {
  const schedule = {
    caller_id: "caller-a",
    task_contract_hash: HASH,
    approval_id: "approval-merge-1",
    dispatch_nonce: "dispatch-merge-1",
    execution_id: "execution-merge-1",
    generation: 1,
    repository: "neoflowcore/atelier-runtime",
    branch: "candidate-a",
    workspace_id: "workspace-a",
    operation_class: "CANDIDATE_WRITE",
    max_parallelism: 1,
    now_ms: 2000
  };
  const lease = evaluateRuntimeDLeaseAcquisition([], {
    task_contract_hash: HASH,
    approval_id: schedule.approval_id,
    dispatch_nonce: schedule.dispatch_nonce,
    execution_id: schedule.execution_id,
    generation: schedule.generation,
    caller_id: schedule.caller_id,
    repository: schedule.repository,
    branch: schedule.branch,
    workspace_id: schedule.workspace_id,
    mode: "WRITE_EXCLUSIVE",
    now_ms: 1000,
    expires_at_ms: 5000
  }).lease;
  const decision = evaluateRuntimeDSchedule([], [lease], schedule).decision;
  return { lease, decision };
}

function request(overrides = {}) {
  return {
    repository: "neoflowcore/atelier-runtime",
    pr_number: 42,
    base_ref: "main",
    expected_base_head: BASE_HEAD,
    head_ref: "candidate-a",
    expected_head_sha: HEAD_SHA,
    merge_method: "SQUASH",
    safety_class: "FIXTURE",
    ...overrides
  };
}

function readback(overrides = {}) {
  return {
    repository: "neoflowcore/atelier-runtime",
    pr_number: 42,
    state: "OPEN",
    base_ref: "main",
    base_head: BASE_HEAD,
    head_ref: "candidate-a",
    head_sha: HEAD_SHA,
    draft: false,
    ...overrides
  };
}

test("exact-approved merge mechanics bind subject but remain deferred", () => {
  const { lease, decision } = coordinated();
  const result = buildRuntimeDExactMergeEnvelope({
    task_contract_hash: HASH,
    lease,
    scheduler_decision: decision,
    approval_evidence_sha256: APPROVAL_SHA,
    provider_readback: readback(),
    request: request()
  });
  assert.equal(result.ok, true);
  assert.equal(result.result, "PREPARED_DEFERRED");
  assert.equal(result.envelope.provider_merge_mutation_authority, "NONE_THROUGH_REV5");
  assert.equal(result.envelope.final_merge_authority, "HUMAN_ONLY");
  assert.deepEqual(verifyRuntimeDExactMergeEnvelope(result.envelope), { ok: true, errors: [] });
});

test("provider subject mismatch fails closed", () => {
  const { lease, decision } = coordinated();
  const result = buildRuntimeDExactMergeEnvelope({
    task_contract_hash: HASH,
    lease,
    scheduler_decision: decision,
    approval_evidence_sha256: APPROVAL_SHA,
    provider_readback: readback({ head_sha: "3".repeat(40) }),
    request: request()
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("READBACK_HEAD_SHA_MISMATCH"));
});

test("production safety class is blocked through Rev5", () => {
  const { lease, decision } = coordinated();
  const result = buildRuntimeDExactMergeEnvelope({
    task_contract_hash: HASH,
    lease,
    scheduler_decision: decision,
    approval_evidence_sha256: APPROVAL_SHA,
    provider_readback: readback(),
    request: request({ safety_class: "PRODUCTION" })
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("PRODUCTION_MERGE_NOT_ACTIVATED_THROUGH_REV5"));
});

test("mechanical merge activation never grants provider mutation through Rev5", () => {
  const { lease, decision } = coordinated();
  const prepared = buildRuntimeDExactMergeEnvelope({
    task_contract_hash: HASH,
    lease,
    scheduler_decision: decision,
    approval_evidence_sha256: APPROVAL_SHA,
    provider_readback: readback(),
    request: request()
  }).envelope;
  const activation = evaluateRuntimeDMechanicalMergeActivation(prepared);
  assert.equal(activation.ok, true);
  assert.equal(activation.provider_mutation_allowed, false);
  assert.equal(activation.final_merge_authority, "HUMAN_ONLY");
});

test("mismatched scheduler or lease scope cannot prepare merge", () => {
  const { lease, decision } = coordinated();
  const badDecision = { ...decision, repository: "neoflowcore/other" };
  const result = buildRuntimeDExactMergeEnvelope({
    task_contract_hash: HASH,
    lease,
    scheduler_decision: badDecision,
    approval_evidence_sha256: APPROVAL_SHA,
    provider_readback: readback(),
    request: request()
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.startsWith("SCHEDULER:")) || result.errors.includes("REPOSITORY_BINDING_MISMATCH"));
});
