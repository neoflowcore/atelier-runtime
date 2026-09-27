import { createHash } from "node:crypto";
import { validateTaskContractV1 } from "../task-contract-v1.mjs";

export const EXECUTION_ENVIRONMENT_CONTRACT_SCHEMA_ID = "EXECUTION_ENVIRONMENT_CONTRACT_V1";
export const CAPABILITY_REQUIREMENT_SET_SCHEMA_ID = "CAPABILITY_REQUIREMENT_SET_V1";
const SHA256_RE = /^[0-9a-f]{64}$/;
const TOKEN_RE = /^[A-Z][A-Z0-9_.-]{0,63}$/;
const VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,63}$/;
const REGISTRY_RE = /^[a-z][a-z0-9+.-]*:\/\/[^\s]+$/;

function object(value) { return !!value && typeof value === "object" && !Array.isArray(value); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function canonicalize(value) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("CAPABILITY_RESOLVER_NON_SAFE_INTEGER");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (object(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  throw new Error("CAPABILITY_RESOLVER_UNSUPPORTED_CANONICAL_TYPE");
}
function hash(value) { return createHash("sha256").update(canonicalize(value), "utf8").digest("hex"); }
function stringOrNull(value, code, pattern = null) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.length === 0 || (pattern && !pattern.test(value))) throw new Error(code);
  return value;
}
function uniqueSortedStrings(value, code, pattern = null) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0 || (pattern && !pattern.test(item)))) throw new Error(code);
  const sorted = [...new Set(value)].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  if (sorted.length !== value.length) throw new Error(`${code}_DUPLICATE`);
  return sorted;
}
function validateOverlay(overlay) {
  if (overlay === undefined || overlay === null) return {
    LANGUAGE_RUNTIME: null,
    RUNTIME_VERSION: null,
    PACKAGE_MANAGER: null,
    PACKAGE_MANAGER_VERSION: null,
    LIBC_CLASS: "ANY",
    CONTAINER_IMAGE_DIGEST: null,
    REGISTRIES: [],
    MIN_DISK_MIB: 0,
    MIN_MEMORY_MIB: 0,
    REQUIRED_PROVIDER_CAPABILITIES: []
  };
  if (!object(overlay)) throw new Error("EXECUTION_ENVIRONMENT_OVERLAY_REQUIRED_OBJECT");
  const allowed = new Set(["LANGUAGE_RUNTIME","RUNTIME_VERSION","PACKAGE_MANAGER","PACKAGE_MANAGER_VERSION","LIBC_CLASS","CONTAINER_IMAGE_DIGEST","REGISTRIES","MIN_DISK_MIB","MIN_MEMORY_MIB","REQUIRED_PROVIDER_CAPABILITIES"]);
  for (const key of Object.keys(overlay)) if (!allowed.has(key)) throw new Error(`EXECUTION_ENVIRONMENT_OVERLAY_UNKNOWN_FIELD:${key}`);
  const libc = overlay.LIBC_CLASS ?? "ANY";
  if (!new Set(["ANY","GLIBC","MUSL","MSVCRT","DARWIN"]).has(libc)) throw new Error("EXECUTION_ENVIRONMENT_LIBC_CLASS_INVALID");
  for (const key of ["MIN_DISK_MIB","MIN_MEMORY_MIB"]) {
    if (overlay[key] !== undefined && (!Number.isSafeInteger(overlay[key]) || overlay[key] < 0)) throw new Error(`EXECUTION_ENVIRONMENT_${key}_INVALID`);
  }
  const digest = overlay.CONTAINER_IMAGE_DIGEST ?? null;
  if (digest !== null && !/^sha256:[0-9a-f]{64}$/.test(digest)) throw new Error("EXECUTION_ENVIRONMENT_CONTAINER_DIGEST_INVALID");
  return {
    LANGUAGE_RUNTIME: stringOrNull(overlay.LANGUAGE_RUNTIME, "EXECUTION_ENVIRONMENT_LANGUAGE_RUNTIME_INVALID", TOKEN_RE),
    RUNTIME_VERSION: stringOrNull(overlay.RUNTIME_VERSION, "EXECUTION_ENVIRONMENT_RUNTIME_VERSION_INVALID", VERSION_RE),
    PACKAGE_MANAGER: stringOrNull(overlay.PACKAGE_MANAGER, "EXECUTION_ENVIRONMENT_PACKAGE_MANAGER_INVALID", TOKEN_RE),
    PACKAGE_MANAGER_VERSION: stringOrNull(overlay.PACKAGE_MANAGER_VERSION, "EXECUTION_ENVIRONMENT_PACKAGE_MANAGER_VERSION_INVALID", VERSION_RE),
    LIBC_CLASS: libc,
    CONTAINER_IMAGE_DIGEST: digest,
    REGISTRIES: uniqueSortedStrings(overlay.REGISTRIES ?? [], "EXECUTION_ENVIRONMENT_REGISTRIES_INVALID", REGISTRY_RE),
    MIN_DISK_MIB: overlay.MIN_DISK_MIB ?? 0,
    MIN_MEMORY_MIB: overlay.MIN_MEMORY_MIB ?? 0,
    REQUIRED_PROVIDER_CAPABILITIES: uniqueSortedStrings(overlay.REQUIRED_PROVIDER_CAPABILITIES ?? [], "EXECUTION_ENVIRONMENT_REQUIRED_PROVIDER_CAPABILITIES_INVALID", TOKEN_RE)
  };
}

export function compileExecutionEnvironmentContractV1(taskContract, overlay = null) {
  const validated = validateTaskContractV1(taskContract);
  if (!validated.ok) throw new Error(`TASK_CONTRACT_INVALID:${validated.errors.join("|")}`);
  if (!SHA256_RE.test(taskContract.TASK_CONTRACT_HASH ?? "")) throw new Error("TASK_CONTRACT_HASH_INVALID");
  const extra = validateOverlay(overlay);
  const taskCapabilities = uniqueSortedStrings(taskContract.CAPABILITY_REQUIREMENTS, "TASK_CAPABILITY_REQUIREMENTS_INVALID", TOKEN_RE);
  const requiredCapabilities = uniqueSortedStrings([...new Set([...taskCapabilities, ...extra.REQUIRED_PROVIDER_CAPABILITIES])], "CAPABILITY_REQUIREMENTS_INVALID", TOKEN_RE);
  const body = {
    SCHEMA_ID: EXECUTION_ENVIRONMENT_CONTRACT_SCHEMA_ID,
    SCHEMA_VERSION: "1",
    TASK_CONTRACT_SHA256: taskContract.TASK_CONTRACT_HASH,
    EXECUTION_CLASS: taskContract.RESOURCE_REQUIREMENTS.EXECUTION_CLASS,
    OS_CLASS: taskContract.RESOURCE_REQUIREMENTS.OS_CLASS,
    ARCH_CLASS: taskContract.RESOURCE_REQUIREMENTS.ARCH_CLASS,
    WORKSPACE_CLASS: taskContract.RESOURCE_REQUIREMENTS.WORKSPACE_CLASS,
    NETWORK_CLASS: taskContract.NETWORK_CLASS,
    DATA_ACCESS_CLASS: taskContract.DATA_ACCESS_CLASS,
    SECRET_CLASS: taskContract.SECRET_CLASS,
    LANGUAGE_RUNTIME: extra.LANGUAGE_RUNTIME,
    RUNTIME_VERSION: extra.RUNTIME_VERSION,
    PACKAGE_MANAGER: extra.PACKAGE_MANAGER,
    PACKAGE_MANAGER_VERSION: extra.PACKAGE_MANAGER_VERSION,
    LIBC_CLASS: extra.LIBC_CLASS,
    CONTAINER_IMAGE_DIGEST: extra.CONTAINER_IMAGE_DIGEST,
    REGISTRIES: extra.REGISTRIES,
    MIN_DISK_MIB: extra.MIN_DISK_MIB,
    MIN_MEMORY_MIB: extra.MIN_MEMORY_MIB,
    TASK_CAPABILITIES: taskCapabilities,
    REQUIRED_CAPABILITIES: requiredCapabilities
  };
  return Object.freeze({ ...body, CONTRACT_SHA256: hash(body) });
}

export function resolveRequiredCapabilitiesV1(environmentContract) {
  if (!object(environmentContract) || environmentContract.SCHEMA_ID !== EXECUTION_ENVIRONMENT_CONTRACT_SCHEMA_ID) throw new Error("EXECUTION_ENVIRONMENT_CONTRACT_REQUIRED");
  if (!SHA256_RE.test(environmentContract.CONTRACT_SHA256 ?? "")) throw new Error("EXECUTION_ENVIRONMENT_CONTRACT_SHA256_INVALID");
  const { CONTRACT_SHA256, ...body } = environmentContract;
  if (hash(body) !== CONTRACT_SHA256) throw new Error("EXECUTION_ENVIRONMENT_CONTRACT_SHA256_MISMATCH");
  const requirements = uniqueSortedStrings(environmentContract.REQUIRED_CAPABILITIES, "CAPABILITY_REQUIREMENTS_INVALID", TOKEN_RE);
  const result = {
    SCHEMA_ID: CAPABILITY_REQUIREMENT_SET_SCHEMA_ID,
    SCHEMA_VERSION: "1",
    TASK_CONTRACT_SHA256: environmentContract.TASK_CONTRACT_SHA256,
    EXECUTION_ENVIRONMENT_CONTRACT_SHA256: environmentContract.CONTRACT_SHA256,
    TASK_CAPABILITIES: uniqueSortedStrings(environmentContract.TASK_CAPABILITIES, "TASK_CAPABILITY_REQUIREMENTS_INVALID", TOKEN_RE),
    REQUIRED_CAPABILITIES: requirements,
    OS_CLASS: environmentContract.OS_CLASS,
    ARCH_CLASS: environmentContract.ARCH_CLASS,
    WORKSPACE_CLASS: environmentContract.WORKSPACE_CLASS,
    NETWORK_CLASS: environmentContract.NETWORK_CLASS,
    DATA_ACCESS_CLASS: environmentContract.DATA_ACCESS_CLASS,
    SECRET_CLASS: environmentContract.SECRET_CLASS,
    LANGUAGE_RUNTIME: environmentContract.LANGUAGE_RUNTIME,
    RUNTIME_VERSION: environmentContract.RUNTIME_VERSION,
    PACKAGE_MANAGER: environmentContract.PACKAGE_MANAGER,
    PACKAGE_MANAGER_VERSION: environmentContract.PACKAGE_MANAGER_VERSION,
    LIBC_CLASS: environmentContract.LIBC_CLASS,
    CONTAINER_IMAGE_DIGEST: environmentContract.CONTAINER_IMAGE_DIGEST,
    REGISTRIES: clone(environmentContract.REGISTRIES),
    MIN_DISK_MIB: environmentContract.MIN_DISK_MIB,
    MIN_MEMORY_MIB: environmentContract.MIN_MEMORY_MIB
  };
  return Object.freeze({ ...result, REQUIRED_CAPABILITIES_SHA256: hash(result) });
}

export function computeCapabilityResolverObjectSha256V1(value) { return hash(value); }
