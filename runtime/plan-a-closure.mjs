import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PLAN_A_BACKEND } from "./backend-plan-a.mjs";
import {
  INTERFACE_VERSION,
  INTERFACE_MANIFEST_SHA256,
  TASK_CONTRACT_SCHEMA_SHA256,
  TASK_CONTRACT_MACHINE_SCHEMA_SHA256
} from "./task-contract-v1.mjs";

export const PLAN_A_CLOSURE_RECEIPT_TYPE = "RUNTIME_A_PLAN_A_CLOSURE_V1";
export const PLAN_A_CLOSURE_SCHEMA_VERSION = 1;
export const PLAN_A_COMPONENT_MANIFEST_TYPE = "RUNTIME_A_PLAN_A_COMPONENT_MANIFEST_V1";
export const RUNTIME_V1_CONTROL_SHA = "cee87103e61656f8ddae57caf7e5a500636df252";
export const RUNTIME_DEVELOPMENT_BASE_SHA = "2f82365b7270fd7b4cb15dcf4f87fe7e0e05f4d9";
export const RUNTIME_DEVELOPMENT_BASE_TREE = "4fc4081accb3ad2a649c90dc236f4284612e7f4f";
export const BASELINE_EPOCH_ID = "11cfb57b2cd0f4d36e6c064ee908ab198677d5309529c2054829cc9da7f103a3";

const SHA40_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

export const PLAN_A_OWNED_PATHS = Object.freeze([
  ".github/workflows/runtime-a-self-hosted-foundation.yml",
  "docs/RUNTIME_A_SELF_HOSTED_FOUNDATION.md",
  "fixtures/runtime-a/interface-v1/CANONICALIZATION_VECTORS.json",
  "fixtures/runtime-a/interface-v1/EXPECTED_RESULTS.json",
  "fixtures/runtime-a/interface-v1/SOURCE_BINDING.json",
  "fixtures/runtime-a/interface-v1/invalid_01_runtime_owned_backend_id.json",
  "fixtures/runtime-a/interface-v1/invalid_02_granted_authority_field.json",
  "fixtures/runtime-a/interface-v1/invalid_03_effect_capability_mismatch.json",
  "fixtures/runtime-a/interface-v1/task-contract-core.schema.json",
  "fixtures/runtime-a/interface-v1/valid_01_read_only.json",
  "fixtures/runtime-a/interface-v1/valid_02_candidate_write_intent.json",
  "fixtures/runtime-a/interface-v1/valid_03_oracle_evidence_only.json",
  "fixtures/runtime-a/plan-a-component-manifest.json",
  "fixtures/runtime-a/self_hosted_read_only.json",
  "runtime/backend-plan-a.mjs",
  "runtime/plan-a-closure.mjs",
  "runtime/plan-a-evidence-binding.mjs",
  "runtime/plan-a-foundation.mjs",
  "runtime/run-plan-a-closure-gate.mjs",
  "runtime/run-plan-a-closure.mjs",
  "runtime/run-plan-a-evidence-binding-gate.mjs",
  "runtime/run-plan-a-evidence-binding.mjs",
  "runtime/run-plan-a-foundation-gate.mjs",
  "runtime/run-plan-a-foundation.mjs",
  "runtime/run-plan-a-worker-attestation-gate.mjs",
  "runtime/run-plan-a-worker-attestation.mjs",
  "runtime/task-contract-v1.mjs",
  "runtime/worker-attestation-plan-a.mjs",
  "schemas/runtime-a-closure.schema.json",
  "schemas/runtime-a-evidence-binding.schema.json",
  "schemas/runtime-a-foundation-receipt.schema.json",
  "schemas/runtime-a-worker-attestation.schema.json",
  "test/backend-plan-a.test.mjs",
  "test/plan-a-closure.test.mjs",
  "test/plan-a-evidence-binding.test.mjs",
  "test/plan-a-foundation.test.mjs",
  "test/plan-a-workflow.test.mjs",
  "test/task-contract-v1.test.mjs",
  "test/worker-attestation-plan-a.test.mjs"
]);

const RECEIPT_FIELDS = Object.freeze([
  "receipt_schema_version",
  "receipt_type",
  "candidate_class",
  "repository",
  "runtime_v1_control_sha",
  "development_base_sha",
  "development_base_tree",
  "candidate_sha",
  "candidate_tree",
  "baseline_epoch_id",
  "interface_version",
  "interface_manifest_sha256",
  "task_contract_schema_sha256",
  "task_contract_machine_schema_sha256",
  "backend_id",
  "component_manifest_sha256",
  "component_count",
  "remote_snapshot_sha256",
  "remote_component_binding",
  "changed_paths_sha256",
  "changed_file_count",
  "observed_workflow_runs",
  "v1_non_regression",
  "interface_core_binding",
  "live_self_hosted_invocation",
  "runtime_a_sealed",
  "sync2_state",
  "lease_state",
  "remote_source_write_authority",
  "result",
  "failure_reason"
]);

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sha256Json(value) {
  return sha256Bytes(Buffer.from(JSON.stringify(value), "utf8"));
}

function sortedUnique(values) {
  return [...new Set(values)].sort((a, b) => Buffer.from(a).compare(Buffer.from(b)));
}

export async function verifyPlanAComponentManifest(rootDirectory, manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return { ok: false, errors: ["MANIFEST_MISSING"] };
  if (manifest.manifest_version !== 1) errors.push("INVALID_MANIFEST_VERSION");
  if (manifest.manifest_type !== PLAN_A_COMPONENT_MANIFEST_TYPE) errors.push("INVALID_MANIFEST_TYPE");
  if (manifest.interface_version !== INTERFACE_VERSION) errors.push("MANIFEST_INTERFACE_VERSION_MISMATCH");
  if (manifest.interface_manifest_sha256 !== INTERFACE_MANIFEST_SHA256) errors.push("MANIFEST_INTERFACE_HASH_MISMATCH");
  if (!Array.isArray(manifest.components) || manifest.components.length < 1) errors.push("MANIFEST_COMPONENTS_INVALID");

  const componentPaths = Array.isArray(manifest.components) ? manifest.components.map((entry) => entry?.path) : [];
  const expectedManifestPaths = PLAN_A_OWNED_PATHS.filter((path) => path !== "fixtures/runtime-a/plan-a-component-manifest.json");
  if (JSON.stringify(sortedUnique(componentPaths)) !== JSON.stringify(sortedUnique(expectedManifestPaths))) {
    errors.push("MANIFEST_COMPONENT_SET_MISMATCH");
  }

  for (const entry of manifest.components ?? []) {
    if (!entry || typeof entry.path !== "string" || !SHA256_RE.test(entry.sha256 ?? "")) {
      errors.push("MANIFEST_COMPONENT_ENTRY_INVALID");
      continue;
    }
    try {
      const bytes = await readFile(resolve(rootDirectory, entry.path));
      if (sha256Bytes(bytes) !== entry.sha256) errors.push(`COMPONENT_SHA256_MISMATCH:${entry.path}`);
    } catch {
      errors.push(`COMPONENT_MISSING:${entry.path}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

export function validatePlanARemoteSnapshot(snapshot) {
  const errors = [];
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return { ok: false, errors: ["REMOTE_SNAPSHOT_MISSING"] };
  if (snapshot.repository !== "neoflowcore/atelier-runtime") errors.push("REPOSITORY_MISMATCH");
  if (snapshot.main_sha !== RUNTIME_DEVELOPMENT_BASE_SHA) errors.push("DEVELOPMENT_BASE_SHA_DRIFT");
  if (snapshot.main_tree !== RUNTIME_DEVELOPMENT_BASE_TREE) errors.push("DEVELOPMENT_BASE_TREE_DRIFT");
  if (!SHA40_RE.test(snapshot.candidate_sha ?? "")) errors.push("INVALID_CANDIDATE_SHA");
  if (!SHA40_RE.test(snapshot.candidate_tree ?? "")) errors.push("INVALID_CANDIDATE_TREE");
  if (!Number.isInteger(snapshot.ahead_by) || snapshot.ahead_by < 1) errors.push("INVALID_AHEAD_BY");
  if (snapshot.behind_by !== 0) errors.push("CANDIDATE_BEHIND_BASE");
  if (!Number.isInteger(snapshot.total_commits) || snapshot.total_commits !== snapshot.ahead_by) errors.push("COMMIT_COUNT_MISMATCH");
  if (!Number.isInteger(snapshot.workflow_runs_count) || snapshot.workflow_runs_count !== 0) errors.push("UNEXPECTED_WORKFLOW_RUNS");
  if (snapshot.component_tree_binding !== "PASS") errors.push("REMOTE_COMPONENT_TREE_BINDING_NOT_PASS");
  if (!Array.isArray(snapshot.changed_paths) || snapshot.changed_paths.length < 1) {
    errors.push("CHANGED_PATHS_MISSING");
  } else {
    const allowed = new Set(PLAN_A_OWNED_PATHS);
    const normalized = sortedUnique(snapshot.changed_paths);
    if (normalized.length !== snapshot.changed_paths.length) errors.push("CHANGED_PATHS_NOT_UNIQUE");
    for (const path of normalized) if (!allowed.has(path)) errors.push(`V1_OR_FOREIGN_PATH_CHANGED:${path}`);
  }
  return { ok: errors.length === 0, errors };
}

export async function buildPlanAClosureReceipt({ rootDirectory, manifest, manifestSha256, remoteSnapshot }) {
  const manifestValidation = await verifyPlanAComponentManifest(rootDirectory, manifest);
  const remoteValidation = validatePlanARemoteSnapshot(remoteSnapshot);
  const errors = [...manifestValidation.errors, ...remoteValidation.errors];
  const changedPaths = sortedUnique(remoteSnapshot?.changed_paths ?? []);
  return {
    receipt_schema_version: PLAN_A_CLOSURE_SCHEMA_VERSION,
    receipt_type: PLAN_A_CLOSURE_RECEIPT_TYPE,
    candidate_class: "COMPATIBLE_FINAL_CANDIDATE_STATIC",
    repository: "neoflowcore/atelier-runtime",
    runtime_v1_control_sha: RUNTIME_V1_CONTROL_SHA,
    development_base_sha: RUNTIME_DEVELOPMENT_BASE_SHA,
    development_base_tree: RUNTIME_DEVELOPMENT_BASE_TREE,
    candidate_sha: remoteSnapshot?.candidate_sha ?? null,
    candidate_tree: remoteSnapshot?.candidate_tree ?? null,
    baseline_epoch_id: BASELINE_EPOCH_ID,
    interface_version: INTERFACE_VERSION,
    interface_manifest_sha256: INTERFACE_MANIFEST_SHA256,
    task_contract_schema_sha256: TASK_CONTRACT_SCHEMA_SHA256,
    task_contract_machine_schema_sha256: TASK_CONTRACT_MACHINE_SCHEMA_SHA256,
    backend_id: PLAN_A_BACKEND.backend_id,
    component_manifest_sha256: manifestSha256 ?? sha256Json(manifest),
    component_count: manifest?.components?.length ?? 0,
    remote_snapshot_sha256: sha256Json(remoteSnapshot ?? {}),
    remote_component_binding: remoteSnapshot?.component_tree_binding === "PASS" ? "PASS" : "FAIL",
    changed_paths_sha256: sha256Json(changedPaths),
    changed_file_count: changedPaths.length,
    observed_workflow_runs: remoteSnapshot?.workflow_runs_count ?? null,
    v1_non_regression: remoteValidation.ok ? "PASS" : "FAIL",
    interface_core_binding: manifestValidation.ok ? "PASS" : "FAIL",
    live_self_hosted_invocation: "NOT_RUN",
    runtime_a_sealed: "NO",
    sync2_state: "WAITING_A_REV42_SEALED_MANIFEST",
    lease_state: "NOT_IMPLEMENTED_PLAN_D",
    remote_source_write_authority: "NONE",
    result: errors.length === 0 ? "PASS" : "BLOCKED",
    failure_reason: errors[0] ?? null
  };
}

export function validatePlanAClosureReceipt(receipt) {
  const errors = [];
  if (!exactKeys(receipt, RECEIPT_FIELDS)) errors.push("INVALID_TOP_LEVEL_FIELDS");
  if (receipt?.receipt_schema_version !== PLAN_A_CLOSURE_SCHEMA_VERSION) errors.push("INVALID_RECEIPT_SCHEMA_VERSION");
  if (receipt?.receipt_type !== PLAN_A_CLOSURE_RECEIPT_TYPE) errors.push("INVALID_RECEIPT_TYPE");
  if (receipt?.candidate_class !== "COMPATIBLE_FINAL_CANDIDATE_STATIC") errors.push("INVALID_CANDIDATE_CLASS");
  if (receipt?.repository !== "neoflowcore/atelier-runtime") errors.push("INVALID_REPOSITORY");
  if (receipt?.runtime_v1_control_sha !== RUNTIME_V1_CONTROL_SHA) errors.push("INVALID_V1_CONTROL_SHA");
  if (receipt?.development_base_sha !== RUNTIME_DEVELOPMENT_BASE_SHA) errors.push("INVALID_DEVELOPMENT_BASE_SHA");
  if (receipt?.development_base_tree !== RUNTIME_DEVELOPMENT_BASE_TREE) errors.push("INVALID_DEVELOPMENT_BASE_TREE");
  if (!SHA40_RE.test(receipt?.candidate_sha ?? "")) errors.push("INVALID_CANDIDATE_SHA");
  if (!SHA40_RE.test(receipt?.candidate_tree ?? "")) errors.push("INVALID_CANDIDATE_TREE");
  if (receipt?.baseline_epoch_id !== BASELINE_EPOCH_ID) errors.push("INVALID_BASELINE_EPOCH_ID");
  if (receipt?.interface_version !== INTERFACE_VERSION) errors.push("INVALID_INTERFACE_VERSION");
  if (receipt?.interface_manifest_sha256 !== INTERFACE_MANIFEST_SHA256) errors.push("INVALID_INTERFACE_MANIFEST_SHA256");
  if (receipt?.task_contract_schema_sha256 !== TASK_CONTRACT_SCHEMA_SHA256) errors.push("INVALID_TASK_CONTRACT_SCHEMA_SHA256");
  if (receipt?.task_contract_machine_schema_sha256 !== TASK_CONTRACT_MACHINE_SCHEMA_SHA256) errors.push("INVALID_TASK_CONTRACT_MACHINE_SCHEMA_SHA256");
  if (receipt?.backend_id !== PLAN_A_BACKEND.backend_id) errors.push("INVALID_BACKEND_ID");
  if (!SHA256_RE.test(receipt?.component_manifest_sha256 ?? "")) errors.push("INVALID_COMPONENT_MANIFEST_SHA256");
  if (!Number.isInteger(receipt?.component_count) || receipt.component_count < 1) errors.push("INVALID_COMPONENT_COUNT");
  if (!SHA256_RE.test(receipt?.remote_snapshot_sha256 ?? "")) errors.push("INVALID_REMOTE_SNAPSHOT_SHA256");
  if (receipt?.remote_component_binding !== "PASS") errors.push("REMOTE_COMPONENT_BINDING_NOT_PASS");
  if (!SHA256_RE.test(receipt?.changed_paths_sha256 ?? "")) errors.push("INVALID_CHANGED_PATHS_SHA256");
  if (!Number.isInteger(receipt?.changed_file_count) || receipt.changed_file_count < 1) errors.push("INVALID_CHANGED_FILE_COUNT");
  if (receipt?.observed_workflow_runs !== 0) errors.push("INVALID_WORKFLOW_RUN_COUNT");
  if (receipt?.v1_non_regression !== "PASS") errors.push("V1_NON_REGRESSION_NOT_PASS");
  if (receipt?.interface_core_binding !== "PASS") errors.push("INTERFACE_CORE_BINDING_NOT_PASS");
  if (receipt?.live_self_hosted_invocation !== "NOT_RUN") errors.push("INVALID_LIVE_INVOCATION_STATE");
  if (receipt?.runtime_a_sealed !== "NO") errors.push("INVALID_RUNTIME_A_SEALED_STATE");
  if (receipt?.sync2_state !== "WAITING_A_REV42_SEALED_MANIFEST") errors.push("INVALID_SYNC2_STATE");
  if (receipt?.lease_state !== "NOT_IMPLEMENTED_PLAN_D") errors.push("INVALID_LEASE_STATE");
  if (receipt?.remote_source_write_authority !== "NONE") errors.push("INVALID_REMOTE_SOURCE_WRITE_AUTHORITY");
  if (!new Set(["PASS", "BLOCKED"]).has(receipt?.result)) errors.push("INVALID_RESULT");
  if (!(receipt?.failure_reason === null || typeof receipt.failure_reason === "string")) errors.push("INVALID_FAILURE_REASON");
  if (receipt?.result === "PASS" && receipt.failure_reason !== null) errors.push("PASS_WITH_FAILURE_REASON");
  if (receipt?.result !== "PASS" && !receipt?.failure_reason) errors.push("BLOCKED_WITHOUT_REASON");
  return { ok: errors.length === 0, errors };
}
