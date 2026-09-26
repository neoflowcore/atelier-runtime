import { createHash } from "node:crypto";

const SHA256_RE = /^[0-9a-f]{64}$/;
const SHA_RE = /^[0-9a-f]{40,64}$/;

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function canonicalize(value) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("FREEZE_NON_SAFE_INTEGER");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  throw new Error("FREEZE_UNSUPPORTED_CANONICAL_TYPE");
}

function hash(value) {
  return createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
}

function requireSha256(value, code) {
  if (!SHA256_RE.test(value ?? "")) throw new Error(code);
  return value;
}

function requireString(value, code) {
  if (typeof value !== "string" || !value) throw new Error(code);
  return value;
}

function normalizeModule(item) {
  if (!isObject(item)) throw new Error("PROMOTED_MODULE_INVALID");
  return {
    path: requireString(item.path, "PROMOTED_MODULE_PATH_REQUIRED"),
    sha256: requireSha256(item.sha256, "PROMOTED_MODULE_SHA256_REQUIRED")
  };
}

export function compilePromotedRuntimeContractSetV1(modules = []) {
  if (!Array.isArray(modules) || modules.length === 0) throw new Error("PROMOTED_RUNTIME_MODULES_REQUIRED");
  const normalized = modules.map(normalizeModule).sort((a, b) => a.path.localeCompare(b.path));
  const paths = new Set();
  for (const item of normalized) {
    if (paths.has(item.path)) throw new Error("PROMOTED_MODULE_PATH_DUPLICATE");
    paths.add(item.path);
  }
  const body = {
    CONTRACT_SET_ID: "R51_V022_PROMOTED_RUNTIME_CONTRACT_SET_V1",
    CONTRACT_SET_VERSION: "1",
    modules: normalized
  };
  return Object.freeze({ ...body, CONTRACT_SET_SHA256: hash(body) });
}

export function compileRuntimeInterfaceIdentityV1(input = {}) {
  const baseline = input.legacyInterfaceBaseline;
  if (!isObject(baseline)) throw new Error("LEGACY_INTERFACE_BASELINE_REQUIRED");
  if (baseline.INTERFACE_VERSION !== "1.0.0") throw new Error("LEGACY_INTERFACE_VERSION_MISMATCH");
  if (baseline.FROZEN_FIELDS !== 27) throw new Error("LEGACY_FROZEN_FIELD_COUNT_MISMATCH");
  const body = {
    SCHEMA_ID: "R51_RUNTIME_INTERFACE_IDENTITY_V1",
    SCHEMA_VERSION: "1",
    LEGACY_INTERFACE_VERSION: baseline.INTERFACE_VERSION,
    LEGACY_INTERFACE_MANIFEST_SHA256: requireSha256(baseline.INTERFACE_MANIFEST_SHA256, "LEGACY_INTERFACE_MANIFEST_SHA256_REQUIRED"),
    LEGACY_TASK_CONTRACT_SCHEMA_SHA256: requireSha256(baseline.TASK_CONTRACT_SCHEMA_SHA256, "LEGACY_TASK_CONTRACT_SCHEMA_SHA256_REQUIRED"),
    LEGACY_TASK_CONTRACT_MACHINE_SCHEMA_SHA256: requireSha256(baseline.TASK_CONTRACT_MACHINE_SCHEMA_SHA256, "LEGACY_TASK_CONTRACT_MACHINE_SCHEMA_SHA256_REQUIRED"),
    LEGACY_FROZEN_FIELDS: baseline.FROZEN_FIELDS,
    TASK_CONTRACT_V1_MUTATION: baseline.TASK_CONTRACT_V1_MUTATION ?? 0,
    INTERFACE_V1_MUTATION: baseline.INTERFACE_V1_MUTATION ?? 0,
    PROMOTED_RUNTIME_CONTRACT_SET_SHA256: requireSha256(input.promotedContractSetSha256, "PROMOTED_CONTRACT_SET_SHA256_REQUIRED"),
    SEMANTIC_OWNERSHIP: "LEGACY_INTERFACE_REMAINS_FROZEN_RUNTIME_ADDS_EXECUTION_CONTROL_CONTRACTS_ONLY"
  };
  if (body.TASK_CONTRACT_V1_MUTATION !== 0) throw new Error("TASK_CONTRACT_V1_MUTATION_DENIED");
  if (body.INTERFACE_V1_MUTATION !== 0) throw new Error("INTERFACE_V1_MUTATION_DENIED");
  return Object.freeze({ ...body, RUNTIME_INTERFACE_IDENTITY_SHA256: hash(body) });
}

export function compileRuntimeCompatibilityIdentityV1(input = {}) {
  const profiles = input.compatProfiles;
  if (!Array.isArray(profiles) || profiles.length === 0) throw new Error("COMPAT_PROFILES_REQUIRED");
  const normalizedProfiles = profiles.map((item) => ({
    id: requireString(item.id, "COMPAT_PROFILE_ID_REQUIRED"),
    sha256: requireSha256(item.sha256, "COMPAT_PROFILE_SHA256_REQUIRED"),
    status: item.status ?? "ACTIVE"
  })).sort((a, b) => a.id.localeCompare(b.id));
  if (normalizedProfiles.some((item) => item.status !== "ACTIVE")) throw new Error("COMPAT_PROFILE_NOT_ACTIVE");
  const body = {
    SCHEMA_ID: "R51_RUNTIME_COMPATIBILITY_IDENTITY_V1",
    SCHEMA_VERSION: "1",
    RUNTIME_INTERFACE_IDENTITY_SHA256: requireSha256(input.runtimeInterfaceIdentitySha256, "RUNTIME_INTERFACE_IDENTITY_SHA256_REQUIRED"),
    LEGACY_COMPATIBILITY_ARTIFACT_SHA256: requireSha256(input.legacyCompatibilityArtifactSha256, "LEGACY_COMPATIBILITY_ARTIFACT_SHA256_REQUIRED"),
    COMPAT_PROFILES: normalizedProfiles,
    REV42_RUNTIME51: "SUPPORTED",
    REV45_RUNTIME51: "SUPPORTED",
    REV50_RUNTIME51: "SUPPORTED",
    REV51_NATIVE: "SUPPORTED",
    SEMANTIC_REINTERPRETATION: "DENY",
    LEGACY_REQUIRED_FIELD_ADDITION: "DENY",
    RUNTIME_DEFINED_EQUIVALENCE: "DENY"
  };
  return Object.freeze({ ...body, RUNTIME_COMPATIBILITY_IDENTITY_SHA256: hash(body) });
}

export function validateCanonicalCiEvidenceV1(evidence = {}) {
  const errors = [];
  if (!SHA_RE.test(evidence.head ?? "")) errors.push("CI_HEAD_INVALID");
  if (!SHA_RE.test(evidence.tree ?? "")) errors.push("CI_TREE_INVALID");
  if (!Number.isSafeInteger(evidence.runId) || evidence.runId <= 0) errors.push("CI_RUN_ID_INVALID");
  if (!Number.isSafeInteger(evidence.jobId) || evidence.jobId <= 0) errors.push("CI_JOB_ID_INVALID");
  if (evidence.conclusion !== "success") errors.push("CI_CONCLUSION_NOT_SUCCESS");
  if (!Number.isSafeInteger(evidence.observedTests) || evidence.observedTests <= 0) errors.push("CI_TEST_COUNT_INVALID");
  if (evidence.fail !== 0) errors.push("CI_FUNCTIONAL_FAILURES_PRESENT");
  if (evidence.releaseGate !== "PASS") errors.push("CI_RELEASE_GATE_NOT_PASS");
  if (evidence.rerun !== 0) errors.push("CI_RERUN_NONZERO");
  if (evidence.workflowDispatch !== 0) errors.push("CI_WORKFLOW_DISPATCH_NONZERO");
  return Object.freeze({ ok: errors.length === 0, errors });
}

export function evaluateRuntimeInterfaceFreezeV1(input = {}) {
  const ci = validateCanonicalCiEvidenceV1(input.canonicalCi);
  const errors = [...ci.errors];
  if (!SHA256_RE.test(input.runtimeInterfaceIdentitySha256 ?? "")) errors.push("RUNTIME_INTERFACE_IDENTITY_REQUIRED");
  if (!SHA256_RE.test(input.runtimeCompatibilityIdentitySha256 ?? "")) errors.push("RUNTIME_COMPATIBILITY_IDENTITY_REQUIRED");
  if (input.promotionCoverageComplete !== true) errors.push("PROMOTION_COVERAGE_INCOMPLETE");
  if (input.credentialIndependentGatesComplete !== true) errors.push("CREDENTIAL_INDEPENDENT_GATES_INCOMPLETE");
  if (input.unexpectedBillableResidue !== 0) errors.push("UNEXPECTED_BILLABLE_RESIDUE_PRESENT");
  const interfaceFreeze = errors.length === 0 ? "PASS" : "DENY";
  const projectDevelopmentComplete = interfaceFreeze === "PASS" && input.remainingCredentialIndependentRequiredWork === 0;
  const deferredAuth = Array.isArray(input.deferredGlobalAuthEndgame) ? [...new Set(input.deferredGlobalAuthEndgame)].sort() : [];
  const globalAuthEndgameTrigger = projectDevelopmentComplete && deferredAuth.length > 0;
  const runtimeDevelopmentSeal = interfaceFreeze !== "PASS"
    ? "DENY"
    : globalAuthEndgameTrigger
      ? "PENDING_GLOBAL_AUTH_ENDGAME"
      : "PASS";
  return Object.freeze({
    interfaceFreeze,
    projectDevelopmentComplete,
    globalAuthEndgameTrigger,
    runtimeDevelopmentSeal,
    deferredGlobalAuthEndgame: deferredAuth,
    errors
  });
}
