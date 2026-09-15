import { createHash } from "node:crypto";
import {
  INTERFACE_VERSION,
  INTERFACE_MANIFEST_SHA256,
  TASK_CONTRACT_SCHEMA_SHA256,
  TASK_CONTRACT_MACHINE_SCHEMA_SHA256
} from "./task-contract-v1.mjs";
import {
  RUNTIME_B_SELECTION_RECEIPT_TYPE,
  verifyBackendBoundContext
} from "./backend-plan-b.mjs";

export const RUNTIME_B_AUTHORITY_BINDING_TYPE = "RUNTIME_B_AUTHORITY_BINDING_V1";
export const RUNTIME_B_EXECUTION_GUARD_RECEIPT_TYPE = "RUNTIME_B_EXECUTION_GUARD_V1";
export const OPAQUE_AUTHORITY_EVIDENCE_CLASS = "OPAQUE_EXTERNAL_AUTHORITY_EVIDENCE";

const SHA256 = /^[0-9a-f]{64}$/;
const AUTHORITY_BINDING_KEYS = Object.freeze([
  "binding_type",
  "authority_evidence_class",
  "authority_evidence_sha256",
  "interface_version",
  "interface_manifest_sha256",
  "task_contract_schema_sha256",
  "task_contract_machine_schema_sha256",
  "task_contract_hash",
  "backend_binding_sha256",
  "backend_id",
  "backend_kind",
  "runtime_source_write_authority",
  "authority_binding_sha256"
]);
const EXECUTION_CONTEXT_KEYS = Object.freeze([
  "task_contract_hash",
  "backend_binding_sha256",
  "backend_id",
  "backend_kind",
  "authority_binding_sha256"
]);

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected) {
  if (!isPlainObject(value)) return false;
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function sha256Json(value) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function inspectSelection(selectionReceipt) {
  const errors = [];
  if (!isPlainObject(selectionReceipt)) return { ok: false, errors: ["SELECTION_RECEIPT_MISSING"], expected: null };
  if (selectionReceipt.receipt_type !== RUNTIME_B_SELECTION_RECEIPT_TYPE) errors.push("SELECTION_RECEIPT_TYPE_MISMATCH");
  if (selectionReceipt.result !== "SELECTED") errors.push("SELECTION_NOT_SELECTED");
  if (selectionReceipt.fallback_used !== false) errors.push("FALLBACK_MUST_BE_FALSE");
  if (selectionReceipt.runtime_source_write_authority !== "NONE") errors.push("SELECTION_SOURCE_WRITE_AUTHORITY_NOT_NONE");
  if (!isPlainObject(selectionReceipt.selected_backend)) errors.push("SELECTED_BACKEND_MISSING");
  if (!isPlainObject(selectionReceipt.backend_binding)) errors.push("BACKEND_BINDING_MISSING");

  const expected = errors.length === 0 ? {
    task_contract_hash: selectionReceipt.task_contract_hash,
    backend_id: selectionReceipt.selected_backend.backend_id,
    backend_kind: selectionReceipt.selected_backend.backend_kind,
    backend_binding_sha256: selectionReceipt.backend_binding.backend_binding_sha256
  } : null;

  if (expected) {
    const verification = verifyBackendBoundContext(selectionReceipt.backend_binding, expected);
    errors.push(...verification.errors.map((error) => `BACKEND_BINDING:${error}`));
    if (selectionReceipt.selected_backend.target_source_write_authority !== "NONE") {
      errors.push("SELECTED_BACKEND_SOURCE_WRITE_AUTHORITY_NOT_NONE");
    }
  }

  return { ok: errors.length === 0, errors, expected };
}

function authorityPayload(selectionReceipt, authorityEvidenceSha256) {
  return {
    binding_type: RUNTIME_B_AUTHORITY_BINDING_TYPE,
    authority_evidence_class: OPAQUE_AUTHORITY_EVIDENCE_CLASS,
    authority_evidence_sha256: authorityEvidenceSha256,
    interface_version: INTERFACE_VERSION,
    interface_manifest_sha256: INTERFACE_MANIFEST_SHA256,
    task_contract_schema_sha256: TASK_CONTRACT_SCHEMA_SHA256,
    task_contract_machine_schema_sha256: TASK_CONTRACT_MACHINE_SCHEMA_SHA256,
    task_contract_hash: selectionReceipt.task_contract_hash,
    backend_binding_sha256: selectionReceipt.backend_binding.backend_binding_sha256,
    backend_id: selectionReceipt.selected_backend.backend_id,
    backend_kind: selectionReceipt.selected_backend.backend_kind,
    runtime_source_write_authority: "NONE"
  };
}

export function bindOpaqueAuthorityEvidence(selectionReceipt, authorityEvidenceSha256) {
  const selection = inspectSelection(selectionReceipt);
  const errors = [...selection.errors];
  if (!SHA256.test(authorityEvidenceSha256 ?? "")) errors.push("AUTHORITY_EVIDENCE_SHA256_INVALID");

  if (errors.length > 0) return { ok: false, result: "BLOCKED", errors, binding: null };

  const payload = authorityPayload(selectionReceipt, authorityEvidenceSha256);
  return {
    ok: true,
    result: "BOUND",
    errors: [],
    binding: {
      ...payload,
      authority_binding_sha256: sha256Json(payload)
    }
  };
}

export function verifyAuthorityBinding(binding, selectionReceipt) {
  const errors = [];
  const selection = inspectSelection(selectionReceipt);
  errors.push(...selection.errors);

  if (!isPlainObject(binding)) return { ok: false, errors: [...errors, "AUTHORITY_BINDING_MISSING"] };
  if (!exactKeys(binding, AUTHORITY_BINDING_KEYS)) errors.push("AUTHORITY_BINDING_FIELDS_MISMATCH");
  if (binding.binding_type !== RUNTIME_B_AUTHORITY_BINDING_TYPE) errors.push("AUTHORITY_BINDING_TYPE_MISMATCH");
  if (binding.authority_evidence_class !== OPAQUE_AUTHORITY_EVIDENCE_CLASS) errors.push("AUTHORITY_EVIDENCE_CLASS_MISMATCH");
  if (!SHA256.test(binding.authority_evidence_sha256 ?? "")) errors.push("AUTHORITY_EVIDENCE_SHA256_INVALID");
  if (binding.interface_version !== INTERFACE_VERSION) errors.push("INTERFACE_VERSION_MISMATCH");
  if (binding.interface_manifest_sha256 !== INTERFACE_MANIFEST_SHA256) errors.push("INTERFACE_MANIFEST_MISMATCH");
  if (binding.task_contract_schema_sha256 !== TASK_CONTRACT_SCHEMA_SHA256) errors.push("TASK_CONTRACT_SCHEMA_MISMATCH");
  if (binding.task_contract_machine_schema_sha256 !== TASK_CONTRACT_MACHINE_SCHEMA_SHA256) errors.push("TASK_CONTRACT_MACHINE_SCHEMA_MISMATCH");
  if (binding.runtime_source_write_authority !== "NONE") errors.push("SOURCE_WRITE_AUTHORITY_NOT_NONE");

  if (selection.expected) {
    if (binding.task_contract_hash !== selection.expected.task_contract_hash) errors.push("TASK_CONTRACT_HASH_MISMATCH");
    if (binding.backend_binding_sha256 !== selection.expected.backend_binding_sha256) errors.push("BACKEND_BINDING_SHA256_MISMATCH");
    if (binding.backend_id !== selection.expected.backend_id) errors.push("BACKEND_ID_MISMATCH");
    if (binding.backend_kind !== selection.expected.backend_kind) errors.push("BACKEND_KIND_MISMATCH");
  }

  const { authority_binding_sha256, ...payload } = binding;
  if (sha256Json(payload) !== authority_binding_sha256) errors.push("AUTHORITY_BINDING_DIGEST_MISMATCH");

  return { ok: errors.length === 0, errors };
}

export function verifyAuthorityBoundExecution({ selection_receipt, authority_binding, execution_context }) {
  const errors = [];
  const authority = verifyAuthorityBinding(authority_binding, selection_receipt);
  errors.push(...authority.errors);

  if (!exactKeys(execution_context, EXECUTION_CONTEXT_KEYS)) {
    errors.push("EXECUTION_CONTEXT_FIELDS_MISMATCH");
  } else {
    if (execution_context.task_contract_hash !== authority_binding?.task_contract_hash) errors.push("EXECUTION_TASK_CONTRACT_HASH_MISMATCH");
    if (execution_context.backend_binding_sha256 !== authority_binding?.backend_binding_sha256) errors.push("EXECUTION_BACKEND_BINDING_SHA256_MISMATCH");
    if (execution_context.backend_id !== authority_binding?.backend_id) errors.push("EXECUTION_BACKEND_ID_MISMATCH");
    if (execution_context.backend_kind !== authority_binding?.backend_kind) errors.push("EXECUTION_BACKEND_KIND_MISMATCH");
    if (execution_context.authority_binding_sha256 !== authority_binding?.authority_binding_sha256) errors.push("EXECUTION_AUTHORITY_BINDING_SHA256_MISMATCH");
  }

  return {
    receipt_type: RUNTIME_B_EXECUTION_GUARD_RECEIPT_TYPE,
    task_contract_hash: authority_binding?.task_contract_hash ?? null,
    backend_binding_sha256: authority_binding?.backend_binding_sha256 ?? null,
    authority_binding_sha256: authority_binding?.authority_binding_sha256 ?? null,
    runtime_source_write_authority: "NONE",
    result: errors.length === 0 ? "PASS" : "BLOCKED",
    reasons: errors
  };
}
