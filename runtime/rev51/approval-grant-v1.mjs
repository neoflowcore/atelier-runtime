export const APPROVAL_STATES = Object.freeze(["AVAILABLE", "CLAIMED", "CONSUMED", "EXPIRED", "INVALID"]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deny(code, grant) {
  return { ok: false, code, grant: clone(grant) };
}

export function claimApprovalGrant(grant, operation) {
  if (!grant || typeof grant !== "object" || Array.isArray(grant)) return { ok: false, code: "APPROVAL_MISSING", grant: null };
  if (grant.STATE !== "AVAILABLE") {
    if (grant.STATE === "CLAIMED" && grant.CLAIM?.OPERATION_ID === operation?.OPERATION_ID && grant.CLAIM?.IDEMPOTENCY_KEY === operation?.IDEMPOTENCY_KEY) {
      return { ok: true, code: "APPROVAL_ALREADY_CLAIMED_SAME_OPERATION", grant: clone(grant), replay: true };
    }
    return deny(`APPROVAL_NOT_AVAILABLE:${grant.STATE}`, grant);
  }
  if (!operation || typeof operation !== "object" || Array.isArray(operation)) return deny("OPERATION_MISSING", grant);
  if (operation.PLAN_HASH !== grant.PLAN_HASH) return deny("PLAN_HASH_MISMATCH", grant);
  if (!grant.ALLOWED_EFFECT_CLASSES?.includes(operation.EFFECT_CLASS)) return deny("EFFECT_CLASS_DENIED", grant);
  if (!grant.ALLOWED_SCOPE?.includes(operation.SCOPE)) return deny("SCOPE_DENIED", grant);
  if (!operation.OPERATION_ID || !operation.IDEMPOTENCY_KEY) return deny("OPERATION_IDEMPOTENCY_REQUIRED", grant);

  const next = clone(grant);
  next.STATE = "CLAIMED";
  next.CLAIM = {
    OPERATION_ID: operation.OPERATION_ID,
    IDEMPOTENCY_KEY: operation.IDEMPOTENCY_KEY,
    EFFECT_CLASS: operation.EFFECT_CLASS,
    SCOPE: operation.SCOPE
  };
  return { ok: true, code: "APPROVAL_CLAIMED", grant: next, replay: false };
}

export function reconcileClaimedApproval(grant, operation) {
  if (!grant || grant.STATE !== "CLAIMED") return deny("APPROVAL_NOT_CLAIMED", grant ?? {});
  if (grant.CLAIM?.OPERATION_ID !== operation?.OPERATION_ID || grant.CLAIM?.IDEMPOTENCY_KEY !== operation?.IDEMPOTENCY_KEY) {
    return deny("SECOND_MUTATION_DENIED", grant);
  }
  return { ok: true, code: "RECONCILE_SAME_OPERATION_ONLY", grant: clone(grant) };
}

export function confirmApprovalSuccess(grant, operation) {
  const reconciliation = reconcileClaimedApproval(grant, operation);
  if (!reconciliation.ok) return reconciliation;
  const next = clone(grant);
  next.STATE = "CONSUMED";
  next.CONSUMED_BY = {
    OPERATION_ID: operation.OPERATION_ID,
    IDEMPOTENCY_KEY: operation.IDEMPOTENCY_KEY
  };
  return { ok: true, code: "APPROVAL_CONSUMED", grant: next };
}

export function markApprovalOutcomeUnknown(grant, operation) {
  const reconciliation = reconcileClaimedApproval(grant, operation);
  if (!reconciliation.ok) return reconciliation;
  const next = clone(grant);
  next.OUTCOME = "OUTCOME_UNKNOWN";
  return { ok: true, code: "OUTCOME_UNKNOWN_RECONCILIATION_ONLY", grant: next };
}

export function invalidateApprovalGrant(grant, reason = "PLAN_INVALIDATED") {
  if (!grant || typeof grant !== "object" || Array.isArray(grant)) return { ok: false, code: "APPROVAL_MISSING", grant: null };
  if (grant.STATE === "CONSUMED") return deny("CONSUMED_APPROVAL_CANNOT_REOPEN", grant);
  const next = clone(grant);
  next.STATE = "INVALID";
  next.INVALID_REASON = reason;
  return { ok: true, code: "APPROVAL_INVALIDATED", grant: next };
}
