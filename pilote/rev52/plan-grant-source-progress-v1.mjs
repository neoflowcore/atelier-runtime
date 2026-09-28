import { createHash } from "node:crypto";

const SHA256_RE = /^[0-9a-f]{64}$/;
const SOURCE_KINDS = new Set(["SOURCE", "CODE", "TEST", "DOCS", "CONFIG", "SPEC", "PROVIDER_INDEPENDENT_EVIDENCE"]);
const DEFERRED_KINDS = new Set(["AUTH", "PROVIDER_LIVE", "PAID_RESOURCE", "FINAL_MERGE_RELEASE"]);
const BLOCKING_DEPENDENCY_TYPES = new Set(["SEMANTIC", "SAFETY"]);

function isObject(value) { return !!value && typeof value === "object" && !Array.isArray(value); }
function canonicalize(value) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("P52_D1_NON_SAFE_INTEGER");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  throw new Error("P52_D1_UNSUPPORTED_CANONICAL_TYPE");
}
const hash = (value) => createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
function requireSha(value, code) { if (!SHA256_RE.test(value ?? "")) throw new Error(code); return value; }
function requireString(value, code) { if (typeof value !== "string" || !value) throw new Error(code); return value; }

function normalizePhase(phase, index) {
  if (!isObject(phase)) throw new Error("PILOTE_PLAN_PHASE_INVALID");
  const id = requireString(phase.id, "PILOTE_PLAN_PHASE_ID_REQUIRED");
  const dependsOn = [...new Set(phase.dependsOn ?? [])].sort();
  const work = (phase.work ?? []).map((node, nodeIndex) => {
    if (!isObject(node) || typeof node.id !== "string" || !node.id) throw new Error("PILOTE_PLAN_WORK_NODE_INVALID");
    const kind = node.kind ?? "CODE";
    if (!SOURCE_KINDS.has(kind) && !DEFERRED_KINDS.has(kind)) throw new Error("PILOTE_PLAN_WORK_KIND_INVALID");
    return {
      id: node.id,
      kind,
      order: Number.isSafeInteger(node.order) ? node.order : nodeIndex,
      dependsOn: [...new Set(node.dependsOn ?? [])].sort(),
      liveDependency: node.liveDependency ?? null
    };
  }).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  return { id, order: Number.isSafeInteger(phase.order) ? phase.order : index, dependsOn, work };
}

export function compileAuthoritativePlanV1(input = {}) {
  requireSha(input.dependencyLockSha256, "DEPENDENCY_LOCK_SHA256_REQUIRED");
  requireSha(input.planDigest, "PLAN_DIGEST_REQUIRED");
  if (!Array.isArray(input.phases) || input.phases.length === 0) throw new Error("PILOTE_PLAN_PHASES_REQUIRED");
  const phases = input.phases.map(normalizePhase).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const ids = new Set();
  for (const phase of phases) {
    if (ids.has(phase.id)) throw new Error("PILOTE_PLAN_DUPLICATE_PHASE_ID");
    ids.add(phase.id);
  }
  for (const phase of phases) for (const dep of phase.dependsOn) if (!ids.has(dep)) throw new Error("PILOTE_PLAN_PHASE_DEPENDENCY_MISSING");
  const body = {
    SCHEMA_ID: "PILOTE_AUTHORITATIVE_PLAN_V1",
    SCHEMA_VERSION: "1",
    planId: requireString(input.planId, "PLAN_ID_REQUIRED"),
    planDigest: input.planDigest,
    dependencyLockSha256: input.dependencyLockSha256,
    phases,
    runtimeSemanticAuthority: "CONSUME_ONLY",
    runtimeResolverReimplementation: false
  };
  return Object.freeze({ ...body, PILOTE_PLAN_SHA256: hash(body) });
}

export function compileMasterPlanDependencyGraphV1(plan) {
  if (!plan || plan.SCHEMA_ID !== "PILOTE_AUTHORITATIVE_PLAN_V1") throw new Error("PILOTE_AUTHORITATIVE_PLAN_REQUIRED");
  const indegree = new Map(plan.phases.map((phase) => [phase.id, 0]));
  const outgoing = new Map(plan.phases.map((phase) => [phase.id, []]));
  for (const phase of plan.phases) {
    for (const dep of phase.dependsOn) {
      indegree.set(phase.id, indegree.get(phase.id) + 1);
      outgoing.get(dep).push(phase.id);
    }
  }
  const queue = plan.phases.filter((phase) => indegree.get(phase.id) === 0).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const ordered = [];
  while (queue.length) {
    const current = queue.shift();
    ordered.push(current.id);
    for (const next of outgoing.get(current.id).sort()) {
      indegree.set(next, indegree.get(next) - 1);
      if (indegree.get(next) === 0) queue.push(plan.phases.find((phase) => phase.id === next));
      queue.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    }
  }
  if (ordered.length !== plan.phases.length) throw new Error("PILOTE_PLAN_DEPENDENCY_CYCLE");
  const body = { SCHEMA_ID: "PILOTE_MASTER_PLAN_DEPENDENCY_GRAPH_V1", SCHEMA_VERSION: "1", planSha256: plan.PILOTE_PLAN_SHA256, phaseOrder: ordered };
  return Object.freeze({ ...body, GRAPH_SHA256: hash(body) });
}

export function compileProjectRunGrantV1(input = {}) {
  const body = {
    SCHEMA_ID: "PILOTE_PROJECT_RUN_GRANT_V1",
    SCHEMA_VERSION: "1",
    grantId: requireString(input.grantId, "PROJECT_RUN_GRANT_ID_REQUIRED"),
    dependencyLockSha256: requireSha(input.dependencyLockSha256, "DEPENDENCY_LOCK_SHA256_REQUIRED"),
    planSha256: requireSha(input.planSha256, "PILOTE_PLAN_SHA256_REQUIRED"),
    graphSha256: requireSha(input.graphSha256, "PILOTE_GRAPH_SHA256_REQUIRED"),
    developmentBranch: requireString(input.developmentBranch, "DEVELOPMENT_BRANCH_REQUIRED"),
    allowedPhaseIds: [...new Set(input.allowedPhaseIds ?? [])].sort(),
    longRunScope: "PILOTE_REV52_TRACK_B",
    allowPhaseAutoTransition: true,
    allowContinueWithoutReapproval: true,
    runtimeSourceMutationAllowed: false,
    providerSpecificLogicAllowed: false,
    state: input.state ?? "ACTIVE"
  };
  if (!new Set(["ACTIVE", "SUSPENDED", "CONSUMED"]).has(body.state)) throw new Error("PROJECT_RUN_GRANT_STATE_INVALID");
  return Object.freeze({ ...body, PROJECT_RUN_GRANT_SHA256: hash(body) });
}

export function compilePhaseExecutionGrantV1(input = {}) {
  const body = {
    SCHEMA_ID: "PILOTE_PHASE_EXECUTION_GRANT_V1",
    SCHEMA_VERSION: "1",
    projectRunGrantSha256: requireSha(input.projectRunGrantSha256, "PROJECT_RUN_GRANT_SHA256_REQUIRED"),
    phaseId: requireString(input.phaseId, "PHASE_ID_REQUIRED"),
    activeWorkIds: [...new Set(input.activeWorkIds ?? [])].sort(),
    deferredWorkIds: [...new Set(input.deferredWorkIds ?? [])].sort(),
    checkpointNotTermination: true,
    reapprovalOnPhaseTransition: false
  };
  return Object.freeze({ ...body, PHASE_EXECUTION_GRANT_SHA256: hash(body) });
}

export function compileSourceProgressPolicyV1(input = {}) {
  const body = {
    SCHEMA_ID: "PILOTE_SOURCE_PROGRESS_POLICY_V1",
    SCHEMA_VERSION: "1",
    projectRunGrantSha256: requireSha(input.projectRunGrantSha256, "PROJECT_RUN_GRANT_SHA256_REQUIRED"),
    activeKinds: [...SOURCE_KINDS].sort(),
    deferredKinds: [...DEFERRED_KINDS].sort(),
    blockingLiveDependencyTypes: [...BLOCKING_DEPENDENCY_TYPES].sort(),
    runtimeResolverAuthority: "RUNTIME_NEXT_LEGAL_ACTION_RESOLVER",
    runtimeAuthEligibilityAuthority: "RUNTIME_AUTH_ENDGAME_ELIGIBILITY",
    currentPhaseExhaustionMeansProjectExhaustion: false,
    inferredLiveDependencyBlocksSource: false
  };
  return Object.freeze({ ...body, SOURCE_PROGRESS_POLICY_SHA256: hash(body) });
}

export function compileExplicitDependencyV1(input = {}) {
  const type = requireString(input.type, "DEPENDENCY_TYPE_REQUIRED");
  const actionId = requireString(input.actionId, "DEPENDENCY_ACTION_ID_REQUIRED");
  return Object.freeze({
    SCHEMA_ID: "PILOTE_EXPLICIT_DEPENDENCY_V1",
    SCHEMA_VERSION: "1",
    type,
    actionId,
    blocksSourceProgress: BLOCKING_DEPENDENCY_TYPES.has(type),
    compilerAuthority: "PILOTE",
    runtimeExecutionDecisionAuthority: "RUNTIME"
  });
}

export function interpretRuntimeProjectRunStateV2V1({ runtimeState, sourceProgressPolicy } = {}) {
  if (!runtimeState || runtimeState.SCHEMA_ID !== "PROJECT_RUN_STATE_V2") throw new Error("RUNTIME_PROJECT_RUN_STATE_V2_REQUIRED");
  if (!sourceProgressPolicy || sourceProgressPolicy.SCHEMA_ID !== "PILOTE_SOURCE_PROGRESS_POLICY_V1") throw new Error("PILOTE_SOURCE_PROGRESS_POLICY_REQUIRED");
  const deferred = [
    runtimeState.DEFERRED_AUTH_NEXT,
    ...(runtimeState.DEFERRED_PROVIDER_LIVE_WORK ?? []),
    ...(runtimeState.DEFERRED_PAID_RESOURCE_WORK ?? []),
    ...(runtimeState.DEFERRED_FINAL_MERGE_RELEASE_WORK ?? [])
  ].filter(Boolean);
  return Object.freeze({
    activeNext: runtimeState.ACTIVE_NEXT ?? null,
    deferred,
    interpretation: runtimeState.ACTIVE_NEXT ? "CONSUME_RUNTIME_ACTIVE_NEXT" : "REQUEST_RUNTIME_NEXT_LEGAL_ACTION_RESOLUTION",
    authEligibilityDecisionMadeByPilote: false
  });
}
