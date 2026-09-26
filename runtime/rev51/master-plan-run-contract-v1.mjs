import { createHash } from "node:crypto";

const SHA256_RE = /^[0-9a-f]{64}$/;
const CONTINUE_ALIASES = new Set(["\u3147\u3147", "dd", "continue", "resume", "reattach"]);

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function canonicalize(value) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("MASTER_PLAN_RUN_NON_SAFE_INTEGER");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  throw new Error("MASTER_PLAN_RUN_UNSUPPORTED_CANONICAL_TYPE");
}

function hash(value) {
  return createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
}

function requireSha(value, code) {
  if (!SHA256_RE.test(value ?? "")) throw new Error(code);
  return value;
}

function requireString(value, code) {
  if (typeof value !== "string" || !value) throw new Error(code);
  return value;
}

export function normalizeContinueAliasV1(value) {
  if (typeof value !== "string") return Object.freeze({ matched: false, alias: null, operation: null });
  const alias = value.trim().toLowerCase();
  if (!CONTINUE_ALIASES.has(alias)) return Object.freeze({ matched: false, alias, operation: null });
  return Object.freeze({ matched: true, alias, operation: "UNIVERSAL_CONTINUE_RESUME_REATTACH" });
}

export function compileMasterPlanExecutionGrantV1(input = {}) {
  const body = {
    SCHEMA_ID: "MASTER_PLAN_EXECUTION_GRANT_V1",
    SCHEMA_VERSION: "1",
    GRANT_ID: requireString(input.GRANT_ID, "GRANT_ID_REQUIRED"),
    PROJECT_IDENTITY_DIGEST: requireSha(input.PROJECT_IDENTITY_DIGEST, "PROJECT_IDENTITY_DIGEST_REQUIRED"),
    PLAN_MANIFEST_DIGEST: requireSha(input.PLAN_MANIFEST_DIGEST, "PLAN_MANIFEST_DIGEST_REQUIRED"),
    APPROVED_HOST_SCOPE: requireString(input.APPROVED_HOST_SCOPE, "APPROVED_HOST_SCOPE_REQUIRED"),
    DEVELOPMENT_BRANCH: requireString(input.DEVELOPMENT_BRANCH, "DEVELOPMENT_BRANCH_REQUIRED"),
    STATE: input.STATE ?? "ACTIVE",
    ALLOW_CONTINUE_WITHOUT_REAPPROVAL: input.ALLOW_CONTINUE_WITHOUT_REAPPROVAL !== false,
    ALLOW_PHASE_AUTO_TRANSITION: input.ALLOW_PHASE_AUTO_TRANSITION !== false,
    ALLOW_LOCAL_BLOCKER_BYPASS: input.ALLOW_LOCAL_BLOCKER_BYPASS !== false,
    MERGE_AUTHORITY: input.MERGE_AUTHORITY ?? "DEFER_UNLESS_STRUCTURALLY_REQUIRED",
    INTERACTIVE_AUTH_BUDGET: input.INTERACTIVE_AUTH_BUDGET ?? 1
  };
  if (!new Set(["ACTIVE", "SUSPENDED", "CONSUMED"]).has(body.STATE)) throw new Error("EXECUTION_GRANT_STATE_INVALID");
  if (body.INTERACTIVE_AUTH_BUDGET !== 1) throw new Error("INTERACTIVE_AUTH_BUDGET_MUST_EQUAL_ONE");
  return Object.freeze({ ...body, GRANT_SHA256: hash(body) });
}

export function bindAliasToExecutionGrantV1({ alias, grant } = {}) {
  const normalized = normalizeContinueAliasV1(alias);
  if (!normalized.matched) return Object.freeze({ ok: false, code: "CONTINUE_ALIAS_NOT_MATCHED" });
  if (!grant || grant.SCHEMA_ID !== "MASTER_PLAN_EXECUTION_GRANT_V1" || grant.STATE !== "ACTIVE") return Object.freeze({ ok: false, code: "ACTIVE_EXECUTION_GRANT_REQUIRED" });
  return Object.freeze({ ok: true, code: "ALIAS_BOUND_TO_EXISTING_GRANT", grantId: grant.GRANT_ID, operation: normalized.operation, reapprovalRequired: false });
}

export function compileMasterPlanRunContractV1(input = {}) {
  const body = {
    SCHEMA_ID: "MASTER_PLAN_RUN_CONTRACT_V1",
    SCHEMA_VERSION: "1",
    PROJECT_IDENTITY_DIGEST: requireSha(input.PROJECT_IDENTITY_DIGEST, "PROJECT_IDENTITY_DIGEST_REQUIRED"),
    PLAN_MANIFEST_DIGEST: requireSha(input.PLAN_MANIFEST_DIGEST, "PLAN_MANIFEST_DIGEST_REQUIRED"),
    EXECUTION_GRANT_SHA256: requireSha(input.EXECUTION_GRANT_SHA256, "EXECUTION_GRANT_SHA256_REQUIRED"),
    DEVELOPMENT_BRANCH: requireString(input.DEVELOPMENT_BRANCH, "DEVELOPMENT_BRANCH_REQUIRED"),
    LONGRUN_EXECUTION_UNIT: "APPROVED_HOST_PROJECT_SCOPE",
    PHASE_ROLE: "CHECKPOINT_BRANCH_LOCAL_ACCEPTANCE_NODE",
    SOURCE_CONTROL_LIFETIME: "HOST_PROJECT_RUN",
    PERSISTENT_DEVELOPMENT_BRANCH: true,
    CURRENT_TURN_EXECUTION_MAXIMIZATION: true,
    DURABLE_MASTER_PLAN_RUNNER: true,
    GLOBAL_NEXT_LEGAL_ACTION_RESOLVER: true,
    AUTO_PHASE_TRANSITION: true,
    GLOBAL_BLOCKER_BYPASS: true,
    FINAL_RESPONSE_REQUIRES_STOP_DECISION: true,
    PR_PER_WORK_UNIT: false,
    MERGE_PER_WORK_UNIT: false,
    PR_PER_PHASE_NORMAL_PATH: false,
    PHASE_FINAL_MERGE_NORMAL_PATH: false,
    BLIND_RERUN: false,
    INTERMEDIATE_FULL_CI: false,
    EXACT_CANDIDATE_FULL_CI_TARGET: 1,
    OPTIONAL_REVALIDATION_MAX: 1,
    AUTH_BIND_INTERACTION_BUDGET_PER_PROJECT_RUN: 1,
    SECOND_AUTH_PROMPT_NORMAL_PATH: 0
  };
  return Object.freeze({ ...body, RUN_CONTRACT_SHA256: hash(body) });
}

export function evaluateSourceControlLifetimeV1(input = {}) {
  const mergeNow = input.projectFinalIntegration === true || input.structurallyRequiredMerge === true || input.explicitMergeNow === true || input.independentHotfixSemanticBoundary === true;
  return Object.freeze({
    sourceControlLifetime: "HOST_PROJECT_RUN",
    branchAction: "REUSE_PERSISTENT_DEVELOPMENT_BRANCH",
    mergeDecision: mergeNow ? "MERGE_ALLOWED_NOW" : "MERGE_DEFERRED_CONTINUE",
    mergeTrigger: mergeNow ? "EXPLICIT_OR_STRUCTURAL" : null
  });
}
