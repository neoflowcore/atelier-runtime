import { createHash } from "node:crypto";

const SHA256_RE = /^[0-9a-f]{64}$/;

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function canonicalize(value) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("LONGRUN_CHECKPOINT_NON_SAFE_INTEGER");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  throw new Error("LONGRUN_CHECKPOINT_UNSUPPORTED_CANONICAL_TYPE");
}

function hash(value) {
  return createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
}

function requireSha(value, code) {
  if (!SHA256_RE.test(value ?? "")) throw new Error(code);
  return value;
}

export function buildLongrunCheckpointV1(input = {}) {
  if (!Number.isSafeInteger(input.checkpointSequence) || input.checkpointSequence < 0) throw new Error("CHECKPOINT_SEQUENCE_INVALID");
  const body = {
    SCHEMA_ID: "LONGRUN_CHECKPOINT_REATTACH_V1",
    SCHEMA_VERSION: "1",
    checkpointId: input.checkpointId,
    checkpointSequence: input.checkpointSequence,
    projectIdentityDigest: requireSha(input.projectIdentityDigest, "PROJECT_IDENTITY_DIGEST_REQUIRED"),
    planManifestDigest: requireSha(input.planManifestDigest, "PLAN_MANIFEST_DIGEST_REQUIRED"),
    branch: input.branch ?? null,
    head: input.head ?? null,
    tree: input.tree ?? null,
    completedWorkIds: [...new Set(input.completedWorkIds ?? [])].sort(),
    evidenceDigests: [...new Set(input.evidenceDigests ?? [])].sort(),
    nextActionId: input.nextActionId ?? null
  };
  if (typeof body.checkpointId !== "string" || !body.checkpointId) throw new Error("CHECKPOINT_ID_REQUIRED");
  return Object.freeze({ ...body, CHECKPOINT_SHA256: hash(body) });
}

export function validateLongrunCheckpointV1(checkpoint) {
  if (!isObject(checkpoint) || checkpoint.SCHEMA_ID !== "LONGRUN_CHECKPOINT_REATTACH_V1") return Object.freeze({ ok: false, errors: ["LONGRUN_CHECKPOINT_REQUIRED"] });
  const errors = [];
  if (!SHA256_RE.test(checkpoint.CHECKPOINT_SHA256 ?? "")) errors.push("CHECKPOINT_SHA256_INVALID");
  else {
    const { CHECKPOINT_SHA256, ...body } = checkpoint;
    if (hash(body) !== CHECKPOINT_SHA256) errors.push("CHECKPOINT_SHA256_MISMATCH");
  }
  return Object.freeze({ ok: errors.length === 0, errors });
}

export function selectIdentityPlanMatchedCheckpointV1(candidates, { projectIdentityDigest, planManifestDigest } = {}) {
  if (!Array.isArray(candidates)) throw new Error("CHECKPOINT_CANDIDATES_REQUIRED");
  requireSha(projectIdentityDigest, "PROJECT_IDENTITY_DIGEST_REQUIRED");
  requireSha(planManifestDigest, "PLAN_MANIFEST_DIGEST_REQUIRED");
  const valid = candidates.filter((checkpoint) => validateLongrunCheckpointV1(checkpoint).ok)
    .filter((checkpoint) => checkpoint.projectIdentityDigest === projectIdentityDigest && checkpoint.planManifestDigest === planManifestDigest)
    .sort((a, b) => b.checkpointSequence - a.checkpointSequence);
  return Object.freeze({ checkpoint: valid[0] ?? null, rejectedCount: candidates.length - valid.length });
}

export function compileReattachDecisionV1(input = {}) {
  if (input.identityResolved !== true) {
    if (Array.isArray(input.safeCurrentProjectLocalActions) && input.safeCurrentProjectLocalActions.length > 0) return Object.freeze({ decision: "CONTINUE_SAFE_LOCAL_WORK", actionId: input.safeCurrentProjectLocalActions[0], pause: false });
    if (input.nextRequiredActionRequiresExternalTarget === true) return Object.freeze({ decision: "PAUSE_IDENTITY_UNRESOLVED", actionId: null, pause: true });
  }
  if (input.planResolved !== true) {
    if (Array.isArray(input.safeCurrentProjectLocalActions) && input.safeCurrentProjectLocalActions.length > 0) return Object.freeze({ decision: "CONTINUE_SAFE_LOCAL_WORK", actionId: input.safeCurrentProjectLocalActions[0], pause: false });
    if (input.nextRequiredActionWouldMateriallyGuessScope === true) return Object.freeze({ decision: "PAUSE_PLAN_UNRESOLVED", actionId: null, pause: true });
  }
  if (input.nextRequiredActionRequiresExternalTarget === true && input.externalTargetMembershipAllowed !== true) return Object.freeze({ decision: "REATTACH_TARGET_MEMBERSHIP_DENIED", actionId: null, pause: true });
  return Object.freeze({ decision: "REATTACH_CONTINUE", actionId: input.checkpoint?.nextActionId ?? null, pause: false, duplicateExecutionAllowed: false, reapprovalRequired: false });
}
