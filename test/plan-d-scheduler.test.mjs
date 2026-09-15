import test from "node:test";
import assert from "node:assert/strict";
import { evaluateRuntimeDLeaseAcquisition } from "../runtime/plan-d-lease.mjs";
import { deriveRuntimeDIdempotencyKey, evaluateRuntimeDSchedule, verifyRuntimeDSchedulerDecision } from "../runtime/plan-d-scheduler.mjs";

const HASH = "b".repeat(64);
function schedule(overrides = {}) {
  return {
    caller_id: "caller-a",
    task_contract_hash: HASH,
    approval_id: "approval-1",
    dispatch_nonce: "dispatch-1",
    execution_id: "execution-1",
    generation: 1,
    repository: "neoflowcore/atelier-runtime",
    branch: "candidate-a",
    workspace_id: "workspace-a",
    operation_class: "READ_ONLY",
    max_parallelism: 2,
    now_ms: 2000,
    ...overrides
  };
}
function leaseFor(s) {
  return evaluateRuntimeDLeaseAcquisition([], {
    task_contract_hash: s.task_contract_hash,
    approval_id: s.approval_id,
    dispatch_nonce: s.dispatch_nonce,
    execution_id: s.execution_id,
    generation: s.generation,
    caller_id: s.caller_id,
    repository: s.repository,
    branch: s.branch,
    workspace_id: s.workspace_id,
    mode: s.operation_class === "CANDIDATE_WRITE" ? "WRITE_EXCLUSIVE" : "READ_SHARED",
    now_ms: 1000,
    expires_at_ms: 5000
  }).lease;
}

test("read-only task schedules only with matching active lease", () => {
  const s = schedule();
  const result = evaluateRuntimeDSchedule([], [leaseFor(s)], s);
  assert.equal(result.ok, true);
  assert.equal(result.result, "SCHEDULED");
  assert.equal(result.decision.source_write_authority, "NONE_FROM_SCHEDULER");
  assert.equal(result.decision.merge_authority, "NONE");
  assert.equal(result.decision.final_merge_authority, "HUMAN_ONLY");
  assert.deepEqual(verifyRuntimeDSchedulerDecision(result.decision), { ok: true, errors: [] });
});

test("exact replay is idempotent and creates no new execution", () => {
  const s = schedule();
  const first = evaluateRuntimeDSchedule([], [leaseFor(s)], s).decision;
  const replay = evaluateRuntimeDSchedule([first], [leaseFor(s)], s);
  assert.equal(replay.result, "IDEMPOTENT_REUSE");
  assert.equal(replay.decision.new_execution_created, false);
  assert.equal(replay.decision.idempotency_key, deriveRuntimeDIdempotencyKey(s));
  assert.deepEqual(verifyRuntimeDSchedulerDecision(replay.decision), { ok: true, errors: [] });
});

test("candidate write requires exclusive lease and Runtime C gateway", () => {
  const s = schedule({ operation_class: "CANDIDATE_WRITE" });
  const result = evaluateRuntimeDSchedule([], [leaseFor(s)], s);
  assert.equal(result.ok, true);
  assert.equal(result.decision.runtime_c_source_write_gateway_required, true);
  assert.equal(result.decision.source_write_authority, "NONE_FROM_SCHEDULER");
});

test("mismatched lease cannot schedule", () => {
  const s = schedule();
  const other = schedule({ execution_id: "execution-2" });
  const result = evaluateRuntimeDSchedule([], [leaseFor(other)], s);
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, ["MATCHING_ACTIVE_LEASE_REQUIRED"]);
});

test("max parallelism is enforced per caller", () => {
  const s = schedule({ max_parallelism: 1 });
  const prior = {
    caller_id: s.caller_id,
    idempotency_key: "c".repeat(64),
    result: "SCHEDULED",
    completed: false
  };
  const result = evaluateRuntimeDSchedule([prior], [leaseFor(s)], s);
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, ["MAX_PARALLELISM_REACHED"]);
});

test("different repository can schedule independently", () => {
  const a = schedule();
  const first = evaluateRuntimeDSchedule([], [leaseFor(a)], a).decision;
  const b = schedule({ repository: "neoflowcore/other-repo", execution_id: "execution-2", workspace_id: "workspace-b", dispatch_nonce: "dispatch-2" });
  const result = evaluateRuntimeDSchedule([first], [leaseFor(b)], b);
  assert.equal(result.ok, true);
  assert.notEqual(result.decision.scope_sha256, first.scope_sha256);
});

test("expired active-state lease cannot schedule", () => {
  const s = schedule({ now_ms: 6000 });
  const expiredByTime = leaseFor({ ...s, now_ms: 2000 });
  const result = evaluateRuntimeDSchedule([], [expiredByTime], s);
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, ["MATCHING_ACTIVE_LEASE_REQUIRED"]);
});
