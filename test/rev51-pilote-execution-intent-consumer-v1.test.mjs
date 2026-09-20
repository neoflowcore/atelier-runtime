import test from "node:test";
import assert from "node:assert/strict";
import {
  A2_AUTHORITATIVE_BINDING,
  createRuntimeExecutionPlanV1,
  validateAuthoritativeIntentBinding
} from "../runtime/rev51/pilote-execution-intent-consumer-v1.mjs";

function validIntent(overrides = {}) {
  return {
    INTENT_TYPE: "PILOTE_EXECUTION_INTENT_V1",
    INTENT_VERSION: "1.0.0",
    INPUT_MODE: "NATIVE_REV51",
    CANONICALIZATION_ID: "ATELIER_EXECUTION_CANONICAL_JSON_V1",
    PROJECT_ID: "ATELIER-PILOTE",
    PHASE_ID: "R42-P2P3",
    TASK_ID: "R42-FIXTURE-READ-001",
    TASK_CONTRACT_SHA256: "d2fb156b45cb2f78f97e1550b2c972ada5e739ae0477fdc2944cb8e5b23ddb66",
    EXECUTION_PATH_POLICY: "RUNTIME_DECIDES",
    CAPABILITY_REQUIREMENTS: ["SOURCE_READ"],
    RESOURCE_INTENT: {CPU_MIN_MILLICORES:null,MEMORY_MIN_MIB:null,DISK_MIN_MIB:null,GPU_COUNT:null,GPU_MEMORY_MIN_MIB:null,GPU_CAPABILITY_CLASS:null},
    SECURITY_REQUIREMENT: {ISOLATION_CLASS:"DEFAULT",NETWORK_CLASS:"INHERIT_TASK",DATA_ACCESS_CLASS:"INHERIT_TASK",SECRET_CLASS:"INHERIT_TASK"},
    BUDGET_INTENT: {MAX_RUNTIME_SECONDS:null,MAX_COST_MICRO_USD:null},
    CHECKPOINT_POLICY: "NOT_REQUESTED",
    CACHE_POLICY: "NOT_REQUESTED",
    DATA_LOCALITY_POLICY: "NONE",
    VERIFIER_POLICY_REF: {ID:"verifier.runtime.required",VERSION:"1.0.0",SHA256:"2".repeat(64)},
    ACCEPTANCE_REQUIREMENT_REF: "task-contract:ACCEPTANCE_REQUIREMENTS",
    APPROVAL_BOUNDARY: {MODE:"INHERIT_TASK",EFFECT_CLASS_REFS:["READ_ONLY"],SCOPE_REFS:["repo:neoflowcore/atelier-runtime"]},
    OPERATOR_POLICY: "ZERO_TOUCH_AFTER_APPROVAL",
    SEMANTIC_DEPENDENCY_REFS: [],
    PARALLELISM_INTENT: "INHERIT_DAG",
    EXPECTED_OUTPUT_CLASSES: ["TASK_DECLARED_OUTPUTS"],
    EXPECTED_EVIDENCE_CLASSES: ["TASK_DECLARED_EVIDENCE"],
    CONTRACT_SET_REF: {ID:"ATELIER_REV51_CONTRACT_SET_V1",VERSION:"1.0.0",SHA256:A2_AUTHORITATIVE_BINDING.CONTRACT_SET_SHA256},
    INTENT_SHA256: "68f231d23a0181ee08bab90df8619ae8b4e8c8ba9ba57ccbe1fa02d75069127e",
    ...overrides
  };
}
function selection(overrides = {}) {
  return {
    COMPUTE_PROVIDER: "DIGITALOCEAN",
    EXECUTION_TRANSPORT: "DIRECT_WORKER",
    VERIFIER_POLICY: "RUNTIME_REQUIRED",
    VERIFIER_POLICY_REF_SHA256: "2".repeat(64),
    ...overrides
  };
}

test("A2 authoritative identities stay exact", () => {
  assert.equal(A2_AUTHORITATIVE_BINDING.HEAD, "53716039bb0df7d725bf8d8b791f376ee17d9551");
  assert.equal(A2_AUTHORITATIVE_BINDING.TREE, "071d6a4e08fe97d32775336eddaf703535fa6871");
  assert.equal(A2_AUTHORITATIVE_BINDING.INTENT_SCHEMA_SHA256, "31fd4c004726434c9b01614aa6f1d2b58409e58dd2af09d492a4a79f483bd82a");
});

test("native provider-neutral intent binds", () => {
  assert.deepEqual(validateAuthoritativeIntentBinding(validIntent()), {ok:true, errors:[]});
});

test("legacy downgrade is denied", () => {
  const r=validateAuthoritativeIntentBinding(validIntent({INPUT_MODE:"LEGACY_COMPAT"}));
  assert.equal(r.ok,false);
  assert.ok(r.errors.includes("INPUT_MODE_MUST_BE_NATIVE_REV51"));
});

test("concrete provider identity in Pilote intent is denied", () => {
  const r=validateAuthoritativeIntentBinding(validIntent({PROVIDER_ID:"do-123"}));
  assert.equal(r.ok,false);
  assert.ok(r.errors.some(x=>x.includes("FORBIDDEN_CONCRETE_INFRASTRUCTURE")));
});

test("runtime plan binds exact upstream intent hash and contract set", () => {
  const plan=createRuntimeExecutionPlanV1(validIntent(),selection());
  assert.equal(plan.UPSTREAM_OBJECT_SHA256, validIntent().INTENT_SHA256);
  assert.equal(plan.EXECUTION_INTENT_SHA256, validIntent().INTENT_SHA256);
  assert.equal(plan.CONTRACT_SET_SHA256, A2_AUTHORITATIVE_BINDING.CONTRACT_SET_SHA256);
  assert.equal(plan.INPUT_MODE, "NATIVE_REV51");
  assert.match(plan.OBJECT_SHA256,/^[0-9a-f]{64}$/);
});

test("verifier policy is hash-bound, not reinterpreted", () => {
  assert.throws(()=>createRuntimeExecutionPlanV1(validIntent(),selection({VERIFIER_POLICY_REF_SHA256:"3".repeat(64)})),/VERIFIER_POLICY_REF_HASH_MISMATCH/);
});

test("GITHUB_GATE_REQUIRED cannot realize as direct worker", () => {
  const intent=validIntent({EXECUTION_PATH_POLICY:"GITHUB_GATE_REQUIRED"});
  assert.throws(()=>createRuntimeExecutionPlanV1(intent,selection({EXECUTION_TRANSPORT:"DIRECT_WORKER"})),/GITHUB_GATE_REQUIRED_TRANSPORT_MISMATCH/);
});

test("GITHUB_GATE_REQUIRED binds to JIT transport", () => {
  const intent=validIntent({EXECUTION_PATH_POLICY:"GITHUB_GATE_REQUIRED"});
  const plan=createRuntimeExecutionPlanV1(intent,selection({EXECUTION_TRANSPORT:"GITHUB_SELF_HOSTED_JIT"}));
  assert.equal(plan.EXECUTION_TRANSPORT,"GITHUB_SELF_HOSTED_JIT");
});
