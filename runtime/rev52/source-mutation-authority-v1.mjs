import { createHash } from "node:crypto";

const SHA256_RE = /^[0-9a-f]{64}$/;
const REAL_BOUNDARIES = new Set([
  "PROJECT_SWITCH",
  "FOREIGN_OR_NEW_REPOSITORY_OUTSIDE_BOUND_SET",
  "PROTECTED_OR_PRODUCTION_BRANCH_SCOPE_CHANGE",
  "APPROVED_PLAN_SCOPE_EXPANSION",
  "IRREVERSIBLE_OR_DESTRUCTIVE_PRODUCTION_MUTATION",
  "FORCE_PUSH_OR_HISTORY_REWRITE",
  "NEW_SECRET_OR_CREDENTIAL_AUTHORITY",
  "NEW_PAID_RESOURCE_OR_COST_AUTHORITY",
  "PROJECT_FINAL_MERGE_OR_RELEASE_AUTHORITY",
  "SEMANTIC_AUTHORITY_CONFLICT",
  "USER_EXPLICIT_STOP_OR_SCOPE_RESTRICTION"
]);

function isObject(value) { return !!value && typeof value === "object" && !Array.isArray(value); }
function canonicalize(value) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("MUTATION_AUTHORITY_NON_SAFE_INTEGER");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  throw new Error("MUTATION_AUTHORITY_UNSUPPORTED_CANONICAL_TYPE");
}
function hash(value) { return createHash("sha256").update(canonicalize(value), "utf8").digest("hex"); }
function requireSha(value, code) { if (!SHA256_RE.test(value ?? "")) throw new Error(code); return value; }
function requireString(value, code) { if (typeof value !== "string" || !value) throw new Error(code); return value; }
function strings(values, code) {
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || !value)) throw new Error(code);
  return [...new Set(values)].sort();
}

export function compileSourceMutationAuthorityEnvelopeV1(input = {}) {
  const repositories = strings(input.repositorySet ?? [], "MUTATION_AUTHORITY_REPOSITORY_SET_INVALID");
  const body = {
    SCHEMA_ID: "SOURCE_MUTATION_AUTHORITY_ENVELOPE_V1",
    SCHEMA_VERSION: "1",
    projectIdentityDigest: requireSha(input.projectIdentityDigest, "PROJECT_IDENTITY_DIGEST_REQUIRED"),
    authoritativePlanSetDigest: requireSha(input.authoritativePlanSetDigest, "AUTHORITATIVE_PLAN_SET_DIGEST_REQUIRED"),
    repositorySet: repositories,
    targetRepository: requireString(input.targetRepository, "TARGET_REPOSITORY_REQUIRED"),
    developmentBranchOrBranchClass: requireString(input.developmentBranchOrBranchClass, "DEVELOPMENT_BRANCH_REQUIRED"),
    authoritySource: requireString(input.authoritySource, "AUTHORITY_SOURCE_REQUIRED"),
    authorityScope: input.authorityScope ?? "APPROVED_RUNTIME_REV52_TRACK_A",
    mutationClass: "NON_DESTRUCTIVE_SOURCE_DEVELOPMENT",
    createdCheckpoint: input.createdCheckpoint ?? null,
    validityConditions: strings(input.validityConditions ?? ["IDENTITY_MATCH","PLAN_MATCH","REPOSITORY_MATCH","DEVELOPMENT_BRANCH_MATCH","NON_DESTRUCTIVE"], "MUTATION_AUTHORITY_VALIDITY_INVALID")
  };
  if (!repositories.includes(body.targetRepository)) throw new Error("TARGET_REPOSITORY_OUTSIDE_BOUND_SET");
  return Object.freeze({ ...body, MUTATION_AUTHORITY_ENVELOPE_SHA256: hash(body) });
}

export function evaluateSourceMutationAuthorityReuseV1({ envelope, current = {}, proposed = {} } = {}) {
  if (!envelope || envelope.SCHEMA_ID !== "SOURCE_MUTATION_AUTHORITY_ENVELOPE_V1") throw new Error("MUTATION_AUTHORITY_ENVELOPE_REQUIRED");
  const hardBoundary = proposed.boundaryType ?? null;
  if (hardBoundary && REAL_BOUNDARIES.has(hardBoundary)) return Object.freeze({ reusable:false, decision:"NEW_AUTHORITY_BOUNDARY", reason:hardBoundary, userReapprovalRequired:true });
  if (current.projectIdentityDigest && current.projectIdentityDigest !== envelope.projectIdentityDigest) return Object.freeze({ reusable:false, decision:"ENVELOPE_INVALIDATED", reason:"PROJECT_IDENTITY_DRIFT", userReapprovalRequired:true });
  if (current.authoritativePlanSetDigest && current.authoritativePlanSetDigest !== envelope.authoritativePlanSetDigest) return Object.freeze({ reusable:false, decision:"ENVELOPE_INVALIDATED", reason:"PLAN_SCOPE_DRIFT", userReapprovalRequired:true });
  if (proposed.targetRepository && proposed.targetRepository !== envelope.targetRepository) return Object.freeze({ reusable:false, decision:"ENVELOPE_INVALIDATED", reason:"TARGET_REPOSITORY_DRIFT", userReapprovalRequired:true });
  if (proposed.developmentBranchOrBranchClass && proposed.developmentBranchOrBranchClass !== envelope.developmentBranchOrBranchClass) return Object.freeze({ reusable:false, decision:"ENVELOPE_INVALIDATED", reason:"DEVELOPMENT_BRANCH_DRIFT", userReapprovalRequired:true });
  if (proposed.destructive === true || proposed.forcePush === true || proposed.historyRewrite === true) return Object.freeze({ reusable:false, decision:"NEW_AUTHORITY_BOUNDARY", reason:"DESTRUCTIVE_OR_HISTORY_REWRITE", userReapprovalRequired:true });
  return Object.freeze({
    reusable:true,
    decision:"REUSE_MUTATION_AUTHORITY_ENVELOPE",
    reason:null,
    userReapprovalRequired:false,
    workUnitChangeAllowed:true,
    fileSetChangeAllowed:true,
    newCommitAllowed:true,
    testAdditionOrFixAllowed:true,
    docsBuildConfigChangeAllowed:true,
    nextPhaseWithinApprovedScopeAllowed:true
  });
}

export function detectRedundantMutationReapprovalV1({ envelopeReusable, reason } = {}) {
  const redundantReasons = new Set(["WORK_UNIT_CHANGE","FILE_SET_CHANGE","NEW_COMMIT","TEST_ADDITION_OR_FIX","DOC_OR_BUILD_FILE_CHANGE","NEXT_PHASE_WITHIN_APPROVED_SCOPE","PR_EXISTENCE","CI_PASS_OR_FAILURE","CHECKPOINT_OR_REATTACH"]);
  if (envelopeReusable === true && redundantReasons.has(reason)) return Object.freeze({ redundant:true, userBoundary:false, turnEndPermission:false, recovery:"REUSE_ENVELOPE_COMPILE_EXACT_MUTATION_READBACK_CONTINUE" });
  return Object.freeze({ redundant:false, userBoundary:false, turnEndPermission:false, recovery:null });
}
