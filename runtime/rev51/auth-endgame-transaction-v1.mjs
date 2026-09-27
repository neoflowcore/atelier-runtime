import { createHash } from "node:crypto";

const SHA256_RE = /^[0-9a-f]{64}$/;

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function canonicalize(value) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("AUTH_ENDGAME_NON_SAFE_INTEGER");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  throw new Error("AUTH_ENDGAME_UNSUPPORTED_CANONICAL_TYPE");
}

function hash(value) {
  return createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
}

function normalizeRequirement(requirement) {
  if (!isObject(requirement)) throw new Error("AUTH_REQUIREMENT_INVALID");
  for (const key of ["provider", "capability", "scope"]) if (typeof requirement[key] !== "string" || !requirement[key]) throw new Error(`AUTH_REQUIREMENT_${key.toUpperCase()}_REQUIRED`);
  return { provider: requirement.provider, capability: requirement.capability, scope: requirement.scope, reason: requirement.reason ?? null };
}

export function compileFinalCredentialBindManifestV1(requirements = []) {
  if (!Array.isArray(requirements)) throw new Error("CREDENTIAL_REQUIREMENTS_ARRAY_REQUIRED");
  const map = new Map();
  for (const item of requirements.map(normalizeRequirement)) {
    const key = `${item.provider}\u0000${item.capability}\u0000${item.scope}`;
    if (!map.has(key)) map.set(key, item);
  }
  const normalized = [...map.values()].sort((a, b) => a.provider.localeCompare(b.provider) || a.capability.localeCompare(b.capability) || a.scope.localeCompare(b.scope));
  const body = {
    SCHEMA_ID: "FINAL_CREDENTIAL_BIND_MANIFEST_V1",
    SCHEMA_VERSION: "1",
    requirements: normalized,
    rawSecretChatPath: "DENY",
    interactionBudget: 1
  };
  return Object.freeze({ ...body, CREDENTIAL_BIND_MANIFEST_SHA256: hash(body) });
}

export function compileFinalAuthBindManifestV1({ projectIdentityDigest, credentialManifest } = {}) {
  if (!SHA256_RE.test(projectIdentityDigest ?? "")) throw new Error("PROJECT_IDENTITY_DIGEST_REQUIRED");
  if (!credentialManifest || credentialManifest.SCHEMA_ID !== "FINAL_CREDENTIAL_BIND_MANIFEST_V1") throw new Error("FINAL_CREDENTIAL_BIND_MANIFEST_REQUIRED");
  const body = {
    SCHEMA_ID: "FINAL_AUTH_BIND_MANIFEST_V1",
    SCHEMA_VERSION: "1",
    projectIdentityDigest,
    credentialBindManifestSha256: credentialManifest.CREDENTIAL_BIND_MANIFEST_SHA256,
    unresolvedRequirementCount: credentialManifest.requirements.length,
    existingNativeDelegatedFederatedAuthReuseFirst: true,
    interactiveAuthPromptMaxPerProjectRun: 1,
    secondAuthPromptNormalPath: 0,
    partialAuthBindThenDiscoverMore: false
  };
  return Object.freeze({ ...body, AUTH_BIND_MANIFEST_SHA256: hash(body) });
}

export function evaluateAuthEndgameClosurePreflightV1(input = {}) {
  if (input.projectDevelopmentComplete !== true) return Object.freeze({ decision: "DEFER_AUTH_CONTINUE_DEVELOPMENT", interactiveBoundaryRequired: false, allowedPromptCount: 0 });
  const unresolved = Array.isArray(input.unresolvedRequirements) ? input.unresolvedRequirements.length : Number(input.unresolvedRequirementCount ?? 0);
  if (unresolved === 0) return Object.freeze({ decision: "READY_NO_INTERACTION", interactiveBoundaryRequired: false, allowedPromptCount: 0 });
  const used = Number.isSafeInteger(input.interactivePromptCount) ? input.interactivePromptCount : 0;
  if (used >= 1) return Object.freeze({ decision: "SECOND_AUTH_PROMPT_DENIED", interactiveBoundaryRequired: false, allowedPromptCount: 0 });
  return Object.freeze({ decision: "ONE_AGGREGATED_AUTH_BOUNDARY", interactiveBoundaryRequired: true, allowedPromptCount: 1 });
}

export function compileTransitiveLiveAuthDependencyClosureV1({ roots = [], dependencies = {} } = {}) {
  if (!Array.isArray(roots) || !isObject(dependencies)) throw new Error("AUTH_DEPENDENCY_GRAPH_REQUIRED");
  const visited = new Set();
  const queue = [...roots].sort();
  while (queue.length > 0) {
    const current = queue.shift();
    if (typeof current !== "string" || !current) throw new Error("AUTH_DEPENDENCY_ID_INVALID");
    if (visited.has(current)) continue;
    visited.add(current);
    const next = dependencies[current] ?? [];
    if (!Array.isArray(next)) throw new Error("AUTH_DEPENDENCY_EDGES_INVALID");
    for (const id of [...next].sort()) if (!visited.has(id)) queue.push(id);
  }
  return Object.freeze({ roots: [...roots].sort(), closure: [...visited].sort() });
}

export function compileAuthEndgameTransactionV1({ authManifest, closure, preflight } = {}) {
  if (!authManifest || authManifest.SCHEMA_ID !== "FINAL_AUTH_BIND_MANIFEST_V1") throw new Error("FINAL_AUTH_BIND_MANIFEST_REQUIRED");
  if (!closure || !Array.isArray(closure.closure)) throw new Error("AUTH_DEPENDENCY_CLOSURE_REQUIRED");
  if (!preflight || !["READY_NO_INTERACTION", "ONE_AGGREGATED_AUTH_BOUNDARY"].includes(preflight.decision)) throw new Error("AUTH_ENDGAME_PREFLIGHT_NOT_READY");
  const body = {
    SCHEMA_ID: "AUTH_ENDGAME_TRANSACTION_V1",
    SCHEMA_VERSION: "1",
    authBindManifestSha256: authManifest.AUTH_BIND_MANIFEST_SHA256,
    dependencyClosure: closure.closure,
    interactionMode: preflight.decision === "ONE_AGGREGATED_AUTH_BOUNDARY" ? "SINGLE_AGGREGATED_BOUNDARY" : "REUSE_EXISTING_AUTH",
    rawSecretChatPath: "DENY",
    secondPromptAllowed: false
  };
  return Object.freeze({ ...body, AUTH_ENDGAME_TRANSACTION_SHA256: hash(body) });
}
