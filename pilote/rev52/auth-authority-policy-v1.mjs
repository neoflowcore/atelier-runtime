import { createHash } from "node:crypto";

const SHA256_RE = /^[0-9a-f]{64}$/;
const REAL_BOUNDARIES = new Set([
  "PROJECT_SWITCH",
  "NEW_UNBOUND_REPOSITORY",
  "PROTECTED_OR_PRODUCTION_BRANCH_EXPANSION",
  "PLAN_SCOPE_EXPANSION",
  "DESTRUCTIVE_OR_IRREVERSIBLE_MUTATION",
  "FORCE_PUSH_OR_HISTORY_REWRITE",
  "NEW_SECRET_AUTHORITY",
  "NEW_COST_AUTHORITY",
  "FINAL_MERGE_OR_RELEASE_AUTHORITY",
  "SEMANTIC_AUTHORITY_CONFLICT",
  "USER_EXPLICIT_STOP_OR_SCOPE_RESTRICTION"
]);

function isObject(value) { return !!value && typeof value === "object" && !Array.isArray(value); }
function canonicalize(value) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("P52_D2_NON_SAFE_INTEGER");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  throw new Error("P52_D2_UNSUPPORTED_CANONICAL_TYPE");
}
const hash = (value) => createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
function requireSha(value, code) { if (!SHA256_RE.test(value ?? "")) throw new Error(code); return value; }
function requireString(value, code) { if (typeof value !== "string" || !value) throw new Error(code); return value; }

function normalizeRequirement(requirement) {
  if (!isObject(requirement)) throw new Error("AUTH_REQUIREMENT_INVALID");
  return {
    provider: requireString(requirement.provider, "AUTH_REQUIREMENT_PROVIDER_REQUIRED"),
    capability: requireString(requirement.capability, "AUTH_REQUIREMENT_CAPABILITY_REQUIRED"),
    scope: requireString(requirement.scope, "AUTH_REQUIREMENT_SCOPE_REQUIRED"),
    phaseId: requirement.phaseId ?? null,
    reason: requirement.reason ?? null
  };
}

export function collectAuthRequirementsV1(requirements = []) {
  if (!Array.isArray(requirements)) throw new Error("AUTH_REQUIREMENTS_ARRAY_REQUIRED");
  const map = new Map();
  for (const item of requirements.map(normalizeRequirement)) {
    const key = `${item.provider}\u0000${item.capability}\u0000${item.scope}`;
    if (!map.has(key)) map.set(key, item);
  }
  const normalized = [...map.values()].sort((a, b) => a.provider.localeCompare(b.provider) || a.capability.localeCompare(b.capability) || a.scope.localeCompare(b.scope));
  const body = { SCHEMA_ID: "PILOTE_AUTH_REQUIREMENT_SET_V1", SCHEMA_VERSION: "1", requirements: normalized };
  return Object.freeze({ ...body, AUTH_REQUIREMENT_SET_SHA256: hash(body) });
}

export function compileFinalAuthBindPolicyV1(input = {}) {
  const body = {
    SCHEMA_ID: "PILOTE_FINAL_AUTH_BIND_POLICY_V1",
    SCHEMA_VERSION: "1",
    authRequirementSetSha256: requireSha(input.authRequirementSetSha256, "AUTH_REQUIREMENT_SET_SHA256_REQUIRED"),
    runtimeAuthEligibilityAuthority: "RUNTIME",
    rawSecretChatPath: "DENY",
    interactivePromptMaxPerProjectRun: 1,
    partialBindThenDiscoverMore: false,
    existingNativeDelegatedFederatedAuthReuseFirst: true,
    leastPrivilegeRequired: true,
    authLast: true
  };
  return Object.freeze({ ...body, FINAL_AUTH_BIND_POLICY_SHA256: hash(body) });
}

export function compileRuntimeAuthEligibilityRequestV1(input = {}) {
  const body = {
    SCHEMA_ID: "PILOTE_RUNTIME_AUTH_ELIGIBILITY_REQUEST_V1",
    SCHEMA_VERSION: "1",
    projectIdentityDigest: requireSha(input.projectIdentityDigest, "PROJECT_IDENTITY_DIGEST_REQUIRED"),
    sourceManifestDigest: requireSha(input.sourceManifestDigest, "SOURCE_MANIFEST_DIGEST_REQUIRED"),
    projectRunStateSha256: requireSha(input.projectRunStateSha256, "PROJECT_RUN_STATE_SHA256_REQUIRED"),
    authRequirementSetSha256: requireSha(input.authRequirementSetSha256, "AUTH_REQUIREMENT_SET_SHA256_REQUIRED"),
    closurePreflightReceiptSha256: input.closurePreflightReceiptSha256 ? requireSha(input.closurePreflightReceiptSha256, "CLOSURE_PREFLIGHT_SHA256_INVALID") : null,
    requestedDecision: "RUNTIME_AUTH_ENDGAME_ELIGIBILITY",
    piloteDoesNotDecideEligibility: true
  };
  return Object.freeze({ ...body, AUTH_ELIGIBILITY_REQUEST_SHA256: hash(body) });
}

export function compileSourceMutationAuthorityRequestV1(input = {}) {
  const body = {
    SCHEMA_ID: "PILOTE_SOURCE_MUTATION_AUTHORITY_REQUEST_V1",
    SCHEMA_VERSION: "1",
    projectIdentityDigest: requireSha(input.projectIdentityDigest, "PROJECT_IDENTITY_DIGEST_REQUIRED"),
    authoritativePlanSetDigest: requireSha(input.authoritativePlanSetDigest, "AUTHORITATIVE_PLAN_SET_DIGEST_REQUIRED"),
    targetRepository: requireString(input.targetRepository, "TARGET_REPOSITORY_REQUIRED"),
    developmentBranchOrBranchClass: requireString(input.developmentBranchOrBranchClass, "DEVELOPMENT_BRANCH_REQUIRED"),
    authoritySource: requireString(input.authoritySource, "AUTHORITY_SOURCE_REQUIRED"),
    mutationClass: input.mutationClass ?? "NON_DESTRUCTIVE_SOURCE_DEVELOPMENT",
    requestedRuntimeContract: "SOURCE_MUTATION_AUTHORITY_ENVELOPE_V1",
    runtimeEvaluationRequired: true
  };
  return Object.freeze({ ...body, MUTATION_AUTHORITY_REQUEST_SHA256: hash(body) });
}

export function compileAuthorityBoundaryV1(input = {}) {
  const boundaryType = input.boundaryType ?? null;
  const isBoundary = boundaryType ? REAL_BOUNDARIES.has(boundaryType) : false;
  return Object.freeze({
    SCHEMA_ID: "PILOTE_AUTHORITY_BOUNDARY_V1",
    SCHEMA_VERSION: "1",
    boundaryType,
    isAuthorityBoundary: isBoundary,
    userApprovalRequired: isBoundary,
    ordinaryInScopeChange: !isBoundary,
    runtimeEnvelopeReusePreferred: !isBoundary
  });
}

export function compileLeastPrivilegeStagingV1(input = {}) {
  if (!Array.isArray(input.requirements)) throw new Error("LEAST_PRIVILEGE_REQUIREMENTS_REQUIRED");
  const staged = input.requirements.map(normalizeRequirement).map((item) => ({
    provider: item.provider,
    capability: item.capability,
    scope: item.scope,
    bindTiming: "AUTH_ENDGAME_ONLY",
    materializedSecretAllowed: false,
    opaqueReferencePreferred: true
  })).sort((a, b) => a.provider.localeCompare(b.provider) || a.capability.localeCompare(b.capability) || a.scope.localeCompare(b.scope));
  const body = { SCHEMA_ID: "PILOTE_LEAST_PRIVILEGE_STAGING_V1", SCHEMA_VERSION: "1", staged, rawSecretChatPath: "DENY", preDevelopmentCredentialBinding: false };
  return Object.freeze({ ...body, LEAST_PRIVILEGE_STAGING_SHA256: hash(body) });
}
