import { createHash } from "node:crypto";

const SHA256_RE = /^[0-9a-f]{64}$/;
const PLAN_ROLES = new Set(["MASTER_PLAN", "PHASE_PLAN", "SPEC", "REFERENCE"]);

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function canonicalize(value) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("IDENTITY_PLAN_NON_SAFE_INTEGER");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  }
  throw new Error("IDENTITY_PLAN_UNSUPPORTED_CANONICAL_TYPE");
}

function digest(value) {
  return createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
}

function uniqueStrings(values, code) {
  if (values === undefined || values === null) return [];
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || value.length === 0)) throw new Error(code);
  return [...new Set(values)].sort();
}

function normalizeIdentity(candidate, source) {
  if (!isObject(candidate)) return null;
  const projectId = typeof candidate.projectId === "string" && candidate.projectId ? candidate.projectId : null;
  const manifestId = typeof candidate.projectIdentityManifestId === "string" && candidate.projectIdentityManifestId ? candidate.projectIdentityManifestId : null;
  const repositorySet = uniqueStrings(candidate.repositorySet, "IDENTITY_REPOSITORY_SET_INVALID");
  const hasEvidence = Array.isArray(candidate.identityEvidence) && candidate.identityEvidence.length > 0;
  const sufficient = !!projectId || (!!manifestId && hasEvidence) || (repositorySet.length > 0 && hasEvidence) || (source === "CURRENT_PROJECT_USER" && hasEvidence);
  if (!sufficient) return null;
  const body = {
    projectIdentityVersion: "1",
    projectId,
    projectSlugOrName: typeof candidate.projectSlugOrName === "string" ? candidate.projectSlugOrName : null,
    projectIdentityManifestId: manifestId,
    projectSpecificPlanId: typeof candidate.projectSpecificPlanId === "string" ? candidate.projectSpecificPlanId : null,
    repositorySet,
    primaryRepository: typeof candidate.primaryRepository === "string" && candidate.primaryRepository ? candidate.primaryRepository : null,
    workspaceRoots: uniqueStrings(candidate.workspaceRoots, "IDENTITY_WORKSPACE_ROOTS_INVALID"),
    providerTargetSet: uniqueStrings(candidate.providerTargetSet, "IDENTITY_PROVIDER_TARGET_SET_INVALID"),
    identityEvidence: Array.isArray(candidate.identityEvidence) ? candidate.identityEvidence : [],
    resolvedFrom: source
  };
  return Object.freeze({ ...body, projectIdentityDigest: digest(body) });
}

export function resolveCurrentProjectIdentityV1(input = {}) {
  const ordered = [
    [input.machineIdentity, "MACHINE_PROJECT_IDENTITY"],
    [input.projectLocalIdentity, "PROJECT_LOCAL_SOURCE"],
    [input.currentProjectUserIdentity, "CURRENT_PROJECT_USER"],
    [input.identityMatchedCheckpoint, "IDENTITY_MATCHED_CHECKPOINT"]
  ];
  for (const [candidate, source] of ordered) {
    const normalized = normalizeIdentity(candidate, source);
    if (normalized) return Object.freeze({ status: "RESOLVED", identity: normalized, rejectedAuthoritySources: ["GLOBAL_RECENT", "MEMORY", "PERSONAL_CONTEXT"] });
  }
  return Object.freeze({ status: "UNRESOLVED", identity: null, rejectedAuthoritySources: ["GLOBAL_RECENT", "MEMORY", "PERSONAL_CONTEXT"] });
}

export function assertProjectTargetMembershipV1(identity, target = {}) {
  if (!identity || !SHA256_RE.test(identity.projectIdentityDigest ?? "")) return Object.freeze({ allowed: false, code: "PROJECT_IDENTITY_UNRESOLVED" });
  if (target.repository !== undefined) {
    if (!identity.repositorySet.includes(target.repository)) return Object.freeze({ allowed: false, code: "TARGET_REPOSITORY_IDENTITY_MISMATCH" });
  }
  if (target.provider !== undefined && identity.providerTargetSet.length > 0) {
    if (!identity.providerTargetSet.includes(target.provider)) return Object.freeze({ allowed: false, code: "TARGET_PROVIDER_IDENTITY_MISMATCH" });
  }
  if (target.workspaceRoot !== undefined && identity.workspaceRoots.length > 0) {
    if (!identity.workspaceRoots.includes(target.workspaceRoot)) return Object.freeze({ allowed: false, code: "TARGET_WORKSPACE_IDENTITY_MISMATCH" });
  }
  return Object.freeze({ allowed: true, code: "TARGET_MEMBERSHIP_PASS" });
}

function normalizePlanRef(ref) {
  if (!isObject(ref)) throw new Error("PLAN_REF_INVALID");
  for (const key of ["planId", "exactTitleOrFilename", "projectLocalSourceRef", "version", "role"]) {
    if (typeof ref[key] !== "string" || !ref[key]) throw new Error(`PLAN_REF_${key.toUpperCase()}_REQUIRED`);
  }
  if (!PLAN_ROLES.has(ref.role)) throw new Error("PLAN_REF_ROLE_INVALID");
  if (ref.digest !== undefined && ref.digest !== null && !SHA256_RE.test(ref.digest)) throw new Error("PLAN_REF_DIGEST_INVALID");
  if (ref.precedence !== undefined && (!Number.isSafeInteger(ref.precedence) || ref.precedence < 0)) throw new Error("PLAN_REF_PRECEDENCE_INVALID");
  return {
    planId: ref.planId,
    exactTitleOrFilename: ref.exactTitleOrFilename,
    projectLocalSourceRef: ref.projectLocalSourceRef,
    version: ref.version,
    digest: ref.digest ?? null,
    role: ref.role,
    precedence: ref.precedence ?? null
  };
}

export function compileProjectSourceManifestV1(input = {}) {
  if (!SHA256_RE.test(input.projectIdentityDigest ?? "")) throw new Error("PROJECT_IDENTITY_DIGEST_REQUIRED");
  if (typeof input.sourceManifestId !== "string" || !input.sourceManifestId) throw new Error("SOURCE_MANIFEST_ID_REQUIRED");
  if (typeof input.sourceManifestVersion !== "string" || !input.sourceManifestVersion) throw new Error("SOURCE_MANIFEST_VERSION_REQUIRED");
  if (!Array.isArray(input.authoritativePlanRefs) || input.authoritativePlanRefs.length === 0) throw new Error("AUTHORITATIVE_PLAN_REFS_REQUIRED");
  const refs = input.authoritativePlanRefs.map(normalizePlanRef).sort((a, b) => {
    const ap = a.precedence ?? Number.MAX_SAFE_INTEGER;
    const bp = b.precedence ?? Number.MAX_SAFE_INTEGER;
    return ap - bp || a.planId.localeCompare(b.planId);
  });
  if (typeof input.activeMasterPlanId !== "string" || !input.activeMasterPlanId) throw new Error("ACTIVE_MASTER_PLAN_ID_REQUIRED");
  if (!refs.some((ref) => ref.planId === input.activeMasterPlanId && ref.role === "MASTER_PLAN")) throw new Error("ACTIVE_MASTER_PLAN_REF_MISSING");
  if (input.activePhasePlanId && !refs.some((ref) => ref.planId === input.activePhasePlanId && ref.role === "PHASE_PLAN")) throw new Error("ACTIVE_PHASE_PLAN_REF_MISSING");
  const body = {
    SCHEMA_ID: "PROJECT_SOURCE_MANIFEST_V1",
    SCHEMA_VERSION: "1",
    projectIdentityDigest: input.projectIdentityDigest,
    sourceManifestId: input.sourceManifestId,
    sourceManifestVersion: input.sourceManifestVersion,
    authoritativePlanRefs: refs,
    activeMasterPlanId: input.activeMasterPlanId,
    activePhasePlanId: input.activePhasePlanId ?? null,
    lastCheckpointId: input.lastCheckpointId ?? null,
    manifestEvidence: Array.isArray(input.manifestEvidence) ? input.manifestEvidence : []
  };
  return Object.freeze({ ...body, SOURCE_MANIFEST_SHA256: digest(body) });
}

export function validateProjectSourceManifestV1(manifest, projectIdentityDigest) {
  if (!isObject(manifest)) return Object.freeze({ ok: false, errors: ["SOURCE_MANIFEST_REQUIRED"] });
  const errors = [];
  if (manifest.SCHEMA_ID !== "PROJECT_SOURCE_MANIFEST_V1") errors.push("SOURCE_MANIFEST_SCHEMA_ID_MISMATCH");
  if (manifest.SCHEMA_VERSION !== "1") errors.push("SOURCE_MANIFEST_SCHEMA_VERSION_MISMATCH");
  if (manifest.projectIdentityDigest !== projectIdentityDigest) errors.push("SOURCE_MANIFEST_IDENTITY_MISMATCH");
  if (!SHA256_RE.test(manifest.SOURCE_MANIFEST_SHA256 ?? "")) errors.push("SOURCE_MANIFEST_SHA256_INVALID");
  else {
    const { SOURCE_MANIFEST_SHA256, ...body } = manifest;
    if (digest(body) !== SOURCE_MANIFEST_SHA256) errors.push("SOURCE_MANIFEST_SHA256_MISMATCH");
  }
  return Object.freeze({ ok: errors.length === 0, errors });
}

export function resolveAuthoritativePlanSetV1({ identity, manifest, availableProjectSources = [] } = {}) {
  const validation = validateProjectSourceManifestV1(manifest, identity?.projectIdentityDigest);
  if (!validation.ok) return Object.freeze({ status: "UNRESOLVED", errors: validation.errors, planRefs: [], missingSourceRefs: [] });
  const available = new Set(availableProjectSources.map((source) => typeof source === "string" ? source : source?.projectLocalSourceRef).filter(Boolean));
  const missingSourceRefs = manifest.authoritativePlanRefs.filter((ref) => !available.has(ref.projectLocalSourceRef)).map((ref) => ref.projectLocalSourceRef);
  return Object.freeze({
    status: missingSourceRefs.length === 0 ? "RESOLVED" : "MANIFEST_BOUND_SOURCE_REFRESH_REQUIRED",
    activeMasterPlanId: manifest.activeMasterPlanId,
    activePhasePlanId: manifest.activePhasePlanId,
    planRefs: manifest.authoritativePlanRefs,
    missingSourceRefs
  });
}
