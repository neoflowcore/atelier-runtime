import { createHash } from "node:crypto";
import { canonicalizeExecutionV1 } from "./canonicalize-execution-v1.mjs";
import {
  REV51_CONTRACT_SET_ID,
  REV51_CONTRACT_SET_SHA256,
  REV51_CONTRACT_SET_VERSION
} from "./execution-intent-v1.mjs";

export const PILOTE_EXECUTION_TERMINAL_SEMANTIC_BINDING_TYPE =
  "PILOTE_EXECUTION_TERMINAL_SEMANTIC_BINDING_V1";
export const PILOTE_EXECUTION_TERMINAL_SEMANTIC_BINDING_VERSION = "1.0.0";
export const A5T_CANONICALIZATION_ID = "ATELIER_EXECUTION_CANONICAL_JSON_V1";

export const EXECUTION_SESSION_STATUS_SCHEMA_REF = Object.freeze({
  PATH: "schemas/rev51/execution-session-status-v1.schema.json",
  SHA256: "fd612bf9556b20b9434d6218ec437d9ec61dfe447f1d9eb534fbb4e7a2a3b5f2",
  GIT_BLOB: "d0e0c62d1b387d39eb911e493eeb459e283e626a"
});

export const EXECUTION_STATES = Object.freeze([
  "REQUESTED",
  "READY",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "CANCELED",
  "EXPIRED",
  "OUTCOME_UNKNOWN"
]);

export const EXECUTION_TERMINAL_STATES = Object.freeze([
  "SUCCEEDED",
  "FAILED",
  "CANCELED",
  "EXPIRED"
]);

export const EXECUTION_NON_TERMINAL_STATES = Object.freeze([
  "REQUESTED",
  "READY",
  "RUNNING",
  "OUTCOME_UNKNOWN"
]);

export const OUTCOME_UNKNOWN_TERMINAL_POLICY =
  "NON_TERMINAL_RECONCILIATION_REQUIRED";
export const EXECUTION_TERMINAL_ACCEPTANCE_POLICY =
  "NO_ACCEPTANCE_IMPLICATION";
export const RUNTIME_EVIDENCE_AUTHORITY_POLICY =
  "AUTHORITATIVE_RUNTIME_EVIDENCE_REQUIRED";
export const PILOTE_DIRECT_EXECUTION_TERMINAL_MUTATION_POLICY = "DENY";

const BINDING_KEYS = Object.freeze([
  "A5T_BINDING_SHA256",
  "BINDING_TYPE",
  "BINDING_VERSION",
  "CANONICALIZATION_ID",
  "CONTRACT_SET_REF",
  "DESTINATION_FLAG",
  "EXECUTION_STATE_ENUM",
  "NON_TERMINAL_STATES",
  "OUTCOME_UNKNOWN_POLICY",
  "PILOTE_DIRECT_FLAG_MUTATION",
  "RUNTIME_EVIDENCE_AUTHORITY",
  "SOURCE_STATUS_SCHEMA_REF",
  "TERMINAL_ACCEPTANCE_POLICY",
  "TERMINAL_STATES"
]);

const SOURCE_REF_KEYS = Object.freeze(["GIT_BLOB", "PATH", "SHA256"]);
const CONTRACT_REF_KEYS = Object.freeze(["ID", "SHA256", "VERSION"]);
const SHA256_RE = /^[0-9a-f]{64}$/;

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected) {
  if (!isObject(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index]);
}

function exactArray(left, right) {
  return Array.isArray(left)
    && left.length === right.length
    && left.every((item, index) => item === right[index]);
}

export function computeExecutionTerminalSemanticBindingSha256V1(binding) {
  const copy = structuredClone(binding);
  delete copy.A5T_BINDING_SHA256;
  return createHash("sha256")
    .update(canonicalizeExecutionV1(copy))
    .digest("hex");
}

export function validateExecutionTerminalSemanticBindingV1(binding) {
  const errors = [];

  if (!exactKeys(binding, BINDING_KEYS)) errors.push("A5T_TOP_LEVEL_FIELDS_MISMATCH");
  if (binding?.BINDING_TYPE !== PILOTE_EXECUTION_TERMINAL_SEMANTIC_BINDING_TYPE) {
    errors.push("A5T_BINDING_TYPE_MISMATCH");
  }
  if (binding?.BINDING_VERSION !== PILOTE_EXECUTION_TERMINAL_SEMANTIC_BINDING_VERSION) {
    errors.push("A5T_BINDING_VERSION_MISMATCH");
  }
  if (binding?.CANONICALIZATION_ID !== A5T_CANONICALIZATION_ID) {
    errors.push("A5T_CANONICALIZATION_ID_MISMATCH");
  }

  const source = binding?.SOURCE_STATUS_SCHEMA_REF;
  if (
    !exactKeys(source, SOURCE_REF_KEYS)
    || source.PATH !== EXECUTION_SESSION_STATUS_SCHEMA_REF.PATH
    || source.SHA256 !== EXECUTION_SESSION_STATUS_SCHEMA_REF.SHA256
    || source.GIT_BLOB !== EXECUTION_SESSION_STATUS_SCHEMA_REF.GIT_BLOB
  ) {
    errors.push("SOURCE_STATUS_SCHEMA_REF_MISMATCH");
  }

  if (!exactArray(binding?.EXECUTION_STATE_ENUM, EXECUTION_STATES)) {
    errors.push("EXECUTION_STATE_ENUM_MISMATCH");
  }
  if (!exactArray(binding?.TERMINAL_STATES, EXECUTION_TERMINAL_STATES)) {
    errors.push("TERMINAL_STATES_MISMATCH");
  }
  if (!exactArray(binding?.NON_TERMINAL_STATES, EXECUTION_NON_TERMINAL_STATES)) {
    errors.push("NON_TERMINAL_STATES_MISMATCH");
  }

  const combined = [
    ...(Array.isArray(binding?.TERMINAL_STATES) ? binding.TERMINAL_STATES : []),
    ...(Array.isArray(binding?.NON_TERMINAL_STATES) ? binding.NON_TERMINAL_STATES : [])
  ];
  if (
    combined.length !== EXECUTION_STATES.length
    || new Set(combined).size !== EXECUTION_STATES.length
    || EXECUTION_STATES.some((state) => !combined.includes(state))
  ) {
    errors.push("TERMINAL_PARTITION_INVALID");
  }

  if (binding?.DESTINATION_FLAG !== "EXECUTION_TERMINAL") {
    errors.push("DESTINATION_FLAG_MISMATCH");
  }
  if (binding?.OUTCOME_UNKNOWN_POLICY !== OUTCOME_UNKNOWN_TERMINAL_POLICY) {
    errors.push("OUTCOME_UNKNOWN_POLICY_MISMATCH");
  }
  if (binding?.TERMINAL_ACCEPTANCE_POLICY !== EXECUTION_TERMINAL_ACCEPTANCE_POLICY) {
    errors.push("TERMINAL_ACCEPTANCE_POLICY_MISMATCH");
  }
  if (binding?.RUNTIME_EVIDENCE_AUTHORITY !== RUNTIME_EVIDENCE_AUTHORITY_POLICY) {
    errors.push("RUNTIME_EVIDENCE_AUTHORITY_MISMATCH");
  }
  if (binding?.PILOTE_DIRECT_FLAG_MUTATION !== PILOTE_DIRECT_EXECUTION_TERMINAL_MUTATION_POLICY) {
    errors.push("PILOTE_DIRECT_FLAG_MUTATION_MISMATCH");
  }

  const contract = binding?.CONTRACT_SET_REF;
  if (
    !exactKeys(contract, CONTRACT_REF_KEYS)
    || contract.ID !== REV51_CONTRACT_SET_ID
    || contract.VERSION !== REV51_CONTRACT_SET_VERSION
    || contract.SHA256 !== REV51_CONTRACT_SET_SHA256
  ) {
    errors.push("CONTRACT_SET_REF_MISMATCH");
  }

  if (!SHA256_RE.test(binding?.A5T_BINDING_SHA256 ?? "")) {
    errors.push("A5T_BINDING_SHA256_INVALID");
  } else {
    try {
      if (computeExecutionTerminalSemanticBindingSha256V1(binding) !== binding.A5T_BINDING_SHA256) {
        errors.push("A5T_BINDING_SHA256_MISMATCH");
      }
    } catch (error) {
      errors.push("A5T_CANONICALIZATION_REJECTED:" + error.message);
    }
  }

  return { ok: errors.length === 0, errors };
}

export function buildExecutionTerminalSemanticBindingV1() {
  const binding = {
    BINDING_TYPE: PILOTE_EXECUTION_TERMINAL_SEMANTIC_BINDING_TYPE,
    BINDING_VERSION: PILOTE_EXECUTION_TERMINAL_SEMANTIC_BINDING_VERSION,
    CANONICALIZATION_ID: A5T_CANONICALIZATION_ID,
    SOURCE_STATUS_SCHEMA_REF: structuredClone(EXECUTION_SESSION_STATUS_SCHEMA_REF),
    EXECUTION_STATE_ENUM: [...EXECUTION_STATES],
    TERMINAL_STATES: [...EXECUTION_TERMINAL_STATES],
    NON_TERMINAL_STATES: [...EXECUTION_NON_TERMINAL_STATES],
    DESTINATION_FLAG: "EXECUTION_TERMINAL",
    OUTCOME_UNKNOWN_POLICY: OUTCOME_UNKNOWN_TERMINAL_POLICY,
    TERMINAL_ACCEPTANCE_POLICY: EXECUTION_TERMINAL_ACCEPTANCE_POLICY,
    RUNTIME_EVIDENCE_AUTHORITY: RUNTIME_EVIDENCE_AUTHORITY_POLICY,
    PILOTE_DIRECT_FLAG_MUTATION: PILOTE_DIRECT_EXECUTION_TERMINAL_MUTATION_POLICY,
    CONTRACT_SET_REF: {
      ID: REV51_CONTRACT_SET_ID,
      VERSION: REV51_CONTRACT_SET_VERSION,
      SHA256: REV51_CONTRACT_SET_SHA256
    },
    A5T_BINDING_SHA256: "0".repeat(64)
  };

  binding.A5T_BINDING_SHA256 =
    computeExecutionTerminalSemanticBindingSha256V1(binding);

  const result = validateExecutionTerminalSemanticBindingV1(binding);
  if (!result.ok) {
    throw new Error("BUILT_A5T_BINDING_INVALID:" + result.errors.join("|"));
  }
  return binding;
}

export function deriveExecutionTerminalProjectionV1(executionState) {
  if (!EXECUTION_STATES.includes(executionState)) {
    throw new Error("EXECUTION_STATE_UNSUPPORTED");
  }

  const terminal = EXECUTION_TERMINAL_STATES.includes(executionState);
  return Object.freeze({
    EXECUTION_STATE: executionState,
    EXECUTION_TERMINAL: terminal,
    RECONCILIATION_REQUIRED: executionState === "OUTCOME_UNKNOWN",
    ACCEPTANCE_IMPLIED: false,
    RUNTIME_EVIDENCE_REQUIRED: true
  });
}
