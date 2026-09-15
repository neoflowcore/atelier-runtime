import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { computeTaskContractHash } from "../runtime/task-contract-v1.mjs";
import { PLAN_A_BACKEND, buildPlanABackendReceipt, compilePlanABackendBinding } from "../runtime/backend-plan-a.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = process.env.SYNC1_FIXTURE_ROOT ?? join(here, "..", "fixtures", "runtime-a", "interface-v1");

async function fixture(name) {
  return JSON.parse(await readFile(join(fixtureRoot, name), "utf8"));
}

async function selfHostedReadOnlyContract() {
  const contract = await fixture("valid_01_read_only.json");
  contract.TASK_ID = "RUNTIME-A-SELF-HOSTED-READ-001";
  contract.RESOURCE_REQUIREMENTS = {
    EXECUTION_CLASS: "SELF_HOSTED_REQUIRED",
    OS_CLASS: "LINUX",
    ARCH_CLASS: "X64",
    WORKSPACE_CLASS: "READ_ONLY"
  };
  contract.TASK_CONTRACT_HASH = computeTaskContractHash(contract);
  return contract;
}

test("Plan A backend identity is fixed and has no hosted fallback", () => {
  assert.deepEqual(PLAN_A_BACKEND.runner_labels, ["self-hosted", "linux", "x64", "atelier-runtime-v1"]);
  assert.equal(PLAN_A_BACKEND.fallback_backend_id, null);
  assert.equal(PLAN_A_BACKEND.target_source_write_authority, "NONE");
});

test("explicit SELF_HOSTED_REQUIRED Linux x64 read-only task is eligible", async () => {
  const contract = await selfHostedReadOnlyContract();
  const plan = compilePlanABackendBinding(contract);
  assert.equal(plan.ok, true, plan.reasons.join(","));
  assert.equal(plan.result, "ELIGIBLE");
  assert.equal(plan.binding.backend_id, "SELF_HOSTED_LINUX_X64_V1");
  assert.equal(plan.binding.fallback_backend_id, null);
  assert.equal(plan.binding.target_source_write_authority, "NONE");
});

test("RUNTIME_DEFAULT is not silently routed to self-hosted in Plan A", async () => {
  const contract = await fixture("valid_01_read_only.json");
  const plan = compilePlanABackendBinding(contract);
  assert.equal(plan.ok, false);
  assert.ok(plan.reasons.includes("RESOURCE_REQUIREMENTS.EXECUTION_CLASS:PLAN_A_REQUIRES_SELF_HOSTED_REQUIRED"));
});

test("candidate-write fixture is understood but blocked by Plan A fences", async () => {
  const contract = await fixture("valid_02_candidate_write_intent.json");
  const plan = compilePlanABackendBinding(contract);
  assert.equal(plan.ok, false);
  assert.ok(plan.reasons.includes("REMOTE_MUTATION_INTENT:PLAN_A_SOURCE_WRITE_ZERO"));
  assert.ok(plan.reasons.includes("SECRET_CLASS:PLAN_A_SECRET_ISSUANCE_NOT_AVAILABLE"));
  assert.ok(plan.reasons.some((reason) => reason.includes("GIT_CANDIDATE_WRITE:PLAN_A_UNSUPPORTED")));
});


test("Plan A requires SOURCE_READ for Git source acquisition", async () => {
  const contract = await selfHostedReadOnlyContract();
  contract.CAPABILITY_REQUIREMENTS = [];
  contract.TASK_CONTRACT_HASH = computeTaskContractHash(contract);
  const plan = compilePlanABackendBinding(contract);
  assert.equal(plan.ok, false);
  assert.ok(plan.reasons.includes("CAPABILITY_REQUIREMENTS:SOURCE_READ_REQUIRED_FOR_GIT"));
});

test("Plan A blocks any non-read touch declaration in validation plane", async () => {
  const contract = await selfHostedReadOnlyContract();
  contract.TOUCH_SET = [{ PATH: "README.md", OPERATION: "UPDATE" }];
  contract.TASK_CONTRACT_HASH = computeTaskContractHash(contract);
  const plan = compilePlanABackendBinding(contract);
  assert.equal(plan.ok, false);
  assert.ok(plan.reasons.includes("TOUCH_SET:PLAN_A_READ_ONLY_REQUIRED"));
});

test("Plan A backend receipt binds interface, task hash and actual backend identity", async () => {
  const contract = await selfHostedReadOnlyContract();
  const receipt = buildPlanABackendReceipt(contract);
  assert.equal(receipt.result, "ELIGIBLE");
  assert.equal(receipt.interface_manifest_sha256, "90b016211babd4f10b7de7700c54ea6e2db9179563d88502fc1d9983ad47b617");
  assert.equal(receipt.task_contract_hash, contract.TASK_CONTRACT_HASH);
  assert.equal(receipt.backend_identity.backend_id, "SELF_HOSTED_LINUX_X64_V1");
  assert.equal(receipt.target_source_write_authority, "NONE");
  assert.equal(receipt.fallback_backend_id, null);
});
