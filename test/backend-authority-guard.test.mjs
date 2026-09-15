import test from "node:test";
import assert from "node:assert/strict";
import { computeTaskContractHash } from "../runtime/task-contract-v1.mjs";
import { selectRuntimeBBackend } from "../runtime/backend-plan-b.mjs";
import {
  bindOpaqueAuthorityEvidence,
  verifyAuthorityBinding,
  verifyAuthorityBoundExecution
} from "../runtime/backend-authority-guard.mjs";

function contract(executionClass = "RUNTIME_DEFAULT") {
  const value = {
    TASK_ID: "B3-TEST-001",
    PROJECT_ID: "ATELIER-RUNTIME",
    PHASE_ID: "RUNTIME-B3",
    TASK_CLASS: "VALIDATION",
    WORKLOAD_CLASS: "SOURCE_INSPECTION",
    SOURCE_IDENTITY: { KIND: "GIT", LOCATOR: "github:neoflowcore/atelier-runtime" },
    EXPECTED_HEAD: "743e14f9292100752c8352b862e3a3e25153be87",
    EFFECT_CLASSES: ["READ_ONLY"],
    ALLOWED_SCOPE: ["repo:neoflowcore/atelier-runtime"],
    TOUCH_SET: [{ PATH: "runtime/backend-plan-b.mjs", OPERATION: "READ" }],
    CAPABILITY_REQUIREMENTS: ["SOURCE_READ"],
    RESOURCE_REQUIREMENTS: { EXECUTION_CLASS: executionClass, OS_CLASS: "LINUX", ARCH_CLASS: "X64", WORKSPACE_CLASS: "READ_ONLY" },
    NETWORK_CLASS: "NONE",
    DATA_ACCESS_CLASS: "PROJECT_INTERNAL",
    SECRET_CLASS: "NONE",
    REMOTE_MUTATION_INTENT: "NONE",
    HOST_OPERATION_INTENT: "NONE",
    ORACLE_REQUIREMENT: "NONE",
    ACCEPTANCE_REQUIREMENTS: [{ ID: "A1", TEXT: "Authority evidence is backend-bound without semantic reinterpretation." }],
    VERIFIER_REQUIREMENTS: [{ ID: "V1", TEXT: "Cross-backend reuse fails closed." }],
    ECONOMY_BUDGET: { MAX_EXECUTIONS: 1, MAX_RETRIES: 0, MAX_REPAIRS: 0, MAX_PARALLELISM: 1 },
    INTERVENTION_POLICY: "BLOCK_ON_AMBIGUITY",
    REPLAN_BOUNDARY: "TASK_ONLY",
    EXPECTED_OUTPUTS: [{ ID: "O1", TEXT: "Opaque authority binding." }],
    EXPECTED_EVIDENCE: [{ ID: "E1", TEXT: "Authority binding digest." }],
    CONTRACT_VERSION: "1.0.0",
    TASK_CONTRACT_HASH: "0".repeat(64)
  };
  value.TASK_CONTRACT_HASH = computeTaskContractHash(value);
  return value;
}

const authorityEvidenceSha256 = "a".repeat(64);

function executionContext(binding) {
  return {
    task_contract_hash: binding.task_contract_hash,
    backend_binding_sha256: binding.backend_binding_sha256,
    backend_id: binding.backend_id,
    backend_kind: binding.backend_kind,
    authority_binding_sha256: binding.authority_binding_sha256
  };
}

test("hosted selection binds opaque external authority evidence", () => {
  const selection = selectRuntimeBBackend(contract());
  const result = bindOpaqueAuthorityEvidence(selection, authorityEvidenceSha256);
  assert.equal(result.ok, true);
  assert.equal(result.result, "BOUND");
  assert.equal(result.binding.authority_evidence_class, "OPAQUE_EXTERNAL_AUTHORITY_EVIDENCE");
});

test("self-hosted selection binds the same opaque evidence to a different authority identity", () => {
  const hosted = bindOpaqueAuthorityEvidence(selectRuntimeBBackend(contract()), authorityEvidenceSha256);
  const selfHosted = bindOpaqueAuthorityEvidence(selectRuntimeBBackend(contract("SELF_HOSTED_REQUIRED")), authorityEvidenceSha256);
  assert.equal(hosted.ok, true);
  assert.equal(selfHosted.ok, true);
  assert.notEqual(hosted.binding.authority_binding_sha256, selfHosted.binding.authority_binding_sha256);
});

test("cross-backend authority reuse is rejected", () => {
  const hostedSelection = selectRuntimeBBackend(contract());
  const selfHostedSelection = selectRuntimeBBackend(contract("SELF_HOSTED_REQUIRED"));
  const hosted = bindOpaqueAuthorityEvidence(hostedSelection, authorityEvidenceSha256);
  const result = verifyAuthorityBinding(hosted.binding, selfHostedSelection);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("BACKEND_ID_MISMATCH"));
  assert.ok(result.errors.includes("BACKEND_BINDING_SHA256_MISMATCH"));
});

test("authority evidence digest is opaque but must be immutable SHA-256", () => {
  const selection = selectRuntimeBBackend(contract());
  const result = bindOpaqueAuthorityEvidence(selection, "not-a-digest");
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("AUTHORITY_EVIDENCE_SHA256_INVALID"));
});

test("authority binding rejects structural extension", () => {
  const selection = selectRuntimeBBackend(contract());
  const bound = bindOpaqueAuthorityEvidence(selection, authorityEvidenceSha256);
  const result = verifyAuthorityBinding({ ...bound.binding, semantic_decision: "ALLOW" }, selection);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("AUTHORITY_BINDING_FIELDS_MISMATCH"));
});

test("matching authority-bound execution context passes", () => {
  const selection = selectRuntimeBBackend(contract());
  const bound = bindOpaqueAuthorityEvidence(selection, authorityEvidenceSha256);
  const receipt = verifyAuthorityBoundExecution({
    selection_receipt: selection,
    authority_binding: bound.binding,
    execution_context: executionContext(bound.binding)
  });
  assert.equal(receipt.result, "PASS");
  assert.equal(receipt.runtime_source_write_authority, "NONE");
});

test("execution context for a different backend fails closed", () => {
  const selection = selectRuntimeBBackend(contract());
  const bound = bindOpaqueAuthorityEvidence(selection, authorityEvidenceSha256);
  const context = executionContext(bound.binding);
  context.backend_id = "SELF_HOSTED_LINUX_X64_V1";
  const receipt = verifyAuthorityBoundExecution({ selection_receipt: selection, authority_binding: bound.binding, execution_context: context });
  assert.equal(receipt.result, "BLOCKED");
  assert.ok(receipt.reasons.includes("EXECUTION_BACKEND_ID_MISMATCH"));
});

test("unselected Runtime B receipt cannot receive authority binding", () => {
  const selection = selectRuntimeBBackend(contract("HOST_LOCAL_REQUIRED"));
  const result = bindOpaqueAuthorityEvidence(selection, authorityEvidenceSha256);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("SELECTION_NOT_SELECTED"));
});
