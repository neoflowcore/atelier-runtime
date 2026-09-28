import { createHash } from "node:crypto";

const CONTINUE_ALIASES = new Set(["ㅇㅇ", "dd", "continue", "resume", "reattach"]);
const CONTINUE_DECISIONS = new Set([
  "CONTINUE_ACTIVE_NEXT",
  "CONTINUE_ALTERNATE_LEGAL_WORK",
  "CONTINUE_SAFE_LOCAL_WORK",
  "REATTACH_CONTINUE",
  "MERGE_DEFERRED_CONTINUE",
  "CONTINUE_CREDENTIAL_INDEPENDENT_WORK",
  "AUTH_ENDGAME_DEFERRED_OR_NOT_REQUIRED"
]);
const BOUNDARY_DECISIONS = new Set([
  "PAUSE_IDENTITY_UNRESOLVED",
  "PAUSE_PLAN_UNRESOLVED",
  "REATTACH_TARGET_MEMBERSHIP_DENIED",
  "PLATFORM_APPROVAL_REQUIRED",
  "AUTH_ENDGAME_EXECUTABLE",
  "FINAL_RELEASE_MERGE_AUTHORITY_REQUIRED",
  "USER_STOP",
  "HOST_WORK_EXHAUSTED"
]);

function isObject(value) { return !!value && typeof value === "object" && !Array.isArray(value); }
function canonicalize(value) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("P52_D3_NON_SAFE_INTEGER");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  throw new Error("P52_D3_UNSUPPORTED_CANONICAL_TYPE");
}
const hash = (value) => createHash("sha256").update(canonicalize(value), "utf8").digest("hex");

export function normalizePiloteContinuationAliasV1(value) {
  if (typeof value !== "string") return Object.freeze({ matched: false, alias: null, operation: null });
  const alias = value.trim().toLowerCase();
  return Object.freeze({
    matched: CONTINUE_ALIASES.has(alias),
    alias,
    operation: CONTINUE_ALIASES.has(alias) ? "CONTINUE_EXISTING_PROJECT_RUN" : null
  });
}

export function compileStrictLongrunNaturalLanguageFixtureV1() {
  const body = {
    SCHEMA_ID: "PILOTE_STRICT_LONGRUN_NL_FIXTURE_V1",
    SCHEMA_VERSION: "1",
    aliases: [...CONTINUE_ALIASES].sort(),
    acceptedLongFormMeaning: "continue the current approved project run without redundant reapproval until a real boundary",
    deniedInterpretations: [
      "start a different project",
      "expand repository or provider scope",
      "grant final merge authority",
      "grant new secret authority",
      "grant new paid resource authority"
    ],
    minimalPromptUxOnly: true,
    runtimeParserRequirement: false
  };
  return Object.freeze({ ...body, FIXTURE_SHA256: hash(body) });
}

export function compileContinuationPolicyV1(input = {}) {
  const body = {
    SCHEMA_ID: "PILOTE_CONTINUATION_POLICY_V1",
    SCHEMA_VERSION: "1",
    projectRunGrantSha256: input.projectRunGrantSha256 ?? null,
    checkpointIsTermination: false,
    phaseCompleteIsStop: false,
    prReadyIsStop: false,
    ciPassIsStop: false,
    commitCreatedIsStop: false,
    authRequirementDiscoveredIsStop: false,
    planVerifiedIsStop: false,
    identityVerifiedIsStop: false,
    runtimeContinuationDecisionAuthority: "RUNTIME",
    finalResponseRequiresRuntimeBoundaryOrExhaustion: true,
    reaskApprovalForOrdinaryInScopeContinuation: false
  };
  return Object.freeze({ ...body, CONTINUATION_POLICY_SHA256: hash(body) });
}

export function consumeRuntimeContinuationDecisionV1(decision) {
  if (!isObject(decision) || typeof decision.decision !== "string" || !decision.decision) throw new Error("RUNTIME_CONTINUATION_DECISION_REQUIRED");
  const code = decision.decision;
  if (CONTINUE_DECISIONS.has(code)) {
    return Object.freeze({ runtimeDecision: code, responseClass: "CONTINUE", hardBoundary: false, finalResponseAllowed: false, activeNext: decision.ACTIVE_NEXT ?? decision.actionId ?? null });
  }
  if (BOUNDARY_DECISIONS.has(code)) {
    return Object.freeze({ runtimeDecision: code, responseClass: "BOUNDARY", hardBoundary: true, finalResponseAllowed: true, activeNext: null });
  }
  return Object.freeze({ runtimeDecision: code, responseClass: "UNKNOWN_RUNTIME_DECISION", hardBoundary: true, finalResponseAllowed: false, activeNext: null });
}

export function compilePiloteResponseGateV1({ runtimeDecision, channelPause = false, userExplicitStop = false } = {}) {
  const consumed = consumeRuntimeContinuationDecisionV1(runtimeDecision);
  const userOrChannelBoundary = userExplicitStop === true || channelPause === true;
  const finalResponseAllowed = userOrChannelBoundary || consumed.finalResponseAllowed === true;
  const body = {
    SCHEMA_ID: "PILOTE_RESPONSE_GATE_V1",
    SCHEMA_VERSION: "1",
    runtimeDecision: consumed.runtimeDecision,
    responseClass: userOrChannelBoundary ? "BOUNDARY" : consumed.responseClass,
    continueExecution: !finalResponseAllowed,
    finalResponseAllowed,
    userExplicitStop: userExplicitStop === true,
    channelPause: channelPause === true,
    runtimeDecisionConsumedNotReimplemented: true
  };
  return Object.freeze({ ...body, RESPONSE_GATE_SHA256: hash(body) });
}

export function compileNewChatReattachSemanticsV1(input = {}) {
  const body = {
    SCHEMA_ID: "PILOTE_NEW_CHAT_REATTACH_V1",
    SCHEMA_VERSION: "1",
    projectIdentityMatched: input.projectIdentityMatched === true,
    planMatched: input.planMatched === true,
    runtimeDependencyLockMatched: input.runtimeDependencyLockMatched === true,
    duplicateExecutionAllowed: false,
    approvalReset: false,
    phaseReset: false,
    authReset: false,
    reconnectMeansNewRun: false,
    decision: input.projectIdentityMatched === true && input.planMatched === true && input.runtimeDependencyLockMatched === true ? "REATTACH_EXISTING_PILOTE_RUN" : "REATTACH_PRECONDITION_REQUIRED"
  };
  return Object.freeze({ ...body, REATTACH_SEMANTICS_SHA256: hash(body) });
}

export function compileIdentityPlanAutoContinueUxV1(input = {}) {
  const verified = input.identityVerified === true && input.planVerified === true;
  return Object.freeze({
    SCHEMA_ID: "PILOTE_IDENTITY_PLAN_AUTO_CONTINUE_UX_V1",
    SCHEMA_VERSION: "1",
    identityVerified: input.identityVerified === true,
    planVerified: input.planVerified === true,
    confirmationPromptRequired: false,
    stopAtVerification: false,
    autoContinue: verified,
    nextAction: verified ? "REQUEST_RUNTIME_NEXT_LEGAL_ACTION_AND_EXECUTE" : "COMPLETE_VERIFICATION_PREFLIGHT"
  });
}
