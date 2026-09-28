import { createHash } from "node:crypto";

const SHA256_RE = /^[0-9a-f]{64}$/;
const REQUIRED_GATES = Object.freeze([
  "RUNTIME_HANDOFF_BIND",
  "PLAN_GRANT_COMPATIBILITY",
  "SOURCE_PROGRESS_RUNTIME_RESOLVER_COMPATIBILITY",
  "AUTH_RUNTIME_ELIGIBILITY_COMPATIBILITY",
  "MUTATION_AUTHORITY_RUNTIME_ENVELOPE_COMPATIBILITY",
  "CONTINUATION_RESPONSE_GATE_COMPATIBILITY",
  "PROVIDER_INTENT_RUNTIME_ADAPTER_COMPATIBILITY",
  "RECEIPT_EVIDENCE_COMPATIBILITY",
  "NEW_CHAT_REATTACH_COMPATIBILITY"
]);

function isObject(value) { return !!value && typeof value === "object" && !Array.isArray(value); }
function canonicalize(value) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("P52_D5_NON_SAFE_INTEGER");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  throw new Error("P52_D5_UNSUPPORTED_CANONICAL_TYPE");
}
const hash = (value) => createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
function requireSha(value, code) { if (!SHA256_RE.test(value ?? "")) throw new Error(code); return value; }

export function compilePiloteDependentConformanceV1(input = {}) {
  requireSha(input.runtimeDependencyLockSha256, "RUNTIME_DEPENDENCY_LOCK_SHA256_REQUIRED");
  requireSha(input.runtimeHandoffDigest, "RUNTIME_HANDOFF_DIGEST_REQUIRED");
  requireSha(input.runtimeInterfaceDigest, "RUNTIME_INTERFACE_DIGEST_REQUIRED");
  if (!Array.isArray(input.checks)) throw new Error("DEPENDENT_CONFORMANCE_CHECKS_REQUIRED");
  const map = new Map();
  for (const check of input.checks) {
    if (!isObject(check) || typeof check.id !== "string" || !check.id) throw new Error("DEPENDENT_CONFORMANCE_CHECK_INVALID");
    if (map.has(check.id)) throw new Error("DEPENDENT_CONFORMANCE_CHECK_DUPLICATE");
    map.set(check.id, { id: check.id, status: check.status ?? "PENDING", evidenceRef: check.evidenceRef ?? null });
  }
  const missingGates = REQUIRED_GATES.filter((id) => !map.has(id));
  const failedGates = [...map.values()].filter((check) => check.status !== "PASS").map((check) => check.id).sort();
  const runtimeSourceMutationCount = Number.isSafeInteger(input.runtimeSourceMutationCount) ? input.runtimeSourceMutationCount : -1;
  const providerSpecificLogicCount = Number.isSafeInteger(input.providerSpecificLogicCount) ? input.providerSpecificLogicCount : -1;
  const pass = missingGates.length === 0 && failedGates.length === 0 && runtimeSourceMutationCount === 0 && providerSpecificLogicCount === 0;
  const body = {
    SCHEMA_ID: "PILOTE_REV52_DEPENDENT_CONFORMANCE_V1",
    SCHEMA_VERSION: "1",
    runtimeDependencyLockSha256: input.runtimeDependencyLockSha256,
    runtimeHandoffDigest: input.runtimeHandoffDigest,
    runtimeInterfaceDigest: input.runtimeInterfaceDigest,
    checks: [...map.values()].sort((a, b) => a.id.localeCompare(b.id)),
    missingGates,
    failedGates,
    runtimeSourceMutationCount,
    providerSpecificLogicCount,
    credentialBoundLiveAcceptanceRequired: false,
    status: pass ? "PASS" : "FAIL"
  };
  return Object.freeze({ ...body, CONFORMANCE_SHA256: hash(body) });
}

export function evaluatePiloteDependentConformanceV1(receipt) {
  if (!receipt || receipt.SCHEMA_ID !== "PILOTE_REV52_DEPENDENT_CONFORMANCE_V1") throw new Error("PILOTE_DEPENDENT_CONFORMANCE_RECEIPT_REQUIRED");
  const { CONFORMANCE_SHA256, ...body } = receipt;
  const digestValid = SHA256_RE.test(CONFORMANCE_SHA256 ?? "") && hash(body) === CONFORMANCE_SHA256;
  return Object.freeze({
    pass: digestValid && receipt.status === "PASS" && receipt.runtimeSourceMutationCount === 0 && receipt.providerSpecificLogicCount === 0,
    digestValid,
    missingGates: receipt.missingGates,
    failedGates: receipt.failedGates,
    runtimeSourceMutationCount: receipt.runtimeSourceMutationCount,
    providerSpecificLogicCount: receipt.providerSpecificLogicCount
  });
}

export { REQUIRED_GATES as PILOTE_REV52_REQUIRED_CONFORMANCE_GATES };
