import { createHash } from "node:crypto";

export const INTERFACE_VERSION = "1.0.0";
export const INTERFACE_MANIFEST_SHA256 = "90b016211babd4f10b7de7700c54ea6e2db9179563d88502fc1d9983ad47b617";
export const TASK_CONTRACT_SCHEMA_SHA256 = "6afcf7aa1b7d3d73b28d6195326db22c82774de308664ce85ba52e42fba640e8";
export const TASK_CONTRACT_MACHINE_SCHEMA_SHA256 = "3bdbb85a7879c8cee2c7eb2f18c3936fac7a44389ec0ae61f0954b9c19660b65";

export const FROZEN_TASK_CONTRACT_FIELDS = Object.freeze([
  "TASK_ID",
  "PROJECT_ID",
  "PHASE_ID",
  "TASK_CLASS",
  "WORKLOAD_CLASS",
  "SOURCE_IDENTITY",
  "EXPECTED_HEAD",
  "EFFECT_CLASSES",
  "ALLOWED_SCOPE",
  "TOUCH_SET",
  "CAPABILITY_REQUIREMENTS",
  "RESOURCE_REQUIREMENTS",
  "NETWORK_CLASS",
  "DATA_ACCESS_CLASS",
  "SECRET_CLASS",
  "REMOTE_MUTATION_INTENT",
  "HOST_OPERATION_INTENT",
  "ORACLE_REQUIREMENT",
  "ACCEPTANCE_REQUIREMENTS",
  "VERIFIER_REQUIREMENTS",
  "ECONOMY_BUDGET",
  "INTERVENTION_POLICY",
  "REPLAN_BOUNDARY",
  "EXPECTED_OUTPUTS",
  "EXPECTED_EVIDENCE",
  "CONTRACT_VERSION",
  "TASK_CONTRACT_HASH"
]);

const EFFECT_CLASSES = new Set([
  "READ_ONLY",
  "LOCAL_COMPUTE",
  "LOCAL_WORKSPACE_WRITE",
  "REMOTE_SOURCE_WRITE",
  "REMOTE_PROVIDER_MUTATION",
  "MERGE_OR_TAG",
  "PRODUCTION_CHANGE",
  "HOST_PRIVILEGED_CHANGE",
  "EXTERNAL_ORACLE"
]);
const CAPABILITIES = new Set([
  "SOURCE_READ",
  "FILESYSTEM_READ",
  "FILESYSTEM_WRITE",
  "PROCESS_EXEC",
  "NETWORK_EGRESS",
  "PROVIDER_API_READ",
  "PROVIDER_API_MUTATE",
  "GIT_CANDIDATE_WRITE",
  "BROWSER_AUTOMATION",
  "HUMAN_ORACLE",
  "DEVICE_ORACLE",
  "HOST_PRIVILEGED"
]);
const SOURCE_KINDS = new Set(["GIT", "ARTIFACT", "BUNDLE", "OPAQUE", "NONE"]);
const EXECUTION_CLASSES = new Set(["RUNTIME_DEFAULT", "HOSTED_ELIGIBLE", "SELF_HOSTED_REQUIRED", "HOST_LOCAL_REQUIRED"]);
const OS_CLASSES = new Set(["ANY", "LINUX", "WINDOWS", "MACOS"]);
const ARCH_CLASSES = new Set(["ANY", "X64", "ARM64"]);
const WORKSPACE_CLASSES = new Set(["NONE", "READ_ONLY", "ISOLATED_WRITABLE"]);
const NETWORK_CLASSES = new Set(["NONE", "LOOPBACK_ONLY", "ALLOWLIST_READ", "ALLOWLIST_MUTATE"]);
const DATA_ACCESS_CLASSES = new Set(["PUBLIC", "PROJECT_INTERNAL", "PRIVATE_SOURCE", "PRODUCTION"]);
const SECRET_CLASSES = new Set(["NONE", "SOURCE_READ", "SOURCE_WRITE", "PROVIDER_MUTATION", "PRODUCTION_CONTROL"]);
const MUTATION_INTENTS = new Set(["NONE", "DECLARED", "EXACT_APPROVAL_REQUIRED"]);
const ORACLE_REQUIREMENTS = new Set(["NONE", "OPTIONAL", "REQUIRED"]);
const TOUCH_OPERATIONS = new Set(["READ", "CREATE", "UPDATE", "DELETE", "MOVE"]);

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const TOKEN_RE = /^[A-Z][A-Z0-9_.-]{0,63}$/;
const SHA40_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const IMMUTABLE_DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const SCOPE_RE = /^[a-z][a-z0-9_-]{0,31}:[^\s]+$/;
const TOUCH_PATH_RE = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\\).+$/;

function codePointLength(value) {
  return Array.from(value).length;
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  return JSON.stringify(actual) === JSON.stringify(required);
}

function exactKeysAllowing(value, required, optional = []) {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => keys.includes(key)) && keys.every((key) => allowed.has(key));
}

function isNfc(value) {
  return value.normalize("NFC") === value;
}

function walkStrings(value, visit) {
  if (typeof value === "string") {
    visit(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) walkStrings(item, visit);
    return;
  }
  if (isPlainObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      visit(key);
      walkStrings(item, visit);
    }
  }
}

function utf8Compare(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function isStrictlyAscendingUtf8(values) {
  for (let index = 1; index < values.length; index += 1) {
    if (utf8Compare(values[index - 1], values[index]) >= 0) return false;
  }
  return true;
}

function touchSortKey(item) {
  return [item.PATH, item.OPERATION, item.FROM_PATH ?? ""];
}

function compareTouch(left, right) {
  const a = touchSortKey(left);
  const b = touchSortKey(right);
  for (let index = 0; index < a.length; index += 1) {
    const comparison = utf8Compare(a[index], b[index]);
    if (comparison !== 0) return comparison;
  }
  return 0;
}

function isStrictlyAscendingTouch(values) {
  for (let index = 1; index < values.length; index += 1) {
    if (compareTouch(values[index - 1], values[index]) >= 0) return false;
  }
  return true;
}

function validateId(errors, field, value) {
  if (typeof value !== "string" || !ID_RE.test(value)) errors.push(`${field}:INVALID_ID`);
}

function validateToken(errors, field, value) {
  if (typeof value !== "string" || !TOKEN_RE.test(value)) errors.push(`${field}:INVALID_TOKEN`);
}

function validateEnum(errors, field, value, allowed) {
  if (!allowed.has(value)) errors.push(`${field}:UNSUPPORTED_VALUE`);
}

function validateString(errors, field, value, { min = 0, max = Number.MAX_SAFE_INTEGER, pattern = null } = {}) {
  if (typeof value !== "string") {
    errors.push(`${field}:NOT_STRING`);
    return;
  }
  const length = codePointLength(value);
  if (length < min || length > max) errors.push(`${field}:INVALID_LENGTH`);
  if (pattern && !pattern.test(value)) errors.push(`${field}:INVALID_FORMAT`);
}

function validateRequirementArray(errors, field, value, minItems) {
  if (!Array.isArray(value) || value.length < minItems) {
    errors.push(`${field}:INVALID_ARRAY`);
    return;
  }
  value.forEach((entry, index) => {
    const prefix = `${field}[${index}]`;
    if (!exactKeys(entry, ["ID", "TEXT"])) {
      errors.push(`${prefix}:INVALID_FIELDS`);
      return;
    }
    validateId(errors, `${prefix}.ID`, entry.ID);
    validateString(errors, `${prefix}.TEXT`, entry.TEXT, { min: 1, max: 2048 });
  });
}

function validateSetArray(errors, field, value, allowed, { minItems = 0, requireAscending = true } = {}) {
  if (!Array.isArray(value) || value.length < minItems) {
    errors.push(`${field}:INVALID_ARRAY`);
    return;
  }
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== "string" || !allowed.has(item)) errors.push(`${field}:UNSUPPORTED_VALUE`);
    if (seen.has(item)) errors.push(`${field}:DUPLICATE_VALUE`);
    seen.add(item);
  }
  if (requireAscending && value.every((item) => typeof item === "string") && !isStrictlyAscendingUtf8(value)) {
    errors.push(`${field}:NOT_UTF8_ASCENDING`);
  }
}

function validateScopeArray(errors, value) {
  const field = "ALLOWED_SCOPE";
  if (!Array.isArray(value) || value.length < 1) {
    errors.push(`${field}:INVALID_ARRAY`);
    return;
  }
  const seen = new Set();
  for (const item of value) {
    validateString(errors, field, item, { min: 3, max: 512, pattern: SCOPE_RE });
    if (seen.has(item)) errors.push(`${field}:DUPLICATE_VALUE`);
    seen.add(item);
  }
  if (value.every((item) => typeof item === "string") && !isStrictlyAscendingUtf8(value)) errors.push(`${field}:NOT_UTF8_ASCENDING`);
}

function validateTouchSet(errors, value) {
  const field = "TOUCH_SET";
  if (!Array.isArray(value)) {
    errors.push(`${field}:INVALID_ARRAY`);
    return;
  }
  const seen = new Set();
  value.forEach((entry, index) => {
    const prefix = `${field}[${index}]`;
    if (!isPlainObject(entry)) {
      errors.push(`${prefix}:NOT_OBJECT`);
      return;
    }
    const operation = entry.OPERATION;
    const expected = operation === "MOVE" ? ["PATH", "OPERATION", "FROM_PATH"] : ["PATH", "OPERATION"];
    if (!exactKeys(entry, expected)) errors.push(`${prefix}:INVALID_FIELDS`);
    validateString(errors, `${prefix}.PATH`, entry.PATH, { min: 1, max: 512, pattern: TOUCH_PATH_RE });
    validateEnum(errors, `${prefix}.OPERATION`, operation, TOUCH_OPERATIONS);
    if (operation === "MOVE") validateString(errors, `${prefix}.FROM_PATH`, entry.FROM_PATH, { min: 1, max: 512, pattern: TOUCH_PATH_RE });
    const key = JSON.stringify(touchSortKey(entry));
    if (seen.has(key)) errors.push(`${field}:DUPLICATE_VALUE`);
    seen.add(key);
  });
  if (value.every((item) => isPlainObject(item)) && !isStrictlyAscendingTouch(value)) errors.push(`${field}:NOT_UTF8_ASCENDING`);
}

function validateBudget(errors, value) {
  const field = "ECONOMY_BUDGET";
  const keys = ["MAX_EXECUTIONS", "MAX_RETRIES", "MAX_REPAIRS", "MAX_PARALLELISM"];
  if (!exactKeys(value, keys)) {
    errors.push(`${field}:INVALID_FIELDS`);
    return;
  }
  for (const key of ["MAX_EXECUTIONS", "MAX_RETRIES", "MAX_REPAIRS"]) {
    const number = value[key];
    if (!Number.isInteger(number) || number < 0 || number > 1_000_000) errors.push(`${field}.${key}:INVALID_INTEGER`);
  }
  const parallelism = value.MAX_PARALLELISM;
  if (!Number.isInteger(parallelism) || parallelism < 1 || parallelism > 1024) errors.push(`${field}.MAX_PARALLELISM:INVALID_INTEGER`);
}

function jcsSerialize(value) {
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isInteger(value) || !Number.isSafeInteger(value)) throw new Error("JCS_NON_INTEGER_NUMBER");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(jcsSerialize).join(",")}]`;
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${jcsSerialize(value[key])}`).join(",")}}`;
  }
  throw new Error("JCS_UNSUPPORTED_JSON_TYPE");
}

export function canonicalizeTaskContractForHash(contract) {
  if (!isPlainObject(contract)) throw new Error("TASK_CONTRACT_NOT_OBJECT");
  const payload = { ...contract };
  delete payload.TASK_CONTRACT_HASH;
  return jcsSerialize(payload);
}

export function computeTaskContractHash(contract) {
  return createHash("sha256").update(canonicalizeTaskContractForHash(contract), "utf8").digest("hex");
}

export function validateTaskContractV1(contract) {
  const errors = [];
  if (!exactKeys(contract, FROZEN_TASK_CONTRACT_FIELDS)) {
    errors.push("TOP_LEVEL:INVALID_FROZEN_FIELDS");
    return { ok: false, errors, computed_hash: null };
  }

  walkStrings(contract, (value) => {
    if (!isNfc(value)) errors.push("STRING:NON_NFC");
  });

  validateId(errors, "TASK_ID", contract.TASK_ID);
  validateId(errors, "PROJECT_ID", contract.PROJECT_ID);
  validateId(errors, "PHASE_ID", contract.PHASE_ID);
  validateToken(errors, "TASK_CLASS", contract.TASK_CLASS);
  validateToken(errors, "WORKLOAD_CLASS", contract.WORKLOAD_CLASS);

  if (!exactKeysAllowing(contract.SOURCE_IDENTITY, ["KIND", "LOCATOR"], ["IMMUTABLE_DIGEST"])) {
    errors.push("SOURCE_IDENTITY:INVALID_FIELDS");
  } else {
    validateEnum(errors, "SOURCE_IDENTITY.KIND", contract.SOURCE_IDENTITY.KIND, SOURCE_KINDS);
    validateString(errors, "SOURCE_IDENTITY.LOCATOR", contract.SOURCE_IDENTITY.LOCATOR, { min: 1, max: 512 });
    if (contract.SOURCE_IDENTITY.IMMUTABLE_DIGEST !== undefined) {
      validateString(errors, "SOURCE_IDENTITY.IMMUTABLE_DIGEST", contract.SOURCE_IDENTITY.IMMUTABLE_DIGEST, { pattern: IMMUTABLE_DIGEST_RE });
    }
  }

  if (!(contract.EXPECTED_HEAD === "NONE" || (typeof contract.EXPECTED_HEAD === "string" && SHA40_RE.test(contract.EXPECTED_HEAD)))) {
    errors.push("EXPECTED_HEAD:INVALID_VALUE");
  }

  validateSetArray(errors, "EFFECT_CLASSES", contract.EFFECT_CLASSES, EFFECT_CLASSES, { minItems: 1 });
  validateScopeArray(errors, contract.ALLOWED_SCOPE);
  validateTouchSet(errors, contract.TOUCH_SET);
  validateSetArray(errors, "CAPABILITY_REQUIREMENTS", contract.CAPABILITY_REQUIREMENTS, CAPABILITIES);

  if (!exactKeys(contract.RESOURCE_REQUIREMENTS, ["EXECUTION_CLASS", "OS_CLASS", "ARCH_CLASS", "WORKSPACE_CLASS"])) {
    errors.push("RESOURCE_REQUIREMENTS:INVALID_FIELDS");
  } else {
    validateEnum(errors, "RESOURCE_REQUIREMENTS.EXECUTION_CLASS", contract.RESOURCE_REQUIREMENTS.EXECUTION_CLASS, EXECUTION_CLASSES);
    validateEnum(errors, "RESOURCE_REQUIREMENTS.OS_CLASS", contract.RESOURCE_REQUIREMENTS.OS_CLASS, OS_CLASSES);
    validateEnum(errors, "RESOURCE_REQUIREMENTS.ARCH_CLASS", contract.RESOURCE_REQUIREMENTS.ARCH_CLASS, ARCH_CLASSES);
    validateEnum(errors, "RESOURCE_REQUIREMENTS.WORKSPACE_CLASS", contract.RESOURCE_REQUIREMENTS.WORKSPACE_CLASS, WORKSPACE_CLASSES);
  }

  validateEnum(errors, "NETWORK_CLASS", contract.NETWORK_CLASS, NETWORK_CLASSES);
  validateEnum(errors, "DATA_ACCESS_CLASS", contract.DATA_ACCESS_CLASS, DATA_ACCESS_CLASSES);
  validateEnum(errors, "SECRET_CLASS", contract.SECRET_CLASS, SECRET_CLASSES);
  validateEnum(errors, "REMOTE_MUTATION_INTENT", contract.REMOTE_MUTATION_INTENT, MUTATION_INTENTS);
  validateEnum(errors, "HOST_OPERATION_INTENT", contract.HOST_OPERATION_INTENT, MUTATION_INTENTS);
  validateEnum(errors, "ORACLE_REQUIREMENT", contract.ORACLE_REQUIREMENT, ORACLE_REQUIREMENTS);

  validateRequirementArray(errors, "ACCEPTANCE_REQUIREMENTS", contract.ACCEPTANCE_REQUIREMENTS, 1);
  validateRequirementArray(errors, "VERIFIER_REQUIREMENTS", contract.VERIFIER_REQUIREMENTS, 1);
  validateBudget(errors, contract.ECONOMY_BUDGET);
  validateToken(errors, "INTERVENTION_POLICY", contract.INTERVENTION_POLICY);
  validateToken(errors, "REPLAN_BOUNDARY", contract.REPLAN_BOUNDARY);
  validateRequirementArray(errors, "EXPECTED_OUTPUTS", contract.EXPECTED_OUTPUTS, 0);
  validateRequirementArray(errors, "EXPECTED_EVIDENCE", contract.EXPECTED_EVIDENCE, 1);

  if (contract.CONTRACT_VERSION !== INTERFACE_VERSION) errors.push("CONTRACT_VERSION:UNSUPPORTED_VALUE");
  if (typeof contract.TASK_CONTRACT_HASH !== "string" || !SHA256_RE.test(contract.TASK_CONTRACT_HASH)) errors.push("TASK_CONTRACT_HASH:INVALID_FORMAT");

  const capabilities = new Set(Array.isArray(contract.CAPABILITY_REQUIREMENTS) ? contract.CAPABILITY_REQUIREMENTS : []);
  const effects = new Set(Array.isArray(contract.EFFECT_CLASSES) ? contract.EFFECT_CLASSES : []);
  if (contract.NETWORK_CLASS !== "NONE" && !capabilities.has("NETWORK_EGRESS")) errors.push("NETWORK_CLASS:MISSING_CAPABILITY_NETWORK_EGRESS");
  if (effects.has("REMOTE_SOURCE_WRITE") && !capabilities.has("GIT_CANDIDATE_WRITE")) errors.push("EFFECT_CLASSES:MISSING_CAPABILITY_GIT_CANDIDATE_WRITE");
  if (effects.has("REMOTE_PROVIDER_MUTATION") && !capabilities.has("PROVIDER_API_MUTATE")) errors.push("EFFECT_CLASSES:MISSING_CAPABILITY_PROVIDER_API_MUTATE");
  if (effects.has("HOST_PRIVILEGED_CHANGE") && !capabilities.has("HOST_PRIVILEGED")) errors.push("EFFECT_CLASSES:MISSING_CAPABILITY_HOST_PRIVILEGED");
  if (effects.has("EXTERNAL_ORACLE") && !capabilities.has("HUMAN_ORACLE") && !capabilities.has("DEVICE_ORACLE")) {
    errors.push("EFFECT_CLASSES:MISSING_CAPABILITY_ORACLE");
  }

  let computedHash = null;
  try {
    computedHash = computeTaskContractHash(contract);
    if (computedHash !== contract.TASK_CONTRACT_HASH) errors.push("TASK_CONTRACT_HASH:MISMATCH");
  } catch (error) {
    errors.push(`TASK_CONTRACT_HASH:${error.message}`);
  }

  return { ok: errors.length === 0, errors, computed_hash: computedHash };
}
