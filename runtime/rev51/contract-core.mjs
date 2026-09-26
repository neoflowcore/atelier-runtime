import { createHash } from "node:crypto";

export const REV51_INTERFACE_VERSION = "1.0.0";
export const REV51_INTERFACE_MANIFEST_SHA256 = "90b016211babd4f10b7de7700c54ea6e2db9179563d88502fc1d9983ad47b617";
export const REV51_TASK_CONTRACT_SCHEMA_SHA256 = "6afcf7aa1b7d3d73b28d6195326db22c82774de308664ce85ba52e42fba640e8";
export const REV51_TASK_CONTRACT_MACHINE_SCHEMA_SHA256 = "3bdbb85a7879c8cee2c7eb2f18c3936fac7a44389ec0ae61f0954b9c19660b65";
export const REV51_FROZEN_TASK_FIELD_COUNT = 27;

export const REV51_CONTRACT_LAYERS = Object.freeze([
  Object.freeze({ id: "TASK_CONTRACT_V1", owner: "CROSS_STACK_FROZEN", version: "1.0.0" }),
  Object.freeze({ id: "PILOTE_EXECUTION_INTENT_V1", owner: "PILOTE", version: "1" }),
  Object.freeze({ id: "RUNTIME_EXECUTION_PLAN_V1", owner: "RUNTIME", version: "1" }),
  Object.freeze({ id: "WORKER_JOB_V1", owner: "RUNTIME", version: "1" }),
  Object.freeze({ id: "EXECUTION_RECEIPT_V1", owner: "RUNTIME", version: "1" })
]);

export const COMPUTE_PROVIDERS = Object.freeze(["LOCAL", "VMWARE", "DIGITALOCEAN"]);
export const EXECUTION_TRANSPORTS = Object.freeze(["DIRECT_WORKER", "GITHUB_SELF_HOSTED_JIT"]);
export const VERIFIER_POLICIES = Object.freeze(["RUNTIME_REQUIRED", "PROJECT_CI_REQUIRED", "RUNTIME_PLUS_PROJECT_CI"]);
export const INPUT_MODES = Object.freeze(["LEGACY_COMPAT", "NATIVE_REV51"]);

const SHA256_RE = /^[0-9a-f]{64}$/;

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function jcs(value) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("REV51_JCS_NON_SAFE_INTEGER");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(jcs).join(",")}]`;
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${jcs(value[key])}`).join(",")}}`;
  }
  throw new Error("REV51_JCS_UNSUPPORTED_TYPE");
}

export function canonicalizeRev51Object(value) {
  return jcs(value);
}

export function computeRev51ObjectHash(value) {
  if (!isPlainObject(value)) throw new Error("REV51_OBJECT_NOT_OBJECT");
  const payload = { ...value };
  delete payload.OBJECT_SHA256;
  return createHash("sha256").update(jcs(payload), "utf8").digest("hex");
}

export function validateRev5FrozenBaseline(binding) {
  const errors = [];
  if (!isPlainObject(binding)) return { ok: false, errors: ["BASELINE_NOT_OBJECT"] };
  if (binding.INTERFACE_VERSION !== REV51_INTERFACE_VERSION) errors.push("INTERFACE_VERSION_MISMATCH");
  if (binding.INTERFACE_MANIFEST_SHA256 !== REV51_INTERFACE_MANIFEST_SHA256) errors.push("INTERFACE_MANIFEST_MISMATCH");
  if (binding.TASK_CONTRACT_SCHEMA_SHA256 !== REV51_TASK_CONTRACT_SCHEMA_SHA256) errors.push("TASK_CONTRACT_SCHEMA_MISMATCH");
  if (binding.TASK_CONTRACT_MACHINE_SCHEMA_SHA256 !== REV51_TASK_CONTRACT_MACHINE_SCHEMA_SHA256) errors.push("TASK_CONTRACT_MACHINE_SCHEMA_MISMATCH");
  if (binding.FROZEN_FIELDS !== REV51_FROZEN_TASK_FIELD_COUNT) errors.push("FROZEN_FIELD_COUNT_MISMATCH");
  if (binding.TASK_CONTRACT_V1_MUTATION !== 0) errors.push("TASK_CONTRACT_V1_MUTATED");
  if (binding.INTERFACE_V1_MUTATION !== 0) errors.push("INTERFACE_V1_MUTATED");
  return { ok: errors.length === 0, errors };
}

export function validateContractEnvelope(envelope, expected = {}) {
  const errors = [];
  if (!isPlainObject(envelope)) return { ok: false, errors: ["ENVELOPE_NOT_OBJECT"] };
  for (const key of ["SCHEMA_ID", "SCHEMA_VERSION", "CANONICALIZATION_ID", "UPSTREAM_OBJECT_SHA256", "OBJECT_SHA256"]) {
    if (typeof envelope[key] !== "string" || envelope[key].length === 0) errors.push(`MISSING_OR_INVALID:${key}`);
  }
  if (!SHA256_RE.test(envelope.UPSTREAM_OBJECT_SHA256 ?? "")) errors.push("INVALID_UPSTREAM_OBJECT_SHA256");
  if (!SHA256_RE.test(envelope.OBJECT_SHA256 ?? "")) errors.push("INVALID_OBJECT_SHA256");
  if (expected.schemaId && envelope.SCHEMA_ID !== expected.schemaId) errors.push("SCHEMA_ID_MISMATCH");
  if (expected.schemaVersion && envelope.SCHEMA_VERSION !== expected.schemaVersion) errors.push("SCHEMA_VERSION_MISMATCH");
  if (expected.canonicalizationId && envelope.CANONICALIZATION_ID !== expected.canonicalizationId) errors.push("CANONICALIZATION_ID_MISMATCH");
  if (expected.upstreamObjectSha256 && envelope.UPSTREAM_OBJECT_SHA256 !== expected.upstreamObjectSha256) errors.push("UPSTREAM_OBJECT_SHA256_MISMATCH");
  if (SHA256_RE.test(envelope.OBJECT_SHA256 ?? "") && computeRev51ObjectHash(envelope) !== envelope.OBJECT_SHA256) errors.push("OBJECT_SHA256_MISMATCH");
  return { ok: errors.length === 0, errors };
}

export function validateExecutionAxes(value) {
  const errors = [];
  if (!isPlainObject(value)) return { ok: false, errors: ["EXECUTION_AXES_NOT_OBJECT"] };
  if (!COMPUTE_PROVIDERS.includes(value.COMPUTE_PROVIDER)) errors.push("UNSUPPORTED_COMPUTE_PROVIDER");
  if (!EXECUTION_TRANSPORTS.includes(value.EXECUTION_TRANSPORT)) errors.push("UNSUPPORTED_EXECUTION_TRANSPORT");
  if (!VERIFIER_POLICIES.includes(value.VERIFIER_POLICY)) errors.push("UNSUPPORTED_VERIFIER_POLICY");
  if (value.COMPUTE_PROVIDER === "GITHUB_SELF_HOSTED_JIT") errors.push("TRANSPORT_MISCLASSIFIED_AS_COMPUTE_PROVIDER");
  return { ok: errors.length === 0, errors };
}

export function validateExecutionInputMode(value) {
  const errors = [];
  if (!isPlainObject(value)) return { ok: false, errors: ["INPUT_MODE_NOT_OBJECT"] };
  if (!INPUT_MODES.includes(value.INPUT_MODE)) errors.push("UNSUPPORTED_INPUT_MODE");
  const hasLegacyProfile = typeof value.COMPAT_PROFILE_SHA256 === "string" && SHA256_RE.test(value.COMPAT_PROFILE_SHA256);
  const hasNativeIntent = typeof value.EXECUTION_INTENT_SHA256 === "string" && SHA256_RE.test(value.EXECUTION_INTENT_SHA256);
  if (value.INPUT_MODE === "LEGACY_COMPAT") {
    if (!hasLegacyProfile) errors.push("LEGACY_PROFILE_REQUIRED");
    if (hasNativeIntent) errors.push("LEGACY_TO_REV51_INTENT_SYNTHESIS_DENY");
  }
  if (value.INPUT_MODE === "NATIVE_REV51") {
    if (!hasNativeIntent) errors.push("NATIVE_EXECUTION_INTENT_REQUIRED");
    if (hasLegacyProfile) errors.push("REV51_TO_LEGACY_DOWNGRADE_DENY");
  }
  return { ok: errors.length === 0, errors };
}
