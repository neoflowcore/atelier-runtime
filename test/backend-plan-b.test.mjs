import test from "node:test";
import assert from "node:assert/strict";
import { computeTaskContractHash } from "../runtime/task-contract-v1.mjs";
import {
  V1_HOSTED_BACKEND,
  buildBackendBindingIdentity,
  compileV1HostedBinding,
  selectRuntimeBBackend,
  verifyBackendBoundContext
} from "../runtime/backend-plan-b.mjs";
import { PLAN_A_BACKEND } from "../runtime/backend-plan-a.mjs";

function contract(overrides = {}) {
  const value = {
    TASK_ID: "B1-TEST-001",
    PROJECT_ID: "ATELIER-RUNTIME",
    PHASE_ID: "RUNTIME-B1",
    TASK_CLASS: "VALIDATION",
    WORKLOAD_CLASS: "SOURCE_INSPECTION",
    SOURCE_IDENTITY: { KIND: "GIT", LOCATOR: "github:neoflowcore/atelier-runtime" },
    EXPECTED_HEAD: "c18800c0c8c2fe55c017e5a8c970a29daf42410f",
    EFFECT_CLASSES: ["READ_ONLY"],
    ALLOWED_SCOPE: ["repo:neoflowcore/atelier-runtime"],
    TOUCH_SET: [{ PATH: "runtime/task-contract-v1.mjs", OPERATION: "READ" }],
    CAPABILITY_REQUIREMENTS: ["SOURCE_READ"],
    RESOURCE_REQUIREMENTS: {
      EXECUTION_CLASS: "RUNTIME_DEFAULT",
      OS_CLASS: "ANY",
      ARCH_CLASS: "ANY",
      WORKSPACE_CLASS: "READ_ONLY"
    },
    NETWORK_CLASS: "NONE",
    DATA_ACCESS_CLASS: "PUBLIC",
    SECRET_CLASS: "NONE",
    REMOTE_MUTATION_INTENT: "NONE",
    HOST_OPERATION_INTENT: "NONE",
    ORACLE_REQUIREMENT: "NONE",
    ACCEPTANCE_REQUIREMENTS: [{ ID: "A1", TEXT: "Backend selection is deterministic." }],
    VERIFIER_REQUIREMENTS: [{ ID: "V1", TEXT: "Verify backend binding identity." }],
    ECONOMY_BUDGET: { MAX_EXECUTIONS: 1, MAX_RETRIES: 0, MAX_REPAIRS: 0, MAX_PARALLELISM: 1 },
    INTERVENTION_POLICY: "BLOCK_ON_AMBIGUITY",
    REPLAN_BOUNDARY: "TASK_ONLY",
    EXPECTED_OUTPUTS: [{ ID: "O1", TEXT: "Runtime backend selection receipt." }],
    EXPECTED_EVIDENCE: [{ ID: "E1", TEXT: "Backend binding digest." }],
    CONTRACT_VERSION: "1.0.0",
    TASK_CONTRACT_HASH: "0".repeat(64),
    ...overrides
  };
  value.TASK_CONTRACT_HASH = computeTaskContractHash(value);
  return value;
}

test("RUNTIME_DEFAULT preserves V1 hosted selection and never silently routes to self-hosted", () => {
  const result = selectRuntimeBBackend(contract());
  assert.equal(result.result, "SELECTED");
  assert.equal(result.selected_backend.backend_id, V1_HOSTED_BACKEND.backend_id);
  assert.equal(result.fallback_used, false);
  assert.equal(result.runtime_source_write_authority, "NONE");
});

test("HOSTED_ELIGIBLE deterministically selects V1 hosted when eligible", () => {
  const value = contract({
    RESOURCE_REQUIREMENTS: { EXECUTION_CLASS: "HOSTED_ELIGIBLE", OS_CLASS: "LINUX", ARCH_CLASS: "X64", WORKSPACE_CLASS: "READ_ONLY" }
  });
  const result = selectRuntimeBBackend(value);
  assert.equal(result.result, "SELECTED");
  assert.equal(result.selected_backend.backend_id, V1_HOSTED_BACKEND.backend_id);
});

test("SELF_HOSTED_REQUIRED routes only to Plan A and uses no hosted fallback", () => {
  const value = contract({
    RESOURCE_REQUIREMENTS: { EXECUTION_CLASS: "SELF_HOSTED_REQUIRED", OS_CLASS: "LINUX", ARCH_CLASS: "X64", WORKSPACE_CLASS: "READ_ONLY" }
  });
  const result = selectRuntimeBBackend(value);
  assert.equal(result.result, "SELECTED");
  assert.equal(result.selected_backend.backend_id, PLAN_A_BACKEND.backend_id);
  assert.equal(result.fallback_used, false);
});

test("HOST_LOCAL_REQUIRED fails closed because Plan B owns no host-local backend", () => {
  const value = contract({
    RESOURCE_REQUIREMENTS: { EXECUTION_CLASS: "HOST_LOCAL_REQUIRED", OS_CLASS: "LINUX", ARCH_CLASS: "X64", WORKSPACE_CLASS: "READ_ONLY" }
  });
  const result = selectRuntimeBBackend(value);
  assert.equal(result.result, "BLOCKED");
  assert.equal(result.selected_backend, null);
  assert.deepEqual(result.reasons, ["RUNTIME_B:NO_BACKEND_FOR_HOST_LOCAL_REQUIRED"]);
});

test("hosted selection rejects source-write, secret, network-policy and oracle requirements", () => {
  const value = contract({
    EFFECT_CLASSES: ["REMOTE_SOURCE_WRITE"],
    CAPABILITY_REQUIREMENTS: ["GIT_CANDIDATE_WRITE", "NETWORK_EGRESS", "SOURCE_READ"],
    NETWORK_CLASS: "ALLOWLIST_MUTATE",
    SECRET_CLASS: "SOURCE_WRITE",
    REMOTE_MUTATION_INTENT: "EXACT_APPROVAL_REQUIRED",
    ORACLE_REQUIREMENT: "REQUIRED"
  });
  const hosted = compileV1HostedBinding(value);
  assert.equal(hosted.ok, false);
  assert.ok(hosted.reasons.some((reason) => reason.includes("SOURCE_WRITE_ZERO")));
  assert.ok(hosted.reasons.some((reason) => reason.includes("NETWORK_CLASS")));
  assert.ok(hosted.reasons.some((reason) => reason.includes("SECRET_CLASS")));
  assert.ok(hosted.reasons.some((reason) => reason.includes("ORACLE_REQUIREMENT")));
});

test("backend binding digest is backend-specific and cross-backend reuse is rejected", () => {
  const value = contract();
  const hosted = buildBackendBindingIdentity(value.TASK_CONTRACT_HASH, V1_HOSTED_BACKEND);
  const selfHosted = buildBackendBindingIdentity(value.TASK_CONTRACT_HASH, PLAN_A_BACKEND);
  assert.notEqual(hosted.backend_binding_sha256, selfHosted.backend_binding_sha256);

  const ok = verifyBackendBoundContext(hosted, {
    task_contract_hash: value.TASK_CONTRACT_HASH,
    backend_id: V1_HOSTED_BACKEND.backend_id,
    backend_kind: V1_HOSTED_BACKEND.backend_kind,
    backend_binding_sha256: hosted.backend_binding_sha256
  });
  assert.equal(ok.ok, true);

  const crossBackend = verifyBackendBoundContext(hosted, {
    task_contract_hash: value.TASK_CONTRACT_HASH,
    backend_id: PLAN_A_BACKEND.backend_id,
    backend_kind: PLAN_A_BACKEND.backend_kind,
    backend_binding_sha256: selfHosted.backend_binding_sha256
  });
  assert.equal(crossBackend.ok, false);
  assert.ok(crossBackend.errors.includes("BACKEND_ID_MISMATCH"));
  assert.ok(crossBackend.errors.includes("BACKEND_BINDING_EXPECTED_DIGEST_MISMATCH"));
});

test("invalid Task Contract is blocked before backend selection", () => {
  const value = contract();
  value.TASK_CONTRACT_HASH = "f".repeat(64);
  const result = selectRuntimeBBackend(value);
  assert.equal(result.result, "BLOCKED");
  assert.equal(result.selected_backend, null);
  assert.equal(result.candidate_evaluations.length, 0);
});

test("backend binding rejects structural extension even with recomputed-looking content", () => {
  const value = contract();
  const hosted = buildBackendBindingIdentity(value.TASK_CONTRACT_HASH, V1_HOSTED_BACKEND);
  const tampered = { ...hosted, approval: "ALLOW" };
  const result = verifyBackendBoundContext(tampered, {
    task_contract_hash: value.TASK_CONTRACT_HASH,
    backend_id: V1_HOSTED_BACKEND.backend_id,
    backend_kind: V1_HOSTED_BACKEND.backend_kind,
    backend_binding_sha256: hosted.backend_binding_sha256
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("BACKEND_BINDING_FIELDS_MISMATCH"));
});
