import test from "node:test";
import assert from "node:assert/strict";
import {
  decideContinuationV1,
  evaluatePiloteResponseGateV1,
  evaluatePrematureStopWatchdogV1,
  resolveGlobalNextLegalActionV1
} from "../runtime/rev51/continuation-decision-v1.mjs";

test("next legal action bypasses local blocker when another action is ready", () => {
  const out = resolveGlobalNextLegalActionV1({ actions: [
    { id: "auth-live", state: "BLOCKED", blockerScope: "LOCAL" },
    { id: "implement-contracts", state: "READY" }
  ] });
  assert.equal(out.status, "ACTION_READY");
  assert.equal(out.actionId, "implement-contracts");
  assert.deepEqual(out.bypassedLocalBlockers, ["auth-live"]);
});

test("global blocker is classified only when no ready action exists", () => {
  const out = resolveGlobalNextLegalActionV1({ actions: [{ id: "paid-authority", state: "BLOCKED", blockerScope: "GLOBAL" }] });
  assert.equal(out.status, "GLOBAL_HARD_BOUNDARY");
  assert.deepEqual(out.globalBlockers, ["paid-authority"]);
});

test("completed graph reports exhausted work", () => {
  assert.equal(resolveGlobalNextLegalActionV1({ actions: [{ id: "p1", state: "COMPLETE" }] }).status, "HOST_PROJECT_WORK_EXHAUSTED");
});

test("remaining executable host work mandates continuation", () => {
  assert.deepEqual(decideContinuationV1({ projectRemainingWork: true, executableOrAlternateLegalWork: true }), { decision: "CONTINUE", reason: "HOST_LEGAL_WORK_REMAINS" });
});

test("phase complete, CI pass, PR ready and fixed batch count are not stop permission", () => {
  for (const key of ["phaseComplete", "ciPass", "prReady", "fixedWorkUnitCountReached"]) {
    assert.equal(decideContinuationV1({ [key]: true }).decision, "CONTINUE");
  }
});

test("identity or plan uncertainty continues safe current-project local work", () => {
  assert.equal(decideContinuationV1({ identityUnresolved: true, safeCurrentProjectLocalWork: true }).reason, "CONTINUE_SAFE_LOCAL_WORK");
  assert.equal(decideContinuationV1({ planUnresolved: true, safeCurrentProjectLocalWork: true }).reason, "CONTINUE_SAFE_LOCAL_WORK");
});

test("development credential shortage is bypassed by credential-independent work", () => {
  assert.equal(decideContinuationV1({ developmentCredentialShortage: true, alternateCredentialIndependentWork: true }).reason, "DEFER_AUTH_CONTINUE_OTHER_WORK");
});

test("explicit user stop and real global boundary are actual stops", () => {
  assert.equal(decideContinuationV1({ explicitUserStop: true }).reason, "STOP_USER_REQUESTED");
  assert.equal(decideContinuationV1({ realGlobalHardBoundary: true }).reason, "STOP_GLOBAL_HARD_BOUNDARY");
});

test("response gate denies final response while legal work remains", () => {
  const out = evaluatePiloteResponseGateV1({ projectRemainingWork: true, executableOrAlternateLegalWork: true });
  assert.equal(out.finalResponseAllowed, false);
  assert.equal(out.executeImmediately, true);
});

test("premature-stop watchdog rejects attempted final response during continuation", () => {
  const out = evaluatePrematureStopWatchdogV1({ attemptedFinalResponse: true, projectRemainingWork: true, executableOrAlternateLegalWork: true });
  assert.equal(out.ok, false);
  assert.equal(out.code, "PREMATURE_STOP_DENIED");
});
