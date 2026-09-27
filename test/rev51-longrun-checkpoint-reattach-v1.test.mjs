import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLongrunCheckpointV1,
  compileReattachDecisionV1,
  selectIdentityPlanMatchedCheckpointV1,
  validateLongrunCheckpointV1
} from "../runtime/rev51/longrun-checkpoint-reattach-v1.mjs";

const I = "1".repeat(64);
const P = "2".repeat(64);
function checkpoint(sequence, overrides = {}) {
  return buildLongrunCheckpointV1({
    checkpointId: `cp-${sequence}`,
    checkpointSequence: sequence,
    projectIdentityDigest: I,
    planManifestDigest: P,
    branch: "runtime-r51-p8-dependency-lock-cache",
    head: "a".repeat(40),
    tree: "b".repeat(40),
    completedWorkIds: ["p1", "p2"],
    evidenceDigests: ["3".repeat(64)],
    nextActionId: "p26-promote",
    ...overrides
  });
}

test("longrun checkpoint is deterministic and tamper-evident", () => {
  const a = checkpoint(1);
  const b = checkpoint(1);
  assert.equal(a.CHECKPOINT_SHA256, b.CHECKPOINT_SHA256);
  assert.equal(validateLongrunCheckpointV1(a).ok, true);
  assert.equal(validateLongrunCheckpointV1({ ...a, nextActionId: "foreign" }).errors.includes("CHECKPOINT_SHA256_MISMATCH"), true);
});

test("checkpoint selection chooses latest matching identity and plan, not globally newer foreign state", () => {
  const local1 = checkpoint(1);
  const local2 = checkpoint(2);
  const foreign = checkpoint(99, { projectIdentityDigest: "9".repeat(64) });
  const out = selectIdentityPlanMatchedCheckpointV1([local1, foreign, local2], { projectIdentityDigest: I, planManifestDigest: P });
  assert.equal(out.checkpoint.checkpointSequence, 2);
  assert.equal(out.checkpoint.checkpointId, "cp-2");
  assert.equal(out.rejectedCount, 1);
});

test("identity unresolved continues safe local work when available", () => {
  assert.deepEqual(compileReattachDecisionV1({ identityResolved: false, safeCurrentProjectLocalActions: ["inspect-local-plan"] }), { decision: "CONTINUE_SAFE_LOCAL_WORK", actionId: "inspect-local-plan", pause: false });
});

test("identity pause is narrow and requires external target with no safe local work", () => {
  assert.equal(compileReattachDecisionV1({ identityResolved: false, nextRequiredActionRequiresExternalTarget: true }).decision, "PAUSE_IDENTITY_UNRESOLVED");
});

test("plan unresolved continues safe local work instead of creating confirmation loop", () => {
  assert.equal(compileReattachDecisionV1({ identityResolved: true, planResolved: false, safeCurrentProjectLocalActions: ["read-plan"] }).decision, "CONTINUE_SAFE_LOCAL_WORK");
});

test("external target membership denial blocks reattach to foreign target", () => {
  const out = compileReattachDecisionV1({ identityResolved: true, planResolved: true, nextRequiredActionRequiresExternalTarget: true, externalTargetMembershipAllowed: false });
  assert.equal(out.decision, "REATTACH_TARGET_MEMBERSHIP_DENIED");
  assert.equal(out.pause, true);
});

test("normal reattach preserves next action without duplicate execution or reapproval", () => {
  const cp = checkpoint(4);
  const out = compileReattachDecisionV1({ identityResolved: true, planResolved: true, checkpoint: cp });
  assert.equal(out.decision, "REATTACH_CONTINUE");
  assert.equal(out.actionId, "p26-promote");
  assert.equal(out.duplicateExecutionAllowed, false);
  assert.equal(out.reapprovalRequired, false);
});
