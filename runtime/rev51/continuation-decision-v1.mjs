function requireActions(actions) {
  if (!Array.isArray(actions)) throw new Error("HOST_ACTIONS_REQUIRED");
  for (const action of actions) {
    if (!action || typeof action !== "object" || Array.isArray(action)) throw new Error("HOST_ACTION_INVALID");
    if (typeof action.id !== "string" || !action.id) throw new Error("HOST_ACTION_ID_REQUIRED");
    if (!["READY", "BLOCKED", "COMPLETE"].includes(action.state)) throw new Error("HOST_ACTION_STATE_INVALID");
    if (action.state === "BLOCKED" && !["LOCAL", "GLOBAL"].includes(action.blockerScope)) throw new Error("BLOCKER_SCOPE_REQUIRED");
  }
  return actions;
}

export function resolveGlobalNextLegalActionV1({ actions = [] } = {}) {
  requireActions(actions);
  const remaining = actions.filter((action) => action.state !== "COMPLETE");
  const ready = remaining.find((action) => action.state === "READY");
  if (ready) return Object.freeze({ status: "ACTION_READY", actionId: ready.id, bypassedLocalBlockers: remaining.filter((action) => action.state === "BLOCKED" && action.blockerScope === "LOCAL").map((action) => action.id) });
  const global = remaining.filter((action) => action.state === "BLOCKED" && action.blockerScope === "GLOBAL");
  const local = remaining.filter((action) => action.state === "BLOCKED" && action.blockerScope === "LOCAL");
  if (global.length > 0) return Object.freeze({ status: "GLOBAL_HARD_BOUNDARY", actionId: null, globalBlockers: global.map((action) => action.id), localBlockers: local.map((action) => action.id) });
  if (remaining.length === 0) return Object.freeze({ status: "HOST_PROJECT_WORK_EXHAUSTED", actionId: null, globalBlockers: [], localBlockers: [] });
  return Object.freeze({ status: "NO_EXECUTABLE_ACTION", actionId: null, globalBlockers: [], localBlockers: local.map((action) => action.id) });
}

export function decideContinuationV1(input = {}) {
  if (input.explicitUserStop === true) return Object.freeze({ decision: "STOP", reason: "STOP_USER_REQUESTED" });
  if (input.realGlobalHardBoundary === true) return Object.freeze({ decision: "STOP", reason: "STOP_GLOBAL_HARD_BOUNDARY" });
  if (input.projectRemainingWork === false) return Object.freeze({ decision: "STOP", reason: "STOP_HOST_PROJECT_COMPLETE" });
  if (input.projectRemainingWork === true && input.executableOrAlternateLegalWork === true) return Object.freeze({ decision: "CONTINUE", reason: "HOST_LEGAL_WORK_REMAINS" });
  if (input.identityUnresolved === true && input.safeCurrentProjectLocalWork === true) return Object.freeze({ decision: "CONTINUE", reason: "CONTINUE_SAFE_LOCAL_WORK" });
  if (input.planUnresolved === true && input.safeCurrentProjectLocalWork === true) return Object.freeze({ decision: "CONTINUE", reason: "CONTINUE_SAFE_LOCAL_WORK" });
  if (input.developmentCredentialShortage === true && input.alternateCredentialIndependentWork === true) return Object.freeze({ decision: "CONTINUE", reason: "DEFER_AUTH_CONTINUE_OTHER_WORK" });
  if (input.phaseComplete === true || input.ciPass === true || input.prReady === true || input.fixedWorkUnitCountReached === true) return Object.freeze({ decision: "CONTINUE", reason: "MILESTONE_NOT_STOP_PERMISSION" });
  return Object.freeze({ decision: "STOP", reason: "STOP_NO_GLOBAL_LEGAL_NEXT_ACTION" });
}

export function evaluatePiloteResponseGateV1(input = {}) {
  const decision = decideContinuationV1(input);
  return Object.freeze({
    ...decision,
    finalResponseAllowed: decision.decision === "STOP",
    executeImmediately: decision.decision === "CONTINUE"
  });
}

export function evaluatePrematureStopWatchdogV1(input = {}) {
  const decision = decideContinuationV1(input);
  const attemptedStopWithoutPermission = input.attemptedFinalResponse === true && decision.decision === "CONTINUE";
  return Object.freeze({
    ok: !attemptedStopWithoutPermission,
    code: attemptedStopWithoutPermission ? "PREMATURE_STOP_DENIED" : "STOP_DECISION_CONFORMANT",
    expectedDecision: decision.decision,
    reason: decision.reason
  });
}
