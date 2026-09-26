import test from "node:test";
import assert from "node:assert/strict";
import { computeRev51ObjectHash } from "../runtime/rev51/contract-core.mjs";
import {
  createWorkerJobV1,
  normalizeStructuredEntrypointV1,
  validateRuntimeExecutionPlanForWorkerJob
} from "../runtime/rev51/runtime-plan-worker-job-v1.mjs";

function validPlan(overrides = {}) {
  const plan = {
    SCHEMA_ID: "RUNTIME_EXECUTION_PLAN_V1",
    SCHEMA_VERSION: "1",
    CANONICALIZATION_ID: "ATELIER_REV51_JCS_V1",
    UPSTREAM_OBJECT_SHA256: "1".repeat(64),
    OBJECT_SHA256: "0".repeat(64),
    COMPUTE_PROVIDER: "DIGITALOCEAN",
    EXECUTION_TRANSPORT: "DIRECT_WORKER",
    VERIFIER_POLICY: "RUNTIME_REQUIRED",
    INPUT_MODE: "NATIVE_REV51",
    EXECUTION_INTENT_SHA256: "1".repeat(64),
    ...overrides
  };
  plan.OBJECT_SHA256 = computeRev51ObjectHash(plan);
  return plan;
}

function assignment(overrides = {}) {
  return {
    EXECUTION_ID: "exec-001",
    ATTEMPT_ID: "attempt-001",
    FENCE_TOKEN: "fence-001",
    ENTRYPOINT_SPEC: {
      executable: "node",
      argv: ["worker.mjs"],
      working_directory: "/workspace",
      environment_refs: ["env:runtime"],
      stdin_policy: "CLOSED",
      timeout: 900,
      expected_exit_codes: [0]
    },
    ...overrides
  };
}

test("runtime plan exact hash binds upstream and execution-plan hash", () => {
  const plan = validPlan();
  const job = createWorkerJobV1(plan, assignment());
  assert.equal(job.UPSTREAM_OBJECT_SHA256, plan.OBJECT_SHA256);
  assert.equal(job.EXECUTION_PLAN_HASH, plan.OBJECT_SHA256);
  assert.match(job.OBJECT_SHA256, /^[0-9a-f]{64}$/);
});

test("DIRECT_WORKER maps deterministically to DIRECT_REMOTE", () => {
  assert.equal(createWorkerJobV1(validPlan(), assignment()).EXECUTION_MODE, "DIRECT_REMOTE");
});

test("GITHUB_SELF_HOSTED_JIT maps deterministically to GITHUB_GATE", () => {
  const plan = validPlan({ EXECUTION_TRANSPORT: "GITHUB_SELF_HOSTED_JIT" });
  assert.equal(createWorkerJobV1(plan, assignment()).EXECUTION_MODE, "GITHUB_GATE");
});

test("worker job is deterministic for identical inputs", () => {
  const plan = validPlan();
  const a = createWorkerJobV1(plan, assignment());
  const b = createWorkerJobV1(plan, assignment());
  assert.deepEqual(a, b);
});

test("tampered runtime plan object hash is rejected", () => {
  const plan = validPlan();
  plan.VERIFIER_POLICY = "PROJECT_CI_REQUIRED";
  const result = validateRuntimeExecutionPlanForWorkerJob(plan);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("OBJECT_SHA256_MISMATCH"));
});

test("runtime-owned execution identity is required", () => {
  assert.throws(() => createWorkerJobV1(validPlan(), assignment({ EXECUTION_ID: "" })), /EXECUTION_ID_REQUIRED/);
});

test("runtime-owned attempt identity is required", () => {
  assert.throws(() => createWorkerJobV1(validPlan(), assignment({ ATTEMPT_ID: "" })), /ATTEMPT_ID_REQUIRED/);
});

test("runtime-owned fence token is required", () => {
  assert.throws(() => createWorkerJobV1(validPlan(), assignment({ FENCE_TOKEN: "" })), /FENCE_TOKEN_REQUIRED/);
});

test("structured entrypoint defaults shell interpretation to DENY", () => {
  const normalized = normalizeStructuredEntrypointV1(assignment().ENTRYPOINT_SPEC);
  assert.equal(normalized.schema_id, "ENTRYPOINT_SPEC_V1");
  assert.equal(normalized.shell_interpretation, "DENY");
});

test("shell entrypoint fields are denied", () => {
  assert.throws(
    () => normalizeStructuredEntrypointV1({ ...assignment().ENTRYPOINT_SPEC, shell: "node worker.mjs" }),
    /SHELL_ENTRYPOINT_FIELD_DENY:shell/
  );
});

test("semantic replanning is always denied", () => {
  const job = createWorkerJobV1(validPlan(), assignment());
  assert.equal(job.SEMANTIC_REPLANNING, "DENY");
});
