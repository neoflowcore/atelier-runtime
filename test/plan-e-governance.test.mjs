import test from "node:test";
import assert from "node:assert/strict";
import {
  appendRuntimeEAuditEvent,
  compileRuntimeEGovernanceDecision,
  validateRuntimeEGovernanceRequest,
  verifyRuntimeEGovernanceDecision
} from "../runtime/plan-e-governance.mjs";

const H64 = "a".repeat(64);
const H40 = "b".repeat(40);
function request(overrides = {}) {
  return {
    request_id: "gov-1",
    repository: "neoflowcore/atelier-runtime",
    target_ref: "refs/heads/main",
    expected_head: H40,
    operation: "APPLY_RULESET",
    desired_policy_sha256: H64,
    authority_evidence_sha256: "c".repeat(64),
    caller_id: "caller-admin",
    change_ticket_id: "change-1",
    readback_required: true,
    ...overrides
  };
}
const seal = {
  receipt_type: "RUNTIME_D_FINAL_SEAL_RECEIPT_V1",
  runtime_d_sealed: "YES",
  result: "PASS"
};

test("governance mutation request requires exact external authority and readback", () => {
  const d = compileRuntimeEGovernanceDecision(request(), seal);
  assert.equal(d.result, "PREPARED");
  assert.equal(d.provider_admin_mutation, true);
  assert.equal(d.exact_external_authority_required, true);
  assert.equal(d.provider_readback_required, true);
  assert.deepEqual(verifyRuntimeEGovernanceDecision(d), { ok: true, errors: [] });
});

test("E1 grants no source, promotion, rollback, or merge authority", () => {
  const d = compileRuntimeEGovernanceDecision(request(), seal);
  assert.equal(d.source_tree_write_authority, "NONE_FROM_E1");
  assert.equal(d.production_promotion_authority, "NONE_IN_E1");
  assert.equal(d.production_rollback_authority, "NONE_IN_E1");
  assert.equal(d.production_merge_authority, "NONE_THROUGH_REV5");
  assert.equal(d.final_merge_authority, "HUMAN_ONLY");
  assert.equal(d.force_push, false);
});

test("read-only provider policy request is non-mutating", () => {
  const d = compileRuntimeEGovernanceDecision(request({ operation: "READ_PROVIDER_POLICY" }), seal);
  assert.equal(d.result, "PREPARED");
  assert.equal(d.provider_admin_mutation, false);
  assert.equal(d.exact_external_authority_required, false);
});

test("missing Runtime D seal blocks E1 preparation", () => {
  const d = compileRuntimeEGovernanceDecision(request(), { receipt_type: "x", runtime_d_sealed: "NO", result: "FAIL" });
  assert.equal(d.result, "BLOCKED");
  assert.ok(d.reasons.includes("RUNTIME_D_NOT_SEALED"));
});

test("unknown governance field fails closed", () => {
  const r = { ...request(), extra: true };
  assert.deepEqual(validateRuntimeEGovernanceRequest(r), { ok: false, errors: ["GOVERNANCE_REQUEST_FIELDS_MISMATCH"] });
});

test("provider readback cannot be disabled", () => {
  const v = validateRuntimeEGovernanceRequest(request({ readback_required: false }));
  assert.equal(v.ok, false);
  assert.ok(v.errors.includes("PROVIDER_READBACK_REQUIRED"));
});

test("audit chain is append-only and contains no secret material", () => {
  const first = appendRuntimeEAuditEvent(null, {
    event_id: "audit-1",
    request_sha256: "1".repeat(64),
    decision_sha256: "2".repeat(64),
    provider_readback_sha256: "3".repeat(64),
    actor_id: "runtime-e",
    event_class: "PROVIDER_ADMIN_READBACK",
    timestamp_ms: 1000
  });
  const second = appendRuntimeEAuditEvent(first, {
    event_id: "audit-2",
    request_sha256: "4".repeat(64),
    decision_sha256: "5".repeat(64),
    provider_readback_sha256: "6".repeat(64),
    actor_id: "runtime-e",
    event_class: "SECURITY_POLICY_DECISION",
    timestamp_ms: 2000
  });
  assert.equal(second.previous_event_sha256, first.event_sha256);
  assert.equal(second.secret_material_present, false);
  assert.notEqual(second.event_sha256, first.event_sha256);
});
