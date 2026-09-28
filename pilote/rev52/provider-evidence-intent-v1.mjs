import { createHash } from "node:crypto";

const SHA256_RE = /^[0-9a-f]{64}$/;
const FORBIDDEN_PROVIDER_KEYS = new Set(["aws", "azure", "gcp", "digitalocean", "github", "cloudflare", "vercel", "providerSpecificApi", "vendorCommand"]);

function isObject(value) { return !!value && typeof value === "object" && !Array.isArray(value); }
function canonicalize(value) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("P52_D4_NON_SAFE_INTEGER");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  throw new Error("P52_D4_UNSUPPORTED_CANONICAL_TYPE");
}
const hash = (value) => createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
function requireSha(value, code) { if (!SHA256_RE.test(value ?? "")) throw new Error(code); return value; }
function requireString(value, code) { if (typeof value !== "string" || !value) throw new Error(code); return value; }

function assertProviderNeutralObject(value) {
  if (!isObject(value)) return;
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_PROVIDER_KEYS.has(key.toLowerCase()) || FORBIDDEN_PROVIDER_KEYS.has(key)) throw new Error("PROVIDER_SPECIFIC_LOGIC_DENIED");
    if (isObject(value[key])) assertProviderNeutralObject(value[key]);
  }
}

export function compileProviderNeutralJobIntentV1(input = {}) {
  assertProviderNeutralObject(input);
  if (!Array.isArray(input.requiredCapabilities) || input.requiredCapabilities.length === 0) throw new Error("REQUIRED_CAPABILITIES_REQUIRED");
  const body = {
    SCHEMA_ID: "PILOTE_PROVIDER_NEUTRAL_JOB_INTENT_V1",
    SCHEMA_VERSION: "1",
    jobId: requireString(input.jobId, "JOB_ID_REQUIRED"),
    executionClass: requireString(input.executionClass, "EXECUTION_CLASS_REQUIRED"),
    requiredCapabilities: [...new Set(input.requiredCapabilities)].sort(),
    runtimeCapabilityContractSha256: requireSha(input.runtimeCapabilityContractSha256, "RUNTIME_CAPABILITY_CONTRACT_SHA256_REQUIRED"),
    executionSurfaceRequirements: [...new Set(input.executionSurfaceRequirements ?? [])].sort(),
    costClass: input.costClass ?? "NO_NEW_PAID_RESOURCE",
    providerSelectionAuthority: "RUNTIME_PROVIDER_CONTROL_LAYER",
    providerSpecificLogic: false
  };
  return Object.freeze({ ...body, JOB_INTENT_SHA256: hash(body) });
}

export function consumeRuntimeCapabilityDecisionV1(decision) {
  if (!isObject(decision) || typeof decision.decision !== "string") throw new Error("RUNTIME_CAPABILITY_DECISION_REQUIRED");
  return Object.freeze({
    admitted: decision.decision === "ADMIT" || decision.allowed === true,
    runtimeDecision: decision.decision,
    providerId: decision.providerId ?? null,
    receiptSha256: decision.receiptSha256 ?? decision.RECEIPT_SHA256 ?? null,
    piloteCapabilityResolutionPerformed: false
  });
}

export function interpretExecutionSurfaceReattachV1(decision) {
  if (!isObject(decision) || typeof decision.decision !== "string") throw new Error("RUNTIME_EXECUTION_SURFACE_DECISION_REQUIRED");
  const allowed = new Set(["HOT_REATTACH", "NO_CURRENT_EXECUTION_SURFACE", "PLATFORM_APPROVAL_REQUIRED"]);
  if (!allowed.has(decision.decision)) throw new Error("RUNTIME_EXECUTION_SURFACE_DECISION_UNKNOWN");
  return Object.freeze({
    runtimeDecision: decision.decision,
    reattach: decision.decision === "HOT_REATTACH",
    surface: decision.surface ?? null,
    platformApprovalRequired: decision.decision === "PLATFORM_APPROVAL_REQUIRED",
    reaskConnection: false,
    staleCapabilityAbsenceTrusted: false
  });
}

export function compileProviderEvidenceAcceptanceV1(input = {}) {
  const body = {
    SCHEMA_ID: "PILOTE_PROVIDER_EVIDENCE_ACCEPTANCE_V1",
    SCHEMA_VERSION: "1",
    evidenceId: requireString(input.evidenceId, "EVIDENCE_ID_REQUIRED"),
    runtimeEvidenceDigest: requireSha(input.runtimeEvidenceDigest, "RUNTIME_EVIDENCE_DIGEST_REQUIRED"),
    runtimeEvidenceStatus: input.runtimeEvidenceStatus ?? "UNKNOWN",
    runtimeInvalidationStatus: input.runtimeInvalidationStatus ?? "VALID",
    requiredDomains: [...new Set(input.requiredDomains ?? [])].sort(),
    accepted: input.runtimeEvidenceStatus === "PASS" && (input.runtimeInvalidationStatus ?? "VALID") === "VALID",
    providerRawBodyCanonicalEvidence: false,
    runtimeEvidenceAuthority: "RUNTIME"
  };
  return Object.freeze({ ...body, EVIDENCE_ACCEPTANCE_SHA256: hash(body) });
}

export function consumeContentIdentityEvidenceReuseV1(runtimeReuseDecision) {
  if (!isObject(runtimeReuseDecision)) throw new Error("RUNTIME_CONTENT_IDENTITY_REUSE_DECISION_REQUIRED");
  const accepted = runtimeReuseDecision.reusable === true || runtimeReuseDecision.decision === "REUSE_ALLOWED" || runtimeReuseDecision.code === "CONTENT_IDENTITY_REUSE_ALLOWED";
  return Object.freeze({ accepted, runtimeDecision: runtimeReuseDecision.decision ?? runtimeReuseDecision.code ?? null, piloteIdentityComparisonPerformed: false });
}

export function acceptBillingResidueReceiptV1(receipt) {
  if (!isObject(receipt) || receipt.SCHEMA_ID !== "BILLING_RESIDUE_RECEIPT_V3") throw new Error("RUNTIME_BILLING_RESIDUE_RECEIPT_V3_REQUIRED");
  const accepted = receipt.status === "PASS" && receipt.activePaidCompute === 0 && receipt.orphanedBillableResource === 0 && receipt.billableResidue === 0 && receipt.deleteOrTerminateReadback === true && receipt.childBillableArtifactsScanned === true;
  return Object.freeze({ accepted, decision: accepted ? "BILLING_RESIDUE_ACCEPTED" : "BILLING_RESIDUE_REJECTED", runtimeReceiptSha256: receipt.RECEIPT_SHA256 ?? null });
}

export function compileAcceptanceDependencyGraphV1(nodes = []) {
  if (!Array.isArray(nodes)) throw new Error("ACCEPTANCE_NODES_REQUIRED");
  const ids = new Set();
  const normalized = nodes.map((node) => {
    if (!isObject(node) || typeof node.id !== "string" || !node.id || ids.has(node.id)) throw new Error("ACCEPTANCE_NODE_INVALID");
    ids.add(node.id);
    return { id: node.id, status: node.status ?? "PENDING", dependsOn: [...new Set(node.dependsOn ?? [])].sort(), evidenceRef: node.evidenceRef ?? null };
  }).sort((a, b) => a.id.localeCompare(b.id));
  for (const node of normalized) for (const dep of node.dependsOn) if (!ids.has(dep)) throw new Error("ACCEPTANCE_DEPENDENCY_MISSING");
  const body = { SCHEMA_ID: "PILOTE_ACCEPTANCE_DEPENDENCY_GRAPH_V1", SCHEMA_VERSION: "1", nodes: normalized };
  return Object.freeze({ ...body, GRAPH_SHA256: hash(body) });
}

export function evaluateAcceptanceDependencyGraphV1(graph) {
  if (!graph || graph.SCHEMA_ID !== "PILOTE_ACCEPTANCE_DEPENDENCY_GRAPH_V1") throw new Error("PILOTE_ACCEPTANCE_GRAPH_REQUIRED");
  const map = new Map(graph.nodes.map((node) => [node.id, node]));
  const blocked = [];
  const accepted = [];
  for (const node of graph.nodes) {
    const depsPass = node.dependsOn.every((id) => map.get(id)?.status === "PASS");
    if (node.status === "PASS" && depsPass) accepted.push(node.id);
    else blocked.push(node.id);
  }
  return Object.freeze({ status: blocked.length === 0 ? "PASS" : "BLOCKED", accepted, blocked });
}
