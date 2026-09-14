import test from "node:test";
import assert from "node:assert/strict";
import { computeTaskContractHash } from "../runtime/task-contract-v1.mjs";
import { compileRuntimeCDevPlane, validateRuntimeCDevelopmentTask } from "../runtime/plan-c-dev-plane.mjs";
import { buildRuntimeCTaskDag, validateRuntimeCTaskDag } from "../runtime/plan-c-dag.mjs";

function task(overrides = {}) {
  const value = {
    TASK_ID: "C-DEV-001",
    PROJECT_ID: "ATELIER",
    PHASE_ID: "PLAN-C",
    TASK_CLASS: "IMPLEMENTATION",
    WORKLOAD_CLASS: "REPOSITORY_CHANGE",
    SOURCE_IDENTITY: { KIND: "GIT", LOCATOR: "github:neoflowcore/atelier-runtime" },
    EXPECTED_HEAD: "2f82365b7270fd7b4cb15dcf4f87fe7e0e05f4d9",
    EFFECT_CLASSES: ["LOCAL_COMPUTE", "LOCAL_WORKSPACE_WRITE", "REMOTE_SOURCE_WRITE"],
    ALLOWED_SCOPE: ["path:src/example.ts", "repo:neoflowcore/example-target"],
    TOUCH_SET: [{ PATH: "src/example.ts", OPERATION: "UPDATE" }],
    CAPABILITY_REQUIREMENTS: ["FILESYSTEM_READ", "FILESYSTEM_WRITE", "GIT_CANDIDATE_WRITE", "NETWORK_EGRESS", "PROCESS_EXEC", "SOURCE_READ"],
    RESOURCE_REQUIREMENTS: { EXECUTION_CLASS: "SELF_HOSTED_REQUIRED", OS_CLASS: "LINUX", ARCH_CLASS: "X64", WORKSPACE_CLASS: "ISOLATED_WRITABLE" },
    NETWORK_CLASS: "ALLOWLIST_MUTATE",
    DATA_ACCESS_CLASS: "PRIVATE_SOURCE",
    SECRET_CLASS: "SOURCE_WRITE",
    REMOTE_MUTATION_INTENT: "EXACT_APPROVAL_REQUIRED",
    HOST_OPERATION_INTENT: "NONE",
    ORACLE_REQUIREMENT: "NONE",
    ACCEPTANCE_REQUIREMENTS: [{ ID: "A1", TEXT: "Only declared files may change." }],
    VERIFIER_REQUIREMENTS: [{ ID: "V1", TEXT: "Verify exact touch set." }],
    ECONOMY_BUDGET: { MAX_EXECUTIONS: 1, MAX_RETRIES: 0, MAX_REPAIRS: 0, MAX_PARALLELISM: 1 },
    INTERVENTION_POLICY: "BLOCK_ON_AMBIGUITY",
    REPLAN_BOUNDARY: "TASK_ONLY",
    EXPECTED_OUTPUTS: [{ ID: "O1", TEXT: "Candidate identity." }],
    EXPECTED_EVIDENCE: [{ ID: "E1", TEXT: "Exact readback." }],
    CONTRACT_VERSION: "1.0.0",
    TASK_CONTRACT_HASH: ""
  };
  Object.assign(value, overrides);
  value.TASK_CONTRACT_HASH = computeTaskContractHash(value);
  return value;
}

const bSeal = {
  receipt_type: "RUNTIME_B_SEAL_RECEIPT_V1", runtime_b_sealed: "YES", seal_decision: "SEALED", result: "PASS",
  sync_3: "NOT_EVALUATED", lease_state: "NOT_IMPLEMENTED_PLAN_D", validation_execution_source_write: 0,
  remote_source_write_authority: "NONE"
};

test("candidate-write Task Contract is eligible for isolated Runtime C development", () => {
  assert.deepEqual(validateRuntimeCDevelopmentTask(task()), { ok: true, errors: [] });
  const receipt = compileRuntimeCDevPlane(task(), bSeal);
  assert.equal(receipt.result, "ELIGIBLE");
  assert.equal(receipt.workspace_class, "ISOLATED_WRITABLE");
  assert.equal(receipt.remote_source_write_authority, "GATEWAY_ONLY");
  assert.equal(receipt.lease_state, "NOT_IMPLEMENTED_PLAN_D");
});

test("Runtime C blocks an unsealed Runtime B dependency", () => {
  const receipt = compileRuntimeCDevPlane(task(), { ...bSeal, runtime_b_sealed: "NO" });
  assert.equal(receipt.result, "BLOCKED");
  assert.ok(receipt.reasons.includes("RUNTIME_B_NOT_SEALED"));
});

test("Runtime C blocks direct merge effect", () => {
  const contract = task({ EFFECT_CLASSES: ["LOCAL_COMPUTE", "LOCAL_WORKSPACE_WRITE", "MERGE_OR_TAG", "REMOTE_SOURCE_WRITE"] });
  const result = validateRuntimeCDevelopmentTask(contract);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("EFFECT_FORBIDDEN_IN_PLAN_C:MERGE_OR_TAG"));
});

test("Runtime C blocks non-isolated workspace", () => {
  const contract = task({ RESOURCE_REQUIREMENTS: { EXECUTION_CLASS: "SELF_HOSTED_REQUIRED", OS_CLASS: "LINUX", ARCH_CLASS: "X64", WORKSPACE_CLASS: "READ_ONLY" } });
  assert.equal(validateRuntimeCDevelopmentTask(contract).ok, false);
});

test("controlled DAG has exactly two gateway remote-mutation nodes", () => {
  const dev = compileRuntimeCDevPlane(task(), bSeal);
  const dag = buildRuntimeCTaskDag(dev);
  assert.equal(dag.result, "READY");
  assert.deepEqual(validateRuntimeCTaskDag(dag), { ok: true, errors: [] });
  const mutationNodes = dag.nodes.filter((node) => node.remote_mutation);
  assert.deepEqual(mutationNodes.map((node) => node.node_id), ["CANDIDATE_PUSH_GATEWAY", "DRAFT_PR_GATEWAY"]);
  assert.ok(mutationNodes.every((node) => node.gateway_required));
});

test("controlled DAG contains no merge release or lease node", () => {
  const dag = buildRuntimeCTaskDag(compileRuntimeCDevPlane(task(), bSeal));
  assert.equal(dag.nodes.some((node) => /MERGE|RELEASE|LEASE/.test(node.node_id)), false);
});
