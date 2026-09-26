import test from "node:test";
import assert from "node:assert/strict";
import {
  bindAliasToExecutionGrantV1,
  compileMasterPlanExecutionGrantV1,
  compileMasterPlanRunContractV1,
  evaluateSourceControlLifetimeV1,
  normalizeContinueAliasV1
} from "../runtime/rev51/master-plan-run-contract-v1.mjs";

const I = "1".repeat(64);
const P = "2".repeat(64);
function grant(overrides = {}) {
  return compileMasterPlanExecutionGrantV1({
    GRANT_ID: "grant-runtime-v017",
    PROJECT_IDENTITY_DIGEST: I,
    PLAN_MANIFEST_DIGEST: P,
    APPROVED_HOST_SCOPE: "Runtime Rev5.1 v017 completion",
    DEVELOPMENT_BRANCH: "runtime-r51-p8-dependency-lock-cache",
    ...overrides
  });
}

test("continue aliases bind ㅇㅇ and dd to the same resume operation", () => {
  assert.equal(normalizeContinueAliasV1("ㅇㅇ").operation, "UNIVERSAL_CONTINUE_RESUME_REATTACH");
  assert.equal(normalizeContinueAliasV1(" DD ").operation, "UNIVERSAL_CONTINUE_RESUME_REATTACH");
  assert.equal(normalizeContinueAliasV1("resume").matched, true);
});

test("unknown alias does not silently widen execution authority", () => {
  assert.deepEqual(normalizeContinueAliasV1("merge-now"), { matched: false, alias: "merge-now", operation: null });
});

test("execution grant preserves continuation without reapproval and one auth interaction budget", () => {
  const g = grant();
  assert.equal(g.STATE, "ACTIVE");
  assert.equal(g.ALLOW_CONTINUE_WITHOUT_REAPPROVAL, true);
  assert.equal(g.ALLOW_PHASE_AUTO_TRANSITION, true);
  assert.equal(g.ALLOW_LOCAL_BLOCKER_BYPASS, true);
  assert.equal(g.INTERACTIVE_AUTH_BUDGET, 1);
  assert.match(g.GRANT_SHA256, /^[0-9a-f]{64}$/);
});

test("execution grant rejects a widened interactive-auth budget", () => {
  assert.throws(() => grant({ INTERACTIVE_AUTH_BUDGET: 2 }), /INTERACTIVE_AUTH_BUDGET_MUST_EQUAL_ONE/);
});

test("continue alias requires an existing active grant", () => {
  assert.equal(bindAliasToExecutionGrantV1({ alias: "ㅇㅇ", grant: grant() }).reapprovalRequired, false);
  assert.equal(bindAliasToExecutionGrantV1({ alias: "ㅇㅇ", grant: grant({ STATE: "SUSPENDED" }) }).code, "ACTIVE_EXECUTION_GRANT_REQUIRED");
});

test("master-plan run contract fixes long-run and action-economy invariants", () => {
  const g = grant();
  const c = compileMasterPlanRunContractV1({ PROJECT_IDENTITY_DIGEST: I, PLAN_MANIFEST_DIGEST: P, EXECUTION_GRANT_SHA256: g.GRANT_SHA256, DEVELOPMENT_BRANCH: g.DEVELOPMENT_BRANCH });
  assert.equal(c.LONGRUN_EXECUTION_UNIT, "APPROVED_HOST_PROJECT_SCOPE");
  assert.equal(c.PERSISTENT_DEVELOPMENT_BRANCH, true);
  assert.equal(c.AUTO_PHASE_TRANSITION, true);
  assert.equal(c.PR_PER_PHASE_NORMAL_PATH, false);
  assert.equal(c.INTERMEDIATE_FULL_CI, false);
  assert.equal(c.EXACT_CANDIDATE_FULL_CI_TARGET, 1);
  assert.equal(c.OPTIONAL_REVALIDATION_MAX, 1);
  assert.equal(c.SECOND_AUTH_PROMPT_NORMAL_PATH, 0);
});

test("source-control lifetime defers ordinary phase merge", () => {
  const decision = evaluateSourceControlLifetimeV1({});
  assert.equal(decision.branchAction, "REUSE_PERSISTENT_DEVELOPMENT_BRANCH");
  assert.equal(decision.mergeDecision, "MERGE_DEFERRED_CONTINUE");
});

test("source-control lifetime permits merge only at explicit or structural boundary", () => {
  assert.equal(evaluateSourceControlLifetimeV1({ structurallyRequiredMerge: true }).mergeDecision, "MERGE_ALLOWED_NOW");
  assert.equal(evaluateSourceControlLifetimeV1({ explicitMergeNow: true }).mergeDecision, "MERGE_ALLOWED_NOW");
});
