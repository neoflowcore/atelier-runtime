import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveRuntimeDLeaseScope,
  evaluateRuntimeDLeaseAcquisition,
  expireRuntimeDLease,
  releaseRuntimeDLease,
  renewRuntimeDLease,
  validateRuntimeDLease
} from "../runtime/plan-d-lease.mjs";

const HASH = "a".repeat(64);
function req(overrides = {}) {
  return {
    task_contract_hash: HASH,
    approval_id: "approval-1",
    dispatch_nonce: "dispatch-1",
    execution_id: "execution-1",
    generation: 1,
    caller_id: "caller-a",
    repository: "neoflowcore/atelier-runtime",
    branch: "candidate-a",
    workspace_id: "workspace-a",
    mode: "READ_SHARED",
    now_ms: 1000,
    expires_at_ms: 5000,
    ...overrides
  };
}

test("read lease acquisition is deterministic and grants no source authority", () => {
  const first = evaluateRuntimeDLeaseAcquisition([], req());
  assert.equal(first.ok, true);
  assert.equal(first.result, "ACQUIRED");
  assert.equal(first.lease.source_write_authority, "NONE_BY_LEASE");
  assert.equal(first.lease.scope_sha256, deriveRuntimeDLeaseScope(req()));
  assert.deepEqual(validateRuntimeDLease(first.lease), { ok: true, errors: [] });
  const replay = evaluateRuntimeDLeaseAcquisition([first.lease], req());
  assert.equal(replay.idempotent_reuse, true);
  assert.equal(replay.lease.lease_id, first.lease.lease_id);
});

test("shared reads can coexist on the same branch", () => {
  const a = evaluateRuntimeDLeaseAcquisition([], req()).lease;
  const bReq = req({ caller_id: "caller-b", execution_id: "execution-2", workspace_id: "workspace-b" });
  const b = evaluateRuntimeDLeaseAcquisition([a], bReq);
  assert.equal(b.ok, true);
});

test("exclusive write is blocked by any active lease on same scope", () => {
  const read = evaluateRuntimeDLeaseAcquisition([], req()).lease;
  const writeReq = req({ caller_id: "caller-b", execution_id: "execution-2", workspace_id: "workspace-b", mode: "WRITE_EXCLUSIVE" });
  const result = evaluateRuntimeDLeaseAcquisition([read], writeReq);
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, ["LEASE_CONFLICT_ACTIVE_SCOPE"]);
});

test("exclusive write on a different branch is independent", () => {
  const read = evaluateRuntimeDLeaseAcquisition([], req()).lease;
  const result = evaluateRuntimeDLeaseAcquisition([read], req({ branch: "candidate-b", mode: "WRITE_EXCLUSIVE" }));
  assert.equal(result.ok, true);
});

test("expired lease no longer blocks acquisition", () => {
  const active = evaluateRuntimeDLeaseAcquisition([], req({ expires_at_ms: 1500 })).lease;
  const result = evaluateRuntimeDLeaseAcquisition([active], req({ caller_id: "caller-b", execution_id: "execution-2", workspace_id: "workspace-b", mode: "WRITE_EXCLUSIVE", now_ms: 2000, expires_at_ms: 6000 }));
  assert.equal(result.ok, true);
});

test("renewal requires same caller and generation+1", () => {
  const lease = evaluateRuntimeDLeaseAcquisition([], req()).lease;
  const renewed = renewRuntimeDLease(lease, { caller_id: "caller-a", now_ms: 2000, expires_at_ms: 7000, generation: 2 });
  assert.equal(renewed.ok, true);
  assert.equal(renewed.lease.generation, 2);
  assert.notEqual(renewed.lease.lease_id, lease.lease_id);
  const bad = renewRuntimeDLease(lease, { caller_id: "caller-b", now_ms: 2000, expires_at_ms: 7000, generation: 2 });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.includes("CALLER_MISMATCH"));
});

test("release and expiry are explicit state transitions", () => {
  const lease = evaluateRuntimeDLeaseAcquisition([], req()).lease;
  const released = releaseRuntimeDLease(lease, { caller_id: "caller-a", now_ms: 2000 });
  assert.equal(released.lease.state, "RELEASED");
  const expired = expireRuntimeDLease(lease, 5000);
  assert.equal(expired.lease.state, "EXPIRED");
});
