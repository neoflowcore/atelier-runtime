import { createHash } from "node:crypto";
import { RUNTIME_C_DEV_PLANE_RECEIPT_TYPE } from "./plan-c-dev-plane.mjs";

export const RUNTIME_C_DAG_RECEIPT_TYPE = "RUNTIME_C_TASK_DAG_V1";

const NODE_SPECS = Object.freeze([
  ["SOURCE_READBACK", [], "PROVIDER_READ", false, false],
  ["WORKSPACE_PREPARE", ["SOURCE_READBACK"], "LOCAL_WORKSPACE", false, false],
  ["LOCAL_TASK_EXECUTE", ["WORKSPACE_PREPARE"], "LOCAL_WORKSPACE", false, false],
  ["TOUCH_SET_VERIFY", ["LOCAL_TASK_EXECUTE"], "LOCAL_VERIFY", false, false],
  ["ACCEPTANCE_VERIFY", ["TOUCH_SET_VERIFY"], "LOCAL_VERIFY", false, false],
  ["CANDIDATE_COMMIT_PREPARE", ["ACCEPTANCE_VERIFY"], "LOCAL_GIT", false, false],
  ["CANDIDATE_PUSH_GATEWAY", ["CANDIDATE_COMMIT_PREPARE"], "REMOTE_SOURCE_WRITE", true, true],
  ["CANDIDATE_READBACK", ["CANDIDATE_PUSH_GATEWAY"], "PROVIDER_READ", false, false],
  ["DRAFT_PR_GATEWAY", ["CANDIDATE_READBACK"], "REMOTE_PROVIDER_MUTATION", true, true],
  ["DRAFT_PR_READBACK", ["DRAFT_PR_GATEWAY"], "PROVIDER_READ", false, false],
  ["RECEIPT_FINALIZE", ["DRAFT_PR_READBACK"], "LOCAL_COMPUTE", false, false]
]);

function sha256Json(value) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function compileNodes() {
  return NODE_SPECS.map(([node_id, depends_on, operation_class, remote_mutation, gateway_required]) => ({
    node_id,
    depends_on: [...depends_on],
    operation_class,
    remote_mutation,
    gateway_required
  }));
}

export function validateRuntimeCTaskDag(receipt) {
  const errors = [];
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) return { ok: false, errors: ["DAG_RECEIPT_MISSING"] };
  if (receipt.receipt_type !== RUNTIME_C_DAG_RECEIPT_TYPE) errors.push("DAG_RECEIPT_TYPE_MISMATCH");
  const expectedNodes = compileNodes();
  if (JSON.stringify(receipt.nodes) !== JSON.stringify(expectedNodes)) errors.push("DAG_NODES_MISMATCH");
  const mutationNodes = (receipt.nodes ?? []).filter((node) => node.remote_mutation === true);
  if (mutationNodes.length !== 2) errors.push("REMOTE_MUTATION_NODE_COUNT_MISMATCH");
  if (mutationNodes.some((node) => node.gateway_required !== true)) errors.push("REMOTE_MUTATION_OUTSIDE_GATEWAY");
  if ((receipt.nodes ?? []).some((node) => /MERGE|RELEASE|LEASE/.test(node.node_id))) errors.push("FORBIDDEN_PLAN_D_OR_RELEASE_NODE");
  const { dag_sha256, ...payload } = receipt;
  if (sha256Json(payload) !== dag_sha256) errors.push("DAG_DIGEST_MISMATCH");
  return { ok: errors.length === 0, errors };
}

export function buildRuntimeCTaskDag(devPlaneReceipt) {
  const errors = [];
  if (devPlaneReceipt?.receipt_type !== RUNTIME_C_DEV_PLANE_RECEIPT_TYPE) errors.push("DEV_PLANE_RECEIPT_TYPE_MISMATCH");
  if (devPlaneReceipt?.result !== "ELIGIBLE") errors.push("DEV_PLANE_NOT_ELIGIBLE");
  if (devPlaneReceipt?.remote_source_write_authority !== "GATEWAY_ONLY") errors.push("DEV_PLANE_GATEWAY_AUTHORITY_REQUIRED");
  if (devPlaneReceipt?.lease_state !== "NOT_IMPLEMENTED_PLAN_D") errors.push("PLAN_D_LEASE_FENCE_VIOLATION");

  const payload = {
    receipt_type: RUNTIME_C_DAG_RECEIPT_TYPE,
    task_contract_hash: devPlaneReceipt?.task_contract_hash ?? null,
    workspace_identity_sha256: devPlaneReceipt?.workspace_identity_sha256 ?? null,
    execution_profile: devPlaneReceipt?.execution_profile ?? null,
    nodes: compileNodes(),
    remote_mutation_nodes: ["CANDIDATE_PUSH_GATEWAY", "DRAFT_PR_GATEWAY"],
    source_write_policy: "GATEWAY_ONLY",
    merge_authority: "NONE",
    lease_state: "NOT_IMPLEMENTED_PLAN_D",
    result: errors.length === 0 ? "READY" : "BLOCKED",
    reasons: errors
  };
  return { ...payload, dag_sha256: sha256Json(payload) };
}
