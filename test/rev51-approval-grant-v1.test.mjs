import test from "node:test";
import assert from "node:assert/strict";
import {
  claimApprovalGrant,
  reconcileClaimedApproval,
  confirmApprovalSuccess,
  markApprovalOutcomeUnknown,
  invalidateApprovalGrant
} from "../runtime/rev51/approval-grant-v1.mjs";

const H = "a".repeat(64);
function grant(overrides = {}) {
  return {
    APPROVAL_GRANT_ID: "approval-1",
    PLAN_HASH: H,
    ALLOWED_EFFECT_CLASSES: ["REMOTE_PROVIDER_MUTATION"],
    ALLOWED_SCOPE: ["provider:worker/create"],
    MAX_COST: 100,
    ISSUED_AT: "2026-09-19T00:00:00Z",
    EXPIRES_AT: "2026-09-20T00:00:00Z",
    ONE_SHOT: true,
    CONSUMED_AT: null,
    STATE: "AVAILABLE",
    ...overrides
  };
}
function op(overrides = {}) {
  return {
    PLAN_HASH: H,
    OPERATION_ID: "op-1",
    IDEMPOTENCY_KEY: "idem-1",
    EFFECT_CLASS: "REMOTE_PROVIDER_MUTATION",
    SCOPE: "provider:worker/create",
    ...overrides
  };
}

test("first irreversible submission claims approval before mutation", () => {
  const result = claimApprovalGrant(grant(), op());
  assert.equal(result.ok, true);
  assert.equal(result.grant.STATE, "CLAIMED");
  assert.equal(result.grant.CLAIM.OPERATION_ID, "op-1");
});

test("plan hash drift cannot claim old approval", () => {
  assert.equal(claimApprovalGrant(grant(), op({ PLAN_HASH: "b".repeat(64) })).code, "PLAN_HASH_MISMATCH");
});

test("claimed approval only reconciles same operation and idempotency key", () => {
  const claimed = claimApprovalGrant(grant(), op()).grant;
  assert.equal(reconcileClaimedApproval(claimed, op()).ok, true);
  assert.equal(reconcileClaimedApproval(claimed, op({ OPERATION_ID: "op-2" })).code, "SECOND_MUTATION_DENIED");
});

test("OUTCOME_UNKNOWN never reopens approval", () => {
  const claimed = claimApprovalGrant(grant(), op()).grant;
  const unknown = markApprovalOutcomeUnknown(claimed, op());
  assert.equal(unknown.ok, true);
  assert.equal(unknown.grant.STATE, "CLAIMED");
  assert.equal(unknown.grant.OUTCOME, "OUTCOME_UNKNOWN");
  assert.equal(claimApprovalGrant(unknown.grant, op({ OPERATION_ID: "op-2", IDEMPOTENCY_KEY: "idem-2" })).ok, false);
});

test("confirmed success consumes one-shot approval", () => {
  const claimed = claimApprovalGrant(grant(), op()).grant;
  const consumed = confirmApprovalSuccess(claimed, op());
  assert.equal(consumed.ok, true);
  assert.equal(consumed.grant.STATE, "CONSUMED");
  assert.equal(claimApprovalGrant(consumed.grant, op()).ok, false);
});

test("consumed approval cannot be invalidated into reusable state", () => {
  const consumed = confirmApprovalSuccess(claimApprovalGrant(grant(), op()).grant, op()).grant;
  assert.equal(invalidateApprovalGrant(consumed).code, "CONSUMED_APPROVAL_CANNOT_REOPEN");
});
