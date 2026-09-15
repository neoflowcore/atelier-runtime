import test from "node:test";
import assert from "node:assert/strict";
import { computeTaskContractHash } from "../runtime/task-contract-v1.mjs";
import { compileRuntimeCDevPlane } from "../runtime/plan-c-dev-plane.mjs";
import { buildRuntimeCTaskDag } from "../runtime/plan-c-dag.mjs";
import { buildRuntimeCMutationEnvelope, verifyRuntimeCMutationEnvelope } from "../runtime/plan-c-source-write-gateway.mjs";
import { appendRuntimeCMutationJournal, evaluateRuntimeCProviderReadback, validateRuntimeCMutationJournal } from "../runtime/plan-c-readback-journal.mjs";

function task() {
  const value = {
    TASK_ID: "C-GATE-001", PROJECT_ID: "ATELIER", PHASE_ID: "PLAN-C", TASK_CLASS: "IMPLEMENTATION", WORKLOAD_CLASS: "REPOSITORY_CHANGE",
    SOURCE_IDENTITY: { KIND: "GIT", LOCATOR: "github:neoflowcore/atelier-runtime" }, EXPECTED_HEAD: "2f82365b7270fd7b4cb15dcf4f87fe7e0e05f4d9",
    EFFECT_CLASSES: ["LOCAL_COMPUTE", "LOCAL_WORKSPACE_WRITE", "REMOTE_SOURCE_WRITE"], ALLOWED_SCOPE: ["path:src/example.ts", "repo:neoflowcore/example-target"],
    TOUCH_SET: [{ PATH: "src/example.ts", OPERATION: "UPDATE" }], CAPABILITY_REQUIREMENTS: ["FILESYSTEM_READ", "FILESYSTEM_WRITE", "GIT_CANDIDATE_WRITE", "NETWORK_EGRESS", "PROCESS_EXEC", "SOURCE_READ"],
    RESOURCE_REQUIREMENTS: { EXECUTION_CLASS: "SELF_HOSTED_REQUIRED", OS_CLASS: "LINUX", ARCH_CLASS: "X64", WORKSPACE_CLASS: "ISOLATED_WRITABLE" },
    NETWORK_CLASS: "ALLOWLIST_MUTATE", DATA_ACCESS_CLASS: "PRIVATE_SOURCE", SECRET_CLASS: "SOURCE_WRITE", REMOTE_MUTATION_INTENT: "EXACT_APPROVAL_REQUIRED", HOST_OPERATION_INTENT: "NONE", ORACLE_REQUIREMENT: "NONE",
    ACCEPTANCE_REQUIREMENTS: [{ ID: "A1", TEXT: "Exact touch set." }], VERIFIER_REQUIREMENTS: [{ ID: "V1", TEXT: "Provider readback." }], ECONOMY_BUDGET: { MAX_EXECUTIONS: 1, MAX_RETRIES: 0, MAX_REPAIRS: 0, MAX_PARALLELISM: 1 },
    INTERVENTION_POLICY: "BLOCK_ON_AMBIGUITY", REPLAN_BOUNDARY: "TASK_ONLY", EXPECTED_OUTPUTS: [{ ID: "O1", TEXT: "Candidate." }], EXPECTED_EVIDENCE: [{ ID: "E1", TEXT: "Readback." }], CONTRACT_VERSION: "1.0.0", TASK_CONTRACT_HASH: ""
  };
  value.TASK_CONTRACT_HASH = computeTaskContractHash(value);
  return value;
}
const bSeal = { receipt_type: "RUNTIME_B_SEAL_RECEIPT_V1", runtime_b_sealed: "YES", seal_decision: "SEALED", result: "PASS", sync_3: "NOT_EVALUATED", lease_state: "NOT_IMPLEMENTED_PLAN_D", validation_execution_source_write: 0, remote_source_write_authority: "NONE" };
const authority = "a".repeat(64);
const candidateSha = "b".repeat(40);

function ctx() {
  const contract = task();
  const dev = compileRuntimeCDevPlane(contract, bSeal);
  const dag = buildRuntimeCTaskDag(dev);
  return { contract, dev, dag };
}

test("candidate push is exact-head bound and force=false", () => {
  const { contract, dev, dag } = ctx();
  const built = buildRuntimeCMutationEnvelope({
    task_contract: contract, dev_plane_receipt: dev, dag_receipt: dag, authority_evidence_sha256: authority, operation: "CANDIDATE_BRANCH_PUSH",
    target: { repository: "neoflowcore/example-target", base_ref: "main", candidate_ref: "pilote-CS-1234", expected_base_head: contract.EXPECTED_HEAD, candidate_commit_sha: candidateSha, force: false }
  });
  assert.equal(built.ok, true);
  assert.deepEqual(verifyRuntimeCMutationEnvelope(built.envelope), { ok: true, errors: [] });
  assert.equal(built.envelope.merge_authority, "NONE");
  assert.equal(built.envelope.final_merge_authority, "HUMAN_ONLY");
});

test("force push is denied", () => {
  const { contract, dev, dag } = ctx();
  const built = buildRuntimeCMutationEnvelope({ task_contract: contract, dev_plane_receipt: dev, dag_receipt: dag, authority_evidence_sha256: authority, operation: "CANDIDATE_BRANCH_PUSH",
    target: { repository: "neoflowcore/example-target", base_ref: "main", candidate_ref: "pilote-CS-1234", expected_base_head: contract.EXPECTED_HEAD, candidate_commit_sha: candidateSha, force: true } });
  assert.equal(built.ok, false);
  assert.ok(built.errors.includes("FORCE_PUSH_DENY"));
});

test("direct main candidate write is denied", () => {
  const { contract, dev, dag } = ctx();
  const built = buildRuntimeCMutationEnvelope({ task_contract: contract, dev_plane_receipt: dev, dag_receipt: dag, authority_evidence_sha256: authority, operation: "CANDIDATE_BRANCH_PUSH",
    target: { repository: "neoflowcore/example-target", base_ref: "release", candidate_ref: "main", expected_base_head: contract.EXPECTED_HEAD, candidate_commit_sha: candidateSha, force: false } });
  assert.equal(built.ok, false);
  assert.ok(built.errors.includes("PROTECTED_DIRECT_WRITE_DENY"));
});

test("repository outside Task Contract allowed scope is denied", () => {
  const { contract, dev, dag } = ctx();
  const built = buildRuntimeCMutationEnvelope({ task_contract: contract, dev_plane_receipt: dev, dag_receipt: dag, authority_evidence_sha256: authority, operation: "CANDIDATE_BRANCH_PUSH",
    target: { repository: "neoflowcore/not-approved", base_ref: "main", candidate_ref: "candidate/x", expected_base_head: contract.EXPECTED_HEAD, candidate_commit_sha: candidateSha, force: false } });
  assert.equal(built.ok, false);
  assert.ok(built.errors.includes("REPOSITORY_OUTSIDE_ALLOWED_SCOPE"));
});

test("Draft PR creation requires draft=true", () => {
  const { contract, dev, dag } = ctx();
  const bad = buildRuntimeCMutationEnvelope({ task_contract: contract, dev_plane_receipt: dev, dag_receipt: dag, authority_evidence_sha256: authority, operation: "DRAFT_PR_CREATE",
    target: { repository: "neoflowcore/example-target", base_ref: "main", head_ref: "pilote-CS-1234", head_sha: candidateSha, draft: false } });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.includes("DRAFT_PR_REQUIRED"));
});

test("missing provider observation is pending and schedules no blind retry", () => {
  const { contract, dev, dag } = ctx();
  const envelope = buildRuntimeCMutationEnvelope({ task_contract: contract, dev_plane_receipt: dev, dag_receipt: dag, authority_evidence_sha256: authority, operation: "CANDIDATE_BRANCH_PUSH",
    target: { repository: "neoflowcore/example-target", base_ref: "main", candidate_ref: "pilote-CS-1234", expected_base_head: contract.EXPECTED_HEAD, candidate_commit_sha: candidateSha, force: false } }).envelope;
  const readback = evaluateRuntimeCProviderReadback(envelope, null);
  assert.equal(readback.state, "PENDING_PROVIDER_READBACK");
  assert.equal(readback.retry_scheduled_by_runtime, false);
});

test("candidate provider readback must match exact head", () => {
  const { contract, dev, dag } = ctx();
  const envelope = buildRuntimeCMutationEnvelope({ task_contract: contract, dev_plane_receipt: dev, dag_receipt: dag, authority_evidence_sha256: authority, operation: "CANDIDATE_BRANCH_PUSH",
    target: { repository: "neoflowcore/example-target", base_ref: "main", candidate_ref: "pilote-CS-1234", expected_base_head: contract.EXPECTED_HEAD, candidate_commit_sha: candidateSha, force: false } }).envelope;
  const pass = evaluateRuntimeCProviderReadback(envelope, { operation: "CANDIDATE_BRANCH_PUSH", repository: "neoflowcore/example-target", candidate_ref: "pilote-CS-1234", observed_head_sha: candidateSha });
  assert.equal(pass.result, "PASS");
  const fail = evaluateRuntimeCProviderReadback(envelope, { operation: "CANDIDATE_BRANCH_PUSH", repository: "neoflowcore/example-target", candidate_ref: "pilote-CS-1234", observed_head_sha: "c".repeat(40) });
  assert.equal(fail.result, "BLOCKED");
});

test("Draft PR readback must remain draft", () => {
  const { contract, dev, dag } = ctx();
  const envelope = buildRuntimeCMutationEnvelope({ task_contract: contract, dev_plane_receipt: dev, dag_receipt: dag, authority_evidence_sha256: authority, operation: "DRAFT_PR_CREATE",
    target: { repository: "neoflowcore/example-target", base_ref: "main", head_ref: "pilote-CS-1234", head_sha: candidateSha, draft: true } }).envelope;
  const readback = evaluateRuntimeCProviderReadback(envelope, { operation: "DRAFT_PR_CREATE", repository: "neoflowcore/example-target", base_ref: "main", head_ref: "pilote-CS-1234", head_sha: candidateSha, draft: true, pr_number: 12 });
  assert.equal(readback.result, "PASS");
});

test("mutation journal is append-only hash chained", () => {
  const { contract, dev, dag } = ctx();
  const envelope = buildRuntimeCMutationEnvelope({ task_contract: contract, dev_plane_receipt: dev, dag_receipt: dag, authority_evidence_sha256: authority, operation: "CANDIDATE_BRANCH_PUSH",
    target: { repository: "neoflowcore/example-target", base_ref: "main", candidate_ref: "pilote-CS-1234", expected_base_head: contract.EXPECTED_HEAD, candidate_commit_sha: candidateSha, force: false } }).envelope;
  const readback = evaluateRuntimeCProviderReadback(envelope, { operation: "CANDIDATE_BRANCH_PUSH", repository: "neoflowcore/example-target", candidate_ref: "pilote-CS-1234", observed_head_sha: candidateSha });
  const journal = appendRuntimeCMutationJournal([], envelope, readback);
  assert.deepEqual(validateRuntimeCMutationJournal(journal), { ok: true, errors: [] });
  const tampered = [{ ...journal[0], operation: "DRAFT_PR_CREATE" }];
  assert.equal(validateRuntimeCMutationJournal(tampered).ok, false);
});
